import {
  CapacityError,
  MemoryRateLimiter,
  assessRisk,
  type ChallengeType,
  type CreateChallengeOptions,
  type ImageCandidate,
  type OorableCaptchaEngine,
  type RateLimitResult,
  type RateLimiter,
  type RiskAssessment,
  type RiskThresholds,
} from "@oorable/captcha";
import { rateLimitKeyForIp } from "./ip.ts";
import {
  DIFFICULTY_ORDER,
  SiteRegistry,
  isSiteKeyShape,
  maxDifficulty,
  safeEqualStrings,
  type Difficulty,
  type SiteConfig,
} from "./sites.ts";

// ------------------------------------------------------------------ transport shapes

export interface ApiRequest {
  method: string;
  /** Path without query string, e.g. "/v1/challenges". */
  path: string;
  /** Decoded query parameters. */
  query?: Record<string, string>;
  /** Lower-cased header names. */
  headers: Record<string, string | string[] | undefined>;
  /** Client address as resolved by the transport (see clientIp()). */
  ip: string;
  /** Parsed JSON body. The transport is responsible for size-limiting it. */
  body?: unknown;
  /** Set by the transport when the body could not be read or parsed. */
  bodyError?: "payload_too_large" | "invalid_json" | "unsupported_media_type" | "body_timeout";
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON-serializable body... */
  json?: unknown;
  /** ...or raw bytes (puzzle tiles). */
  raw?: Buffer;
}

// ------------------------------------------------------------------------ options

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitOptions {
  createPerIp?: RateLimitPolicy;
  createPerSite?: RateLimitPolicy;
  createPerSession?: RateLimitPolicy;
  verifyPerIp?: RateLimitPolicy;
  verifyPerSite?: RateLimitPolicy;
  /** Charged only when a verification FAILS (or a secret is wrong); checked before every verify. */
  failedVerifyPerIp?: RateLimitPolicy;
  /** Charged when a client replays an already-solved challenge. */
  replayPerIp?: RateLimitPolicy;
  tilePerIp?: RateLimitPolicy;
  redeemPerSite?: RateLimitPolicy;
}

export const DEFAULT_RATE_LIMITS: Required<RateLimitOptions> = {
  createPerIp: { limit: 30, windowMs: 60_000 },
  createPerSite: { limit: 3_000, windowMs: 60_000 },
  createPerSession: { limit: 20, windowMs: 60_000 },
  verifyPerIp: { limit: 60, windowMs: 60_000 },
  verifyPerSite: { limit: 6_000, windowMs: 60_000 },
  failedVerifyPerIp: { limit: 20, windowMs: 300_000 },
  replayPerIp: { limit: 10, windowMs: 300_000 },
  tilePerIp: { limit: 600, windowMs: 60_000 },
  redeemPerSite: { limit: 6_000, windowMs: 60_000 },
};

type LimiterName = keyof RateLimitOptions;

export interface RiskOptions {
  /** score >= challenge escalates difficulty; score >= block refuses to issue challenges. */
  thresholds?: RiskThresholds;
  /** Retry-After sent when a request is refused by the risk engine. Default 60. */
  blockSeconds?: number;
}

export type ApiEvent =
  | { name: "request"; method: string; route: string; status: number; durationMs: number }
  | { name: "error"; route: string; errorName: string };

/** Either a bare candidate list, or a list plus the instruction to show above it. */
export type ImageCatalogue = ImageCandidate[] | { prompt?: string; candidates: ImageCandidate[] };

export interface ApiOptions {
  engine: OorableCaptchaEngine;
  /**
   * Registered sites. When present, every request must carry a known siteKey.
   * When omitted the API accepts any (or no) siteKey -- fine for local
   * development, not for production; `oorable-captcha doctor` flags it.
   */
  sites?: SiteConfig[];
  /**
   * Source of image-selection challenges. It runs on the SERVER and decides
   * both the images and which ones are correct. Clients can never supply
   * candidates: a client-chosen answer key would defeat the challenge.
   */
  imageCandidates?: (site: SiteConfig | undefined) => ImageCatalogue | Promise<ImageCatalogue>;
  /** Pass `false` to disable rate limiting entirely (tests only). */
  rateLimit?: RateLimitOptions | false;
  /** Create the limiter behind each policy. Default: in-memory. Use @oorable/captcha-redis for multi-instance deployments. */
  limiterFactory?: (name: string, policy: RateLimitPolicy) => RateLimiter;
  /** What to do when a limiter itself fails (e.g. Redis outage). Default "closed": refuse with 503. */
  onLimiterError?: "closed" | "open";
  /** Opt-in risk scoring built from this server's own limiter state. */
  risk?: RiskOptions;
  /** Browser origins allowed to call the API cross-origin. Default: none (same-origin only). */
  cors?: { allowedOrigins: string[] | "*" };
  /** Return specific failure reasons (not_found, already_used...) instead of a collapsed "invalid". Development aid. */
  exposeDetailedReasons?: boolean;
  /** Bearer token protecting GET /v1/metrics. When unset the route does not exist. */
  metricsToken?: string;
  /** Bearer token protecting GET /v1/admin/assets. When unset the route does not exist. */
  adminToken?: string;
  /** Structured, secret-free events for logging/observability. */
  onEvent?: (event: ApiEvent) => void;
}

export interface ApiMetrics {
  requests: Record<string, number>;
  challengesCreated: Record<string, number>;
  verifications: Record<string, number>;
  tokenRedemptions: Record<string, number>;
  rateLimited: Record<string, number>;
  riskDecisions: Record<string, number>;
}

// ---------------------------------------------------------------------- routing

type RouteName =
  | "health"
  | "createChallenge"
  | "verifyChallenge"
  | "refreshChallenge"
  | "redeemToken"
  | "tile"
  | "metrics"
  | "adminAssets";

interface RouteDef {
  name: RouteName;
  /** Path template used in logs and metrics. Never contains real tokens. */
  label: string;
  methods: string[];
  pattern: RegExp;
}

const ROUTES: RouteDef[] = [
  { name: "health", label: "/v1/health", methods: ["GET"], pattern: /^\/v1\/health$/ },
  { name: "createChallenge", label: "/v1/challenges", methods: ["POST"], pattern: /^\/v1\/challenges$/ },
  { name: "verifyChallenge", label: "/v1/challenges/verify", methods: ["POST"], pattern: /^\/v1\/challenges\/verify$/ },
  { name: "refreshChallenge", label: "/v1/challenges/refresh", methods: ["POST"], pattern: /^\/v1\/challenges\/refresh$/ },
  { name: "redeemToken", label: "/v1/tokens/verify", methods: ["POST"], pattern: /^\/v1\/tokens\/verify$/ },
  { name: "tile", label: "/v1/assets/tile/:token", methods: ["GET"], pattern: /^\/v1\/assets\/tile\/([A-Za-z0-9._-]{1,512})$/ },
  { name: "metrics", label: "/v1/metrics", methods: ["GET"], pattern: /^\/v1\/metrics$/ },
  { name: "adminAssets", label: "/v1/admin/assets", methods: ["GET"], pattern: /^\/v1\/admin\/assets$/ },
];

type Match =
  | { kind: "match"; def: RouteDef; params: string[] }
  | { kind: "method_not_allowed"; def: RouteDef }
  | { kind: "not_found" };

function matchRoute(method: string, path: string): Match {
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  for (const def of ROUTES) {
    const m = def.pattern.exec(normalized);
    if (!m) continue;
    if (!def.methods.includes(method)) return { kind: "method_not_allowed", def };
    return { kind: "match", def, params: m.slice(1) };
  }
  return { kind: "not_found" };
}

// ---------------------------------------------------------------------- helpers

const TYPES: readonly ChallengeType[] = ["meme-puzzle", "text", "image"];
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const LOCALE_PATTERN = /^[A-Za-z0-9-]{2,35}$/;

const PUBLIC_REASON: Record<string, string> = {
  incorrect: "incorrect",
  expired: "expired",
  too_many_attempts: "too_many_attempts",
  // Collapsed so the API is not an oracle for "did this challenge id ever exist / was it solved".
  not_found: "invalid",
  already_used: "invalid",
  site_key_mismatch: "invalid",
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse {
  return { status, headers, json: body };
}

function failure(status: number, error: string, headers: Record<string, string> = {}): ApiResponse {
  return json(status, { error }, headers);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

type Field = { ok: true; value: string | undefined } | { ok: false };

function readString(obj: Record<string, unknown>, key: string, max: number, pattern?: RegExp): Field {
  const v = obj[key];
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (typeof v !== "string" || v.length > max || (pattern && !pattern.test(v))) return { ok: false };
  return { ok: true, value: v };
}

function header(req: ApiRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

function bearer(req: ApiRequest): string | undefined {
  const value = header(req, "authorization");
  const m = value ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null;
  return m?.[1];
}

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function bumpDifficulty(d: Difficulty): Difficulty {
  return DIFFICULTY_ORDER[Math.min(DIFFICULTY_ORDER.length - 1, DIFFICULTY_ORDER.indexOf(d) + 1)] ?? d;
}

const NO_LIMIT: RateLimitResult = { allowed: true, remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
const noLimiter: RateLimiter = {
  consume: async () => NO_LIMIT,
  peek: async () => NO_LIMIT,
};

/** Prometheus text exposition for the counters this API keeps. */
export function renderPrometheus(metrics: ApiMetrics): string {
  const lines: string[] = [];
  const emit = (name: string, help: string, label: string, counter: Record<string, number>) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [k, v] of Object.entries(counter)) {
      lines.push(`${name}{${label}="${k.replace(/["\\\n]/g, "_")}"} ${v}`);
    }
  };
  emit("oorable_requests_total", "HTTP requests by route and status.", "route_status", metrics.requests);
  emit("oorable_challenges_created_total", "Challenges issued by type.", "type", metrics.challengesCreated);
  emit("oorable_verifications_total", "Verification outcomes.", "outcome", metrics.verifications);
  emit("oorable_token_redemptions_total", "Token redemption outcomes.", "outcome", metrics.tokenRedemptions);
  emit("oorable_rate_limited_total", "Requests refused by a rate limit.", "limiter", metrics.rateLimited);
  emit("oorable_risk_decisions_total", "Risk engine decisions.", "action", metrics.riskDecisions);
  return `${lines.join("\n")}\n`;
}

// -------------------------------------------------------------------------- API

export class CaptchaApi {
  readonly metrics: ApiMetrics = {
    requests: {},
    challengesCreated: {},
    verifications: {},
    tokenRedemptions: {},
    rateLimited: {},
    riskDecisions: {},
  };

  private readonly engine: OorableCaptchaEngine;
  private readonly options: ApiOptions;
  private readonly sites?: SiteRegistry;
  private readonly policies: Required<RateLimitOptions>;
  private readonly limiters: Record<LimiterName, RateLimiter>;
  private readonly enabledTypes: ChallengeType[];

  constructor(options: ApiOptions) {
    this.options = options;
    this.engine = options.engine;
    this.sites = options.sites && options.sites.length > 0 ? new SiteRegistry(options.sites) : undefined;
    this.policies = { ...DEFAULT_RATE_LIMITS, ...(options.rateLimit || {}) };
    const factory = options.limiterFactory ?? ((_name, p) => new MemoryRateLimiter(p.limit, p.windowMs));
    this.limiters = {} as Record<LimiterName, RateLimiter>;
    for (const name of Object.keys(this.policies) as LimiterName[]) {
      this.limiters[name] = options.rateLimit === false ? noLimiter : factory(name, this.policies[name]);
    }
    this.enabledTypes = options.imageCandidates ? [...TYPES] : TYPES.filter((t) => t !== "image");
  }

  close(): void {
    const seen = new Set<RateLimiter>();
    for (const limiter of Object.values(this.limiters)) {
      if (!seen.has(limiter)) {
        seen.add(limiter);
        limiter.close?.();
      }
    }
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const started = Date.now();
    const match = req.method === "OPTIONS" ? undefined : matchRoute(req.method, req.path);
    const label = match?.kind === "match" || match?.kind === "method_not_allowed" ? match.def.label : "unmatched";

    let response: ApiResponse;
    try {
      response = await this.dispatch(req, match);
    } catch (err) {
      // Never surface internals to the caller, and never log request content.
      this.options.onEvent?.({ name: "error", route: label, errorName: err instanceof Error ? err.name : "UnknownError" });
      response = err instanceof CapacityError
        ? failure(503, "temporarily_unavailable", { "Retry-After": "5" })
        : failure(500, "internal_error");
    }

    response = this.decorate(req, response);
    bump(this.metrics.requests, `${label}:${response.status}`);
    this.options.onEvent?.({
      name: "request",
      method: req.method,
      route: label,
      status: response.status,
      durationMs: Date.now() - started,
    });
    return response;
  }

  // ------------------------------------------------------------------ plumbing

  private decorate(req: ApiRequest, res: ApiResponse): ApiResponse {
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Oorable-Api-Version": "1",
      ...res.headers,
    };
    const cors = this.options.cors;
    if (cors) {
      headers["Vary"] = "Origin";
      const origin = header(req, "origin");
      if (origin && (cors.allowedOrigins === "*" || cors.allowedOrigins.includes(origin))) {
        headers["Access-Control-Allow-Origin"] = cors.allowedOrigins === "*" ? "*" : origin;
      }
    }
    return { ...res, headers };
  }

  private preflight(req: ApiRequest): ApiResponse {
    const headers: Record<string, string> = { Allow: "GET, POST, OPTIONS" };
    const cors = this.options.cors;
    const origin = header(req, "origin");
    if (cors && origin && (cors.allowedOrigins === "*" || cors.allowedOrigins.includes(origin))) {
      headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
      headers["Access-Control-Max-Age"] = "600";
    }
    return { status: 204, headers };
  }

  private async limited(name: LimiterName, key: string): Promise<ApiResponse | undefined> {
    let result: RateLimitResult;
    try {
      result = await this.limiters[name].consume(`${name}:${key}`);
    } catch {
      return this.options.onLimiterError === "open" ? undefined : failure(503, "temporarily_unavailable", { "Retry-After": "5" });
    }
    if (result.allowed) return undefined;
    bump(this.metrics.rateLimited, name);
    return failure(429, "rate_limited", { "Retry-After": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) });
  }

  /** True when the (read-only) budget is exhausted. */
  private async exhausted(name: LimiterName, key: string): Promise<{ resetAt: number } | undefined> {
    try {
      const result = await this.limiters[name].peek(`${name}:${key}`);
      return result.allowed ? undefined : { resetAt: result.resetAt };
    } catch {
      return this.options.onLimiterError === "open" ? undefined : { resetAt: Date.now() + 5_000 };
    }
  }

  private async charge(name: LimiterName, key: string): Promise<void> {
    try {
      await this.limiters[name].consume(`${name}:${key}`);
    } catch {
      /* charging a penalty budget is best-effort */
    }
  }

  private rateLimitedResponse(name: string, resetAt: number): ApiResponse {
    bump(this.metrics.rateLimited, name);
    return failure(429, "rate_limited", { "Retry-After": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) });
  }

  private originAllowed(req: ApiRequest, site: SiteConfig): boolean {
    const origin = header(req, "origin");
    if (origin === undefined || !site.allowedOrigins) return true;
    return site.allowedOrigins.includes(origin);
  }

  private resolveSite(req: ApiRequest, siteKey: string | undefined): { error: ApiResponse } | { site?: SiteConfig; siteKey?: string } {
    if (this.sites) {
      const site = siteKey ? this.sites.get(siteKey) : undefined;
      if (!site) return { error: failure(403, "invalid_site") };
      if (!this.originAllowed(req, site)) return { error: failure(403, "origin_not_allowed") };
      return { site, siteKey };
    }
    return { siteKey };
  }

  private bodyProblem(req: ApiRequest): ApiResponse | undefined {
    switch (req.bodyError) {
      case "payload_too_large":
        return failure(413, "payload_too_large");
      case "unsupported_media_type":
        return failure(415, "unsupported_media_type");
      case "body_timeout":
        return failure(408, "request_timeout");
      case "invalid_json":
        return failure(400, "invalid_request");
      default:
        return undefined;
    }
  }

  private async riskFor(ipKey: string): Promise<RiskAssessment | undefined> {
    const risk = this.options.risk;
    if (!risk) return undefined;
    const thresholds = risk.thresholds ?? { challenge: 0.4, block: 0.85 };
    const usage = async (name: LimiterName) => {
      try {
        const r = await this.limiters[name].peek(`${name}:${ipKey}`);
        const limit = this.policies[name].limit;
        return Number.isFinite(r.remaining) ? 1 - r.remaining / limit : 0;
      } catch {
        return 0;
      }
    };
    const assessment = assessRisk(
      [
        { name: "failed_verifications", weight: 3, value: await usage("failedVerifyPerIp") },
        { name: "replayed_challenges", weight: 3, value: await usage("replayPerIp") },
        { name: "challenge_request_rate", weight: 1, value: await usage("createPerIp") },
      ],
      thresholds,
    );
    bump(this.metrics.riskDecisions, assessment.action);
    return assessment;
  }

  // ------------------------------------------------------------------ dispatch

  private async dispatch(req: ApiRequest, match: Match | undefined): Promise<ApiResponse> {
    if (req.method === "OPTIONS") return this.preflight(req);
    if (!match || match.kind === "not_found") return failure(404, "not_found");
    if (match.kind === "method_not_allowed") {
      return failure(405, "method_not_allowed", { Allow: match.def.methods.join(", ") });
    }
    switch (match.def.name) {
      case "health":
        return json(200, { status: "ok", version: "v1" });
      case "createChallenge":
        return this.createChallenge(req);
      case "verifyChallenge":
        return this.verifyChallenge(req);
      case "refreshChallenge":
        return this.refreshChallenge(req);
      case "redeemToken":
        return this.redeemToken(req);
      case "tile":
        return this.tile(req, match.params[0] ?? "");
      case "metrics":
        return this.metricsRoute(req);
      case "adminAssets":
        return this.adminAssets(req);
    }
  }

  // ------------------------------------------------------------------ endpoints

  private async createChallenge(req: ApiRequest): Promise<ApiResponse> {
    const ipKey = rateLimitKeyForIp(req.ip);
    // Per-IP limit first: it needs nothing from the body, so garbage floods are throttled too.
    const ipLimited = await this.limited("createPerIp", ipKey);
    if (ipLimited) return ipLimited;

    const bodyProblem = this.bodyProblem(req);
    if (bodyProblem) return bodyProblem;
    const body = asObject(req.body);
    if (!body) return failure(400, "invalid_request");

    const type = body["type"];
    const difficulty = body["difficulty"];
    const locale = readString(body, "locale", 35, LOCALE_PATTERN);
    const siteKeyField = readString(body, "siteKey", 128);
    const sessionField = readString(body, "sessionId", 128, SESSION_ID_PATTERN);
    if (
      typeof type !== "string" ||
      !(TYPES as readonly string[]).includes(type) ||
      (difficulty !== undefined && !(DIFFICULTY_ORDER as readonly unknown[]).includes(difficulty)) ||
      !locale.ok ||
      !siteKeyField.ok ||
      !sessionField.ok
    ) {
      return failure(400, "invalid_request");
    }

    const resolved = this.resolveSite(req, siteKeyField.value);
    if ("error" in resolved) return resolved.error;
    const { site, siteKey } = resolved;

    const allowed = site?.allowedTypes ?? this.enabledTypes;
    if (!allowed.includes(type as ChallengeType) || !this.enabledTypes.includes(type as ChallengeType)) {
      return failure(400, "unsupported_type");
    }

    const siteLimited = siteKey ? await this.limited("createPerSite", siteKey) : undefined;
    if (siteLimited) return siteLimited;
    if (sessionField.value) {
      const sessionLimited = await this.limited("createPerSession", `${siteKey ?? "-"}:${sessionField.value}`);
      if (sessionLimited) return sessionLimited;
    }

    const risk = await this.riskFor(ipKey);
    if (risk?.action === "block") {
      return this.rateLimitedResponse("risk", Date.now() + (this.options.risk?.blockSeconds ?? 60) * 1000);
    }

    const created = await this.engine.createChallenge(
      await this.optionsFor(type as ChallengeType, {
        site,
        siteKey,
        sessionId: sessionField.value,
        locale: locale.value,
        clientDifficulty: difficulty as Difficulty | undefined,
        escalate: risk?.action === "challenge",
      }),
    );
    bump(this.metrics.challengesCreated, created.type);
    return json(201, {
      challengeId: created.challengeId,
      type: created.type,
      expiresIn: created.expiresIn,
      challenge: created.challenge,
    });
  }

  private async optionsFor(
    type: ChallengeType,
    ctx: {
      site?: SiteConfig;
      siteKey?: string;
      sessionId?: string;
      locale?: string;
      clientDifficulty?: Difficulty;
      escalate: boolean;
    },
  ): Promise<CreateChallengeOptions> {
    const options: CreateChallengeOptions = {
      type,
      siteKey: ctx.siteKey,
      sessionId: ctx.sessionId,
      locale: ctx.locale,
    };
    if (type === "meme-puzzle") {
      // The site owns the floor (default "medium"). A client that says nothing gets the floor;
      // a client may ask for harder, never for easier.
      const floor = ctx.site?.difficulty ?? "medium";
      let difficulty = ctx.clientDifficulty ? maxDifficulty(ctx.clientDifficulty, floor) : floor;
      if (ctx.escalate) difficulty = bumpDifficulty(difficulty);
      options.difficulty = difficulty;
    } else if (type === "text") {
      options.mode = ctx.site?.text?.mode ?? "alphanumeric";
      const base = ctx.site?.text?.length ?? 6;
      options.length = ctx.escalate ? base + 2 : base;
    } else if (type === "image") {
      const catalogue = await this.options.imageCandidates!(ctx.site);
      if (Array.isArray(catalogue)) {
        options.candidates = catalogue;
      } else {
        options.candidates = catalogue.candidates;
        options.prompt = catalogue.prompt;
      }
    }
    return options;
  }

  private async verifyChallenge(req: ApiRequest): Promise<ApiResponse> {
    const ipKey = rateLimitKeyForIp(req.ip);
    const ipLimited = await this.limited("verifyPerIp", ipKey);
    if (ipLimited) return ipLimited;
    const failedBudget = await this.exhausted("failedVerifyPerIp", ipKey);
    if (failedBudget) return this.rateLimitedResponse("failedVerifyPerIp", failedBudget.resetAt);

    const bodyProblem = this.bodyProblem(req);
    if (bodyProblem) return bodyProblem;
    const body = asObject(req.body);
    if (!body) return failure(400, "invalid_request");

    const challengeId = readString(body, "challengeId", 64, CHALLENGE_ID_PATTERN);
    const siteKeyField = readString(body, "siteKey", 128);
    if (!challengeId.ok || challengeId.value === undefined || !siteKeyField.ok || !("answer" in body)) {
      return failure(400, "invalid_request");
    }

    const resolved = this.resolveSite(req, siteKeyField.value);
    if ("error" in resolved) return resolved.error;
    const siteLimited = resolved.siteKey ? await this.limited("verifyPerSite", resolved.siteKey) : undefined;
    if (siteLimited) return siteLimited;

    const result = await this.engine.verifyChallenge({
      challengeId: challengeId.value,
      answer: body["answer"],
      siteKey: resolved.siteKey,
    });

    if (result.success) {
      bump(this.metrics.verifications, "success");
      return json(200, { success: true, verificationToken: result.verificationToken, expiresIn: result.expiresIn });
    }

    bump(this.metrics.verifications, result.reason);
    await this.charge("failedVerifyPerIp", ipKey);
    if (result.reason === "already_used") await this.charge("replayPerIp", ipKey);
    const reason = this.options.exposeDetailedReasons ? result.reason : (PUBLIC_REASON[result.reason] ?? "invalid");
    return json(200, { success: false, reason });
  }

  private async refreshChallenge(req: ApiRequest): Promise<ApiResponse> {
    const ipKey = rateLimitKeyForIp(req.ip);
    // A refresh mints a new challenge, so it spends the same budget as creating one.
    const ipLimited = await this.limited("createPerIp", ipKey);
    if (ipLimited) return ipLimited;

    const bodyProblem = this.bodyProblem(req);
    if (bodyProblem) return bodyProblem;
    const body = asObject(req.body);
    if (!body) return failure(400, "invalid_request");
    const challengeId = readString(body, "challengeId", 64, CHALLENGE_ID_PATTERN);
    const siteKeyField = readString(body, "siteKey", 128);
    if (!challengeId.ok || challengeId.value === undefined || !siteKeyField.ok) return failure(400, "invalid_request");

    const resolved = this.resolveSite(req, siteKeyField.value);
    if ("error" in resolved) return resolved.error;
    const siteLimited = resolved.siteKey ? await this.limited("createPerSite", resolved.siteKey) : undefined;
    if (siteLimited) return siteLimited;

    const overrides: Partial<CreateChallengeOptions> = {};
    if (this.options.imageCandidates) {
      const catalogue = await this.options.imageCandidates(resolved.site);
      overrides.candidates = Array.isArray(catalogue) ? catalogue : catalogue.candidates;
      if (!Array.isArray(catalogue)) overrides.prompt = catalogue.prompt;
    }

    const fresh = await this.engine.refreshChallenge({ challengeId: challengeId.value, siteKey: resolved.siteKey }, overrides);
    if (!fresh) return failure(404, "invalid");
    bump(this.metrics.challengesCreated, fresh.type);
    return json(201, {
      challengeId: fresh.challengeId,
      type: fresh.type,
      expiresIn: fresh.expiresIn,
      challenge: fresh.challenge,
    });
  }

  private async redeemToken(req: ApiRequest): Promise<ApiResponse> {
    const ipKey = rateLimitKeyForIp(req.ip);
    const authBudget = await this.exhausted("failedVerifyPerIp", ipKey);
    if (authBudget) return this.rateLimitedResponse("failedVerifyPerIp", authBudget.resetAt);

    const bodyProblem = this.bodyProblem(req);
    if (bodyProblem) return bodyProblem;
    const body = asObject(req.body);
    if (!body) return failure(400, "invalid_request");
    const token = readString(body, "token", 2048);
    const siteKeyField = readString(body, "siteKey", 128);
    const sessionField = readString(body, "sessionId", 128, SESSION_ID_PATTERN);
    if (!token.ok || token.value === undefined || !siteKeyField.ok || !sessionField.ok) return failure(400, "invalid_request");

    if (this.sites) {
      // Redemption is server-to-server: the site's backend proves who it is with its secret key.
      const site = siteKeyField.value ? this.sites.get(siteKeyField.value) : undefined;
      const presented = bearer(req) ?? "";
      if (!this.sites.verifySecret(site, presented)) {
        await this.charge("failedVerifyPerIp", ipKey); // slows secret guessing
        return failure(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
      }
      const siteLimited = await this.limited("redeemPerSite", siteKeyField.value!);
      if (siteLimited) return siteLimited;
    }

    const result = await this.engine.redeemToken(token.value, {
      siteKey: siteKeyField.value,
      sessionId: sessionField.value,
    });
    bump(this.metrics.tokenRedemptions, result.valid ? "valid" : result.reason);
    return json(200, result);
  }

  private async tile(req: ApiRequest, token: string): Promise<ApiResponse> {
    const limited = await this.limited("tilePerIp", rateLimitKeyForIp(req.ip));
    if (limited) return limited;
    const asset = await this.engine.resolveTile(token);
    if (!asset) return failure(404, "not_found");
    return {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        // Tokens are per-challenge, so a tile is only worth caching for the challenge's lifetime.
        "Cache-Control": "private, max-age=60",
        // If a tile were ever attacker-influenced SVG, this stops it running script or loading anything.
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
      raw: asset.data,
    };
  }

  private authorized(req: ApiRequest, expected: string | undefined): "off" | "denied" | "ok" {
    if (!expected) return "off";
    const presented = bearer(req);
    return presented !== undefined && safeEqualStrings(expected, presented) ? "ok" : "denied";
  }

  private async metricsRoute(req: ApiRequest): Promise<ApiResponse> {
    const auth = this.authorized(req, this.options.metricsToken);
    if (auth === "off") return failure(404, "not_found");
    if (auth === "denied") return failure(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
    if (header(req, "accept")?.includes("text/plain") || req.query?.["format"] === "prometheus") {
      return {
        status: 200,
        headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
        raw: Buffer.from(renderPrometheus(this.metrics), "utf8"),
      };
    }
    return json(200, this.metrics);
  }

  private async adminAssets(req: ApiRequest): Promise<ApiResponse> {
    const auth = this.authorized(req, this.options.adminToken);
    if (auth === "off") return failure(404, "not_found");
    if (auth === "denied") return failure(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
    // Read-only, and deliberately limited to ids and labels. There is no endpoint that returns
    // solutions, tile positions or challenge state -- and no write endpoint: assets are added
    // through the offline pipeline (see docs/asset-management.md).
    const images = await this.engine.listSourceImages();
    return json(200, { count: images.length, images: images.map((i) => ({ id: i.id, label: i.label })) });
  }
}

export function createApi(options: ApiOptions): CaptchaApi {
  return new CaptchaApi(options);
}

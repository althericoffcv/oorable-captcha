import {
  ApiError,
  OorableCaptchaClient,
  type ChallengeType,
  type CreatedChallenge,
  type Difficulty,
  type ImageChallenge,
  type MemePuzzleChallenge,
  type TextChallenge,
  type VerifyResponse,
} from "@oorable/captcha-client";
import { STYLES } from "./styles.ts";
import { formatMessage, isRtl, resolveMessages, type Messages } from "./messages.ts";

export interface RenderOptions {
  /** Your public site key. */
  siteKey?: string;
  /** Default "meme-puzzle". */
  type?: ChallengeType;
  /** Origin of your CAPTCHA server. Default: the page's own origin. */
  apiBaseUrl?: string;
  /** Ask for a harder puzzle than your site's default. It can never be easier than the server allows. */
  difficulty?: Difficulty;
  /** BCP 47 tag. Default: the browser's language. */
  locale?: string;
  /** Default "auto" (follows the operating system). */
  theme?: "auto" | "light" | "dark";
  /** Override any UI string. */
  messages?: Partial<Messages>;
  /** Optional opaque session id; the server can bind the resulting token to it. */
  sessionId?: string;
  /** Mouse drag-and-drop on top of tap-to-swap. Default true. Tap and keyboard always work. */
  dragAndDrop?: boolean;
  /** Name of the hidden form field that receives the token. `false` disables it. Default "oorable-captcha-token". */
  tokenFieldName?: string | false;
  /** CSP nonce, only needed when the browser lacks constructable stylesheets. */
  nonce?: string;
  /** Inject a fetch implementation. */
  fetch?: typeof fetch;
  onSuccess?: (token: string) => void;
  onError?: (error: { code: string; message: string }) => void;
  onExpired?: () => void;
}

export interface CaptchaHandle {
  /** Discards the current challenge and loads a new one. */
  reset(): Promise<void>;
  /** Removes the widget (and the hidden form field it created). */
  destroy(): void;
  /** The verification token, if the user has solved the challenge and it has not expired. */
  getToken(): string | undefined;
  readonly element: HTMLElement;
}

type State = "loading" | "ready" | "verifying" | "success" | "expired" | "error" | "blocked";
type Tone = "info" | "success" | "error";
type Attrs = Record<string, string | number | boolean | undefined>;

const SVG_NS = "http://www.w3.org/2000/svg";
const LOCALE_TAG = /^[A-Za-z0-9-]{2,35}$/;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** The brand mark: two interlocking rings, the double-O of OORABLE. */
function brandMark(): SVGElement {
  const mark = svg("svg", { viewBox: "0 0 34 34", class: "mark", "aria-hidden": "true", focusable: "false" });
  mark.append(
    svg("circle", { cx: "12", cy: "17", r: "8.5", fill: "none", "stroke-width": "3.5", class: "ring-a" }),
    svg("circle", { cx: "22", cy: "17", r: "8.5", fill: "none", "stroke-width": "3.5", class: "ring-b" }),
  );
  return mark;
}

function checkMark(): SVGElement {
  const mark = svg("svg", { viewBox: "0 0 24 24", width: "40", height: "40", "aria-hidden": "true", focusable: "false" });
  mark.append(svg("path", { d: "M5 12.5l4.2 4.2L19 7", fill: "none", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  return mark;
}

let sharedSheet: CSSStyleSheet | undefined;

function applyStyles(root: ShadowRoot, nonce: string | undefined): void {
  try {
    if ("adoptedStyleSheets" in root && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
      // Constructable stylesheets are not "inline style" to CSP, so strict-CSP pages keep working.
      if (!sharedSheet) {
        sharedSheet = new CSSStyleSheet();
        sharedSheet.replaceSync(STYLES);
      }
      root.adoptedStyleSheets = [sharedSheet];
      return;
    }
  } catch {
    /* fall through to a <style> element */
  }
  const style = document.createElement("style");
  if (nonce) style.nonce = nonce;
  style.textContent = STYLES;
  root.append(style);
}

export class CaptchaWidget implements CaptchaHandle {
  readonly element: HTMLElement;

  private readonly options: RenderOptions;
  private readonly msg: Messages;
  private readonly client: OorableCaptchaClient;
  private readonly locale: string | undefined;
  private readonly type: ChallengeType;

  private host!: HTMLElement;
  private root!: HTMLElement;
  private content!: HTMLElement;
  private instructions!: HTMLElement;
  private status!: HTMLElement;
  private liveRegion!: HTMLElement;
  private alertRegion!: HTMLElement;
  private actions!: HTMLElement;
  private primary!: HTMLButtonElement;
  private secondary!: HTMLButtonElement;

  private state: State = "loading";
  private primaryMode: "verify" | "retry" = "verify";
  private generation = 0;
  private destroyed = false;
  private challenge?: CreatedChallenge;
  private token?: string;
  private notice?: { text: string; tone: Tone };
  private blockedRemaining = 0;

  private expiryTimer?: ReturnType<typeof setTimeout>;
  private tokenTimer?: ReturnType<typeof setTimeout>;
  private blockTimer?: ReturnType<typeof setInterval>;

  private tokenInput?: HTMLInputElement;
  private ownsTokenInput = false;
  private form?: HTMLFormElement;
  private readonly onFormReset = () => {
    void this.reset();
  };

  // meme puzzle
  private grid?: HTMLElement;
  private cols = 3;
  private tokens: string[] = [];
  private slotEls: HTMLButtonElement[] = [];
  private selected?: number;
  private dragFrom?: number;
  private tileFailed = false;
  // text
  private input?: HTMLInputElement;
  // image
  private chosen = new Set<string>();
  private imageTotal = 0;

  constructor(target: HTMLElement, options: RenderOptions = {}) {
    this.element = target;
    this.options = options;
    this.locale = options.locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined);
    this.msg = resolveMessages(this.locale, options.messages);
    this.type = options.type ?? "meme-puzzle";
    this.client = new OorableCaptchaClient({
      baseUrl: options.apiBaseUrl,
      siteKey: options.siteKey,
      sessionId: options.sessionId,
      fetch: options.fetch,
    });
    this.build();
    this.setupTokenInput();
  }

  // ------------------------------------------------------------------ public API

  async start(): Promise<void> {
    await this.load("create");
  }

  async reset(): Promise<void> {
    await this.load("create");
  }

  getToken(): string | undefined {
    return this.token;
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.clearTimers();
    this.form?.removeEventListener("reset", this.onFormReset);
    if (this.tokenInput) {
      if (this.ownsTokenInput) this.tokenInput.remove();
      else this.tokenInput.value = "";
    }
    this.host.remove();
  }

  // ---------------------------------------------------------------------- build

  private build(): void {
    this.host = h("div", { "data-oorable-captcha-host": "" });
    const shadow = this.host.attachShadow({ mode: "open" });
    applyStyles(shadow, this.options.nonce);

    this.root = h("div", {
      class: "oc",
      "data-state": "loading",
      "data-theme": this.options.theme ?? "auto",
      dir: isRtl(this.locale) ? "rtl" : "ltr",
      lang: this.locale && LOCALE_TAG.test(this.locale) ? this.locale : undefined,
    });

    this.instructions = h("p", { class: "instructions", id: "oc-instructions" });
    this.content = h("div", { class: "content" });
    const badge = h("div", { class: "badge", "aria-hidden": "true" }, h("span", {}, checkMark()));
    const stage = h("div", { class: "stage" }, this.content, badge);

    this.status = h("p", { class: "status", "data-tone": "info" });
    this.liveRegion = h("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    this.alertRegion = h("div", { class: "sr-only", role: "alert", "aria-live": "assertive", "aria-atomic": "true" });

    this.secondary = h("button", { class: "btn btn-secondary", type: "button", "data-action": "refresh" });
    this.primary = h("button", { class: "btn btn-primary", type: "button", "data-action": "primary" });
    this.secondary.addEventListener("click", () => this.onRefresh());
    this.primary.addEventListener("click", () => this.onPrimary());
    this.actions = h("div", { class: "actions" }, this.secondary, this.primary);

    const head = h(
      "div",
      { class: "head" },
      brandMark(),
      h("div", {}, h("p", { class: "title", id: "oc-title", text: this.msg.title }), h("p", { class: "tagline", text: this.msg.tagline })),
    );
    const card = h("div", { class: "card", role: "group", "aria-labelledby": "oc-title" }, head, this.instructions, stage, this.status, this.actions);

    this.root.append(card, this.liveRegion, this.alertRegion);
    shadow.append(this.root);
    this.element.append(this.host);
  }

  private setupTokenInput(): void {
    const name = this.options.tokenFieldName;
    if (name === false) return;
    const form = this.element.closest("form");
    if (!form) return;
    const fieldName = name ?? "oorable-captcha-token";
    let input = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).find((i) => i.name === fieldName);
    if (!input) {
      input = h("input", { type: "hidden", name: fieldName });
      form.append(input);
      this.ownsTokenInput = true;
    }
    this.form = form;
    this.tokenInput = input;
    form.addEventListener("reset", this.onFormReset);
  }

  private syncTokenInput(): void {
    if (this.tokenInput) this.tokenInput.value = this.token ?? "";
  }

  // ------------------------------------------------------------------ state + text

  private setState(state: State): void {
    this.state = state;
    this.root.dataset["state"] = state;
    const busy = state === "loading" || state === "verifying";
    this.content.parentElement?.setAttribute("aria-busy", String(busy));

    this.primaryMode = state === "error" || state === "expired" || (state === "blocked" && this.blockedRemaining <= 0) ? "retry" : "verify";
    this.primary.textContent = this.primaryMode === "retry" ? this.msg.tryAgain : this.msg.verify;
    // "Soft" disabling (aria-disabled, ignored in handlers) keeps keyboard focus on the button while it works.
    const inactive = busy || state === "success" || (state === "blocked" && this.blockedRemaining > 0);
    this.primary.setAttribute("aria-disabled", String(inactive));

    this.secondary.textContent = this.type === "text" ? this.msg.newCode : this.msg.newPuzzle;
    this.secondary.hidden = state === "error" || state === "expired" || state === "blocked" || state === "success";
    this.secondary.setAttribute("aria-disabled", String(busy));
    this.actions.hidden = state === "success";
  }

  private setStatus(text: string, tone: Tone, opts: { announce?: boolean; assertive?: boolean } = {}): void {
    this.status.textContent = text;
    this.status.dataset["tone"] = tone;
    if (text && opts.announce !== false) this.announce(text, opts.assertive ?? tone === "error");
  }

  private announce(text: string, assertive = false): void {
    const region = assertive ? this.alertRegion : this.liveRegion;
    region.textContent = "";
    // Setting the text on the next tick makes screen readers repeat identical consecutive messages.
    setTimeout(() => {
      if (!this.destroyed) region.textContent = text;
    }, 30);
  }

  private clearTimers(): void {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.tokenTimer);
    clearInterval(this.blockTimer);
    this.expiryTimer = this.tokenTimer = this.blockTimer = undefined;
  }

  private instructionsFor(type: ChallengeType, challenge?: CreatedChallenge): string {
    if (type === "text") return this.msg.textInstructions;
    if (type === "image") return (challenge?.type === "image" && challenge.challenge.prompt) || this.msg.imageInstructions;
    return this.msg.puzzleInstructions;
  }

  // -------------------------------------------------------------------- loading

  private async load(mode: "create" | "refresh"): Promise<void> {
    const generation = ++this.generation;
    this.clearTimers();
    this.token = undefined;
    this.syncTokenInput();
    this.selected = undefined;
    this.dragFrom = undefined;
    this.tileFailed = false;
    this.chosen.clear();
    this.blockedRemaining = 0;

    this.setState("loading");
    this.setStatus(this.msg.loading, "info", { announce: false });
    this.instructions.textContent = this.instructionsFor(this.type);
    this.renderSkeleton();

    try {
      let created: CreatedChallenge;
      if (mode === "refresh" && this.challenge) {
        try {
          created = await this.client.refresh(this.challenge.challengeId);
        } catch (err) {
          // The old challenge is gone (expired/used): just get a new one.
          if (err instanceof ApiError && (err.status === 404 || err.status === 400)) created = await this.createNew();
          else throw err;
        }
      } else {
        created = await this.createNew();
      }
      if (generation !== this.generation || this.destroyed) return;
      this.applyChallenge(created);
    } catch (err) {
      if (generation !== this.generation || this.destroyed) return;
      this.fail(err);
    }
  }

  private createNew(): Promise<CreatedChallenge> {
    const locale = this.locale && LOCALE_TAG.test(this.locale) ? this.locale : undefined;
    return this.client.createChallenge({ type: this.type, difficulty: this.options.difficulty, locale });
  }

  private applyChallenge(created: CreatedChallenge): void {
    switch (created.type) {
      case "meme-puzzle":
        this.renderPuzzle(created.challenge);
        break;
      case "text":
        this.renderText(created.challenge);
        break;
      case "image":
        this.renderImages(created.challenge);
        break;
      default:
        throw new ApiError(0, "bad_response");
    }
    this.challenge = created;
    this.instructions.textContent = this.instructionsFor(created.type, created);
    this.setState("ready");

    const notice = this.notice;
    this.notice = undefined;
    if (notice) this.setStatus(notice.text, notice.tone);
    else this.setStatus("", "info", { announce: false });

    this.expiryTimer = setTimeout(() => this.expireChallenge(), Math.max(1_000, created.expiresIn * 1_000 - 1_000));
  }

  private renderSkeleton(): void {
    if (this.type === "text") {
      this.content.replaceChildren(h("div", { class: "skeleton-block", "aria-hidden": "true" }));
      return;
    }
    const grid = h("div", { class: "grid is-skeleton", "aria-hidden": "true" });
    grid.style.setProperty("--oc-cols", "3");
    for (let i = 0; i < 9; i++) grid.append(h("div", { class: "tile" }));
    this.content.replaceChildren(grid);
    this.grid = undefined;
    this.slotEls = [];
    this.input = undefined;
  }

  // ------------------------------------------------------------------- puzzle UI

  private position(slot: number): { row: number; col: number } {
    return { row: Math.floor(slot / this.cols) + 1, col: (slot % this.cols) + 1 };
  }

  private renderPuzzle(c: MemePuzzleChallenge): void {
    const n = c?.grid;
    if (!Number.isInteger(n) || n < 2 || n > 6 || !Array.isArray(c.tiles) || c.tiles.length !== n * n) {
      throw new ApiError(0, "bad_response");
    }
    this.cols = n;
    this.tokens = c.tiles.map((t) => String(t.token));
    const urls = c.tiles.map((t) => this.client.tileUrl(t.assetUrl));

    const grid = h("div", {
      class: "grid",
      role: "group",
      "aria-label": formatMessage(this.msg.gridLabel, { n }),
      "aria-describedby": "oc-instructions",
    });
    grid.style.setProperty("--oc-cols", String(n));

    this.slotEls = this.tokens.map((_, i) => {
      const img = h("img", { alt: "", draggable: "false", decoding: "async" });
      img.src = urls[i]!;
      img.addEventListener("error", () => this.onTileError());
      const btn = h("button", { class: "tile", type: "button", tabindex: i === 0 ? 0 : -1 }, img);
      btn.addEventListener("click", () => this.onSlotClick(i));
      btn.addEventListener("focus", () => this.setFocusIndex(i, false));
      if (this.options.dragAndDrop !== false) this.enableDrag(btn, i);
      return btn;
    });
    grid.append(...this.slotEls);
    grid.addEventListener("keydown", (e) => this.onGridKeydown(e));

    this.grid = grid;
    this.selected = undefined;
    this.content.replaceChildren(grid);
    this.slotEls.forEach((_, i) => this.syncSlot(i));
  }

  private syncSlot(i: number): void {
    const btn = this.slotEls[i]!;
    const { row, col } = this.position(i);
    btn.dataset["token"] = this.tokens[i]!;
    btn.setAttribute("aria-label", formatMessage(this.msg.tileLabel, { row, col }));
    btn.setAttribute("aria-pressed", String(this.selected === i));
  }

  private syncSelection(): void {
    this.slotEls.forEach((_, i) => this.syncSlot(i));
  }

  private setFocusIndex(i: number, focus: boolean): void {
    this.slotEls.forEach((btn, idx) => {
      btn.tabIndex = idx === i ? 0 : -1;
    });
    if (focus) this.slotEls[i]?.focus();
  }

  /** Swaps two slots by moving their <img> nodes, so pictures never reload or flicker. */
  private swapSlots(a: number, b: number): void {
    const tokenA = this.tokens[a]!;
    this.tokens[a] = this.tokens[b]!;
    this.tokens[b] = tokenA;
    const btnA = this.slotEls[a]!;
    const btnB = this.slotEls[b]!;
    const imgA = btnA.firstElementChild!;
    const imgB = btnB.firstElementChild!;
    btnA.replaceChildren(imgB);
    btnB.replaceChildren(imgA);
  }

  private describeSwap(a: number, b: number): string {
    const p = this.position(a);
    const q = this.position(b);
    return formatMessage(this.msg.swapped, { r1: p.row, c1: p.col, r2: q.row, c2: q.col });
  }

  private onSlotClick(i: number): void {
    if (this.state !== "ready") return;
    this.setFocusIndex(i, false);
    const picked = this.selected;
    if (picked === undefined) {
      this.selected = i;
      this.syncSelection();
      this.announce(formatMessage(this.msg.pickedUp, this.position(i)));
    } else if (picked === i) {
      this.selected = undefined;
      this.syncSelection();
      this.announce(this.msg.dropped);
    } else {
      this.swapSlots(picked, i);
      this.selected = undefined;
      this.syncSelection();
      this.announce(this.describeSwap(picked, i));
      this.clearFailure();
    }
  }

  private onGridKeydown(e: KeyboardEvent): void {
    if (this.state !== "ready") return;
    const current = (e.target as HTMLElement).closest("button.tile") as HTMLButtonElement | null;
    const i = current ? this.slotEls.indexOf(current) : -1;
    if (i < 0) return;
    const cols = this.cols;
    const total = cols * cols;
    const r = Math.floor(i / cols);
    const c = i % cols;
    let next = i;
    switch (e.key) {
      case "ArrowRight":
        if (c < cols - 1) next = i + 1;
        break;
      case "ArrowLeft":
        if (c > 0) next = i - 1;
        break;
      case "ArrowDown":
        if (r < cols - 1) next = i + cols;
        break;
      case "ArrowUp":
        if (r > 0) next = i - cols;
        break;
      case "Home":
        next = e.ctrlKey ? 0 : r * cols;
        break;
      case "End":
        next = e.ctrlKey ? total - 1 : r * cols + cols - 1;
        break;
      case "Escape":
        if (this.selected !== undefined) {
          e.preventDefault();
          this.selected = undefined;
          this.syncSelection();
          this.announce(this.msg.dropped);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next !== i) this.setFocusIndex(next, true);
  }

  private enableDrag(btn: HTMLButtonElement, i: number): void {
    btn.draggable = true;
    btn.addEventListener("dragstart", (e) => {
      if (this.state !== "ready") {
        e.preventDefault();
        return;
      }
      this.dragFrom = i;
      btn.classList.add("is-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.setData("text/plain", String(i));
        e.dataTransfer.effectAllowed = "move";
      }
    });
    btn.addEventListener("dragover", (e) => {
      if (this.dragFrom === undefined) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    btn.addEventListener("dragenter", () => {
      if (this.dragFrom !== undefined && this.dragFrom !== i) btn.classList.add("is-target");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("is-target"));
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = this.dragFrom;
      this.endDrag();
      if (from === undefined || from === i || this.state !== "ready") return;
      this.swapSlots(from, i);
      this.selected = undefined;
      this.syncSelection();
      this.announce(this.describeSwap(from, i));
      this.clearFailure();
    });
    btn.addEventListener("dragend", () => this.endDrag());
  }

  private endDrag(): void {
    this.dragFrom = undefined;
    for (const btn of this.slotEls) btn.classList.remove("is-dragging", "is-target");
  }

  private onTileError(): void {
    // A meme-puzzle tile or the text-challenge code image comes from our own
    // asset pipeline (or an inline data: URL); either failing to load means
    // something is actually broken, and every tile is required to solve the
    // puzzle, so there is no partial-credit path -- report once and offer a retry.
    if (this.tileFailed || this.state === "success") return;
    this.tileFailed = true;
    this.fail(new ApiError(0, "network_error"));
  }

  /**
   * An image-challenge CANDIDATE is a third-party photo URL the site owner
   * configured, so a single one failing to load (dead link, hotlink
   * protection, a transient CDN blip) is a realistic, non-fatal event -- and
   * treating it as fatal would let anyone who can make one candidate URL
   * 404 take the whole widget down for every visitor. Disable just that
   * tile, and only give up if too few usable candidates remain to ever
   * reach the required selection count.
   */
  private onCandidateImageError(btn: HTMLButtonElement, id: string): void {
    if (btn.disabled || this.state === "success") return;
    btn.disabled = true;
    btn.setAttribute("aria-pressed", "false");
    this.chosen.delete(id);
    const usable = this.grid?.querySelectorAll(".tile:not(:disabled)").length ?? 0;
    if (usable < this.imageTotal) this.fail(new ApiError(0, "network_error"));
  }

  private clearFailure(): void {
    if (this.status.dataset["tone"] === "error" && this.state === "ready") this.setStatus("", "info", { announce: false });
  }

  private shake(): void {
    const grid = this.grid;
    if (!grid) return;
    grid.classList.remove("is-shaking");
    void grid.offsetWidth; // restart the animation
    grid.classList.add("is-shaking");
    grid.addEventListener("animationend", () => grid.classList.remove("is-shaking"), { once: true });
  }

  // --------------------------------------------------------------------- text UI

  private renderText(c: TextChallenge): void {
    if (!c || typeof c.length !== "number" || !c.image) throw new ApiError(0, "bad_response");
    const img = h("img", { class: "code-img", alt: this.msg.codeImageAlt, decoding: "async" });
    img.src = this.client.dataUrl(c.image);
    img.addEventListener("error", () => this.onTileError());

    const input = h("input", {
      class: "field",
      id: "oc-code",
      type: "text",
      inputmode: c.mode === "numeric" ? "numeric" : "text",
      autocomplete: "off",
      autocapitalize: "characters",
      autocorrect: "off",
      spellcheck: "false",
      enterkeyhint: "go",
      maxlength: c.length + 2,
      "aria-describedby": "oc-instructions",
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submit();
      }
    });
    input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
    this.input = input;
    this.content.replaceChildren(img, h("div", {}, h("label", { class: "field-label", for: "oc-code", text: this.msg.codeLabel }), input));
  }

  // -------------------------------------------------------------------- image UI

  private renderImages(c: ImageChallenge): void {
    if (!c || !Array.isArray(c.options) || c.options.length < 2 || c.options.length > 16) throw new ApiError(0, "bad_response");
    this.chosen.clear();
    this.imageTotal = c.select;
    const grid = h("div", {
      class: "grid",
      role: "group",
      "aria-label": c.prompt || this.msg.imageInstructions,
      "aria-describedby": "oc-instructions",
    });
    grid.style.setProperty("--oc-cols", String(c.options.length <= 4 ? 2 : 3));
    c.options.forEach((option, i) => {
      const img = h("img", { alt: "", decoding: "async" });
      img.src = this.client.safeUrl(option.imageUrl);
      const btn = h(
        "button",
        { class: "tile", type: "button", "aria-pressed": "false", "aria-label": formatMessage(this.msg.imageOption, { n: i + 1 }) },
        img,
      );
      img.addEventListener("error", () => this.onCandidateImageError(btn, option.id));
      btn.addEventListener("click", () => {
        if (this.state !== "ready" || btn.disabled) return;
        const on = !this.chosen.has(option.id);
        if (on) this.chosen.add(option.id);
        else this.chosen.delete(option.id);
        btn.setAttribute("aria-pressed", String(on));
        this.clearFailure();
        this.announce(formatMessage(this.msg.selectedCount, { selected: this.chosen.size, total: this.imageTotal }));
      });
      grid.append(btn);
    });
    this.grid = grid;
    this.content.replaceChildren(grid);
  }

  // -------------------------------------------------------------- user actions

  private onPrimary(): void {
    if (this.primary.getAttribute("aria-disabled") === "true") return;
    if (this.primaryMode === "retry") void this.load("create");
    else void this.submit();
  }

  private onRefresh(): void {
    if (this.state === "loading" || this.state === "verifying" || this.state === "success") return;
    void this.load("refresh");
  }

  private collectAnswer(): unknown {
    if (!this.challenge) return undefined;
    switch (this.challenge.type) {
      case "meme-puzzle":
        return this.tokens.slice();
      case "text": {
        const value = this.input?.value.trim() ?? "";
        if (!value) {
          this.input?.setAttribute("aria-invalid", "true");
          this.setStatus(this.msg.emptyAnswer, "error");
          this.input?.focus();
          return undefined;
        }
        return value;
      }
      case "image":
        if (this.chosen.size === 0) {
          this.setStatus(this.challenge.challenge.prompt || this.msg.imageInstructions, "error");
          return undefined;
        }
        return Array.from(this.chosen);
    }
  }

  private async submit(): Promise<void> {
    if (this.state !== "ready" || !this.challenge) return;
    const answer = this.collectAnswer();
    if (answer === undefined) return;

    const generation = this.generation;
    const challengeId = this.challenge.challengeId;
    this.setState("verifying");
    this.setStatus(this.msg.verifying, "info");
    try {
      const result = await this.client.verify({ challengeId, answer });
      if (generation !== this.generation || this.destroyed) return;
      if (result.success) this.succeed(result);
      else this.reject(result.reason);
    } catch (err) {
      if (generation !== this.generation || this.destroyed) return;
      this.setState("ready"); // let fail() decide the final state
      this.fail(err);
    }
  }

  private succeed(result: Extract<VerifyResponse, { success: true }>): void {
    clearTimeout(this.expiryTimer);
    this.token = result.verificationToken;
    this.syncTokenInput();
    this.setState("success");
    this.setStatus(this.msg.success, "success");
    this.tokenTimer = setTimeout(() => this.expireToken(), Math.max(1_000, result.expiresIn * 1_000 - 1_000));
    this.options.onSuccess?.(result.verificationToken);
  }

  private reject(reason: string): void {
    if (reason === "incorrect") {
      this.setState("ready");
      this.selected = undefined;
      if (this.slotEls.length) this.syncSelection();
      this.setStatus(this.msg.incorrect, "error");
      this.shake();
      if (this.input) {
        this.input.setAttribute("aria-invalid", "true");
        this.input.focus();
        this.input.select();
      }
      return;
    }
    // Expired, out of attempts, or otherwise no longer valid: the old challenge is dead, so start a fresh one.
    const text = reason === "expired" ? this.msg.expired : reason === "too_many_attempts" ? this.msg.tooManyAttempts : this.msg.invalid;
    this.notice = { text, tone: "info" };
    void this.load("create");
  }

  private expireChallenge(): void {
    if (this.state !== "ready") return;
    this.setState("expired");
    this.setStatus(this.msg.expired, "info");
    this.options.onExpired?.();
  }

  private expireToken(): void {
    if (this.state !== "success") return;
    this.token = undefined;
    this.syncTokenInput();
    this.setState("expired");
    this.setStatus(this.msg.expired, "info");
    this.options.onExpired?.();
  }

  private fail(err: unknown): void {
    const error = err instanceof ApiError ? err : new ApiError(0, "network_error");
    this.options.onError?.({ code: error.code, message: error.message });

    if (error.status === 429 || error.code === "rate_limited") {
      this.startBlock(error.retryAfterSeconds ?? 30);
      return;
    }
    this.setState("error");
    const misconfigured = error.status === 403 || error.code === "invalid_site" || error.code === "origin_not_allowed";
    this.setStatus(misconfigured ? this.msg.misconfigured : this.msg.networkError, "error");
  }

  private startBlock(seconds: number): void {
    clearInterval(this.blockTimer);
    this.blockedRemaining = Math.max(1, Math.ceil(seconds));
    const total = this.blockedRemaining;
    this.setState("blocked");
    const tick = () => {
      if (this.blockedRemaining <= 0) {
        clearInterval(this.blockTimer);
        this.setState("blocked"); // re-render the buttons: "Try again" is now available
        this.setStatus("", "info", { announce: false });
        return;
      }
      // Announce at the start and every 10 seconds, not every second.
      const speak = this.blockedRemaining === total || this.blockedRemaining % 10 === 0;
      this.setStatus(formatMessage(this.msg.rateLimited, { seconds: this.blockedRemaining }), "error", { announce: speak });
      this.blockedRemaining--;
    };
    tick();
    this.blockTimer = setInterval(tick, 1_000);
  }
}

import { isIP, isIPv4, isIPv6 } from "node:net";

/** Expands a *valid* IPv6 address into its eight 16-bit groups. */
function expandIPv6(ip: string): number[] {
  let addr = ip;
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    // Embedded IPv4 in the low 32 bits (e.g. ::ffff:1.2.3.4).
    const o = tail.split(".").map(Number);
    const hi = (((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16);
    const lo = (((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  let groups: string[];
  if (addr.includes("::")) {
    const [head = "", rest = ""] = addr.split("::");
    const headParts = head ? head.split(":") : [];
    const restParts = rest ? rest.split(":") : [];
    groups = [...headParts, ...Array<string>(8 - headParts.length - restParts.length).fill("0"), ...restParts];
  } else {
    groups = addr.split(":");
  }
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Canonical form of a client address: brackets and zone ids removed,
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) collapsed to plain IPv4. Returns
 * "unknown" for anything that is not a valid IP literal.
 */
export function normalizeIp(raw: string | undefined): string {
  if (!raw) return "unknown";
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (!isIP(ip)) return "unknown";
  if (isIPv6(ip)) {
    const g = expandIPv6(ip);
    const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
    if (mapped) {
      const a = g[6] ?? 0;
      const b = g[7] ?? 0;
      return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
  }
  return ip;
}

/**
 * The key a rate limiter should count a client under. IPv4 clients are
 * counted per address. IPv6 clients are counted per /64: a single subscriber
 * is typically handed an entire /64, so per-address counting would let one
 * machine rotate through 2^64 addresses and never trip a limit.
 */
export function rateLimitKeyForIp(ip: string): string {
  const normalized = normalizeIp(ip);
  if (isIPv4(normalized)) return `v4:${normalized}`;
  if (isIPv6(normalized)) {
    return `v6:${expandIPv6(normalized)
      .slice(0, 4)
      .map((g) => g.toString(16))
      .join(":")}`;
  }
  return "unknown";
}

/**
 * Determines the client address. `X-Forwarded-For` is attacker-controlled
 * unless a proxy you operate sets it, so it is honored ONLY when you say how
 * many trusted proxies sit in front of the server (`trustProxyHops`). With N
 * trusted hops the client is the Nth entry counting from the right -- entries
 * further left were supplied by the client and are ignored.
 */
export function clientIp(
  socketAddress: string | undefined,
  xForwardedFor: string | string[] | undefined,
  trustProxyHops: number,
): string {
  const socketIp = normalizeIp(socketAddress);
  if (trustProxyHops <= 0 || xForwardedFor === undefined) return socketIp;

  const entries = (Array.isArray(xForwardedFor) ? xForwardedFor.join(",") : xForwardedFor)
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length < trustProxyHops) return socketIp; // fewer hops than promised: do not trust it
  const candidate = normalizeIp(entries[entries.length - trustProxyHops]);
  return candidate === "unknown" ? socketIp : candidate;
}

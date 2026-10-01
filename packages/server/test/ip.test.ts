import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, normalizeIp, rateLimitKeyForIp } from "../src/ip.ts";

test("normalizeIp: canonical forms", () => {
  assert.equal(normalizeIp("1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("  10.0.0.1  "), "10.0.0.1");
  assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("::ffff:0102:0304"), "1.2.3.4");
  assert.equal(normalizeIp("::FFFF:1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80::1");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
});

test("normalizeIp: anything that is not an IP literal becomes 'unknown'", () => {
  for (const bad of [undefined, "", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5", "::gggg", "1.2.3.4:80", "example.com", "1.2.3.4, 5.6.7.8", "<script>"]) {
    assert.equal(normalizeIp(bad as string | undefined), "unknown", String(bad));
  }
});

test("rateLimitKeyForIp: IPv4 per address, IPv6 per /64", () => {
  assert.equal(rateLimitKeyForIp("1.2.3.4"), "v4:1.2.3.4");
  assert.equal(rateLimitKeyForIp("::ffff:1.2.3.4"), "v4:1.2.3.4");
  assert.equal(rateLimitKeyForIp("2001:db8:abcd:12::1"), "v6:2001:db8:abcd:12");
  assert.equal(rateLimitKeyForIp("2001:DB8:ABCD:12:ffff:ffff:ffff:ffff"), "v6:2001:db8:abcd:12");
  assert.equal(rateLimitKeyForIp("2001:db8::"), "v6:2001:db8:0:0");
  assert.equal(rateLimitKeyForIp("::1"), "v6:0:0:0:0");
  assert.equal(rateLimitKeyForIp("::"), "v6:0:0:0:0");
  assert.equal(rateLimitKeyForIp("1:2:3:4:5:6:7:8"), "v6:1:2:3:4");
  assert.equal(rateLimitKeyForIp("::1.2.3.4"), "v6:0:0:0:0", "non-mapped embedded IPv4 is still IPv6");
  assert.notEqual(rateLimitKeyForIp("2001:db8:abcd:12::1"), rateLimitKeyForIp("2001:db8:abcd:13::1"));
  assert.equal(rateLimitKeyForIp("garbage"), "unknown");
});

test("clientIp: X-Forwarded-For is ignored unless trusted proxies are declared", () => {
  assert.equal(clientIp("203.0.113.7", "1.1.1.1", 0), "203.0.113.7");
  assert.equal(clientIp("203.0.113.7", undefined, 3), "203.0.113.7");
  assert.equal(clientIp(undefined, undefined, 0), "unknown");
});

test("clientIp: with N trusted hops the client is the Nth entry from the right", () => {
  // One trusted proxy appended the address it saw; anything to its left is client-supplied and spoofable.
  assert.equal(clientIp("10.0.0.1", "198.51.100.1", 1), "198.51.100.1");
  assert.equal(clientIp("10.0.0.1", "6.6.6.6, 198.51.100.1", 1), "198.51.100.1", "a spoofed leftmost entry is ignored");
  assert.equal(clientIp("10.0.0.1", "6.6.6.6, 198.51.100.1, 10.0.0.9", 2), "198.51.100.1");
  assert.equal(clientIp("10.0.0.1", ["6.6.6.6", "198.51.100.1"], 1), "198.51.100.1", "repeated headers are joined");
});

test("clientIp: implausible or malformed forwarding data falls back to the socket address", () => {
  assert.equal(clientIp("10.0.0.1", "198.51.100.1", 2), "10.0.0.1", "fewer entries than promised hops");
  assert.equal(clientIp("10.0.0.1", "not-an-ip", 1), "10.0.0.1");
  assert.equal(clientIp("10.0.0.1", "", 1), "10.0.0.1");
  assert.equal(clientIp("10.0.0.1", ",,,", 1), "10.0.0.1");
  assert.equal(clientIp("10.0.0.1", "1.2.3.4:8080", 1), "10.0.0.1", "ports are not valid IP literals");
});

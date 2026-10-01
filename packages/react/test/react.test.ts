import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import * as esbuild from "esbuild";
import { MemoryChallengeStore, OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { createApi, startServer } from "@oorable/captcha-server";
import { fileURLToPath } from "node:url";

/**
 * This is the test that actually matters for a "thin wrapper" component:
 * bundle the real .tsx source against the REAL react/react-dom this package
 * declares as peer dependencies (not the sandbox's type-only shim, which
 * exists purely to catch syntax/type slips -- see
 * typings-sandbox-only/react-shim.d.ts) and drive it in a real browser.
 */

const SECRET = "react-test-".padEnd(48, "0123456789abcdef");

async function bundleHarness(): Promise<string> {
  const result = await esbuild.build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { OorableCaptcha } from "./index.ts";
        window.__mount = (props) => {
          const el = document.getElementById("root");
          if (!window.__root) {
            window.__root = createRoot(el);
            window.__ref = React.createRef();
            window.__events = [];
          }
          // flushSync forces React to commit synchronously, so the DOM is
          // fully up to date the instant __mount() returns -- no polling or
          // guessed timeouts needed to observe "did this re-render land yet."
          flushSync(() => {
            window.__root.render(
              React.createElement(OorableCaptcha, {
                ...props,
                ref: window.__ref,
                onSuccess: (t) => window.__events.push(["success", t]),
                onError: (e) => window.__events.push(["error", e.code]),
                onExpired: () => window.__events.push(["expired"]),
              }),
            );
          });
        };
        window.__unmount = () => window.__root.unmount();
      `,
    },
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
    loader: { ".ts": "ts", ".tsx": "tsx" },
    resolveExtensions: [".tsx", ".ts", ".js"],
  });
  return result.outputFiles[0]!.text;
}

async function bootServer() {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  const api = createApi({ engine, cors: { allowedOrigins: "*" }, rateLimit: false });
  const server = await startServer(api);
  return {
    store,
    url: server.url,
    close: async () => {
      await server.close();
      api.close();
      store.close();
    },
  };
}

let browser: Browser;
let bundle: string;
test.before(async () => {
  browser = await chromium.launch();
  bundle = await bundleHarness();
});
test.after(async () => {
  await browser.close();
});

test("react: mounts a real puzzle with real React 19, solves it, and receives the token via onSuccess", async () => {
  const h = await bootServer();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => {
      throw new Error(`page error: ${err.message}`);
    });
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((apiBaseUrl) => (window as any).__mount({ apiBaseUrl, type: "meme-puzzle" }), h.url);
    await page.waitForSelector(".tile");
    assert.equal(await page.locator(".tile").count(), 9);

    const [record] = [...(h.store as unknown as { records: Map<string, any> })["records"].values()];
    const correct: string[] = record.solution.correctOrder;
    let order: string[] = await page.$$eval(".tile", (n) => n.map((x) => (x as HTMLElement).dataset["token"] ?? ""));
    for (let target = 0; target < correct.length; target++) {
      if (order[target] === correct[target]) continue;
      const from = order.indexOf(correct[target]!);
      await page.locator(".tile").nth(target).click();
      await page.locator(".tile").nth(from).click();
      order = await page.$$eval(".tile", (n) => n.map((x) => (x as HTMLElement).dataset["token"] ?? ""));
    }
    await page.locator('button:has-text("Verify")').click();
    await page.waitForFunction(() => (window as any).__events?.some((e: unknown[]) => e[0] === "success"));

    const events: unknown[][] = await page.evaluate(() => (window as any).__events);
    assert.equal(events[0]![0], "success");
    assert.ok(String(events[0]![1]).startsWith("v1."));

    const tokenViaRef: string | undefined = await page.evaluate(() => (window as any).__ref.current.getToken());
    assert.equal(tokenViaRef, events[0]![1]);
    await page.close();
  } finally {
    await h.close();
  }
});

test("react: unmounting the component tears down the widget with no console errors", async () => {
  const h = await bootServer();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((apiBaseUrl) => (window as any).__mount({ apiBaseUrl, type: "meme-puzzle" }), h.url);
    await page.waitForSelector(".tile");
    await page.evaluate(() => (window as any).__unmount());
    await page.waitForTimeout(100);
    assert.equal(await page.locator("[data-oorable-captcha-host]").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await h.close();
  }
});

test("react: changing siteKey remounts with a fresh challenge; an inline onSuccess identity change does not", async () => {
  const h = await bootServer();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((apiBaseUrl) => (window as any).__mount({ apiBaseUrl, type: "meme-puzzle", siteKey: "a" }), h.url);
    await page.waitForSelector(".tile");
    const firstToken = await page.locator(".tile").first().evaluate((el) => (el as HTMLElement).dataset["token"]);

    // Re-render with a brand new inline onSuccess function (new identity every time, as real apps often do).
    // flushSync in the harness means this has already committed by the time __mount() returns -- no wait needed.
    await page.evaluate((apiBaseUrl) => (window as any).__mount({ apiBaseUrl, type: "meme-puzzle", siteKey: "a" }), h.url);
    const sameSiteToken = await page.locator(".tile").first().evaluate((el) => (el as HTMLElement).dataset["token"]);
    assert.equal(sameSiteToken, firstToken, "no remount => the same challenge/tile tokens remain");

    await page.evaluate((apiBaseUrl) => (window as any).__mount({ apiBaseUrl, type: "meme-puzzle", siteKey: "b" }), h.url);
    const newSiteToken = await page.locator(".tile").first().evaluate((el) => (el as HTMLElement).dataset["token"]);
    assert.notEqual(newSiteToken, firstToken, "a changed siteKey does remount with a fresh challenge");
    await page.close();
  } finally {
    await h.close();
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome-path.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-assets-"));
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let changed = false, unavailable = false, checks = 0;
try {
  const build = await Bun.build({ entrypoints: ["scripts/frontend-assets-fixture.tsx"], outdir: root, target: "browser", define: { "process.env.NODE_ENV": '"development"' } });
  assert.ok(build.success, String(build.logs));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") {
      checks++;
      if (unavailable) return new Response("Offline", { status: 503 });
      return new Response(`<!doctype html><html><head><script type="module" src="/assets/fixture.js"></script><link rel="stylesheet" href="/assets/fixture.css">${changed ? '<link rel="stylesheet" href="/assets/hotfix.css">' : ""}</head><body><div id="root"></div></body></html>`, { headers: { "content-type": "text/html" } });
    }
    if (path === "/assets/fixture.js") return new Response(Bun.file(join(root, "frontend-assets-fixture.js")), { headers: { "content-type": "text/javascript" } });
    if (path.endsWith(".css")) return new Response("", { headers: { "content-type": "text/css" } });
    return Response.json({ managed: false, phase: "idle", current_revision: null, available: false });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.locator('[data-reload="none"]').waitFor();
  await page.waitForFunction(() => document.querySelector("textarea") !== null);
  await page.locator("textarea").fill("My draft survives the update");
  const foreground = async () => {
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForFunction(() => document.visibilityState === "hidden");
    // Let React commit the hidden state before emitting the next browser lifecycle event.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  };
  unavailable = true;
  const previous = checks;
  const offlineResponse = page.waitForResponse(response => response.url().endsWith("/") && response.status() === 503);
  await foreground();
  await offlineResponse;
  assert.ok(checks > previous);
  assert.equal(await page.locator("output").getAttribute("data-reload"), "none");
  unavailable = false; changed = true;
  await foreground();
  await page.locator('[data-reload="updated"]').waitFor();
  assert.equal(await page.locator("textarea").inputValue(), "My draft survives the update");
  console.log("ok: same-revision CSS change offers reload; offline checks retain the draft and do not reload");
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}

/** Real ChatView at phone and unfolded widths, using only fictional messages. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome-path.ts";

const root = mkdtempSync(join(tmpdir(), "herdr-chat-width-"));
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const evidence = process.env.UI_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const text = [
  "Four lookups are enough because of how the fictional scoring works. ".repeat(8),
  "**Results on 1,000 fictional imports, checked against what `scoreCandidates` returned at each import's time:**",
  "| Metric | Result |\n| --- | --- |\n| Records still available | 100% (770 / 770) |\n| Searches that hit a cap | 0 |\n| Time on the database | p50 7 ms, p95 25 ms |\n| Long identifier | identifieridentifieridentifieridentifieridentifieridentifieridentifieridentifieridentifieridentifieridentifieridentifieridentifieridentifier |",
  "```text\n" + "wide code sample ".repeat(25) + "\n```",
  "- " + "This ordinary paragraph after the table must fit the phone without clipping. ".repeat(7),
].join("\n\n");
try {
  const build = await Bun.build({ entrypoints: ["scripts/chat-virtual-fixture.tsx"], outdir: root, target: "browser", define: { "process.env.NODE_ENV": '"development"' } });
  assert.ok(build.success, String(build.logs));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/pane/conversation")) return Response.json({ source: "pi-transcript", history_id: "width-fixture", cursor: null, turns: [{ role: "assistant", ts: null, parts: [{ kind: "text", text }] }] });
    if (path.endsWith("/pane/commands")) return Response.json({ commands: [] });
    if (path.startsWith("/api/")) return Response.json({});
    if (path === "/") return new Response('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/chat-virtual-fixture.css"></head><body><div id="root"></div><script type="module" src="/chat-virtual-fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    const file = Bun.file(join(root, path.slice(1)));
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 412, height: 850 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  for (const mode of ["reload", "resize"]) for (const width of [360, 412, 768, 1200]) for (const scale of [1, 1.35]) {
    await page.setViewportSize({ width, height: 850 });
    if (mode === "reload") await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.locator(".chat-turn-agent .markdown p").first().waitFor();
    await page.evaluate(scale => document.documentElement.style.setProperty("--chat-scale", String(scale)), scale);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const metrics = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>(".chat-view")!;
      const prose = [...view.querySelectorAll<HTMLElement>(".chat-turn-agent .markdown p, .chat-turn-agent .markdown ul")];
      const box = view.getBoundingClientRect();
      return { viewport: innerWidth, view: { left: box.left, right: box.right, client: view.clientWidth, scroll: view.scrollWidth }, prose: prose.map(p => ({ right: p.getBoundingClientRect().right, width: p.getBoundingClientRect().width })), table: (() => { const table = view.querySelector<HTMLElement>(".markdown-table-wrap")!; return { client: table.clientWidth, scroll: table.scrollWidth }; })() };
    });
    console.log(JSON.stringify({ mode, width, scale, ...metrics }));
    assert.ok(metrics.prose.length > 0, "no prose measured");
    assert.ok(metrics.prose.every(p => p.right <= metrics.view.right + 1), `prose clips at ${width}px`);
    assert.ok(metrics.table.scroll > metrics.table.client, "wide table should scroll locally");
    if (evidence) await page.screenshot({ path: join(evidence, `chat-width-${mode}-${width}-${scale}.png`) });
    assert.ok(metrics.view.scroll <= metrics.view.client + 1, `chat overflows at ${width}px`);
  }
  console.log("ok: phone, folded and unfolded widths keep prose inside the chat");
} finally {
  await browser?.close();
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
}

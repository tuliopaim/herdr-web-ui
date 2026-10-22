import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";
import panes from "../site/demo/fixtures/panes.json";

// The real app and demo transport only. No live sessions, RPCs or user state.
const app = mkdtempSync(join(tmpdir(), "herdr-response-comments-"));
const shots = process.env.COMMENT_SHOTS;
interface CommentWindow extends Window { commentSubmits: { text: string }[]; failCommentSend: boolean }
const selectQuote = async (page: Page, selector = "[data-response-comment-source]") => {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  return page.locator(selector).first().evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return selection.toString().trim();
  });
};
const save = async (page: Page, comment: string) => {
  const quote = await selectQuote(page);
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page.locator("dialog[open]").getByLabel("Your comment", { exact: true }).fill(comment);
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  return quote;
};
try {
  await buildDemoApp(app);
  const index = join(app, "index.html");
  const injection = `<script src="./demo-transport.js"></script><script>
    window.commentSubmits = [];
    window.failCommentSend = false;
    const transportFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
      if (url.pathname === '/api/pane/prompt') return Promise.resolve(new Response(JSON.stringify({prompt:null,suggestion:null}), {headers:{'content-type':'application/json'}}));
      return transportFetch(input, init);
    };
    const Socket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      const socket = new Socket(url, protocols);
      const send = socket.send.bind(socket);
      socket.send = function(raw) {
        const message = JSON.parse(raw);
        if (message.type === 'submit') {
          window.commentSubmits.push(message);
          if (window.failCommentSend) {
            queueMicrotask(() => socket.push({type:'submit-result',id:message.id,pane_id:message.pane_id,ok:false,code:'not_transmitted',message:'Simulated send failure'}));
            return;
          }
        }
        return send(raw);
      };
      return socket;
    };
    for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) window.WebSocket[key] = Socket[key];
  </script>`;
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, `${injection}<script type="module"`));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path.includes("..")) return new Response("not found", { status: 404 });
    return new Response(Bun.file(join(app, path === "/" ? "index.html" : path)));
  } });
  try {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
    try {
      for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 740, height: 390 }]) {
        const context = await browser.newContext({ viewport: size, hasTouch: size.width < 800, isMobile: size.width < 800 });
        await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", autoSendQueued: true })));
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(panes.web)}`);
        await page.locator(".terminal-stack.is-chat").waitFor();
        await page.locator("[data-response-comment-source]").first().waitFor();
        await page.locator(".composer-text").fill("My overall request");
        const quote = await save(page, "Explain the first passage");
        await save(page, "Change the second passage");
        await page.getByRole("button", { name: "Comments · 2", exact: true }).click();
        await page.getByRole("button", { name: "Edit comment 1", exact: true }).click();
        await page.locator("dialog[open]").getByLabel("Your comment", { exact: true }).fill("Edited comment");
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        await page.getByRole("button", { name: "Remove comment 2", exact: true }).click();
        await page.getByRole("button", { name: "Comments · 1", exact: true }).waitFor();
        assert.equal(await page.locator(".composer-text").inputValue(), "My overall request");
        // A failed submission must retain the message and its comment.
        await page.evaluate(() => { (window as unknown as CommentWindow).failCommentSend = true; });
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.waitForFunction(() => (window as unknown as CommentWindow).commentSubmits.length === 1);
        await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
        assert.equal(await page.locator(".composer-text").inputValue(), "My overall request");
        await page.getByRole("button", { name: "Comments · 1", exact: true }).waitFor();
        await page.evaluate(() => { (window as unknown as CommentWindow).failCommentSend = false; });
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>(".composer-text")?.value === "");
        assert.equal(await page.locator(".response-comments-queue").count(), 0);
        const submitted = await page.evaluate(() => (window as unknown as CommentWindow).commentSubmits.at(-1)!.text);
        assert.ok(submitted.startsWith("My overall request\n\n"));
        assert.ok(submitted.includes("Edited comment"));
        assert.ok(submitted.includes(quote.split("\n").map((line) => `> ${line}`).join("\n")));
        assert.ok(!submitted.includes("Change the second passage"));
        // Reset the demo agent: its scripted reply opens an unrelated interactive question.
        await page.reload();
        await page.locator("[data-response-comment-source]").first().waitFor();
        // Reading mode still permits collection, and review exits it without sending.
        // Keyboard activation also works in cramped landscapes where pane controls overlap the header.
        await page.locator(".header-more-button").focus();
        await page.locator(".header-more-button").press("Enter");
        await page.getByText("Reading mode", { exact: true }).click();
        await page.locator(".app.is-reading").waitFor();
        await save(page, "Reading mode comment");
        await page.getByRole("button", { name: /Comments · 1/ }).click();
        await page.locator(".app.is-reading").waitFor({ state: "detached" });
        await page.getByLabel("Saved comments").getByText("Reading mode comment", { exact: true }).waitFor();
        // No text is needed for comments-only sends.
        assert.equal(await page.locator(".composer-text").inputValue(), "");
        if (shots) {
          mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: join(shots, `comments-${size.width}x${size.height}.png`) });
        }
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector(".response-comments-queue"));
        const commentsOnly = await page.evaluate(() => (window as unknown as CommentWindow).commentSubmits.at(-1)!.text);
        assert.ok(commentsOnly.startsWith("Address my comments"));
        assert.ok(commentsOnly.includes("Reading mode comment"));
        // Native selection in a user's message must not offer annotation.
        await selectQuote(page, ".chat-turn-user");
        await page.getByRole("button", { name: "Add comment", exact: true }).waitFor({ state: "detached" });
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`PASS ${size.width}x${size.height}: select, edit/remove, combined send, failed-send retention, Reading mode, comments-only and user-selection exclusion`);
      }
    } finally { await browser.close(); }
  } finally { await server.stop(true); }
} finally { rmSync(app, { recursive: true, force: true }); }

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
interface CommentWindow extends Window { commentSubmits: { text: string }[]; failCommentSend: boolean; failCommentUpload: boolean }
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
    window.failCommentUpload = false;
    let imageSequence = 0;
    const transportFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
      if (url.pathname === '/api/pane/image') return Promise.resolve(window.failCommentUpload ? new Response(JSON.stringify({error:'Simulated upload failure'}), {status:500,headers:{'content-type':'application/json'}}) : new Response(JSON.stringify({path:'/tmp/comment-image-' + (++imageSequence) + '.png'}), {headers:{'content-type':'application/json'}}));
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
    if (path === "/api/fs/file") return new Response(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII=", "base64"), { headers: { "content-type": "image/png" } });
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
        const image = { name: "comment.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII=", "base64") };
        const dialog = page.locator("dialog[open]");
        // Upload errors preserve text; successful retry supplies a removable thumbnail.
        await page.evaluate(() => { (window as unknown as CommentWindow).failCommentUpload = true; });
        await dialog.locator('input[type="file"]').setInputFiles(image);
        await dialog.getByRole("alert").waitFor();
        assert.equal(await dialog.getByLabel("Your comment", { exact: true }).inputValue(), "Edited comment");
        await page.evaluate(() => { (window as unknown as CommentWindow).failCommentUpload = false; });
        await dialog.locator('input[type="file"]').setInputFiles(image);
        await dialog.getByRole("button", { name: "Remove comment.png", exact: true }).click();
        assert.equal(await dialog.locator(".response-comment-images img").count(), 0);
        // Clipboard images use the same path as the picker.
        await dialog.locator("textarea").evaluate((node) => {
          const data = new DataTransfer();
          data.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII="), (char) => char.charCodeAt(0))], "pasted.png", { type: "image/png" }));
          node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
        });
        await dialog.getByRole("button", { name: "Remove pasted.png", exact: true }).waitFor();
        if (size.width === 390) {
          await page.setViewportSize({ width: 390, height: 480 });
          const saveButton = dialog.getByRole("button", { name: "Save comment", exact: true });
          await saveButton.scrollIntoViewIfNeeded();
          const box = await saveButton.boundingBox();
          assert.ok(box && box.y >= 0 && box.y + box.height <= 480, "Save stays reachable above a simulated keyboard");
          if (shots) {
            mkdirSync(shots, { recursive: true });
            await page.screenshot({ path: join(shots, "comment-editor-keyboard.png") });
          }
          await page.setViewportSize(size);
        }
        if (shots) {
          mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: join(shots, `comment-editor-${size.width}x${size.height}.png`) });
        }
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        // Saved images remain available when reopening the editor.
        await page.getByRole("button", { name: "Edit comment 1", exact: true }).click();
        await page.locator("dialog[open]").getByRole("img", { name: "pasted.png" }).waitFor();
        await page.locator("dialog[open]").getByRole("button", { name: "Cancel", exact: true }).click();
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
        assert.equal(await page.getByLabel("Saved comments").getByRole("img", { name: "pasted.png" }).count(), 1);
        await page.evaluate(() => { (window as unknown as CommentWindow).failCommentSend = false; });
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>(".composer-text")?.value === "");
        assert.equal(await page.locator(".response-comments-queue").count(), 0);
        const submitted = await page.evaluate(() => (window as unknown as CommentWindow).commentSubmits.at(-1)!.text);
        assert.ok(submitted.startsWith("My overall request\n\n"));
        assert.ok(submitted.includes("Edited comment"));
        assert.ok(submitted.includes("@/tmp/comment-image-2.png"));
        assert.ok(!submitted.includes("data:image"));
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
        // An image can be the entire comment; dropping it must not send anything yet.
        await selectQuote(page);
        await page.getByRole("button", { name: "Add comment", exact: true }).click();
        await page.locator("dialog[open] .response-comment-editor").evaluate((node) => {
          const data = new DataTransfer();
          data.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII="), (char) => char.charCodeAt(0))], "dropped.png", { type: "image/png" }));
          node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
        });
        await page.locator("dialog[open]").getByRole("button", { name: "Remove dropped.png", exact: true }).waitFor();
        assert.equal(await page.locator("dialog[open] textarea").inputValue(), "");
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        await page.getByRole("button", { name: "Comments · 1", exact: true }).waitFor();
        // Native selection in a user's message must not offer annotation.
        await selectQuote(page, ".chat-turn-user");
        await page.getByRole("button", { name: "Add comment", exact: true }).waitFor({ state: "detached" });
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`PASS ${size.width}x${size.height}: select, edit/remove, combined send, failed-send retention, Reading mode, image pick/paste/drop, image-only notes and user-selection exclusion`);
      }
    } finally { await browser.close(); }
  } finally { await server.stop(true); }
} finally { rmSync(app, { recursive: true, force: true }); }

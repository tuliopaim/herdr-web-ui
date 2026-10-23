import { describe, expect, it } from "bun:test";
import { assetsChanged, frontendAssets } from "./frontendAssets.ts";

const base = "https://example.test/";
describe("frontend asset reload detection", () => {
  it("detects CSS hotfixes even with the same release revision", () => {
    const loaded = frontendAssets(["/assets/index-aaa.js", "/assets/index-bbb.css"], base);
    const served = frontendAssets(["/assets/index-aaa.js", "/assets/index-bbb.css", "/assets/chat-width-fix-ccc.css"], base);
    expect(assetsChanged(loaded, served)).toBe(true);
  });
  it("normalizes order, duplicates and absolute URLs", () => {
    expect(frontendAssets(["/assets/a.js", "/assets/b.css"], base)).toBe(frontendAssets(["https://example.test/assets/b.css", "/assets/a.js", "/assets/a.js"], base));
  });
  it("ignores missing shells, development files, icons and foreign assets", () => {
    expect(frontendAssets(["/src/main.tsx", "/favicon.png", "https://other.test/assets/a.js"], base)).toBeNull();
    expect(assetsChanged(null, "/assets/a.js")).toBe(false);
    expect(assetsChanged("/assets/a.js", null)).toBe(false);
    expect(assetsChanged("/assets/a.js", "/assets/a.js")).toBe(false);
  });
});

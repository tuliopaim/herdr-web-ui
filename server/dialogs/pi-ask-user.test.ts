import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { answerKeys, parseInteractivePrompt } from "../prompt.ts";
import { parsePiAskUser } from "./pi-ask-user.ts";

const rule = "─".repeat(60);
const askUserScreen = (selected = 0, editing = false, draft = "") => [
  rule, " Which account?", "",
  `${selected === 0 ? " ❯ " : "   "}1. Personal`, "      My own account",
  `${selected === 1 ? " ❯ " : "   "}2. Company`, "      Business account",
  `${selected === 2 ? " ❯ " : "   "}✎ Write my own answer…`,
  ...(editing ? ["", " Your answer:", ` ${rule.slice(2)}`, ` ${draft}`, ` ${rule.slice(2)}`] : []),
  "", editing ? " Enter submit • Esc back" : " ↑↓ or 1-3 select • Enter confirm • Esc dismiss", rule,
  "/tmp/project (main)", "10% context",
].join("\n");

describe("Pi's ask_user extension", () => {
  // Captured from the real custom extension on Pi 1.4.0 in an isolated herdr session.
  test("reads the captured menu and custom editor", () => {
    for (const [name, responder] of [["menu", "pi-ask-user"], ["input", "pi-ask-user-input"]] as const) {
      const screen = readFileSync(new URL(`../fixtures/pi-ask-user-1.4.0-${name}.txt`, import.meta.url), "utf8");
      const prompt = parsePiAskUser(screen)!;
      expect(prompt.responder).toBe(responder);
      expect(prompt.question).toBe("Which account should I use?");
      expect(prompt.custom_option_index).toBe(name === "input" ? 0 : null);
    }
  });

  test("reads the live OptChat footer without accepting stale dialogs", () => {
    const screen = readFileSync(new URL("../fixtures/pi-ask-user-optchat-menu.txt", import.meta.url), "utf8");
    const prompt = parsePiAskUser(screen);
    expect(prompt?.responder).toBe("pi-ask-user");
    expect(prompt?.question).toBe("One more capture of the question screen. Please wait two seconds before answering.");
    expect(prompt?.options[1]?.label).toBe("Still generic controls");
    expect(parsePiAskUser(screen + "\n❯ next message")).toBeNull();
    expect(parsePiAskUser(screen.replace("Agents: 0 running", "Unexpected output: 0 running"))).toBeNull();
    expect(parsePiAskUser(screen.replace(/OptChat:.*$/m, "Unrelated output"))).toBeNull();
  });

  test("reads options and descriptions without sending digit shortcuts", () => {
    const prompt = parseInteractivePrompt("pi", askUserScreen())!;
    expect(prompt).not.toBeNull();
    expect(prompt.question).toBe("Which account?");
    expect(prompt.options.slice(0, 3)).toEqual([
      { label: "Personal", description: "My own account" },
      { label: "Company", description: "Business account" },
      { label: "Write my own answer…", description: null },
    ]);
    expect(answerKeys(prompt, { option_index: 1 })).toEqual([{ keys: ["down"] }, { keys: ["enter"] }]);
    expect(answerKeys(prompt, { option_index: 2 })).toEqual([{ keys: ["down"] }, { keys: ["down"] }, { keys: ["enter"] }]);
    expect(answerKeys(prompt, { option_index: 3 })).toEqual([{ keys: ["esc"] }]);
    expect(() => answerKeys(prompt, { custom_text: "Not yet" })).toThrow();
  });

  test("follows the actual cursor without changing the question identity", () => {
    const first = parseInteractivePrompt("pi", askUserScreen())!;
    const moved = parseInteractivePrompt("pi", askUserScreen(1))!;
    expect(moved.id).toBe(first.id);
    expect(answerKeys(moved, { option_index: 0 })).toEqual([{ keys: ["up"] }, { keys: ["enter"] }]);
  });

  test("offers text only after the custom editor opens, and leaves terminal drafts alone", () => {
    const menu = parseInteractivePrompt("pi", askUserScreen(2))!;
    const input = parseInteractivePrompt("pi", askUserScreen(2, true))!;
    expect(input).not.toBeNull();
    expect(input.id).not.toBe(menu.id);
    expect(input.custom_option_index).toBe(0);
    const changed = parseInteractivePrompt("pi", askUserScreen(2, true).replace("2. Company", "2. Shared"))!;
    expect(changed.id).not.toBe(input.id);
    expect(answerKeys(input, { custom_text: "A different account" })).toEqual([{ text: "A different account" }, { keys: ["enter"] }]);
    const illustrated = "@/tmp/project/.herdr-web-ui/answer.png Joint account\nUse the highlighted balance";
    expect(answerKeys(input, { custom_text: illustrated })).toEqual([{ text: illustrated }, { keys: ["enter"] }]);
    expect(answerKeys(input, { option_index: 1 })).toEqual([{ keys: ["esc"] }]);
    expect(parseInteractivePrompt("pi", askUserScreen(2, true, "unfinished terminal answer"))).toBeNull();
  });

  test("joins wrapped question, labels, descriptions and hints on a phone", () => {
    const screen = askUserScreen().replace(" Which account?", " Which account should\n I use?")
      .replace("1. Personal", "1. Personal account\n   for savings")
      .replace("My own account", "My own\n      account")
      .replace("↑↓ or 1-3 select • Enter confirm • Esc dismiss", "↑↓ or 1-3 select • Enter\n confirm • Esc dismiss");
    const prompt = parseInteractivePrompt("pi", screen)!;
    expect(prompt.question).toBe("Which account should I use?");
    expect(prompt.options[0]).toEqual({ label: "Personal account for savings", description: "My own account" });
  });

  test("refuses incomplete, stale, inconsistent and non-Pi screens", () => {
    expect(parseInteractivePrompt("pi", askUserScreen().replace("2. Company", "4. Company"))).toBeNull();
    expect(parseInteractivePrompt("pi", askUserScreen().replace(" ❯ 1.", "   1."))).toBeNull();
    expect(parseInteractivePrompt("pi", askUserScreen().replace("1-3 select", "1-6 select"))).toBeNull();
    expect(parseInteractivePrompt("pi", askUserScreen() + "\n❯ next message\nreply\nreply")).toBeNull();
    expect(parseInteractivePrompt("pi", askUserScreen().replace("✎ Write my own answer…", "3. Other"))).toBeNull();
    expect(parseInteractivePrompt("codex", askUserScreen())).toBeNull();
  });
});

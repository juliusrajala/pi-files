import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import codeKataExtension, {
  buildKataGuidance,
} from "../extensions/code-kata.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("kata guidance asks for focus before implementation when none is set", () => {
  const guidance = buildKataGuidance("");
  assert.match(guidance, /First ask the learner what they want to learn/);
  assert.match(guidance, /Do not start implementation until they answer/);
});

test("kata guidance uses the selected focus and preserves the exercise boundary", () => {
  const guidance = buildKataGuidance("async functions");
  assert.match(guidance, /current focus is: async functions/);
  assert.match(
    guidance,
    /Do not fill in the learner's exercise before they try/,
  );
  assert.match(guidance, /Take over if they ask you to/);
});

test(".katafile enables kata with its goal unless the user turns it off", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "code-kata-"));
  try {
    await writeFile(join(cwd, ".katafile"), "  Rust ownership\n");
    const handlers = new Map<string, Function>();
    const commands = new Map<string, { handler: Function }>();
    const prompts: string[] = [];
    const notifications: string[] = [];
    codeKataExtension({
      on: (event: string, handler: Function) => handlers.set(event, handler),
      registerCommand: (name: string, command: { handler: Function }) =>
        commands.set(name, command),
      registerShortcut: () => {},
    } as unknown as ExtensionAPI);

    const ctx = {
      cwd,
      hasUI: true,
      ui: {
        input: async (title: string) => {
          prompts.push(title);
          return "unexpected prompt";
        },
        notify: (message: string) => notifications.push(message),
        theme: { fg: (_color: string, text: string) => text },
        setStatus: () => {},
      },
    };
    const start = handlers.get("session_start")!;
    await start({}, ctx);

    assert.deepEqual(prompts, []);
    assert.equal(notifications.at(-1), "Code kata: on");
    const event = {
      systemPromptOptions: { sections: {} as Record<string, string> },
    };
    handlers.get("before_agent_start")!(event);
    assert.match(
      event.systemPromptOptions.sections.code_kata ?? "",
      /current focus is: Rust ownership/,
    );

    await commands.get("kata")!.handler("off", ctx);
    await start({}, ctx);
    handlers.get("before_agent_start")!(event);
    assert.equal(event.systemPromptOptions.sections.code_kata, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/kata enables the mode, asks for focus, and injects guidance", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const shortcuts = new Map<string, { handler: Function }>();
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  const prompts: string[] = [];

  codeKataExtension({
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerCommand: (name: string, command: { handler: Function }) =>
      commands.set(name, command),
    registerShortcut: (key: string, shortcut: { handler: Function }) =>
      shortcuts.set(key, shortcut),
  } as unknown as ExtensionAPI);

  const ctx = {
    hasUI: true,
    ui: {
      input: async (title: string) => {
        prompts.push(title);
        return "async functions";
      },
      notify: (message: string) => notifications.push(message),
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (_key: string, value: string | undefined) =>
        statuses.push(value),
    },
  };

  await commands.get("kata")!.handler("on", ctx);
  assert.deepEqual(prompts, ["What do you want to learn?"]);
  assert.equal(notifications.at(-1), "Code kata: on");
  assert.match(statuses.at(-1)!, /kata/);

  const event = {
    systemPromptOptions: { sections: {} as Record<string, string> },
  };
  handlers.get("before_agent_start")!(event);
  assert.match(
    event.systemPromptOptions.sections.code_kata ?? "",
    /async functions/,
  );

  await commands.get("kata")!.handler("off", ctx);
  handlers.get("before_agent_start")!(event);
  assert.equal(event.systemPromptOptions.sections.code_kata, undefined);
  assert.ok(shortcuts.has("f7"));
});

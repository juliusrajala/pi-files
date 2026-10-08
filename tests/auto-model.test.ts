import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionShortcut,
  ExtensionVirtualModel,
  ModelRoute,
  ModelRouteRequest,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import autoModelExtension, {
  ASTRA,
  LUNA,
  SOL,
  readAutoModelConfig,
  type JevState,
} from "../extensions/auto-model.ts";

type Request = ModelRouteRequest<JevState>;

function user(text = "Implement this feature."): Request["messages"][number] {
  return { role: "user", content: text, timestamp: 0 };
}

function tool(toolName: string, isError = false): Request["messages"][number] {
  return {
    role: "toolResult",
    toolName,
    toolCallId: "call",
    content: [],
    isError,
    timestamp: 0,
  };
}

function harness(t: TestContext, config: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pi-auto-model-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(join(directory, "auto-model.json"), JSON.stringify(config));
  const models = new Map<string, ModelRoute["model"]>();
  function addModel(provider: string, id: string, api = "openai-responses") {
    const model = { provider, id, api } as ModelRoute["model"];
    models.set(`${provider}/${id}`, model);
    return model;
  }
  for (const provider of ["openai-codex", "openai"]) {
    for (const id of [ASTRA, SOL, LUNA]) addModel(provider, id);
  }
  const virtual = addModel("jev", "auto", "pi-virtual");
  const state = {
    selected: models.get(`openai-codex/${LUNA}`)!,
    authenticated: true,
    canSetModel: true,
    classifierAvailable: true,
    classifierResult: {
      stopReason: "stop",
      answers: {
        complexity: { type: "choice", probabilities: { complex: 0.8 } },
      },
    },
    classifications: [] as Array<{ input: unknown; options: unknown }>,
    selections: [] as string[],
    branch: [] as Record<string, unknown>[],
    notifications: [] as Array<{ message: string; type: string }>,
    status: undefined as string | undefined,
  };
  let router: ExtensionVirtualModel<JevState>;
  let command: RegisteredCommand;
  let shortcut: ExtensionShortcut;
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const ctx = {
    cwd: directory,
    get model() {
      return state.selected;
    },
    ui: {
      theme: {
        fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      },
      notify: (message: string, type: string) =>
        state.notifications.push({ message, type }),
      setStatus: (_key: string, value: string | undefined) => {
        state.status = value;
      },
    },
    modelRegistry: {
      find: (provider: string, id: string) => models.get(`${provider}/${id}`),
      hasConfiguredAuth: () => state.authenticated,
      findOfType: () =>
        state.classifierAvailable ? { id: "jev-latest" } : undefined,
      classify: async (_model: unknown, input: unknown, options: unknown) => {
        state.classifications.push({ input, options });
        return state.classifierResult;
      },
    },
    sessionManager: { getBranch: () => state.branch },
  } as unknown as ExtensionContext;
  const api = {
    registerVirtualModel: (value: ExtensionVirtualModel<JevState>) => {
      router = value;
    },
    registerCommand: (_name: string, value: RegisteredCommand) => {
      command = value;
    },
    registerShortcut: (_key: string, value: ExtensionShortcut) => {
      shortcut = value;
    },
    on: (
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => {
      handlers.set(event, handler);
    },
    setModel: async (model: ModelRoute["model"]) => {
      if (!state.canSetModel) return false;
      state.branch.push({
        type: "model_change",
        provider: state.selected.provider,
        modelId: state.selected.id,
      });
      state.selected = model;
      state.selections.push(`${model.provider}/${model.id}`);
      return true;
    },
  } as unknown as ExtensionAPI;
  autoModelExtension(api);
  return {
    ctx,
    state,
    models,
    directory,
    router: () => router,
    route: async (overrides: Partial<Request> = {}) =>
      router.route(
        {
          model: virtual,
          thinkingLevel: "high",
          reason: "user",
          messages: [user()],
          ...overrides,
        },
        ctx,
      ),
    command: (args: string) =>
      command.handler(args, ctx as ExtensionCommandContext),
    toggle: () => shortcut.handler(ctx),
    emit: (event: string) => handlers.get(event)?.({}, ctx),
  };
}

test("registers jev/auto and uses Jev to select Sol for complex planning", async (t) => {
  const h = harness(t);
  assert.equal(h.router().provider, "jev");
  assert.equal(h.router().id, "auto");
  const result = await h.route();
  assert.equal(result.model.id, SOL);
  assert.equal(result.thinkingLevel, "high");
  assert.deepEqual(result.state, { phase: "planning", model: SOL });
  assert.equal(h.state.classifications.length, 1);
});

test("uses Astra below the complexity threshold and when Jev is unavailable", async (t) => {
  const h = harness(t);
  h.state.classifierResult.answers.complexity.probabilities.complex = 0.49;
  assert.equal((await h.route()).model.id, ASTRA);
  h.state.classifierResult.answers.complexity.probabilities.complex = 0.5;
  assert.equal((await h.route()).model.id, SOL);
  h.state.classifierResult.stopReason = "error";
  assert.equal((await h.route()).model.id, ASTRA);
  h.state.classifierResult.stopReason = "aborted";
  assert.equal((await h.route()).model.id, ASTRA);
  h.state.classifierAvailable = false;
  assert.equal((await h.route()).model.id, ASTRA);
  assert.equal(h.state.classifications.length, 4);
});

test("retains an existing planning model without sending a classifier request", async (t) => {
  const h = harness(t);
  for (const id of [ASTRA, SOL]) {
    const result = await h.route({
      previous: { model: h.models.get(`openai-codex/${id}`)! },
    });
    assert.equal(result.model.id, id);
  }
  assert.equal(h.state.classifications.length, 0);
});

test("classifies only the latest user text, bounds it, and forwards cancellation", async (t) => {
  const h = harness(t);
  const signal = new AbortController().signal;
  await h.route({
    signal,
    messages: [
      user("earlier prompt"),
      {
        role: "user",
        timestamp: 0,
        content: [
          { type: "text", text: "x".repeat(20_000) },
          { type: "image", data: "secret-image", mimeType: "image/png" },
        ],
      },
    ],
  });
  const call = h.state.classifications[0]!;
  assert.equal(
    (call.input as { state: { prompt: string } }).state.prompt,
    "x".repeat(16_000),
  );
  assert.deepEqual(call.options, { signal });
});

test("keeps planning for reads and failed edits, then hands off after edit or write", async (t) => {
  const h = harness(t);
  const state: JevState = { phase: "planning", model: SOL };
  for (const message of [
    tool("read"),
    tool("edit", true),
    tool("write", true),
  ]) {
    assert.equal(
      (
        await h.route({
          reason: "continuation",
          state,
          messages: [user(), message],
        })
      ).model.id,
      SOL,
    );
  }
  for (const name of ["edit", "write"]) {
    const result = await h.route({
      reason: "continuation",
      state,
      messages: [user(), tool(name)],
    });
    assert.equal(result.model.id, LUNA);
    assert.deepEqual(result.state, { phase: "implementation", model: LUNA });
  }
  assert.equal(h.state.classifications.length, 0);
});

test("recognizes successful nested codemode edits without treating failures as edits", async (t) => {
  const h = harness(t);
  const state: JevState = { phase: "planning", model: SOL };
  for (const status of ["ok", "error", "unfinished"] as const) {
    const nested: Request["messages"][number] = {
      role: "toolResult",
      toolName: "codemode",
      toolCallId: "parent",
      content: [],
      timestamp: 0,
      isError: true,
      nestedCalls: {
        complete: true,
        calls: [{ id: "parent/1", name: "edit", status }],
      },
    };
    assert.equal(
      (await h.route({ state, messages: [user(), nested] })).model.id,
      status === "ok" ? LUNA : SOL,
    );
  }
});

test("uses branch state for retries, later inputs, resume and tree navigation", async (t) => {
  const h = harness(t);
  const planning: JevState = { phase: "planning", model: SOL };
  const implementation: JevState = { phase: "implementation", model: LUNA };
  for (const reason of ["user", "continuation", "retry"] as const) {
    assert.equal((await h.route({ reason, state: planning })).model.id, SOL);
    assert.equal(
      (
        await h.route({
          reason,
          state: implementation,
          messages: [user("Difficult architecture redesign")],
        })
      ).model.id,
      LUNA,
    );
  }
  // Navigating back to a planning branch must not retain another branch's phase.
  assert.equal(
    (await h.route({ state: planning, messages: [tool("edit"), user()] })).model
      .id,
    SOL,
  );
  assert.equal(h.state.classifications.length, 0);
});

test("direct requests use Luna without classification or persisted state", async (t) => {
  const h = harness(t);
  const result = await h.route({ reason: "direct" });
  assert.equal(result.model.id, LUNA);
  assert.equal(result.state, undefined);
  assert.equal(h.state.classifications.length, 0);
});

test("supports another physical provider and fails clearly for unavailable or virtual targets", async (t) => {
  const h = harness(t, { provider: "openai", complexPlanningModel: ASTRA });
  assert.equal((await h.route()).model.provider, "openai");
  assert.equal((await h.route()).model.id, ASTRA);
  h.models.delete(`openai/${ASTRA}`);
  await assert.rejects(
    h.route(),
    /Physical model openai\/gpt-6-astra is not available/,
  );
  h.models.set(`openai/${ASTRA}`, h.models.get("jev/auto")!);
  await assert.rejects(h.route(), /Physical model .* is not available/);
});

test("commands and F8 select the router and return to the last physical model", async (t) => {
  const h = harness(t);
  await h.command("on");
  assert.equal(h.state.selected.id, "auto");
  assert.equal(
    h.state.status,
    "<success>●</success> <success>auto-model</success>  ",
  );
  await h.command("status");
  assert.equal(h.state.selections.length, 1);
  h.state.branch.push({
    type: "message",
    message: { role: "assistant", provider: "openai-codex", model: SOL },
  });
  await h.command("off");
  assert.equal(h.state.selected.id, SOL);
  await h.toggle();
  assert.equal(h.state.selected.id, "auto");
  await h.command("");
  assert.equal(h.state.selected.id, SOL);
  await h.command("invalid");
  assert.match(h.state.notifications.at(-1)!.message, /Usage:/);
});

test("activation failures do not report success or change the selected model", async (t) => {
  const h = harness(t);
  h.state.authenticated = false;
  await h.command("on");
  assert.equal(h.state.selected.id, LUNA);
  assert.equal(h.state.notifications.at(-1)!.type, "error");
  h.state.authenticated = true;
  h.state.canSetModel = false;
  await h.command("on");
  assert.equal(h.state.selected.id, LUNA);
  assert.match(h.state.notifications.at(-1)!.message, /Could not change model/);
});

test("a disabled directory blocks activation and routing even when selected via /model", async (t) => {
  const h = harness(t, { disabledRepositories: [process.cwd()] });
  h.ctx.cwd = process.cwd();
  await h.command("on");
  assert.match(h.state.notifications.at(-1)!.message, /disabled here/);
  await assert.rejects(h.route(), /disabled here/);
  h.state.selected = h.models.get("jev/auto")!;
  await h.command("off");
  assert.equal(h.state.selected.id, ASTRA);
});

test("preserves the colored dot and label across selection and session lifecycle", (t) => {
  const h = harness(t);
  const off = "<dim>●</dim> <dim>auto-model</dim>  ";
  const on = "<success>●</success> <success>auto-model</success>  ";
  h.emit("session_start");
  assert.equal(h.state.status, off);
  h.state.selected = h.models.get("jev/auto")!;
  h.emit("model_select");
  assert.equal(h.state.status, on);
  h.state.selected = h.models.get(`openai-codex/${ASTRA}`)!;
  h.emit("session_tree");
  assert.equal(h.state.status, off);
  h.emit("session_shutdown");
  assert.equal(h.state.status, undefined);
});

test("configuration honors the agent directory and validates malformed values", (t) => {
  const h = harness(t);
  assert.equal(readAutoModelConfig(h.directory).complexPlanningModel, SOL);
  const path = join(h.directory, "auto-model.json");
  for (const value of [
    "null",
    "{",
    '{"disabledRepositories":[1]}',
    '{"provider":false}',
    '{"implementationModel":""}',
  ]) {
    writeFileSync(path, value);
    assert.throws(() => readAutoModelConfig(h.directory));
  }
  rmSync(path);
  assert.equal(readAutoModelConfig(h.directory).planningModel, ASTRA);
});

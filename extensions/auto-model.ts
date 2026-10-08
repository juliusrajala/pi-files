import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type ModelRoute,
  type ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";

export const SOL = "gpt-6.1-sol";
export const ASTRA = "gpt-6-astra";
export const LUNA = "gpt-6-luna";
export const ROUTER_PROVIDER = "jev";
export const ROUTER_ID = "auto";

export type AutoModelConfig = {
  provider: string;
  planningModel: string;
  complexPlanningModel: string;
  implementationModel: string;
  disabledRepositories: string[];
};

export type JevState = {
  phase: "planning" | "implementation";
  model: string;
};

type JevRequest = ModelRouteRequest<JevState>;

// Based on Pi 0.99.1's examples/extensions/jev-router.ts. Keep the planning
// model through the first edit, then accept one cache miss to implement on Luna.
export default function autoModelExtension(pi: ExtensionAPI) {
  const config = readAutoModelConfig(getAgentDir());

  pi.registerVirtualModel<JevState>({
    provider: ROUTER_PROVIDER,
    id: ROUTER_ID,
    name: "Auto (Jev)",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    async route(request, ctx) {
      if (isDisabled(ctx.cwd, config)) {
        throw new Error(
          "Auto model routing is disabled here. Select a physical model or run /auto-model off.",
        );
      }
      if (request.reason === "direct") {
        return routeTo(request, ctx, config, config.implementationModel);
      }
      const state = request.state;
      if (!state) {
        const model = await choosePlanningModel(request, ctx, config);
        return routeTo(request, ctx, config, model, {
          phase: "planning",
          model,
        });
      }
      if (state.phase === "planning" && editedThisTurn(request.messages)) {
        const model = config.implementationModel;
        return routeTo(request, ctx, config, model, {
          phase: "implementation",
          model,
        });
      }
      return routeTo(request, ctx, config, state.model);
    },
  });

  async function setEnabled(enabled: boolean, ctx: ExtensionContext) {
    try {
      if (enabled !== isAutoModel(ctx.model)) {
        if (enabled && isDisabled(ctx.cwd, config)) {
          throw new Error("Auto model routing is disabled here.");
        }
        if (enabled) {
          for (const id of new Set([
            config.planningModel,
            config.complexPlanningModel,
            config.implementationModel,
          ])) {
            const target = findPhysicalModel(ctx, config.provider, id);
            if (!ctx.modelRegistry.hasConfiguredAuth(target)) {
              throw new Error(
                `Sign in to ${config.provider} before enabling auto model routing.`,
              );
            }
          }
        }
        const model = enabled
          ? ctx.modelRegistry.find(ROUTER_PROVIDER, ROUTER_ID)
          : (lastPhysicalModel(ctx) ??
            findPhysicalModel(ctx, config.provider, config.planningModel));
        if (!model || !(await pi.setModel(model))) {
          throw new Error(
            "Could not change model; check model availability and authentication.",
          );
        }
      }
      setAutoModelStatus(ctx, enabled);
      ctx.ui.notify(
        `Auto model selection: ${enabled ? "on (Jev)" : "off"}`,
        "info",
      );
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  pi.registerCommand("auto-model", {
    description: "Toggle the Jev planning/implementation router",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (!["", "toggle", "on", "off", "status"].includes(command)) {
        ctx.ui.notify("Usage: /auto-model [on|off|toggle|status]", "error");
        return;
      }
      const enabled = isAutoModel(ctx.model);
      await setEnabled(
        command === "status"
          ? enabled
          : command === "on" || (command !== "off" && !enabled),
        ctx,
      );
    },
  });

  pi.registerShortcut("f8", {
    description: "Toggle the Jev planning/implementation router",
    handler: (ctx) => setEnabled(!isAutoModel(ctx.model), ctx),
  });

  const updateStatus = (ctx: ExtensionContext) =>
    setAutoModelStatus(ctx, isAutoModel(ctx.model));
  pi.on("session_start", (_event, ctx) => updateStatus(ctx));
  pi.on("session_tree", (_event, ctx) => updateStatus(ctx));
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) =>
    ctx.ui.setStatus("auto-model", undefined),
  );
}

function setAutoModelStatus(ctx: ExtensionContext, enabled: boolean): void {
  const color = enabled ? "success" : "dim";
  const marker = ctx.ui.theme.fg(color, "●");
  const label = ctx.ui.theme.fg(color, "auto-model");
  ctx.ui.setStatus("auto-model", `${marker} ${label}  `);
}

function routeTo(
  request: JevRequest,
  ctx: ExtensionContext,
  config: AutoModelConfig,
  id: string,
  state?: JevState,
): ModelRoute<JevState> {
  return {
    model: findPhysicalModel(ctx, config.provider, id),
    thinkingLevel: request.thinkingLevel,
    ...(state ? { state } : {}),
  };
}

async function choosePlanningModel(
  request: JevRequest,
  ctx: ExtensionContext,
  config: AutoModelConfig,
): Promise<string> {
  // Match the upstream router: retain an existing planning model to avoid a cache miss.
  const previous = request.previous?.model;
  if (
    previous?.provider === config.provider &&
    [config.planningModel, config.complexPlanningModel].includes(previous.id)
  ) {
    return previous.id;
  }
  const jev = ctx.modelRegistry.findOfType(
    "classifier",
    "typesafe",
    "jev-latest",
  );
  if (!jev) return config.planningModel;
  const result = await ctx.modelRegistry.classify(
    jev,
    {
      state: { prompt: lastUserText(request.messages).slice(0, 16_000) },
      questions: {
        complexity: {
          type: "choice",
          instructions:
            "How demanding is the software engineering work requested in `prompt`?",
          criteria: {
            standard: "Ordinary features, fixes, reviews, or questions",
            complex: "Subtle design, cross-cutting changes, or hard debugging",
          },
        },
      },
    },
    request.signal ? { signal: request.signal } : {},
  );
  const answer =
    result.stopReason === "stop" ? result.answers.complexity : undefined;
  return answer?.type === "choice" && (answer.probabilities.complex ?? 0) >= 0.5
    ? config.complexPlanningModel
    : config.planningModel;
}

function lastUserText(messages: JevRequest["messages"]): string {
  const content =
    messages.findLast((message) => message.role === "user")?.content ?? "";
  return typeof content === "string"
    ? content
    : content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
}

function editedThisTurn(messages: JevRequest["messages"]): boolean {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(lastUser + 1).some((message) => {
    if (message.role !== "toolResult") return false;
    if (["edit", "write"].includes(message.toolName) && !message.isError)
      return true;
    // Codemode edits are nested calls, not standalone transcript messages.
    return (
      message.nestedCalls?.calls.some(
        (call) => ["edit", "write"].includes(call.name) && call.status === "ok",
      ) ?? false
    );
  });
}

function isAutoModel(model: ExtensionContext["model"]): boolean {
  return model?.provider === ROUTER_PROVIDER && model.id === ROUTER_ID;
}

function findPhysicalModel(
  ctx: ExtensionContext,
  provider: string,
  id: string,
): ModelRoute["model"] {
  const model = ctx.modelRegistry.find(provider, id);
  if (!model || model.api === "pi-virtual") {
    throw new Error(
      `Physical model ${provider}/${id} is not available. Check auto-model.json and /model.`,
    );
  }
  return model;
}

function lastPhysicalModel(
  ctx: ExtensionContext,
): ModelRoute["model"] | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    const reference =
      entry.type === "model_change"
        ? { provider: entry.provider, id: entry.modelId }
        : entry.type === "message" && entry.message.role === "assistant"
          ? { provider: entry.message.provider, id: entry.message.model }
          : undefined;
    if (!reference) continue;
    const model = ctx.modelRegistry.find(reference.provider, reference.id);
    if (model && model.api !== "pi-virtual") return model;
  }
  return undefined;
}

function isDisabled(cwd: string, config: AutoModelConfig): boolean {
  return config.disabledRepositories.some(
    (path) => canonicalPath(path) === canonicalPath(cwd),
  );
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

export function readAutoModelConfig(agentDir: string): AutoModelConfig {
  const path = join(agentDir, "auto-model.json");
  let value: unknown = {};
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw new Error(`Could not read ${path}; check its JSON syntax.`, {
        cause: error,
      });
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must contain a configuration object.`);
  }
  const config = value as Record<string, unknown>;
  function modelSetting(key: string, fallback: string): string {
    const setting = config[key] ?? fallback;
    if (typeof setting !== "string" || !setting.trim())
      throw new Error(`Invalid ${key} in ${path}.`);
    return setting.trim();
  }
  const disabled = config.disabledRepositories ?? [];
  if (
    !Array.isArray(disabled) ||
    !disabled.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`Invalid disabledRepositories in ${path}.`);
  }
  return {
    provider: modelSetting("provider", "openai-codex"),
    planningModel: modelSetting("planningModel", ASTRA),
    complexPlanningModel: modelSetting("complexPlanningModel", SOL),
    implementationModel: modelSetting("implementationModel", LUNA),
    disabledRepositories: disabled,
  };
}

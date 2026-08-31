import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type AutoModelConfig = {
  disabledRepositories?: string[];
};

export const TERRA = "gpt-5.6-terra";
export const LUNA = "gpt-5.6-luna";
const CONFIG_PATH = join(
  process.env.HOME ?? "",
  ".pi",
  "agent",
  "auto-model.json",
);

export default function (pi: ExtensionAPI) {
  const state = { enabled: true };

  pi.registerCommand("auto-model", {
    description: "Toggle automatic Terra/Luna selection",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (command === "on" || command === "off") {
        state.enabled = command === "on";
      } else if (command === "" || command === "toggle") {
        state.enabled = !state.enabled;
      } else if (command !== "status") {
        ctx.ui.notify("Usage: /auto-model [on|off|toggle|status]", "error");
        return;
      }

      setAutoModelStatus(ctx, state.enabled);
      ctx.ui.notify(
        `Auto model selection: ${state.enabled ? "on" : "off"}`,
        "info",
      );
    },
  });

  pi.registerShortcut("f8", {
    description: "Toggle automatic Terra/Luna selection",
    handler: async (ctx) => {
      state.enabled = !state.enabled;
      setAutoModelStatus(ctx, state.enabled);
      ctx.ui.notify(
        `Auto model selection: ${state.enabled ? "on" : "off"}`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    setAutoModelStatus(
      ctx,
      state.enabled && !isDisabled(getRepositoryPath(ctx.cwd) ?? ""),
    );
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const repository = getRepositoryPath(ctx.cwd);
    if (!state.enabled || repository === undefined || isDisabled(repository)) {
      return;
    }

    const targetModelId = chooseModel(event.prompt);
    if (ctx.model?.id === targetModelId) {
      return;
    }

    const model = ctx.modelRegistry.find("openai-codex", targetModelId);
    if (model === undefined) {
      console.warn(`[auto-model] Model not available: ${targetModelId}`);
      return;
    }

    const changed = await pi.setModel(model);
    if (changed) {
      setAutoModelStatus(ctx, true);
      console.log(
        `[auto-model] ${repository}: ${targetModelId} for ${summarizeReason(event.prompt)}`,
      );
    }
  });
}

function setAutoModelStatus(ctx: ExtensionContext, enabled: boolean): void {
  const status = `Auto-model: ${enabled ? "On" : "Off"}`;
  ctx.ui.setStatus("auto-model", ctx.ui.theme.fg("dim", status));
}

export function chooseModel(prompt: string): string {
  const terraSignals = [
    /architect|architecture|design|redesign|trade-?off/i,
    /debug|investigate|diagnos|root cause|race condition|flak/i,
    /refactor|restructure|migrat|multi[- ]file|cross[- ]cutting/i,
    /security|permission|auth|database schema|backfill/i,
    /complex|ambiguous|carefully|thorough|review the whole/i,
  ];
  const score = terraSignals.reduce(
    (total, signal) => total + (signal.test(prompt) ? 1 : 0),
    0,
  );

  return score >= 1 || prompt.length > 700 ? TERRA : LUNA;
}

function getRepositoryPath(cwd: string): string | undefined {
  try {
    return realpathSync(resolve(cwd));
  } catch {
    return undefined;
  }
}

function isDisabled(repository: string): boolean {
  if (!existsSync(CONFIG_PATH)) {
    return false;
  }

  try {
    const config = JSON.parse(
      readFileSync(CONFIG_PATH, "utf8"),
    ) as AutoModelConfig;
    return (config.disabledRepositories ?? []).some((path) => {
      try {
        return realpathSync(resolve(path)) === repository;
      } catch {
        return resolve(path) === repository;
      }
    });
  } catch (error) {
    console.warn(
      `[auto-model] Could not read ${CONFIG_PATH}: ${String(error)}`,
    );
    return false;
  }
}

export function summarizeReason(prompt: string): string {
  return prompt.replace(/\s+/g, " ").slice(0, 100);
}

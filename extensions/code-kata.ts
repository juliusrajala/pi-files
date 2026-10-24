import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export default function codeKataExtension(pi: ExtensionAPI) {
  let enabled = false;
  let focus = "";
  let explicitlyDisabled = false;

  function updateStatus(ctx: ExtensionContext) {
    const color = enabled ? "success" : "dim";
    const marker = ctx.ui.theme.fg(color, "●");
    const label = ctx.ui.theme.fg(color, "kata");
    ctx.ui.setStatus("code-kata", `${marker} ${label}  `);
  }

  async function setEnabled(next: boolean, ctx: ExtensionContext) {
    explicitlyDisabled = !next;
    if (next && !enabled && !focus && ctx.hasUI) {
      const answer = await ctx.ui.input(
        "What do you want to learn?",
        "For example: async functions, React state, or SQL joins",
      );
      focus = answer?.trim() ?? "";
    }
    enabled = next;
    updateStatus(ctx);
    ctx.ui.notify(`Code kata: ${enabled ? "on" : "off"}`, "info");
  }

  pi.registerCommand("kata", {
    description: "Toggle code kata mode",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (!["", "toggle", "on", "off", "status"].includes(command)) {
        ctx.ui.notify("Usage: /kata [on|off|toggle|status]", "error");
        return;
      }
      if (command === "status") {
        ctx.ui.notify(
          `Code kata: ${enabled ? "on" : "off"}${focus ? ` · focus: ${focus}` : ""}`,
          "info",
        );
        return;
      }
      await setEnabled(
        command === "off" ? false : command === "on" ? true : !enabled,
        ctx,
      );
    },
  });

  pi.registerShortcut("f7", {
    description: "Toggle code kata mode",
    handler: (ctx) => setEnabled(!enabled, ctx),
  });

  pi.on("before_agent_start", (event) => {
    if (!enabled) {
      delete event.systemPromptOptions.sections.code_kata;
      return;
    }
    event.systemPromptOptions.sections.code_kata = buildKataGuidance(focus);
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
    if (explicitlyDisabled) return;

    let kataFocus: string;
    try {
      kataFocus = (await readFile(join(ctx.cwd, ".katafile"), "utf8")).trim();
    } catch {
      // A missing or unreadable .katafile does not change the current mode.
      return;
    }
    if (kataFocus) {
      focus = kataFocus;
      await setEnabled(true, ctx);
    }
  });
  pi.on("session_tree", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("code-kata", undefined);
  });
}

export function buildKataGuidance(focus: string): string {
  const focusInstruction = focus
    ? `The learner's current focus is: ${focus}. Connect exercises and explanations to this focus when relevant.`
    : "First ask the learner what they want to learn. Do not start implementation until they answer.";

  return [
    "Code kata mode is active. Help the user learn while you work together.",
    focusInstruction,
    "For coding work, identify one small, useful piece that matches the learner's focus, such as a function body, function signature, test, or design choice.",
    "Explain the task and its expected behavior, then leave that piece for the learner to write. Implement the surrounding code and keep the exercise boundary clear.",
    "Do not fill in the learner's exercise before they try. Avoid leaving the repository in a broken state; when an unfinished code gap would break the project, ask the learner to write the piece in chat before applying it.",
    "When the learner shares an attempt, review it, explain what works and what needs change, and help them finish it. Take over if they ask you to.",
  ].join("\n");
}

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  AnalyticsRecorder,
  estimateJsonBytes,
} from "../src/analytics/recorder.ts";

export default function piUsageAnalyticsExtension(pi: ExtensionAPI) {
  const recorder = new AnalyticsRecorder();
  const toolStarts = new Map<
    string,
    {
      interactionId: string | null;
      monotonicMs: number;
      inputBytes: number | null;
    }
  >();
  const turnStarts = new Map<
    number,
    { interactionId: string | null; monotonicMs: number }
  >();
  const interactionState: {
    activeInteractionId: string | undefined;
    pendingInteractionId: string | undefined;
  } = { activeInteractionId: undefined, pendingInteractionId: undefined };
  const skillsByPath = new Map<string, string>();

  const leafId = (ctx: ExtensionContext) => ctx.sessionManager.getLeafId();

  pi.events.on("pi-files:permission-denied", (data) => {
    if (!isPermissionDenial(data)) return;
    recorder.record(
      "permission_denied",
      {
        interactionId: interactionState.activeInteractionId ?? null,
        operation: data.operation,
      },
      null,
    );
  });

  pi.on("session_start", (event, ctx) => {
    recorder.startSession(ctx.sessionManager.getSessionId());
    recorder.record("session_started", { reason: event.reason }, leafId(ctx));
  });

  pi.on("session_shutdown", async (event, ctx) => {
    recorder.record("session_stopped", { reason: event.reason }, leafId(ctx));
    await recorder.flush(leafId(ctx));
  });

  pi.on("input", (event, ctx) => {
    const inputBytes = Buffer.byteLength(event.text, "utf8");
    const interactionId = randomUUID();
    interactionState.pendingInteractionId = interactionId;
    recorder.record(
      "input_received",
      {
        attachmentCount: event.images?.length ?? 0,
        characterCount: event.text.length,
        inputBytes,
        interactionId,
        source: event.source,
        streamingBehavior: event.streamingBehavior ?? null,
      },
      leafId(ctx),
    );

    const skillName = parseExplicitSkillName(event.text);
    if (skillName !== undefined)
      recorder.record("skill_requested", { skillName }, leafId(ctx));
  });

  pi.on("before_agent_start", (event) => {
    skillsByPath.clear();
    for (const skill of event.systemPromptOptions.skills ?? []) {
      skillsByPath.set(skill.filePath, skill.name);
    }
  });

  pi.on("turn_start", (event, ctx) => {
    const interactionId =
      interactionState.activeInteractionId ??
      interactionState.pendingInteractionId ??
      null;
    interactionState.pendingInteractionId = undefined;
    interactionState.activeInteractionId = interactionId ?? undefined;
    turnStarts.set(event.turnIndex, {
      interactionId,
      monotonicMs: performance.now(),
    });
    recorder.record(
      "turn_started",
      { interactionId, turnIndex: event.turnIndex },
      leafId(ctx),
    );
  });

  pi.on("turn_end", (event, ctx) => {
    const started = turnStarts.get(event.turnIndex);
    turnStarts.delete(event.turnIndex);
    recorder.record(
      "turn_finished",
      {
        durationMs:
          started === undefined
            ? null
            : performance.now() - started.monotonicMs,
        interactionId: started?.interactionId ?? null,
        toolResultCount: event.toolResults.length,
        turnIndex: event.turnIndex,
      },
      leafId(ctx),
    );
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const interactionId = interactionState.activeInteractionId ?? null;
    toolStarts.set(event.toolCallId, {
      inputBytes: estimateJsonBytes(event.args),
      interactionId,
      monotonicMs: performance.now(),
    });
    recorder.record(
      "tool_started",
      { interactionId, toolCallId: event.toolCallId, toolName: event.toolName },
      leafId(ctx),
    );

    if (event.toolName === "read") {
      const skillName = findReadSkillName(event.args, ctx.cwd, skillsByPath);
      if (skillName !== undefined)
        recorder.record("skill_read", { skillName }, leafId(ctx));
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const started = toolStarts.get(event.toolCallId);
    toolStarts.delete(event.toolCallId);
    recorder.record(
      "tool_finished",
      {
        durationMs:
          started === undefined
            ? null
            : performance.now() - started.monotonicMs,
        inputBytes: started?.inputBytes ?? null,
        interactionId: started?.interactionId ?? null,
        isError: event.isError,
        resultBytes: estimateJsonBytes(event.result),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      },
      leafId(ctx),
    );
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    recorder.record(
      "assistant_completed",
      {
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        inputTokens: usage.input,
        interactionId: interactionState.activeInteractionId ?? null,
        model: event.message.model,
        outputTokens: usage.output,
        provider: event.message.provider,
        stopReason: event.message.stopReason,
        thinkingLevel: ctx.thinkingLevel,
        totalTokens: usage.totalTokens,
      },
      leafId(ctx),
    );
  });

  pi.on("model_select", (event, ctx) => {
    recorder.record(
      "model_selected",
      {
        model: event.model.id,
        provider: event.model.provider,
        source: event.source,
      },
      leafId(ctx),
    );
  });

  pi.on("thinking_level_select", (event, ctx) => {
    recorder.record(
      "thinking_level_selected",
      { level: event.level },
      leafId(ctx),
    );
  });

  pi.on("session_compact", (event, ctx) => {
    recorder.record(
      "compaction_finished",
      {
        fromExtension: event.fromExtension,
        interactionId: interactionState.activeInteractionId ?? null,
        reason: event.reason,
        tokensBefore: event.compactionEntry.tokensBefore,
        willRetry: event.willRetry,
      },
      leafId(ctx),
    );
  });

  pi.on("session_compact_failed", (event, ctx) => {
    recorder.record(
      "compaction_failed",
      {
        aborted: event.aborted,
        errorCategory: event.aborted
          ? "aborted"
          : event.errorMessage
            ? "error"
            : "unknown",
        fromExtension: event.fromExtension,
        interactionId: interactionState.activeInteractionId ?? null,
        reason: event.reason,
        willRetry: event.willRetry,
      },
      leafId(ctx),
    );
  });

  pi.on("session_tree", (event, ctx) => {
    recorder.record(
      "tree_navigated",
      { oldLeafId: event.oldLeafId, newLeafId: event.newLeafId },
      leafId(ctx),
    );
  });

  pi.on("agent_settled", async (_event, ctx) => {
    recorder.record(
      "agent_settled",
      { interactionId: interactionState.activeInteractionId ?? null },
      leafId(ctx),
    );
    interactionState.activeInteractionId = undefined;
    interactionState.pendingInteractionId = undefined;
    await recorder.flush(leafId(ctx));
  });
}

export function parseExplicitSkillName(input: string): string | undefined {
  return input.match(/^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)\b/)?.[1];
}

export function findReadSkillName(
  args: unknown,
  cwd: string,
  skillsByPath: ReadonlyMap<string, string>,
): string | undefined {
  if (
    typeof args !== "object" ||
    args === null ||
    !("path" in args) ||
    typeof args.path !== "string"
  ) {
    return undefined;
  }
  return skillsByPath.get(resolve(cwd, args.path.replace(/^@/, "")));
}

function isPermissionDenial(value: unknown): value is { operation: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "operation" in value &&
    typeof value.operation === "string"
  );
}

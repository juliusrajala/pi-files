#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { getAgentDir } from "../../../src/analytics/recorder.ts";

type JsonObject = Record<string, unknown>;

type AnalyticsEvent = {
  data: JsonObject;
  sessionId: string;
  timestamp: string;
  type: string;
};

type Interaction = {
  assistantResponses: number;
  characterCount: number;
  errorCount: number;
  inputTimestamp: string;
  settled: boolean;
  toolCount: number;
  turnCount: number;
  totalDurationMs: number;
  totalTokens: number;
};

type Prompt = {
  interactionId: string | undefined;
  sessionId: string;
  text: string;
  timestamp: string;
};

const analyticsRoot = join(getAgentDir(), "analytics");
const sessionsRoot = join(getAgentDir(), "sessions");

const options = parseArgs(process.argv.slice(2));
const events = await readEvents(options.start, options.end, options.sessionId);
const prompts = options.includePrompts
  ? await readPrompts(options.start, options.end, events, options.sessionId)
  : [];

printReport({
  end: options.end,
  events,
  prompts,
  sessionId: options.sessionId,
  start: options.start,
});

async function readEvents(
  start: Date,
  end: Date,
  sessionIdFilter: string | undefined,
): Promise<AnalyticsEvent[]> {
  const paths = await findJsonlFiles(analyticsRoot);
  const events: AnalyticsEvent[] = [];

  for (const path of paths) {
    const contents = await readFile(path, "utf8");
    for (const line of contents.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isObject(parsed)) continue;
        const timestamp = stringValue(parsed.timestamp);
        const sessionId = stringValue(parsed.sessionId);
        const type = stringValue(parsed.type);
        const data = parsed.data;
        if (
          timestamp === undefined ||
          sessionId === undefined ||
          type === undefined ||
          !isObject(data)
        )
          continue;
        const date = new Date(timestamp);
        if (
          Number.isNaN(date.getTime()) ||
          date < start ||
          date >= end ||
          (sessionIdFilter !== undefined && sessionId !== sessionIdFilter)
        )
          continue;
        events.push({ data, sessionId, timestamp, type });
      } catch {
        // Ignore a truncated final record from a process that exited abruptly.
      }
    }
  }

  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return events;
}

async function readPrompts(
  start: Date,
  end: Date,
  events: AnalyticsEvent[],
  sessionIdFilter: string | undefined,
): Promise<Prompt[]> {
  const paths = await findJsonlFiles(sessionsRoot);
  const prompts: Prompt[] = [];

  for (const path of paths) {
    const contents = await readFile(path, "utf8");
    let sessionId: string | undefined;
    for (const line of contents.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isObject(parsed)) continue;
        sessionId ??= stringValue(parsed.id);
        if (parsed.type !== "message" || !isObject(parsed.message)) continue;
        if (parsed.message.role !== "user") continue;
        const timestamp = stringValue(parsed.timestamp);
        const messageContent = parsed.message.content;
        if (timestamp === undefined || !Array.isArray(messageContent)) continue;
        const date = new Date(timestamp);
        if (
          Number.isNaN(date.getTime()) ||
          date < start ||
          date >= end ||
          sessionId === undefined ||
          (sessionIdFilter !== undefined && sessionId !== sessionIdFilter)
        )
          continue;
        const text = messageContent
          .filter(isObject)
          .filter((part) => part.type === "text")
          .map((part) => stringValue(part.text) ?? "")
          .join("\n");
        prompts.push({
          interactionId: undefined,
          sessionId,
          text,
          timestamp,
        });
      } catch {
        // Session files can also have a truncated final record.
      }
    }
  }

  prompts.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const matchedInputEvents = new Set<AnalyticsEvent>();
  for (const prompt of prompts) {
    const promptTime = new Date(prompt.timestamp).getTime();
    const match = events
      .filter(
        (event) =>
          event.type === "input_received" &&
          event.sessionId === prompt.sessionId &&
          interactionId(event) !== undefined &&
          !matchedInputEvents.has(event),
      )
      .map((event) => ({
        distance: Math.abs(new Date(event.timestamp).getTime() - promptTime),
        event,
      }))
      .filter(({ distance }) => distance <= 10_000)
      .sort((left, right) => left.distance - right.distance)[0];
    if (match === undefined) continue;
    matchedInputEvents.add(match.event);
    prompt.interactionId = interactionId(match.event);
  }
  return prompts;
}

function printReport({
  end,
  events,
  prompts,
  sessionId,
  start,
}: {
  end: Date;
  events: AnalyticsEvent[];
  prompts: Prompt[];
  sessionId: string | undefined;
  start: Date;
}): void {
  const typeCount = countBy(events, (event) => event.type);
  const inputs = events.filter((event) => event.type === "input_received");
  const responses = events.filter(
    (event) => event.type === "assistant_completed",
  );
  const turns = events.filter((event) => event.type === "turn_finished");
  const tools = events.filter((event) => event.type === "tool_finished");
  const toolErrors = tools.filter((event) => booleanValue(event.data.isError));
  const interactions = collectInteractions(events);
  const totalTokens = sumNumber(responses, "totalTokens");
  const cacheReadTokens = sumNumber(responses, "cacheReadTokens");
  const turnDurations = numberValues(turns, "durationMs");
  const toolDurations = numberValues(tools, "durationMs");

  console.log(`# Pi usage report`);
  console.log(`\nRange: ${start.toISOString()} – ${end.toISOString()}`);
  console.log(`Events: ${events.length}`);
  console.log(
    sessionId === undefined
      ? `Sessions: ${new Set(events.map((event) => event.sessionId)).size}`
      : `Session: ${sessionId}`,
  );
  console.log(`\n## Activity`);
  console.log(`- Inputs: ${inputs.length}`);
  console.log(`- Input characters: ${sumNumber(inputs, "characterCount")}`);
  console.log(`- Assistant responses: ${responses.length}`);
  console.log(`- Turns: ${turns.length}`);
  console.log(`- Tool calls: ${tools.length} (${toolErrors.length} errors)`);
  console.log(
    `- Tool calls per response: ${average(tools.length, responses.length)}`,
  );
  console.log(`\n## Tokens`);
  console.log(`- Total: ${formatNumber(totalTokens)}`);
  console.log(`- Input: ${formatNumber(sumNumber(responses, "inputTokens"))}`);
  console.log(
    `- Output: ${formatNumber(sumNumber(responses, "outputTokens"))}`,
  );
  console.log(
    `- Cache read: ${formatNumber(cacheReadTokens)} (${ratio(cacheReadTokens, totalTokens)})`,
  );
  console.log(`\n## Models`);
  printCounts(responses, (event) => stringValue(event.data.model) ?? "unknown");
  console.log(`\n## Tools`);
  printToolCounts(tools);
  console.log(`\n## Skills read`);
  printCounts(
    events.filter((event) => event.type === "skill_read"),
    (event) => stringValue(event.data.skillName) ?? "unknown",
  );
  console.log(`\n## Timing`);
  console.log(`- Turn duration: ${summarizeDurations(turnDurations)}`);
  console.log(`- Tool duration: ${summarizeDurations(toolDurations)}`);
  console.log(`\n## Other events`);
  for (const type of [
    "permission_denied",
    "compaction_finished",
    "compaction_failed",
    "records_dropped",
  ])
    console.log(`- ${type}: ${typeCount.get(type) ?? 0}`);

  const interactionCoverage = inputs.filter(
    (event) => interactionId(event) !== undefined,
  );
  console.log(`\n## Interaction analysis`);
  console.log(
    `- Inputs with interaction IDs: ${interactionCoverage.length}/${inputs.length}`,
  );
  if (interactions.size > 0) {
    console.log(
      `- Completed interactions: ${[...interactions.values()].filter((item) => item.settled).length}`,
    );
    console.log(`- Interactions with turn data: ${interactions.size}`);
    console.log("- Longest interactions by summed turn duration:");
    for (const [id, interaction] of [...interactions.entries()]
      .sort((left, right) => right[1].totalDurationMs - left[1].totalDurationMs)
      .slice(0, 10))
      console.log(
        `  - ${id} (${interaction.inputTimestamp}): ${interaction.characterCount} chars, ${formatDuration(interaction.totalDurationMs)}, ${interaction.turnCount} turns, ${interaction.assistantResponses} responses, ${interaction.toolCount} tools, ${interaction.errorCount} errors, ${formatNumber(interaction.totalTokens)} tokens`,
      );
  } else {
    console.log("- No interaction-level data is available in this range.");
  }

  if (prompts.length > 0) {
    console.log(`\n## Prompts from Pi session files`);
    for (const prompt of prompts) {
      const interaction =
        prompt.interactionId === undefined
          ? undefined
          : interactions.get(prompt.interactionId);
      const effort =
        interaction === undefined
          ? "no interaction metrics"
          : `${formatDuration(interaction.totalDurationMs)}, ${interaction.turnCount} turns, ${interaction.toolCount} tools, ${interaction.errorCount} errors`;
      console.log(`\n### ${prompt.timestamp} (${prompt.sessionId}; ${effort})`);
      console.log(prompt.text || "[non-text input]");
    }
  }

  console.log(`\nEvent counts: ${formatCounts(typeCount)}`);
}

function collectInteractions(
  events: AnalyticsEvent[],
): Map<string, Interaction> {
  const interactions = new Map<string, Interaction>();
  for (const event of events) {
    const id = interactionId(event);
    if (id === undefined) continue;
    const current = interactions.get(id) ?? {
      assistantResponses: 0,
      characterCount: 0,
      errorCount: 0,
      inputTimestamp: event.timestamp,
      settled: false,
      toolCount: 0,
      totalDurationMs: 0,
      totalTokens: 0,
      turnCount: 0,
    };
    if (event.type === "input_received")
      current.characterCount += numberValue(event.data.characterCount);
    if (event.type === "turn_finished") {
      current.turnCount += 1;
      current.totalDurationMs += numberValue(event.data.durationMs);
    }
    if (event.type === "tool_finished") {
      current.toolCount += 1;
      if (booleanValue(event.data.isError)) current.errorCount += 1;
    }
    if (event.type === "assistant_completed") {
      current.assistantResponses += 1;
      current.totalTokens += numberValue(event.data.totalTokens);
    }
    if (event.type === "agent_settled") current.settled = true;
    interactions.set(id, current);
  }
  return interactions;
}

function printToolCounts(events: AnalyticsEvent[]): void {
  const names = [
    ...new Set(
      events.map((event) => stringValue(event.data.toolName) ?? "unknown"),
    ),
  ].sort();
  for (const name of names) {
    const matching = events.filter(
      (event) => (stringValue(event.data.toolName) ?? "unknown") === name,
    );
    const errors = matching.filter((event) =>
      booleanValue(event.data.isError),
    ).length;
    console.log(`- ${name}: ${matching.length} (${errors} errors)`);
  }
}

function printCounts(
  events: AnalyticsEvent[],
  key: (event: AnalyticsEvent) => string,
): void {
  const counts = countBy(events, key);
  for (const [value, count] of [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  ))
    console.log(`- ${value}: ${count}`);
}

function parseArgs(args: string[]): {
  end: Date;
  includePrompts: boolean;
  sessionId: string | undefined;
  start: Date;
} {
  const now = new Date();
  const defaultStart = startOfWeek(now);
  let start = defaultStart;
  let end = now;
  let includePrompts = false;
  let sessionId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--include-prompts") {
      includePrompts = true;
      continue;
    }
    if (arg === "--session") {
      sessionId = args[index + 1];
      if (sessionId === undefined) throw new Error("--session requires an ID");
      index += 1;
      continue;
    }
    if (arg === "--since" || arg === "--until") {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`${arg} requires YYYY-MM-DD`);
      const date = parseDate(value, arg === "--until");
      if (arg === "--since") start = date;
      else end = date;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { end, includePrompts, sessionId, start };
}

function parseDate(value: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid date: ${value}`);
  const date = new Date(`${value}T00:00:00`);
  if (endOfDay) date.setDate(date.getDate() + 1);
  return date;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

async function findJsonlFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await findJsonlFiles(path)));
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}

function interactionId(event: AnalyticsEvent): string | undefined {
  return stringValue(event.data.interactionId);
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function numberValues(events: AnalyticsEvent[], key: string): number[] {
  return events
    .map((event) => numberValue(event.data[key]))
    .filter((value) => value >= 0);
}

function sumNumber(events: AnalyticsEvent[], key: string): number {
  return events.reduce(
    (total, event) => total + numberValue(event.data[key]),
    0,
  );
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeDurations(values: number[]): string {
  if (values.length === 0) return "no data";
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  return `${formatDuration(values.reduce((sum, value) => sum + value, 0))} total; median ${formatDuration(median)}; p90 ${formatDuration(p90)}; max ${formatDuration(sorted.at(-1) ?? 0)}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function average(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return (numerator / denominator).toFixed(2);
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

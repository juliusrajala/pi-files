import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AnalyticsRecorder,
  estimateJsonBytes,
} from "../src/analytics/recorder.ts";
import {
  findReadSkillName,
  parseExplicitSkillName,
} from "../extensions/pi-usage-analytics.ts";

test("writes versioned, content-free event records to a session sidecar", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-files-analytics-"));
  const recorder = new AnalyticsRecorder({
    rootDir,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    monotonicNow: () => 12.5,
  });
  recorder.startSession("session/a");
  recorder.record(
    "input_received",
    { characterCount: 12, source: "interactive" },
    "leaf-a",
  );
  await recorder.flush("leaf-a");

  const [line] = (
    await readFile(
      join(rootDir, "session_a", `${recorder.runtimeId}.jsonl`),
      "utf8",
    )
  )
    .trim()
    .split("\n");
  assert.ok(line);
  const event = JSON.parse(line);
  assert.deepEqual(
    { ...event, eventId: "<generated>" },
    {
      schemaVersion: 1,
      eventId: "<generated>",
      timestamp: "2026-01-02T03:04:05.000Z",
      monotonicMs: 12.5,
      runtimeId: recorder.runtimeId,
      sessionId: "session/a",
      leafId: "leaf-a",
      type: "input_received",
      data: { characterCount: 12, source: "interactive" },
    },
  );
  assert.match(event.eventId, /^[0-9a-f-]{36}$/);
});

test("records bounded-queue drops after pending writes drain", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-files-analytics-"));
  const recorder = new AnalyticsRecorder({ rootDir, maxPendingRecords: 1 });
  recorder.startSession("session-a");
  recorder.record("first", {}, null);
  recorder.record("dropped", {}, null);
  await recorder.flush(null);

  const lines = (
    await readFile(
      join(rootDir, "session-a", `${recorder.runtimeId}.jsonl`),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((event) => [event.type, event.data]),
    [
      ["first", {}],
      ["records_dropped", { count: 1 }],
    ],
  );
});

test("returns payload sizes without retaining payload content", () => {
  assert.equal(
    estimateJsonBytes({ secret: "do-not-store" }),
    Buffer.byteLength('{"secret":"do-not-store"}'),
  );
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(estimateJsonBytes(circular), null);
});

test("recognizes only valid explicit skill commands", () => {
  assert.equal(
    parseExplicitSkillName("/skill:code-review focus auth"),
    "code-review",
  );
  assert.equal(parseExplicitSkillName("/skill:Code-Review"), undefined);
  assert.equal(
    parseExplicitSkillName("please use /skill:code-review"),
    undefined,
  );
});

test("maps read calls to known skills without recording their paths", () => {
  const skillsByPath = new Map([
    ["/work/skills/code-review/SKILL.md", "code-review"],
  ]);
  assert.equal(
    findReadSkillName(
      { path: "@/work/skills/code-review/SKILL.md" },
      "/work",
      skillsByPath,
    ),
    "code-review",
  );
  assert.equal(
    findReadSkillName({ path: "/work/other.md" }, "/work", skillsByPath),
    undefined,
  );
});

import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const ANALYTICS_SCHEMA_VERSION = 1;
const DEFAULT_MAX_PENDING_RECORDS = 1_000;

export type AnalyticsData = Record<
  string,
  boolean | number | string | null | undefined
>;

export type AnalyticsEvent = {
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  eventId: string;
  timestamp: string;
  monotonicMs: number;
  runtimeId: string;
  sessionId: string;
  leafId: string | null;
  type: string;
  data: AnalyticsData;
};

type RecorderOptions = {
  rootDir?: string;
  maxPendingRecords?: number;
  now?: () => Date;
  monotonicNow?: () => number;
};

export class AnalyticsRecorder {
  readonly runtimeId = randomUUID();

  private readonly rootDir: string;
  private readonly maxPendingRecords: number;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private pendingRecords = 0;
  private queue: Promise<void> = Promise.resolve();
  private sessionId: string | undefined;
  private filePath: string | undefined;
  private droppedRecords = 0;

  constructor(options: RecorderOptions = {}) {
    this.rootDir = options.rootDir ?? join(getAgentDir(), "analytics");
    this.maxPendingRecords =
      options.maxPendingRecords ?? DEFAULT_MAX_PENDING_RECORDS;
    this.now = options.now ?? (() => new Date());
    this.monotonicNow =
      options.monotonicNow ?? performance.now.bind(performance);
  }

  startSession(sessionId: string): void {
    this.sessionId = sessionId;
    const startedAt = this.now().toISOString().replaceAll(":", "-");
    this.filePath = join(
      this.rootDir,
      `${startedAt}_${safeFileComponent(sessionId)}_${this.runtimeId}.jsonl`,
    );
  }

  record(type: string, data: AnalyticsData, leafId: string | null): void {
    if (this.sessionId === undefined || this.filePath === undefined) return;
    if (this.pendingRecords >= this.maxPendingRecords) {
      this.droppedRecords += 1;
      return;
    }

    const event: AnalyticsEvent = {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      eventId: randomUUID(),
      timestamp: this.now().toISOString(),
      monotonicMs: this.monotonicNow(),
      runtimeId: this.runtimeId,
      sessionId: this.sessionId,
      leafId,
      type,
      data,
    };
    const line = `${JSON.stringify(event)}\n`;
    const filePath = this.filePath;

    this.pendingRecords += 1;
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.rootDir, {
          recursive: true,
          mode: 0o700,
        });
        await appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
      })
      .catch(() => undefined)
      .finally(() => {
        this.pendingRecords -= 1;
      });
  }

  async flush(leafId: string | null): Promise<void> {
    await this.queue;
    if (this.droppedRecords === 0) return;

    const droppedRecords = this.droppedRecords;
    this.droppedRecords = 0;
    this.record("records_dropped", { count: droppedRecords }, leafId);
    await this.queue;
  }
}

export function getAgentDir(): string {
  const configuredDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configuredDir) return join(homedir(), ".pi", "agent");
  if (configuredDir === "~") return homedir();
  if (configuredDir.startsWith("~/"))
    return join(homedir(), configuredDir.slice(2));
  return configuredDir;
}

export function estimateJsonBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

function safeFileComponent(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

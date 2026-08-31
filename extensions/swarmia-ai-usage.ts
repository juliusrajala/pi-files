import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Breakdown = {
  model: string;
  client: "cli";
  messagesCount: number;
  sessions: Record<string, true>;
  tokensInput: number;
  tokensOutput: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type DayUsage = {
  messagesCount: number;
  sessions: Record<string, true>;
  breakdowns: Record<string, Breakdown>;
};

export type ProfileUsage = {
  days: Record<string, DayUsage>;
};

export type StoredState = {
  version: 1;
  profiles: Record<string, ProfileUsage>;
};

export type UsageReport = {
  aiService: string;
  data: Array<{
    email: string;
    date: string;
    is_enabled: boolean;
    is_active: boolean;
    messages_count: number;
    conversations_count: number;
    breakdowns: Array<{
      model: string;
      client: "cli";
      messages_count: number;
      conversations_count: number;
      tokens_input: number;
      tokens_output: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
    }>;
  }>;
};

const STATE_VERSION = 1;
const DEFAULT_SERVICE = "Pi";
const DEFAULT_API_BASE_URL = "https://app.swarmia.com/api/v1";
const LOCK_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_POST_ATTEMPTS = 3;

export default async function swarmiaAiUsageExtension(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const config = await readConfig(agentDir);
  const statePath = join(agentDir, "swarmia-ai-usage.json");
  const profileKey = `${config.apiBaseUrl}\0${config.aiService}\0${config.email}`;
  const runtime = {
    writeQueue: Promise.resolve(),
    flushPromise: undefined as Promise<void> | undefined,
    lastSubmittedReport: undefined as string | undefined,
  };

  pi.registerCommand("swarmia-usage", {
    description: "Show and submit your Pi usage data to Swarmia",
    handler: async (_args, ctx) => {
      if (!config.enabled) {
        ctx.ui.notify(getConfigurationMessage(config), "warning");
        return;
      }

      try {
        await flush();
        const state = await readState(statePath);
        const report = buildReport(state, config);
        const dayCount = report.data.length;
        const message =
          dayCount === 0
            ? "No Pi usage data has been collected yet"
            : `Submitted Pi usage for ${dayCount} day${dayCount === 1 ? "" : "s"}`;
        ctx.ui.notify(message, "info");
      } catch (error) {
        ctx.ui.notify(
          `Could not submit Pi usage: ${formatError(error)}`,
          "error",
        );
      }
    },
  });

  pi.on("message_end", async (event, ctx) => {
    const message = event.message;
    if (
      !config.enabled ||
      message.role !== "assistant" ||
      message.stopReason === "error" ||
      message.stopReason === "aborted"
    ) {
      return;
    }

    try {
      await enqueueStateUpdate((state) => {
        const sessionId = ctx.sessionManager.getSessionId();
        addAssistantMessage(state, profileKey, sessionId, message);
      });
    } catch (error) {
      console.error(
        `[Swarmia AI usage] Could not save local usage: ${formatError(error)}`,
      );
    }
  });

  pi.on("agent_settled", async () => {
    await flushWithLogging();
  });

  pi.on("session_shutdown", async () => {
    await flushWithLogging();
  });

  async function flushWithLogging() {
    try {
      await flush();
    } catch (error) {
      console.error(`[Swarmia AI usage] ${formatError(error)}`);
    }
  }

  async function flush() {
    if (!config.enabled) return;
    if (runtime.flushPromise) return runtime.flushPromise;

    runtime.flushPromise = (async () => {
      await runtime.writeQueue;
      const state = await readState(statePath);
      const report = buildReport(state, config);
      if (report.data.length === 0) return;

      const reportFingerprint = JSON.stringify(report);
      if (runtime.lastSubmittedReport === reportFingerprint) return;

      await postReport(report, config);
      runtime.lastSubmittedReport = reportFingerprint;
      await pruneReportedDays(report, config);
    })().finally(() => {
      runtime.flushPromise = undefined;
    });

    return runtime.flushPromise;
  }

  async function enqueueStateUpdate(
    update: (state: StoredState) => void | Promise<void>,
  ) {
    runtime.writeQueue = runtime.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await withFileLock(statePath, async () => {
          const state = await readState(statePath);
          await update(state);
          await writeStateUnlocked(statePath, state);
        });
      });
    return runtime.writeQueue;
  }

  async function pruneReportedDays(report: UsageReport, currentConfig: Config) {
    await withFileLock(statePath, async () => {
      const state = await readState(statePath);
      const profile = state.profiles[profileKey];
      if (!profile) return;

      const today = getDateKey(Date.now());
      for (const row of report.data) {
        if (row.date >= today) continue;
        const currentDay = profile.days[row.date];
        if (!currentDay) continue;
        if (
          JSON.stringify(
            buildDayReport(currentDay, row.date, currentConfig.email),
          ) === JSON.stringify(row)
        ) {
          delete profile.days[row.date];
        }
      }

      await writeStateUnlocked(statePath, state);
    });
  }
}

type Config = {
  apiToken: string;
  email: string;
  aiService: string;
  apiBaseUrl: string;
  enabled: boolean;
};

type LocalConfig = {
  apiToken?: string | undefined;
  email?: string | undefined;
  aiService?: string | undefined;
  apiBaseUrl?: string | undefined;
};

async function readConfig(agentDir: string): Promise<Config> {
  const localConfig = await readLocalConfig(
    join(agentDir, "swarmia-ai-usage-config.json"),
  );
  const apiToken = nonEmpty(
    process.env.SWARMIA_API_TOKEN?.trim(),
    localConfig?.apiToken?.trim() ?? "",
  );
  const email = nonEmpty(
    process.env.SWARMIA_AI_USAGE_EMAIL?.trim(),
    localConfig?.email?.trim() ?? "",
  );
  const aiService = nonEmpty(
    process.env.SWARMIA_AI_USAGE_SERVICE?.trim(),
    nonEmpty(localConfig?.aiService?.trim(), DEFAULT_SERVICE),
  );
  const apiBaseUrl = nonEmpty(
    process.env.SWARMIA_API_BASE_URL?.trim(),
    nonEmpty(localConfig?.apiBaseUrl?.trim(), DEFAULT_API_BASE_URL),
  ).replace(/\/$/, "");

  return {
    apiToken,
    email,
    aiService,
    apiBaseUrl,
    enabled: apiToken.length > 0 && email.length > 0,
  };
}

async function readLocalConfig(path: string): Promise<LocalConfig | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) return undefined;

    return {
      apiToken:
        typeof parsed.apiToken === "string" ? parsed.apiToken : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      aiService:
        typeof parsed.aiService === "string" ? parsed.aiService : undefined,
      apiBaseUrl:
        typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl : undefined,
    };
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined, fallback: string) {
  return value && value.length > 0 ? value : fallback;
}

function getAgentDir() {
  const configuredDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configuredDir) return join(homedir(), ".pi", "agent");
  if (configuredDir === "~") return homedir();
  if (configuredDir.startsWith("~/"))
    return join(homedir(), configuredDir.slice(2));
  return configuredDir;
}

export function emptyState(): StoredState {
  return { version: STATE_VERSION, profiles: {} };
}

async function readState(path: string): Promise<StoredState> {
  try {
    const contents = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(contents);
    if (isStoredState(parsed)) return parsed;
  } catch {
    // A missing or incomplete state file starts a fresh local aggregate.
  }
  return emptyState();
}

function isStoredState(value: unknown): value is StoredState {
  if (!isRecord(value) || value.version !== STATE_VERSION) return false;
  if (!isRecord(value.profiles)) return false;
  return Object.values(value.profiles).every(
    (profile) => isRecord(profile) && isRecord(profile.days),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeStateUnlocked(path: string, state: StoredState) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      await mkdir(lockPath, { recursive: false });
      break;
    } catch (error) {
      if (!isFileExistsError(error) || Date.now() >= deadline) throw error;
      try {
        const lockStats = await stat(lockPath);
        if (Date.now() - lockStats.mtimeMs > LOCK_TIMEOUT_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      await sleep(50);
    }
  }

  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === "EEXIST";
}

export function addAssistantMessage(
  state: StoredState,
  profileKey: string,
  sessionId: string,
  message: {
    model: string;
    provider: string;
    timestamp: number;
    usage: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  },
) {
  const profile = (state.profiles[profileKey] ??= { days: {} });
  const date = getDateKey(message.timestamp);
  const day = (profile.days[date] ??= {
    messagesCount: 0,
    sessions: {},
    breakdowns: {},
  });
  const model = `${message.provider}/${message.model}`;
  const breakdown = (day.breakdowns[model] ??= {
    model,
    client: "cli",
    messagesCount: 0,
    sessions: {},
    tokensInput: 0,
    tokensOutput: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  day.messagesCount += 1;
  day.sessions[sessionId] = true;
  breakdown.messagesCount += 1;
  breakdown.sessions[sessionId] = true;
  breakdown.tokensInput += message.usage.input;
  breakdown.tokensOutput += message.usage.output;
  breakdown.cacheReadTokens += message.usage.cacheRead;
  breakdown.cacheCreationTokens += message.usage.cacheWrite;
}

export function buildReport(state: StoredState, config: Config): UsageReport {
  const profileKey = `${config.apiBaseUrl}\0${config.aiService}\0${config.email}`;
  const profile = state.profiles[profileKey];
  return {
    aiService: config.aiService,
    data: Object.entries(profile?.days ?? {})
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, day]) => buildDayReport(day, date, config.email)),
  };
}

function buildDayReport(
  day: DayUsage,
  date: string,
  email: string,
): UsageReport["data"][number] {
  return {
    email,
    date,
    is_enabled: true,
    is_active: day.messagesCount > 0,
    messages_count: day.messagesCount,
    conversations_count: Object.keys(day.sessions).length,
    breakdowns: Object.values(day.breakdowns).map((breakdown) => ({
      model: breakdown.model,
      client: breakdown.client,
      messages_count: breakdown.messagesCount,
      conversations_count: Object.keys(breakdown.sessions).length,
      tokens_input: breakdown.tokensInput,
      tokens_output: breakdown.tokensOutput,
      cache_read_tokens: breakdown.cacheReadTokens,
      cache_creation_tokens: breakdown.cacheCreationTokens,
    })),
  };
}

async function postReport(report: UsageReport, config: Config) {
  for (let attempt = 1; attempt <= MAX_POST_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${config.apiBaseUrl}/ingest/ai-usage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === MAX_POST_ATTEMPTS) throw error;
      await sleep(attempt * 250);
      continue;
    }

    if (response.ok) return;
    if (response.status < 500 || attempt === MAX_POST_ATTEMPTS) {
      throw new Error(`Swarmia API returned HTTP ${response.status}`);
    }
    await sleep(attempt * 250);
  }
}

export function getDateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getConfigurationMessage(config: Config) {
  const missing = [
    config.apiToken ? undefined : "SWARMIA_API_TOKEN",
    config.email ? undefined : "SWARMIA_AI_USAGE_EMAIL",
  ].filter((value): value is string => value !== undefined);
  return `Configure ${missing.join(" and ")} to enable Swarmia usage reporting`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

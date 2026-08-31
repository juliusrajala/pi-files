import assert from "node:assert/strict";
import test from "node:test";

import {
  addAssistantMessage,
  buildReport,
  emptyState,
  getDateKey,
} from "../extensions/swarmia-ai-usage.ts";

const config = {
  aiService: "Pi",
  apiBaseUrl: "https://app.swarmia.com/api/v1",
  apiToken: "test-token",
  email: "person@example.com",
  enabled: true,
};
const profileKey = `${config.apiBaseUrl}\0${config.aiService}\0${config.email}`;

function message(
  overrides: Partial<{
    model: string;
    provider: string;
    timestamp: number;
  }> = {},
) {
  return {
    model: "gpt-5.6",
    provider: "openai-codex",
    timestamp: Date.UTC(2026, 0, 2, 12),
    usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    ...overrides,
  };
}

test("aggregates model usage and de-duplicates a session per day", () => {
  const state = emptyState();
  addAssistantMessage(state, profileKey, "session-a", message());
  addAssistantMessage(
    state,
    profileKey,
    "session-a",
    message({ model: "gpt-5.7" }),
  );
  addAssistantMessage(state, profileKey, "session-b", message());

  assert.deepEqual(buildReport(state, config), {
    aiService: "Pi",
    data: [
      {
        email: "person@example.com",
        date: "2026-01-02",
        is_enabled: true,
        is_active: true,
        messages_count: 3,
        conversations_count: 2,
        breakdowns: [
          {
            model: "openai-codex/gpt-5.6",
            client: "cli",
            messages_count: 2,
            conversations_count: 2,
            tokens_input: 20,
            tokens_output: 40,
            cache_read_tokens: 60,
            cache_creation_tokens: 80,
          },
          {
            model: "openai-codex/gpt-5.7",
            client: "cli",
            messages_count: 1,
            conversations_count: 1,
            tokens_input: 10,
            tokens_output: 20,
            cache_read_tokens: 30,
            cache_creation_tokens: 40,
          },
        ],
      },
    ],
  });
});

test("uses UTC day boundaries", () => {
  assert.equal(getDateKey(Date.UTC(2026, 0, 2, 23, 59, 59)), "2026-01-02");
});

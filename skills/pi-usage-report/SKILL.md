---
name: pi-usage-report
description: Analyze local Pi usage analytics and produce a privacy-aware report. Use when reviewing Pi usage, finding interesting usage patterns, comparing easy and hard prompts, inspecting tool/model performance, or asking for a weekly or date-range Pi usage report.
---

# Pi usage report

Run the bundled report script from the `pi-files` package:

```bash
node --experimental-strip-types skills/pi-usage-report/scripts/report.ts
```

The default range is the current Monday through now. Use explicit local dates when needed:

```bash
node --experimental-strip-types skills/pi-usage-report/scripts/report.ts \
  --since 2026-09-01 --until 2026-09-07
```

Limit the report to one session with `--session <sessionId>`. Combine it with `--include-prompts` for prompt-level analysis.

## Workflow

1. Run the report script and summarize activity, tokens, models, tools, skills, errors, timing, compactions, and interaction coverage.
2. Treat `turn` and `tool` durations as operational effort, not a correctness score. Long durations can be caused by CI, databases, network calls, or permissions.
3. For prompt-level analysis, rerun with `--include-prompts`. This reads prompts from Pi's canonical session JSONL files at report time; it does not copy them into analytics files.
4. Use `interactionId` fields to compare prompt-level effort when present. Older records do not have interaction IDs and must be reported as having no interaction-level coverage.
5. Keep prompt text, tool arguments, tool results, paths, and credentials out of any saved report unless the user explicitly requests a local prompt dump.
6. Never upload analytics or session data. Keep the report local and mention when the selected range has incomplete or truncated records.

The analytics sidecars live under `PI_CODING_AGENT_DIR/analytics` or `~/.pi/agent/analytics`. Pi session files live under the corresponding `sessions` directory. The recorder intentionally stores aggregate metadata rather than prompt text; report-time joining is the preferred way to inspect prompt difficulty.

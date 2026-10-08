# Pi 0.99.1 compatibility plan

## Scope and baseline

Review date: 2026-09-30. The repository was pinned to Pi 0.84.4 while the external CLI was already 0.99.1. All five extensions loaded against 0.99.1, and the original 21 tests and type-check passed against its installed packages. No immediate extension API break was found.

Implement the remaining work in the order below. Do not change personal settings, credentials, default models, or enable MCP/codemode as part of repository maintenance.

## Completed with the auto-model update

- [x] Pin development dependencies for `pi-coding-agent` and `pi-tui` to 0.99.1 and regenerate the lockfile. Keep host-provided modules as wildcard peer dependencies.
- [x] Replace keyword-based switching with `jev/auto`, based on Pi's `examples/extensions/jev-router.ts`. Jev chooses Sol/Astra for planning; the first successful edit/write hands implementation to Luna. Recognize nested codemode edits too.
- [x] Retain `/auto-model` and F8 controls; derive enabled state from native model selection. Use Pi's branch-local router state instead of a process-global toggle.
- [x] Make physical provider/models configurable and respect `PI_CODING_AGENT_DIR` and directory exclusions. Preserve legacy Codex credentials by default; make migration to `openai` an explicit user choice.
- [x] Remove prompt/path logging while preserving the original colored dot-and-label auto-model status. Document classifier data sharing, fallback behavior, and the persistent one-way implementation handoff.
- [x] Add deterministic router, command, configuration, and lifecycle tests without provider requests.

## 1. Make version checks trustworthy

Files: `scripts/check-pi-version.mjs`, `package.json`, `README.md`, new script tests.

- [ ] Distinguish the manifest pin, actually installed development packages, and external CLI executable/version. Report executable paths as well as versions.
- [ ] Avoid npm's prepended `node_modules/.bin` silently selecting the development CLI. Support an explicit external CLI path and document resolution behavior; do not assume a particular Node version manager or global installation path.
- [ ] Retain optional source-checkout verification and fail clearly for missing executables, missing development packages, and mismatched versions.
- [ ] Consider including the corrected check in `npm run check`; keep environments without an external CLI usable through a documented explicit mode.

Acceptance: a fixture with local Pi 0.99.1 and external Pi at a different version fails identically when invoked directly and through npm. Tests also cover mismatched installed packages, matching versions, and optional/required source checkouts.

## 2. Record physical thinking levels accurately

Files: `extensions/pi-usage-analytics.ts`, analytics tests, `docs/analytics-capability-matrix.md`.

- [ ] Read dispatched thinking level from the finalized assistant message, not `ctx.thinkingLevel`, which now describes the virtual selection.
- [ ] Record selected and dispatched levels separately if both are useful. Represent missing historical message metadata as unknown; do not silently substitute a potentially different selected level.
- [ ] Keep provider/model attribution on the physical assistant message, not the virtual router.
- [ ] Update the capability matrix's stale Pi target and document compatibility with older sidecars.

Acceptance: a virtual selection at `high` routed to a physical model at `medium` records both accurately. Missing fields and aborted/error responses are covered. No prompt, response, or thinking content is persisted.

## 3. Distinguish nested tool calls in analytics

Files: `extensions/pi-usage-analytics.ts`, `skills/pi-usage-report/scripts/report.ts`, analytics/report tests.

- [ ] Add `parentToolCallId` to tool start/finish records while retaining correlation by `toolCallId`.
- [ ] Report top-level orchestration and nested operations separately. Label overlapping tool durations as cumulative execution time, not elapsed user time.
- [ ] Preserve nested skill-read detection and permission-denial correlation.
- [ ] Treat old records without parent metadata as legacy/unknown coverage where appropriate, not proof that every call was top-level.

Acceptance: synthetic parallel codemode calls produce separate parent/child counts and correct error attribution, without double-counting their overlapping durations as wall-clock time. Reports still read old sidecars.

## 4. Define and expand usage accounting

Files: both usage extensions, report script, recorder/schema documentation, aggregation tests.

- [ ] First label existing totals as assistant-only; they are not equivalent to Pi's full session usage.
- [ ] Add tool/classifier usage using top-level aggregated results. Nested usage already rolls up to parent results; never sum both parent and child usage.
- [ ] Investigate public access to persisted `usage` entries for cache warming, compaction, and branch summaries. Prefer stable public APIs; explicitly document unsupported sources rather than importing internal host code.
- [ ] Account for classifier calls made by the Jev router separately if a supported mechanism exists. The example's direct `modelRegistry.classify()` call is not an assistant response, and codemode usage aggregation does not automatically cover it.
- [ ] Define model attribution when a tool result contains combined usage from multiple models. Do not label all of it as the selected chat model.
- [ ] Keep message/conversation counts separate from background and classifier usage in Swarmia reports.
- [ ] Deduplicate persisted usage across flush, reload, resume, and tree navigation. Keep provider requests and credentials out of tests.

Acceptance: fixture totals include assistant, top-level tool, and supported background usage exactly once. If a source cannot be observed or attributed reliably, the report names the limitation. Local analytics remain content-free; no new analytics upload path is introduced.

## 5. Theme-safe UI and permission regression coverage

Files: `extensions/auto-model.ts`, `extensions/pi-pod-status.ts`, `extensions/command-permission.ts`, related tests.

- [ ] Rebuild themed status output through a supported rendering lifecycle while preserving the existing colored dot-and-label appearance. Do not replace the compact status with textual on/off indicators.
- [ ] Review the custom permission dialog's pre-styled `Text` content so changing themes while it is open does not leave stale colors.
- [ ] Add lasting tests that nested Bash calls still trigger approval, non-interactive calls fail closed, and RPC uses supported dialogs rather than custom TUI components.
- [ ] Exercise parallel nested protected calls for dialog serialization and cancellation.
- [ ] Document that the current gate protects matching Bash commands, not arbitrary MCP write operations. Any annotation-based MCP permission policy needs a separate explicit design; do not broaden or weaken approvals silently.

Acceptance: theme changes and narrow terminal widths work in regular/fullscreen modes, and nested protected commands cannot execute without the existing approval path.

## 6. Repository cleanup and final validation

- [ ] Format `extensions/pi-pod-status.ts` and `tests/pi-pod-status.test.ts`; these were existing failures in the review baseline.
- [ ] Update `scripts/setup-pi-source.sh` from the old `pi-mono` URL to the current `earendil-works/pi` repository. Review its forced tag fetch and checkout safety separately; do not run it during this migration.
- [ ] Run `npm run check`, the corrected version check, and extension-load smoke tests with an isolated agent directory.
- [ ] Manually test `/auto-model`, F8, direct `/model jev/auto` selection, classifier fallback, first-edit handoff, resume/reload, and tree navigation in the TUI.
- [ ] Verify that examples do not silently filter out intended package resources. The current settings example explicitly loads only auto-model and command-permission and disables skills; label that as a minimal configuration or provide a full-package example.

The native `system` theme replaces the need for the removed custom system-theme extension. No replacement extension or mandatory theme setting is needed.

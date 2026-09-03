# Pi agent files: development and maintenance plan

## Goal

Move the personal Pi configuration out of `~/.pi/agent/extensions` into this version-controlled repository, with Pi-compatible TypeScript tooling, characterization tests, and enough matching Pi source context to maintain extensions confidently.

This is personal Pi-agent configuration. It is not a Swarmia-specific package, even though one extension reports Pi usage to Swarmia.

## Findings

- Pi CLI version currently installed: `0.84.3`.
- Current custom extensions are loose files in `~/.pi/agent/extensions`:
  - `auto-model.ts`
  - `git-operation-permission.ts`
  - `swarmia-ai-usage.ts`
- There is no existing local Pi source checkout.
- Pi supports package resources from local paths and Git sources.
- A Git-installed Pi package is discovered from the repository root. Therefore, this repository needs its Pi package manifest at the root if it is to be installed directly from Git.
- Pi loads TypeScript extensions directly through `jiti`; a production compilation step is not required, but strict type checking and tests are still valuable.
- Pi extensions can observe most lifecycle events needed for analytics:
  - raw user input
  - session start/shutdown
  - turns and assistant message completion
  - tool execution start/end
  - compaction and model changes
- Pi has no dedicated event for automatic skill invocation or agent-level retries. Explicit `/skill:name` input is observable, while automatic skill use and retries must be inferred from other events.
- Pi sessions are trees, not linear conversations. Analytics must account for reloads, resumes, forks, and `/tree` navigation rather than identifying everything only by session ID.
- The existing Swarmia extension aggregates daily model/token usage and submits it from `agent_settled` and `session_shutdown`. Those handlers await submission, so retries and request timeouts can delay settling or shutdown. It does not provide detailed skill/tool timing data.

## Options

### 1. Standalone dotfiles package

Create a version-controlled Pi package with its own `package.json`, `tsconfig.json`, formatter, linter, and tests. Install it as a local package during development and a Git-pinned package when needed elsewhere.

Pros:

- Small and independent of Pi internals
- Easy to update Pi independently
- Clean personal configuration ownership
- Standard Pi package loading and filtering

Cons:

- Pi source context remains a separate checkout or dependency
- Some internal behavior may be harder to understand

### 2. Dotfiles package plus Pi source checkout

Keep the personal package separate, but use a matching, development-only Pi source checkout for navigation and investigation. Use the installed Pi package and an exact development dependency for runtime-compatible types.

Pros:

- Preserves separation from Pi core
- Provides source context
- Avoids maintaining a fork

Cons:

- Two repositories/workspaces to coordinate
- Tooling needs an explicit check that the source checkout, development dependency, and runtime CLI are compatible

### 3. Fork Pi and add a workspace package

Fork `pi-mono`, add a personal `pi-agent-files` package to the workspace, and develop extensions alongside Pi's source and tooling.

Pros:

- Best source navigation and TypeScript integration
- Existing Pi lint/test/build conventions are immediately available
- Easy to prototype an upstream API addition

Cons:

- Ongoing rebase/merge maintenance
- Personal configuration becomes coupled to Pi's workspace
- Temptation to patch core instead of first using the extension API
- Less convenient to consume the configuration from an unmodified Pi install

## Recommendation

Start with option 2 in this repository:

1. Make the repository root a valid Pi package so both local-path and Git-pinned installation work.
2. Keep extensions, skills, prompts, themes, tests, scripts, and safe settings templates in the root package.
3. Use an ignored, on-demand sibling checkout for Pi source initially. Add a setup script that checks out the release matching the development dependency. Use a submodule only if reproducible source navigation proves worth its maintenance cost.
4. Pin `@earendil-works/pi-coding-agent` exactly in `devDependencies` for type checking and tests, keep Pi-provided runtime packages in `peerDependencies` with the ranges recommended by Pi, and commit the lockfile.
5. Add a version check that compares the development dependency, source checkout, and local `pi --version` before compatibility-sensitive work.
6. Copy and characterize the existing extensions before removing them from `~/.pi/agent/extensions`.
7. Point global Pi settings at this package during development. Remove the loose extension files only after confirming that the package loads once and behavior remains unchanged.
8. Revisit a Pi fork only if a concrete missing public API blocks useful analytics or another extension.

## Proposed layout

```text
pi-files/
├── PLAN.md
├── README.md
├── package.json               # Pi manifest at repository root
├── package-lock.json
├── tsconfig.json
├── extensions/
│   ├── auto-model.ts
│   ├── git-operation-permission.ts
│   ├── swarmia-ai-usage.ts
│   └── pi-usage-analytics.ts
├── src/                       # Shared, testable implementation modules
│   ├── analytics/
│   └── usage/
├── skills/
├── prompts/
├── themes/
├── tests/
├── scripts/
│   ├── check-pi-version.ts
│   └── setup-pi-source.sh
├── config/
│   ├── settings.json.example
│   └── keybindings.json.example
└── pi-source/                 # ignored development checkout, not package runtime input
```

The root `package.json` should explicitly list resources under its `pi` key rather than relying only on conventional discovery. This makes package contents and future exclusions obvious.

Add explicit ignore rules for `pi-source/`, dependencies, build/test output, local analytics files, temporary lock files, and local configuration. Do not commit session files, auth credentials, API tokens, local aggregate state, repository trust decisions, or machine-specific generated files.

## Migration and compatibility strategy

- Copy the three existing extensions into the package without behavior changes.
- Extract pure helpers only where needed to make characterization tests possible; keep behavior-changing refactors separate.
- Test the local package through Pi's normal package loading path, not only by importing modules in the test runner.
- Verify startup in interactive and non-interactive modes because the permission extension intentionally blocks gated operations when no UI is available.
- Confirm that commands, shortcuts, statuses, and event handlers are registered exactly once before deleting the loose files.
- Keep a documented rollback: restore the loose files and remove the local package entry from global settings.
- When upgrading Pi, update the exact development dependency and lockfile, refresh the source checkout, run type checks/tests, and perform a package-loading smoke test before updating the normal runtime.

## Test focus

### `auto-model`

- Terra/Luna prompt classification boundaries
- Long-prompt behavior
- Missing and malformed configuration
- Disabled repository path normalization
- Missing model and failed model-switch behavior

### `git-operation-permission`

- Shell command boundary parsing
- Multiple Git operations in one command
- Flags, `env`, and `command` prefixes
- False positives from ordinary text
- Interactive allow/deny behavior
- Fail-closed behavior without UI

### `swarmia-ai-usage`

- Daily and per-model aggregation
- Session de-duplication
- Atomic state writes and concurrent writers
- Retry and timeout behavior
- Report fingerprinting and pruning
- Disabled/malformed configuration

### Package integration

- Root manifest resource discovery
- Extension load smoke test
- No duplicate registrations during migration
- Compatibility with the pinned Pi version

## Analytics extension design

Implement analytics only after the package and migration are stable.

### Scope

Record compact, privacy-conscious metadata locally first:

- schema version, event ID, wall-clock timestamp, and monotonic duration data
- logical Pi session ID plus a per-runtime ID
- current leaf/branch identifiers when relevant, so tree navigation and resumed sessions can be interpreted
- prompt character/byte count, attachment count, source, and queueing behavior, but not prompt text
- explicit `/skill:name` input and reads of known skill files; label inferred automatic skill use as inferred rather than explicit
- tool name, call ID, start/end time, duration, success/error, and input/result sizes, but not arguments or result content
- model/provider/thinking level and compact assistant usage totals
- compaction attempts and terminal outcomes, including failure, abort, reason, and `willRetry`
- observable retry indicators, with inferred retries clearly distinguished from explicit events
- permission denials emitted directly by the permission extension through a small shared internal event contract

Avoid copying raw data already present in Pi session files. Compact usage totals may be duplicated when needed for durable reporting, but prompt content, tool content, and full model messages should remain only in Pi's existing session storage. The reporting code may read session metadata when useful, but it must never copy sensitive content into analytics output.

### Identity and privacy defaults

- Do not record full cwd, repository path, Git remote, branch name, command arguments, prompt content, or tool content by default.
- Represent repository identity with an optional local hash or similarly opaque identifier. Keep branch collection disabled unless explicitly enabled.
- Treat session IDs as sensitive correlation identifiers and allow hashing or disabling them in exported reports.
- Keep local analytics configuration separate from Swarmia upload configuration. Pure usage-normalization utilities may be shared, but storage, privacy, retention, and network behavior should remain isolated.
- Document every collected field and whether it is explicit, inferred, local-only, or exportable.

### Local storage

- Use versioned JSONL with one sidecar file per session/runtime to avoid contention between concurrent Pi processes.
- Store files under the configured Pi agent directory and create them with mode `0600`.
- Serialize writes through a small in-process queue. Flush by size and maximum age rather than retaining the entire session only in memory.
- Await bounded local queue drainage during `agent_settled` and `session_shutdown` so normal exits are durable.
- Tolerate a truncated final JSONL record after a crash.
- Define retention, rotation, maximum queue size, and disk-budget behavior before collecting real usage.
- Use monotonic clocks for duration calculations and wall-clock timestamps for correlation.

### Network behavior

Do not upload in the initial analytics extension. In particular, do not perform or await network requests from tool, model, settle, or shutdown lifecycle handlers. If upload is later justified, make it a separate explicit command or background process with idempotent event IDs and a persisted upload cursor.

The existing Swarmia usage extension should remain behaviorally unchanged during migration. Any later change that removes network work from its lifecycle handlers should be a separate, tested refactor.

### Reporting

Add a local report command or script that:

- validates event schema versions
- skips incomplete final records safely
- distinguishes explicit metrics from inferred metrics
- accounts for resumed, forked, and branched sessions
- reports unknown/unavailable values instead of inventing precision
- defaults to aggregate output that contains no sensitive identifiers

Inspect local reports before deciding whether a server ingestion endpoint is useful.

## Current implementation status

- Completed: root Pi package manifest, exact Pi `0.84.3` development dependency, peer dependency declarations, lockfile, strict TypeScript configuration, Prettier, ignore rules, safe configuration templates, and source/version-check scripts.
- Completed: copied the three loose extensions into `extensions/`; strict checking exposed and fixed two type-safety issues without changing runtime intent.
- Completed: characterization tests for automatic model selection, Git-operation parsing/highlighting, and Swarmia daily aggregation; `npm run check` passes.
- Completed: a temporary package-loader smoke test via `pi --no-extensions -e . --list-models` and a global-package loader smoke test.
- Completed: installed this repository as the global local package and moved the three loose extension files out of `~/.pi/agent/extensions` into a timestamped sibling backup directory. No loose TypeScript extensions remain active, so the package is the only active copy.
- Remaining: verify real interactive command, shortcut, permission-dialog, and Swarmia-reporting behavior during normal use; restore the archived files and run `pi remove "$(pwd)"` to roll back if needed.
- Completed: initial analytics capability matrix in `docs/analytics-capability-matrix.md`, including explicit, inferred, unavailable, and excluded data.
- Completed: initial local-only analytics recorder in `extensions/pi-usage-analytics.ts`, with versioned per-session/runtime JSONL sidecars, sortable timestamp-prefixed filenames, `0600` file creation, bounded queued writes, settled/shutdown persistence, interaction correlation, tool timing/size metadata, skill signals, compaction outcomes, and permission-denial integration.
- Completed: local usage report skill and script in `skills/pi-usage-report/`; it aggregates sidecars and can read prompt text from canonical Pi session files only when explicitly requested.
- Not started: Pi source checkout and upload consideration.

## Implementation phases

1. **Define the package contract** — complete
   - Add the root Pi manifest, exact development dependency, peer dependencies, lockfile, strict TypeScript configuration, formatter/linter, ignore rules, and version-check scripts.

2. **Characterize existing behavior** — partially complete
   - Copy the three extensions and add focused tests for their current utilities, aggregation, and safety behavior.
   - Add interactive permission-flow and file-lock/retry tests before considering behavior fully characterized.
3. **Migrate safely** — substantially complete
   - Install the root package by local path, run package-loading smoke tests, verify single registration, remove the loose files, and document rollback.
   - Verify real interactive behavior during normal use before considering this phase fully complete.
4. **Create an analytics capability matrix and schema** — in progress
   - Map desired metrics to explicit Pi events, inferred signals, unavailable data, privacy classification, and test cases.
   - Initial event matrix: `docs/analytics-capability-matrix.md`.
5. **Implement durable local recording** — in progress
   - Add versioned sidecar JSONL, bounded local flushing, retention, crash handling, and permission-denial integration.
   - Initial recorder and focused tests are complete. Retention, rotation, disk-budget behavior, and an explicit crash-recovery test remain.
6. **Implement local reporting**
   - Add privacy-safe aggregation and tests for sessions, reloads, forks, branches, and inferred metrics.
   - Completed initial report script and skill; interaction-level report coverage will improve as new sidecars are recorded.
7. **Inspect real usage data**
   - Validate whether the metrics reveal actionable bottlenecks and remove fields that are not useful.
8. **Consider upload separately**
   - Define consent, redaction, idempotency, retention, and a persisted upload cursor before adding any endpoint.
9. **Fork Pi only if blocked**
   - Require a documented missing API and a failed extension-only prototype before adopting fork maintenance.

## Acceptance criteria

- The repository root installs successfully as both a local Pi package and a Git-pinned Pi package.
- The three existing extensions preserve their behavior and have focused characterization tests.
- The normal Pi installation loads each migrated extension exactly once.
- Type checking and tests use an exact Pi development version and detect runtime/source version drift.
- No credentials, sessions, analytics state, or machine-specific paths are tracked by Git.
- Local analytics survives normal shutdown and tolerates a truncated crash record.
- Default analytics output contains no prompt text, tool content, full paths, branch names, command arguments, or un-hashed repository identity.
- Analytics documentation distinguishes explicit, inferred, and unavailable metrics.
- No analytics network requests occur during Pi lifecycle handlers.

## Open decisions

- Whether the ignored source checkout eventually needs to become a submodule or fork.
- Whether the tracked package should use an absolute local path in global settings or normally be installed from a Git tag/commit.
- Which opaque repository and session identifiers are useful enough to retain locally or export.
- Retention period and disk budget for analytics sidecars.
- Whether the local report should be an extension command, a standalone script, or both.
- Whether the existing Swarmia reporter should later consume shared local aggregates or remain completely independent.

# pi-files

Personal [Pi](https://pi.dev) extensions, skills, prompts, and themes.

## Development

Requires the Pi version pinned in `package.json` and a supported Node.js runtime.

```bash
npm install
npm run check
npm run check:pi-version
pi install "$(pwd)"
```

`pi install` adds this directory as a local package without copying it. Use `/reload` after changing auto-discovered package resources, or restart Pi.

The development dependency and the installed `pi` CLI must have the same version. `npm run check:pi-version` checks that relationship. To also check a development source checkout, clone Pi at `pi-source/` and run `npm run check:pi-version -- --require-source`.

## Local configuration

Copy `config/settings.json.example` and `config/keybindings.json.example` only when needed. Never commit populated configuration, credentials, sessions, or analytics data.

### Auto model routing (Jev)

`auto-model` uses Pi's bundled Jev router example as its basis. Select `jev/auto` in `/model`, run `/auto-model on`, or press F8. `/auto-model off` selects the most recent physical model on the current branch (Astra if none is available). `/auto-model status` reports whether the router is selected.

- Jev chooses GPT-6.1 Sol for complex planning and GPT-6 Astra otherwise.
- An existing Astra/Sol response keeps that planning model without classification, avoiding a cache miss.
- After the first successful `edit` or `write`, including nested codemode calls, implementation moves to GPT-6 Luna.
- **Luna remains selected for subsequent requests on that branch**, including new user prompts. This is a one-way planning-to-implementation handoff, not per-prompt classification. Pi persists the phase through resume, reload, forks, and tree navigation. Toggling off/on does not reset it; start a new session for a fresh planning phase.
- Direct requests such as compaction summaries use Luna. Pi displays both the virtual selection and the routed physical model in its footer.

The defaults require OpenAI Codex credentials. Jev uses TypeSafe's `jev-latest` classifier with `TYPESAFE_API_KEY`. When classification is needed, up to 16,000 characters of the latest user message are sent to TypeSafe (no images). If Jev is unavailable or classification fails, routing falls back to Astra. The extension does not log prompt text or repository paths.

Optionally copy `config/auto-model.json.example` to `<agent-dir>/auto-model.json`, then `/reload`. The agent directory is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. Configure the physical provider/model IDs there; for example, set `provider` to `openai` after `/login openai` to use the newer ChatGPT sign-in. `disabledRepositories` matches canonical working-directory paths: activation and routing are refused there, but `/auto-model off` remains available. Invalid configuration prevents this extension from loading rather than silently ignoring exclusions.

Do not also load a separate `jev-router.ts` registering `jev/auto`.

### Protected commands

`command-permission` always protects `git commit` and `git push`. Copy `config/command-permission.json.example` to `~/.pi/agent/command-permission.json` and add private command prefixes under `scripts`. The package is installed globally, so Pi sessions started by another agent load the extension and this configuration too when they use the standard agent directory. Sessions started with `--no-extensions` or a different `PI_CODING_AGENT_DIR` must explicitly load the package or provide the same configuration.

This package is installed as the global local package. The former loose extension files were archived outside this repository at `~/.pi/agent/extensions.pre-pi-files-<timestamp>/`; restore them and run `pi remove "$(pwd)"` to roll back. See [PLAN.md](PLAN.md) for the remaining Pi 0.99.1 compatibility work and [the analytics capability matrix](docs/analytics-capability-matrix.md) for the recorder's privacy boundary.

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

The manifest pin, installed `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`, and external `pi` CLI must have the same version. The check deliberately ignores npm's prepended `node_modules/.bin`; it resolves `pi` from the remaining `PATH`. Set `PI_CLI_PATH=/absolute/path/to/pi` or pass `npm run check:pi-version -- --pi /absolute/path/to/pi` to choose the CLI explicitly. `npm run check` verifies the installed development packages and checks the CLI whenever one is available; `--allow-missing-cli` is used there to support package-only environments. To require an installed CLI, run `npm run check:pi-version`. To also check a development source checkout, clone Pi at `pi-source/` and run `npm run check:pi-version -- --require-source`.

## Container sessions

Run the complete Pi process inside the project's development image:

```sh
pi-sesh launch pi
pi-sesh launch pi -- --mode rpc
```

The trusted user preset resolves the current standalone Pi distribution on each launch. Program files and selected package folders are mounted read-only. Settings and explicitly selected credentials are copied into private session resources. Pi, extensions, new tools, and subprocesses run inside the same container. The project image does not contain Pi.

See [sesh/README.md](sesh/README.md) for setup and offline validation. The helper has no Pi version pin or individual tool list. It does not install tools or rebuild images.

`extensions/pi-sesh-status.ts` displays a green dot and session name when Pi runs inside pi-sesh. It records the container ID association in Pi session metadata. The extension must be selected in the package's `extensions` filter; `sesh/setup.ts` copies the filters from your selected Pi settings and does not add it automatically. Add this filename to that filter before running pi-sesh. The former status filename and host tool-routing extension are removed.

The active host preset and host credentials are not changed automatically. Review the project image before supplying selected credentials. Use an isolated clone and `network: "none"` for offline work.

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

### Code kata mode

`code-kata` is independent from auto-model routing. Run `/kata on`, `/kata off`, `/kata toggle`, or `/kata status`, or press F7. The footer shows a `● kata` indicator while the extension is loaded. Add a `.katafile` to a project and put the learning goal in it as plain text. The extension then enables code-kata at session start and uses that text as the focus. `/kata off` prevents automatic activation for the rest of the extension runtime. Without a non-empty `.katafile`, enabling the mode asks what you want to learn. If you run Pi without an interactive UI, the agent asks for your focus before implementation. Code kata mode leaves one useful, bounded piece of coding work for you, helps keep unfinished code from breaking the project, and reviews your attempt. It does not change the selected model. The mode and focus reset when the extension runtime restarts.

Add `code-kata.ts` to the configured extensions filter to load it.

### Protected commands

`command-permission` always protects `git commit` and `git push`. Copy `config/command-permission.json.example` to `~/.pi/agent/command-permission.json` and add private command prefixes under `scripts`. The package is installed globally, so Pi sessions started by another agent load the extension and this configuration too when they use the standard agent directory. Sessions started with `--no-extensions` or a different `PI_CODING_AGENT_DIR` must explicitly load the package or provide the same configuration.

The settings example loads auto-model, command-permission, and the pi-sesh status extension. It disables package skills, prompts, and themes. See [the analytics capability matrix](docs/analytics-capability-matrix.md) for the local recorder's privacy boundary.

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

### Protected commands

`command-permission` always protects `git commit` and `git push`. Copy `config/command-permission.json.example` to `~/.pi/agent/command-permission.json` and add private command prefixes under `scripts`. The package is installed globally, so Pi sessions started by another agent load the extension and this configuration too when they use the standard agent directory. Sessions started with `--no-extensions` or a different `PI_CODING_AGENT_DIR` must explicitly load the package or provide the same configuration.

This package is installed as the global local package. The former loose extension files were archived outside this repository at `~/.pi/agent/extensions.pre-pi-files-<timestamp>/`; restore them and run `pi remove "$(pwd)"` to roll back. See [PLAN.md](PLAN.md) for the migration and analytics design.

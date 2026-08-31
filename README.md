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

This package is installed as the global local package. The former loose extension files were archived outside this repository at `~/.pi/agent/extensions.pre-pi-files-<timestamp>/`; restore them and run `pi remove "$(pwd)"` to roll back. See [PLAN.md](PLAN.md) for the migration and analytics design.

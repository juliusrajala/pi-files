---
name: pi-files-development
description: Create, modify, test, or organize Pi skills and extensions in the user's pi-files package. Use when asked to add or maintain a Pi skill, extension, prompt, theme, or related package resource in pi-files.
---

# pi-files development

`pi-files` is the user's local Pi package:

```text
/home/obviouslyarmadillo/dweomer/pi-files
```

Its `package.json` already discovers `./skills` and `./extensions`; adding a
resource under those directories needs no separate manifest entry.

## Start here

1. Read `README.md`, `package.json`, and similar existing resources before
   changing the package. Preserve its local-package workflow and style.
2. Check `git status --short` before and after edits. Do not commit, publish, or
   install a dependency without the user's approval.
3. Treat skills and extensions as trusted, executable capability definitions.
   Keep their scope narrow and do not add credential access, network access, or
   destructive behavior without an explicit user request.

## Create a skill

Create a directory and required entry point:

```text
skills/<skill-name>/SKILL.md
```

Use valid frontmatter. Names are 1–64 characters of lowercase letters, numbers,
and single hyphens; make the directory name and `name` match. Write a specific
`description` that states both capability and trigger conditions, since Pi uses
that description to decide when to load the skill.

```markdown
---
name: example-skill
description: Do a specific task. Use when a request has these clear triggers.
---

# Example skill

Give concise, safe instructions. Put optional helper scripts, references, and
assets beneath this skill directory and refer to them with relative paths.
```

A skill should tell the agent what to verify, what files or tools to use, what
must not happen implicitly, and how to report results. Keep detailed reference
material in separate files so it is loaded only when needed.

## Create an extension

Use either a small single-file extension:

```text
extensions/<extension-name>.ts
```

or a multi-file extension with an entry point:

```text
extensions/<extension-name>/index.ts
```

Export a default factory and use Pi's extension API:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("example", {
    description: "Describe the command",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Done", "info");
    },
  });
}
```

Extensions run with the user's full system permissions. Prefer the smallest
feature that meets the request. Follow these rules:

- Defer watchers, processes, sockets, and timers until `session_start`; clean
  them up in an idempotent `session_shutdown` handler.
- Guard terminal-only UI with `ctx.mode === "tui"`, and interactive prompts or
  notifications with `ctx.hasUI`.
- Use `ctx.signal` for abortable work. Custom tools must bound/truncate output;
  file-mutating tools must use Pi's file-mutation queue around their whole
  read-modify-write operation.
- Do not override built-in tools or register providers unless the request
  specifically requires it. Test exported pure logic separately where useful.

Read the installed Pi extension documentation and the closest example before
using an unfamiliar API. The relevant references are `docs/extensions.md`,
`docs/skills.md`, and `examples/extensions/` in the installed Pi distribution.

## Validate and load

From the package root, run:

```sh
npm run check
npm run check:pi-version
```

Use the installed Pi version required by `package.json`. For a local smoke test,
ensure the package is linked with `pi install "$(pwd)"`; then restart Pi or run
`/reload` to rediscover package resources. Use `pi -e <extension-path>` only
for a temporary extension test. Report the files changed and the commands run.

---
name: linux-systems-docs
description: Locate and use the user's personal Linux and systems documentation in the Obsidian Systems folder. Use when a task concerns this machine's Linux setup, operations, security model, system configuration, or when the user asks to check their Systems notes.
---

# Linux systems documentation

The user's Linux and systems notes are in:

```text
$HOME/obsidian/Systems/
```

Resolve that path from `$HOME`; on this system it is
`/home/obviouslyarmadillo/obsidian/Systems/`.

## Workflow

1. Confirm the directory exists before relying on it:

   ```sh
   test -d "$HOME/obsidian/Systems"
   ```

2. Search only this folder for relevant Markdown notes. Prefer a targeted search:

   ```sh
   rg -n -i --glob '*.md' 'search terms' "$HOME/obsidian/Systems"
   ```

   If the topic is unclear, list the available notes without searching the rest
   of the Obsidian vault:

   ```sh
   find "$HOME/obsidian/Systems" -type f -name '*.md' | sort
   ```

3. Read the relevant note with the `read` tool, then answer with the note path
   and the applicable heading or section. Treat the notes as user-specific
   operational context, not as general Linux documentation.

4. Do not modify, create, rename, or move notes unless the user explicitly asks
   for that change. Keep note contents local; do not upload or quote unrelated
   private material.

If the folder is absent or the notes do not answer the question, say so plainly
and continue with other appropriate local documentation or investigation.

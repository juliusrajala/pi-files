# Personal Pi container setup

Pi-sesh runs the complete Pi process inside the project image. These files supply personal Pi inputs. Pi-sesh itself does not know Pi settings, credentials, package formats, or versions.

## One-time user setup

Configure these inputs once for your user. Reuse the same `pi` preset in every project. Do not create a Pi installation, selection file, or preparation script for each project. Each launch creates new session resources from the shared inputs.

A project needs only its development image and `pi-sesh.json`. Its image must be compatible with the selected Pi runtime. The project does not contain or install Pi.

## Select user inputs

Create one private JSON file outside all project folders. Use absolute paths. Make its mode `0600`.

```json
{
  "runtimeResolver": ["/usr/bin/mise", "where", "pi"],
  "packages": [
    {
      "source": "/absolute/path/to/pi-files",
      "paths": [
        "package.json",
        "extensions",
        "src",
        "skills",
        "prompts",
        "themes",
        "node_modules"
      ]
    }
  ],
  "agentFiles": {
    "settings.json": "/absolute/path/.pi/agent/settings.json",
    "auto-model.json": "/absolute/path/.pi/agent/auto-model.json",
    "command-permission.json": "/absolute/path/.pi/agent/command-permission.json"
  },
  "credentials": {
    "source": "/absolute/path/.pi/agent/auth.json",
    "providers": ["openai-codex"]
  }
}
```

Only `runtimeResolver` is required. Omit credentials for offline work. Omit files that you do not want to supply. The helper never discovers credentials or mounts the host agent directory.

The resolver must print one absolute directory containing a standalone executable named `pi`. It runs with fixed `HOME`, `PATH=/usr/bin:/bin`, and cwd set to the host home. It does not install Pi. `mise where pi` selects the version pinned by mise, which can be older than the newest installed version. To set an exact installed version, run `node sesh/set-version.mjs 1.4.0` from the `pi-files` directory. The helper checks that mise has the version, then changes only `runtimeResolver` in `pi-selection.json`. New pi-sesh launches use that version. Existing sessions keep their selected runtime. For another installation manager, supply a trusted resolver command. A plain executable path does not prove that all runtime dependencies are present. This helper supports standalone distributions, not arbitrary npm launcher scripts.

`packages` selects local packages. Optional `extensions`, `skills`, `prompts`, and `themes` arrays use native Pi package filters. A selected `paths` array mounts complete program folders, not a list of tools. A new extension in a selected folder needs no pi-sesh change. Supply its dependencies through the selected paths. If `paths` is omitted, the helper selects existing `package.json`, `extensions`, `src`, `skills`, `prompts`, `themes`, and `node_modules` paths. Explicit paths must exist. Sources must not contain escaping symlinks, sockets, or special files.

Selected `settings.json` supplies personal options. The helper replaces `packages` with the explicitly selected container packages. It replaces `sessionDir` with the retained output path. Other selected agent files keep their contents. Do not select files with unsupported host paths, host sockets, environment references, or MCP login requirements. The helper does not translate MCP commands or supply MCP OAuth state. Network access can start external services configured by selected packages or settings. Review those inputs before enabling networking.

The `credentials` selection copies only the named provider entries. The original credential file must be private and user-owned. Credentials are writable private snapshots inside the container. Refreshes are not written back to the host. Supplied credentials are readable by the contained agent and its tools.

## Define the launcher

Add the shared `pi` preset to `~/.config/pi-sesh/launchers.json` once. Preserve existing presets. Make its directory mode `0700`. Make the file mode `0600`.

```json
{
  "version": 1,
  "presets": {
    "pi": {
      "command": ["/bin/sh", "/home/session/bootstrap.sh"],
      "workspace": "clone",
      "network": "none",
      "prepare": [
        "/usr/bin/mise",
        "exec",
        "bun",
        "--",
        "bun",
        "/absolute/path/to/pi-files/sesh/prepare.ts",
        "/absolute/path/to/private-selection.json"
      ]
    }
  }
}
```

This example uses globally selected installed Bun to run the helper. Use a trusted absolute Bun executable if you do not use mise. The project cannot choose the helper or its inputs.

The preset intentionally omits `image`. The project selects its development image through `pi-sesh.json`, or you select it with `--image`. Review that image before supplying credentials. To restrict the preset to one trusted image, add `image`; changing it through project defaults then requires explicit CLI approval.

The image needs a compatible Linux x86-64 loader and system libraries for the chosen Pi distribution. It needs `/bin/sh`, `mkdir`, and `ln` for this bootstrap. Supply the development tools that Pi and your extensions need. Pi-sesh does not install them during launch. No agent-specific image is required.

## Launch

From any configured project directory, use the same shared preset:

```sh
pi-sesh launch pi
pi-sesh launch pi -- --mode rpc
pi-sesh launch pi -- --version
```

Programmatic clients spawn the same launcher with stdin and stdout as pipes. Launcher diagnostics use stderr. Session identity, workspace, program mounts, and resources are automatic. Native Pi arguments remain literal after `--`.

Use `--network pasta` only when outbound access is wanted. With `network: "none"`, the bootstrap sets `PI_OFFLINE=1`. It puts the supplied Pi executable on container `PATH`, so child Pi processes use the same contained runtime. It does not change the host Pi installation or host settings.

The status extension is `extensions/pi-sesh-status.ts`. Select that filename when you use explicit extension filters. It displays the session name and appends the container association to Pi session metadata. Pi writes a session file only when its conversation contains a user or assistant message. Opening and closing Pi can therefore leave no transcript.

Inspect results before removal:

```sh
pi-sesh inspect <name>
pi-sesh logs <name>
pi-sesh remove <name>
```

The output resource retains Pi sessions and analytics. The staged agent directory is secret and is deleted after verified exit. Workspace writes stay in the clone. Mount mode instead writes to the original project.

Attached-launch cancellation stops and verifies the whole container. Results remain available. An unhandled launcher crash can require explicit `stop`. Container startup failure never runs Pi on the host.

## Offline validation

```sh
bun test
bun run typecheck
PI_SESSION_INTEGRATION=1 \
  PI_SESH_BINARY=/absolute/path/to/pi-sesh \
  PI_SESSION_PI_RUNTIME=/absolute/path/to/first/pi-distribution \
  PI_SESSION_NEXT_RUNTIME=/absolute/path/to/second/pi-distribution \
  bun test tests/sesh.integration.test.ts
```

Use two different compatible Pi versions. The test uses cached `docker.io/library/node:22-bookworm-slim`, local rootless Podman, host Git, Bun, mise, and Python 3. The image contains development runtime files but no Pi. No downloads are made.

The test checks RPC framing, terminal startup, the footer, session metadata, retained output, clone-only writes, runtime updates, a new model-callable extension tool, direct extension filesystem access, subprocess containment, read-only runtime files, and SIGTERM cancellation. It calls the new tool from an extension command, without a model request. It does not load host credentials or change host launchers. It removes only its disposable sessions.

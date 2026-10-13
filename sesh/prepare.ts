#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageSelection {
  source: string;
  paths?: string[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}
export interface PiSessionConfig {
  runtimeResolver: string[];
  packages?: PackageSelection[];
  agentFiles?: Record<string, string>;
  credentials?: { source: string; providers: string[] };
}
function fail(message: string): never {
  throw new Error(`pi-session-prepare: ${message}`);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Expected a JSON object");
  return value as Record<string, unknown>;
}
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Unsupported configuration field");
}
async function selectedFile(path: string, privateFile = false) {
  if (!isAbsolute(path) || path.includes("\0"))
    fail("Selected file must use an absolute path");
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    info.size > 1024 * 1024 ||
    (privateFile && (info.mode & 0o077) !== 0)
  )
    fail(
      "Selected file must be user-owned, regular, bounded, and private when it contains credentials",
    );
  return readFile(path, "utf8");
}
function safePath(value: string) {
  if (
    !value ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    /[\0\r\n]/.test(value)
  )
    fail("Program and agent paths must be safe relative paths");
}

/** Resolve the current standalone Pi distribution. Copy only selected user inputs. */
export async function preparePiSession(configPath: string, directory: string) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    fail("Preparation directory must be private and user-owned");
  const raw = object(JSON.parse(await selectedFile(configPath, true)));
  keys(raw, ["runtimeResolver", "packages", "agentFiles", "credentials"]);
  const config = raw as unknown as PiSessionConfig;
  const argv = config.runtimeResolver;
  if (
    !Array.isArray(argv) ||
    !argv.length ||
    argv.length > 32 ||
    argv.some(
      (part) => typeof part !== "string" || !part || part.includes("\0"),
    ) ||
    !isAbsolute(argv[0]!)
  )
    fail(
      "runtimeResolver must contain literal argv with an absolute executable",
    );
  const result = spawnSync(argv[0]!, argv.slice(1), {
    cwd: homedir(),
    env: { HOME: homedir(), PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    fail("Runtime resolver failed; no agent will run on the host");
  const selected = result.stdout.trim();
  if (!isAbsolute(selected) || /[\0\r\n]/.test(selected))
    fail("Runtime resolver must print one absolute distribution directory");
  let runtime = await realpath(selected);
  const entry = await lstat(join(runtime, "pi"));
  if (entry.isDirectory()) runtime = await realpath(join(runtime, "pi"));
  const binary = await lstat(join(runtime, "pi"));
  if (!binary.isFile() || binary.isSymbolicLink() || !(binary.mode & 0o111))
    fail("Distribution must contain an executable pi file");
  const mounts = [{ source: runtime, destination: "/home/session/runtime/pi" }];
  const packages = config.packages ?? [];
  if (!Array.isArray(packages) || packages.length > 8)
    fail("packages must be a bounded array");
  const packageSettings: Record<string, unknown>[] = [];
  for (const [index, selection] of packages.entries()) {
    object(selection);
    keys(selection, [
      "source",
      "paths",
      "extensions",
      "skills",
      "prompts",
      "themes",
    ]);
    if (typeof selection.source !== "string" || !isAbsolute(selection.source))
      fail("Package source must be absolute");
    const source = await realpath(selection.source);
    const target = `/home/session/runtime/package-${index}`;
    const paths = selection.paths ?? [
      "package.json",
      "extensions",
      "src",
      "skills",
      "prompts",
      "themes",
      "node_modules",
    ];
    if (!Array.isArray(paths) || !paths.length || paths.length > 24)
      fail("Package paths must be a bounded array");
    for (const path of paths) {
      if (typeof path !== "string") fail("Package path must be a string");
      safePath(path);
      const hostPath = join(source, path);
      const entry = await lstat(hostPath).catch((error) => {
        if (error.code === "ENOENT" && !selection.paths) return undefined;
        throw error;
      });
      if (!entry) continue;
      if (entry.isSymbolicLink() || (await realpath(hostPath)) !== hostPath)
        fail("Selected program path traverses a symlink");
      mounts.push({ source: hostPath, destination: `${target}/${path}` });
    }
    const filters: Record<string, unknown> = { source: target };
    for (const name of ["extensions", "skills", "prompts", "themes"] as const) {
      const filter = selection[name];
      if (filter !== undefined) {
        if (
          !Array.isArray(filter) ||
          filter.some(
            (value) => typeof value !== "string" || value.includes("\0"),
          )
        )
          fail("Package filters must be string arrays");
        filters[name] = filter;
      }
    }
    packageSettings.push(filters);
  }
  const agent = join(directory, "agent");
  await mkdir(agent, { mode: 0o700 });
  const files = config.agentFiles ?? {};
  object(files);
  let settings: Record<string, unknown> = {};
  if (files["settings.json"])
    settings = object(JSON.parse(await selectedFile(files["settings.json"])));
  for (const [name, source] of Object.entries(files)) {
    safePath(name);
    if (name === "auth.json" || name === "mcp-auth.json")
      fail(
        "Select provider credentials through credentials; MCP OAuth is not supplied",
      );
    if (name === "settings.json") continue;
    if (typeof source !== "string")
      fail("Agent source must be an absolute file path");
    const content = await selectedFile(
      source,
      name === "mcp.json" || name === "models.json",
    );
    const target = join(agent, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600, flag: "wx" });
  }
  settings.packages = packageSettings;
  settings.sessionDir = "/home/session/output/sessions";
  await writeFile(join(agent, "settings.json"), JSON.stringify(settings), {
    mode: 0o600,
    flag: "wx",
  });
  if (config.credentials) {
    object(config.credentials);
    keys(config.credentials, ["source", "providers"]);
    if (
      !Array.isArray(config.credentials.providers) ||
      !config.credentials.providers.length ||
      config.credentials.providers.some(
        (provider) =>
          typeof provider !== "string" || !/^[a-zA-Z0-9_-]+$/.test(provider),
      )
    )
      fail("Select provider names explicitly");
    const auth = object(
      JSON.parse(await selectedFile(config.credentials.source, true)),
    );
    const selectedAuth = Object.fromEntries(
      config.credentials.providers.map((provider) => {
        if (!Object.hasOwn(auth, provider))
          fail("Selected provider has no host credential");
        return [provider, auth[provider]];
      }),
    );
    await writeFile(join(agent, "auth.json"), JSON.stringify(selectedAuth), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const bootstrap = join(directory, "bootstrap.sh");
  await copyFile(
    fileURLToPath(new URL("./bootstrap.sh", import.meta.url)),
    bootstrap,
  );
  await chmod(bootstrap, 0o600);
  await writeFile(
    join(directory, "runtime.json"),
    JSON.stringify({ version: 1, mounts }),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    join(directory, "handoff.json"),
    JSON.stringify({
      version: 1,
      resources: [
        {
          id: "pi-agent",
          kind: "snapshot",
          source: "agent",
          destination: "/home/session/.pi/agent",
          access: "rw",
          lifetime: "secret",
        },
        {
          id: "bootstrap",
          kind: "snapshot",
          source: "bootstrap.sh",
          destination: "/home/session/bootstrap.sh",
          access: "ro",
          lifetime: "retained",
        },
        {
          id: "output",
          kind: "owned-directory",
          destination: "/home/session/output",
          lifetime: "retained",
        },
      ],
    }),
    { mode: 0o600, flag: "wx" },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const config = process.argv[2],
    directory = process.env.PI_SESH_PREPARE_DIR;
  if (!config || !directory)
    fail("Pass a private config file through a trusted pi-sesh preset");
  await preparePiSession(resolve(config), directory);
}

#!/usr/bin/env bun
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Create one shared preset from the user's selected Pi settings. */
export async function setupPiPreset() {
  const home = homedir();
  const root = join(
    process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME)
      ? process.env.XDG_CONFIG_HOME
      : join(home, ".config"),
    "pi-sesh",
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.()
  )
    throw new Error(
      "The preset directory must be user-owned and must not be a symlink",
    );
  await chmod(root, 0o700);
  const agent = join(home, ".pi", "agent");
  const settingsPath = await realpath(join(agent, "settings.json"));
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  if (
    typeof settings.defaultProvider !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(settings.defaultProvider)
  )
    throw new Error("Select a default provider in Pi before setup");

  const packages = [];
  for (const entry of settings.packages ?? []) {
    const selection = typeof entry === "string" ? { source: entry } : entry;
    if (
      !selection ||
      typeof selection.source !== "string" ||
      !isAbsolute(selection.source)
    )
      throw new Error(
        "Select installed local packages before setup. Setup does not download packages.",
      );
    const copy = { ...selection, source: await realpath(selection.source) };
    if (Array.isArray(copy.extensions))
      copy.extensions = copy.extensions
        .map((path: string) =>
          path === "extensions/pi-pod-status.ts"
            ? "extensions/pi-sesh-status.ts"
            : path,
        )
        .filter((path: string) => path !== "extensions/pi-session.ts");
    packages.push(copy);
  }
  const agentFiles: Record<string, string> = { "settings.json": settingsPath };
  for (const name of [
    "auto-model.json",
    "command-permission.json",
    "keybindings.json",
    "mcp.json",
    "models.json",
    "AGENTS.md",
    "AGENTS.override.md",
    "CLAUDE.md",
    "SYSTEM.md",
    "APPEND_SYSTEM.md",
  ]) {
    const path = join(agent, name);
    const file = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (file) {
      if (!file.isFile() || file.isSymbolicLink())
        throw new Error(`Selected agent file must be regular: ${name}`);
      agentFiles[name] = path;
    }
  }
  const launcherPath = join(root, "launchers.json");
  const launcherFile = await lstat(launcherPath).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (
    launcherFile &&
    (!launcherFile.isFile() ||
      launcherFile.isSymbolicLink() ||
      launcherFile.uid !== process.getuid?.() ||
      launcherFile.mode & 0o077)
  )
    throw new Error("launchers.json must be private, regular, and user-owned");
  const launchers = launcherFile
    ? JSON.parse(await readFile(launcherPath, "utf8"))
    : { version: 1, presets: {} };
  if (
    launchers.version !== 1 ||
    !launchers.presets ||
    typeof launchers.presets !== "object" ||
    Array.isArray(launchers.presets)
  )
    throw new Error(
      "Unsupported launcher configuration. No preset was replaced.",
    );
  const selectionPath = join(root, "pi-selection.json");
  const selectionFile = await lstat(selectionPath).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (
    selectionFile &&
    (!selectionFile.isFile() ||
      selectionFile.isSymbolicLink() ||
      selectionFile.uid !== process.getuid?.() ||
      selectionFile.mode & 0o077)
  )
    throw new Error(
      "The Pi selection file must be private, regular, and user-owned",
    );
  const selection = {
    runtimeResolver: ["/usr/bin/mise", "where", "pi"],
    packages,
    agentFiles,
    credentials: {
      source: join(agent, "auth.json"),
      providers: [settings.defaultProvider],
    },
  };
  await writeFile(selectionPath, `${JSON.stringify(selection, null, 2)}\n`, {
    mode: 0o600,
  });
  launchers.presets.pi = {
    command: ["/bin/sh", "/home/session/bootstrap.sh", "--no-approve"],
    workspace: launchers.presets.pi?.workspace ?? "mount",
    network: launchers.presets.pi?.network ?? "none",
    prepare: [
      process.execPath,
      fileURLToPath(new URL("./prepare.ts", import.meta.url)),
      selectionPath,
    ],
  };
  await writeFile(launcherPath, `${JSON.stringify(launchers, null, 2)}\n`, {
    mode: 0o600,
  });
  return launcherPath;
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  console.log(`Configured shared Pi preset: ${await setupPiPreset()}`);
  console.log(
    "Existing project recipes and other presets were preserved. Credentials were not read.",
  );
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmod, lstat, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

function fail(message) {
  console.error(`set-pi-sesh-version: ${message}`);
  process.exit(1);
}

const version = process.argv[2];
if (
  !version ||
  process.argv.length !== 3 ||
  !/^\d+(?:\.\d+){0,2}$/.test(version)
) {
  fail("usage: node sesh/set-version.mjs <Pi version, for example 1.4.0>");
}

const mise = "/usr/bin/mise";
const resolved = spawnSync(mise, ["where", `pi@${version}`], {
  encoding: "utf8",
  env: { HOME: homedir(), PATH: "/usr/bin:/bin" },
  timeout: 30_000,
});
if (resolved.error || resolved.status !== 0) {
  fail(
    `Pi ${version} is not installed with mise, or mise could not resolve it`,
  );
}

const configHome = process.env.XDG_CONFIG_HOME;
const root = join(
  configHome && isAbsolute(configHome)
    ? configHome
    : join(homedir(), ".config"),
  "pi-sesh",
);
const path = join(root, "pi-selection.json");
const info = await lstat(path).catch((error) => {
  if (error.code === "ENOENT") fail(`config file not found: ${path}`);
  throw error;
});
if (
  !info.isFile() ||
  info.isSymbolicLink() ||
  info.uid !== process.getuid?.() ||
  (info.mode & 0o077) !== 0
) {
  fail("pi-selection.json must be a private, regular file owned by your user");
}

let config;
try {
  config = JSON.parse(await readFile(path, "utf8"));
} catch {
  fail("pi-selection.json is not valid JSON");
}
if (!config || typeof config !== "object" || Array.isArray(config)) {
  fail("pi-selection.json must contain a JSON object");
}
config.runtimeResolver = [mise, "where", `pi@${version}`];
const temporary = join(root, `.pi-selection.json.${process.pid}.tmp`);
try {
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
} catch (error) {
  await import("node:fs/promises").then(({ unlink }) =>
    unlink(temporary).catch(() => {}),
  );
  throw error;
}
console.log(
  `Pi-sesh will use Pi ${version} (${resolved.stdout.trim()}) on the next launch.`,
);

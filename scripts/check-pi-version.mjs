import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const requireSource = args.includes("--require-source");
const allowMissingCli = args.includes("--allow-missing-cli");
const piArg = args.findIndex((arg) => arg === "--pi");
if (piArg >= 0 && (!args[piArg + 1] || args[piArg + 1].startsWith("--"))) {
  throw new Error("--pi requires an executable path.");
}
const explicitPi = piArg >= 0 ? args[piArg + 1] : process.env.PI_CLI_PATH;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootPackage = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const expected =
  rootPackage.devDependencies?.["@earendil-works/pi-coding-agent"];
const tuiExpected = rootPackage.devDependencies?.["@earendil-works/pi-tui"];

if (!isExactVersion(expected) || !isExactVersion(tuiExpected)) {
  throw new Error(
    "Expected exact Pi coding-agent and pi-tui versions in devDependencies.",
  );
}
if (expected !== tuiExpected) {
  throw new Error(
    `Pi development packages must match (${expected} != ${tuiExpected}).`,
  );
}

const versions = [];
for (const name of [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
]) {
  const packagePath = join(
    root,
    "node_modules",
    ...name.split("/"),
    "package.json",
  );
  if (!existsSync(packagePath)) {
    versions.push({
      label: `${name} installed package`,
      version: "missing",
      path: packagePath,
    });
    continue;
  }
  const installed = JSON.parse(readFileSync(packagePath, "utf8"));
  versions.push({
    label: `${name} installed package`,
    version: installed.version,
    path: packagePath,
  });
}
versions.push({
  label: "manifest pin",
  version: expected,
  path: join(root, "package.json"),
});

const piPath = resolvePiPath(explicitPi);
if (piPath) {
  let runtime;
  try {
    runtime = execFileSync(piPath, ["--version"], { encoding: "utf8" }).trim();
  } catch (error) {
    throw new Error(`Could not run Pi CLI at ${piPath}: ${error.message}`);
  }
  versions.push({ label: "external Pi CLI", version: runtime, path: piPath });
} else if (!allowMissingCli) {
  throw new Error(
    "Could not find an external Pi CLI. Set PI_CLI_PATH or pass --pi <path>; npm's local node_modules/.bin is intentionally ignored.",
  );
}

const sourceCandidates = [
  join(root, "pi-source", "packages", "coding-agent", "package.json"),
  join(root, "pi-source", "package.json"),
];
const sourcePackagePath = sourceCandidates.find(existsSync);
if (sourcePackagePath) {
  const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, "utf8"));
  if (typeof sourcePackage.version === "string") {
    versions.push({
      label: "Pi source",
      version: sourcePackage.version,
      path: sourcePackagePath,
    });
  }
} else if (requireSource) {
  throw new Error("No Pi source checkout found at pi-source/.");
}

for (const { label, version, path } of versions)
  console.log(`${label}: ${version} (${path})`);
const mismatches = versions.filter(({ version }) => version !== expected);
if (mismatches.length > 0)
  throw new Error(`Pi version mismatch; expected ${expected}.`);

function isExactVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function resolvePiPath(explicit) {
  if (explicit) {
    const path = resolve(explicit);
    if (!existsSync(path))
      throw new Error(`Pi CLI path does not exist: ${path}`);
    return path;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (
      !directory ||
      /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/.test(directory)
    )
      continue;
    const candidate = join(
      directory,
      process.platform === "win32" ? "pi.cmd" : "pi",
    );
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

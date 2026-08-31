import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requireSource = process.argv.includes("--require-source");
const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const expected =
  rootPackage.devDependencies?.["@earendil-works/pi-coding-agent"];

if (!expected || !/^\d+\.\d+\.\d+$/.test(expected)) {
  throw new Error(
    "Expected an exact pi-coding-agent version in devDependencies.",
  );
}

const runtime = execFileSync("pi", ["--version"], { encoding: "utf8" }).trim();
const versions = [
  { label: "development dependency", version: expected },
  { label: "Pi CLI", version: runtime },
];

const sourceCandidates = [
  join("pi-source", "packages", "coding-agent", "package.json"),
  join("pi-source", "package.json"),
];
const sourcePackagePath = sourceCandidates.find(existsSync);
if (sourcePackagePath) {
  const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, "utf8"));
  if (typeof sourcePackage.version === "string") {
    versions.push({
      label: `Pi source (${sourcePackagePath})`,
      version: sourcePackage.version,
    });
  }
} else if (requireSource) {
  throw new Error("No Pi source checkout found at pi-source/.");
}

const mismatches = versions.filter(({ version }) => version !== expected);
for (const { label, version } of versions) console.log(`${label}: ${version}`);

if (mismatches.length > 0) {
  throw new Error(`Pi version mismatch; expected ${expected}.`);
}

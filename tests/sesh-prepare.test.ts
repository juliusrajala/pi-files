import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePiSession, type PiSessionConfig } from "../sesh/prepare.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-files-sesh-"));
  roots.push(root);
  const runtime = join(root, "pi-current"),
    output = join(root, "prepared"),
    pkg = join(root, "package");
  await mkdir(runtime);
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(pkg, "extensions"), { recursive: true });
  await writeFile(join(runtime, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "test-package",
      pi: { extensions: ["./extensions"] },
    }),
  );
  const config: PiSessionConfig = {
    runtimeResolver: [
      "/bin/sh",
      "-c",
      'printf "%s\\n" "$1"',
      "resolver",
      runtime,
    ],
    packages: [{ source: pkg }],
  };
  const configPath = join(root, "config.json");
  return { root, runtime, output, pkg, config, configPath };
}
test("resolves the current distribution and mounts package folders without a tool list", async () => {
  const { root, runtime, output, pkg, config, configPath } = await fixture();
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await preparePiSession(configPath, output);
  const first = await json(join(output, "runtime.json"));
  assert.ok(
    first.mounts.some(
      (mount: { source: string; destination: string }) =>
        mount.source === runtime &&
        mount.destination === "/home/session/runtime/pi",
    ),
  );
  assert.ok(
    first.mounts.some(
      (mount: { source: string; destination: string }) =>
        mount.source === join(pkg, "extensions") &&
        mount.destination === "/home/session/runtime/package-0/extensions",
    ),
  );
  await writeFile(
    join(pkg, "extensions", "new-tool.ts"),
    "export default () => {};\n",
  );
  const next = join(root, "next");
  await mkdir(next, { mode: 0o700 });
  await preparePiSession(configPath, next);
  assert.deepEqual(await json(join(next, "runtime.json")), first);
  await assert.rejects(stat(join(next, "agent", "auth.json")));
  const settings = await json(join(next, "agent", "settings.json"));
  assert.deepEqual(settings.packages, [
    { source: "/home/session/runtime/package-0" },
  ]);
  assert.equal(settings.sessionDir, "/home/session/output/sessions");
  assert.equal(
    (await stat(join(next, "agent", "settings.json"))).mode & 0o077,
    0,
  );
});
test("copies only selected provider credentials without changing originals", async () => {
  const { root, output, config, configPath } = await fixture();
  const authPath = join(root, "auth.json");
  const auth = {
    selected: { type: "api_key", key: "synthetic" },
    other: { type: "api_key", key: "not-selected" },
  };
  await writeFile(authPath, JSON.stringify(auth), { mode: 0o600 });
  config.credentials = { source: authPath, providers: ["selected"] };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await preparePiSession(configPath, output);
  assert.deepEqual(await json(join(output, "agent", "auth.json")), {
    selected: auth.selected,
  });
  assert.deepEqual(await json(authPath), auth);
  assert.equal(
    (await json(join(output, "handoff.json"))).resources[0].lifetime,
    "secret",
  );
});
test("unsafe selections and failed resolvers do not run an agent on the host", async () => {
  for (const change of [
    (config: PiSessionConfig) => {
      config.runtimeResolver = ["relative"];
    },
    (config: PiSessionConfig) => {
      config.runtimeResolver = ["/bin/sh", "-c", "exit 23"];
    },
    (config: PiSessionConfig) => {
      config.agentFiles = { "auth.json": "/ignored" };
    },
    (config: PiSessionConfig) => {
      config.packages![0]!.paths = ["../escape"];
    },
  ]) {
    const { output, config, configPath } = await fixture();
    change(config);
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    await assert.rejects(preparePiSession(configPath, output));
    await assert.rejects(stat(join(output, "handoff.json")));
  }
});

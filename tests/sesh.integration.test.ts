import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const enabled = process.env.PI_SESSION_INTEGRATION === "1";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test(
  "whole Pi launch supports RPC, terminal, updates, new tools, and cancellation offline",
  { skip: !enabled, timeout: 120_000 },
  async () => {
    const selectedBinary = process.env.PI_SESH_BINARY;
    const runtime = process.env.PI_SESSION_PI_RUNTIME;
    const nextRuntime = process.env.PI_SESSION_NEXT_RUNTIME;
    assert.ok(
      selectedBinary && runtime && nextRuntime,
      "Select PI_SESH_BINARY and two compatible standalone Pi distribution roots",
    );
    const binary = selectedBinary;
    const root = await mkdtemp(join(tmpdir(), "pi-files-launch-"));
    const project = join(root, "project"),
      config = join(root, "config"),
      pkg = join(root, "package"),
      selector = join(root, "current-runtime");
    await mkdir(project);
    await mkdir(join(config, "pi-sesh"), { recursive: true, mode: 0o700 });
    await mkdir(join(pkg, "extensions"), { recursive: true });
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: config,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    const names: string[] = [];
    const run = (argv: string[]) => {
      const result = spawnSync(argv[0]!, argv.slice(1), {
        cwd: project,
        env,
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      return result.stdout;
    };
    const cli = (args: string[]) => run([binary, ...args]);
    const inspection = (name: string) => JSON.parse(cli(["inspect", name]));
    function name(label: string) {
      const value = `pi-launch-${label}-${crypto.randomUUID().slice(0, 8)}`;
      names.push(value);
      return value;
    }
    function rpc(sessionName: string) {
      const child = spawn(
        binary,
        ["launch", "pi", "--name", sessionName, "--", "--mode", "rpc"],
        { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] },
      );
      const records: any[] = [];
      let pending = "",
        stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        pending += data;
        for (;;) {
          const boundary = pending.indexOf("\n");
          if (boundary < 0) break;
          const line = pending.slice(0, boundary);
          pending = pending.slice(boundary + 1);
          if (line) records.push(JSON.parse(line));
        }
      });
      child.stderr.on("data", (data: string) => {
        stderr += data;
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      });
      async function wait(predicate: (record: any) => boolean) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const found = records.find(predicate);
          if (found) return found;
          if (child.exitCode !== null) throw new Error(`Pi exited: ${stderr}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        child.kill("SIGTERM");
        throw new Error(`RPC deadline: ${stderr}`);
      }
      return {
        child,
        records,
        exited,
        wait,
        send: (command: object) =>
          child.stdin.write(`${JSON.stringify(command)}\n`),
      };
    }
    try {
      run(["git", "init", "--initial-branch=main"]);
      await writeFile(join(project, "source.txt"), "source fixture\n");
      await writeFile(
        join(project, "pi-sesh.json"),
        JSON.stringify({
          version: 1,
          image: "docker.io/library/node:22-bookworm-slim",
        }),
      );
      run(["git", "add", "."]);
      run([
        "git",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "Fixture",
      ]);
      await writeFile(selector, runtime);
      const selection = join(root, "selection.json");
      await writeFile(
        selection,
        JSON.stringify({
          runtimeResolver: ["/bin/sh", "-c", 'cat "$1"', "resolver", selector],
          packages: [
            {
              source: packageRoot,
              paths: ["package.json", "extensions", "src"],
              extensions: ["extensions/pi-sesh-status.ts"],
              skills: [],
              prompts: [],
              themes: [],
            },
            { source: pkg },
          ],
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(config, "pi-sesh", "launchers.json"),
        JSON.stringify({
          version: 1,
          presets: {
            pi: {
              command: ["/bin/sh", "/home/session/bootstrap.sh"],
              workspace: "clone",
              network: "none",
              prepare: [
                "/usr/bin/mise",
                "exec",
                "bun",
                "--",
                "bun",
                join(packageRoot, "sesh", "prepare.ts"),
                selection,
              ],
            },
          },
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(pkg, "package.json"),
        JSON.stringify({
          name: "test-tools",
          pi: { extensions: ["./extensions"] },
        }),
      );
      await writeFile(
        join(pkg, "extensions", "baseline.ts"),
        `import { writeFileSync } from "node:fs";\nexport default function(pi) { pi.registerCommand("baseline", { handler: async (_args, ctx) => { writeFileSync("baseline.txt", "inside"); writeFileSync("/home/session/output/result.txt", "retained"); ctx.shutdown(); } }); }\n`,
      );

      const currentVersion = cli([
        "launch",
        "pi",
        "--name",
        name("version"),
        "--",
        "--version",
      ]).trim();
      const firstName = name("rpc");
      const first = rpc(firstName);
      first.send({ id: "state", type: "get_state" });
      const firstState = await first.wait(
        (record) => record.type === "response" && record.id === "state",
      );
      assert.equal(firstState.success, true);
      first.send({
        id: "bash",
        type: "bash",
        command: "printf builtin > rpc-bash.txt",
      });
      assert.equal(
        (
          await first.wait(
            (record) => record.type === "response" && record.id === "bash",
          )
        ).success,
        true,
      );
      first.send({ id: "entries", type: "get_entries" });
      const entries = await first.wait(
        (record) => record.id === "entries" && record.type === "response",
      );
      assert.equal(entries.success, true);
      first.send({ id: "probe", type: "prompt", message: "/baseline" });
      assert.equal(await first.exited, 0);
      const firstRecord = inspection(firstName);
      assert.equal(firstRecord.exitCode, 0);
      assert.equal(
        await readFile(join(firstRecord.workspacePath, "baseline.txt"), "utf8"),
        "inside",
      );
      assert.equal(
        await readFile(join(firstRecord.workspacePath, "rpc-bash.txt"), "utf8"),
        "builtin",
      );
      const firstOutput = firstRecord.resources.find(
        (item: any) => item.id === "output",
      ).hostPath;
      const sessionFile = firstState.data.sessionFile;
      assert.ok(sessionFile?.startsWith("/home/session/output/sessions/"));
      assert.ok(JSON.stringify(entries.data).includes(firstRecord.id));
      assert.equal(
        await readFile(join(firstOutput, "result.txt"), "utf8"),
        "retained",
      );
      assert.equal(
        firstRecord.resources.some((item: any) => item.id === "pi-agent"),
        false,
      );

      const terminalName = name("terminal");
      const terminalScript = `import os, pty, subprocess, time, select, struct, fcntl, termios, sys\nmaster, slave = pty.openpty()\nfcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))\nchild = subprocess.Popen([sys.argv[1], 'launch', 'pi', '--name', sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)\nos.close(slave)\noutput = b''\nstart = time.monotonic()\nsent = False\nwhile child.poll() is None and time.monotonic() - start < 30:\n if not sent and time.monotonic() - start > 3:\n  os.write(master, b'/baseline\\r')\n  sent = True\n ready, _, _ = select.select([master], [], [], 0.1)\n if ready:\n  try: output += os.read(master, 65536)\n  except OSError: break\nif child.poll() is None:\n child.terminate()\n child.wait(timeout=10)\nos.close(master)\nassert child.returncode == 0, output.decode(errors='replace')\nassert b'pi-sesh' in output, output.decode(errors='replace')\n`;
      run(["python3", "-c", terminalScript, binary, terminalName]);
      assert.equal(
        await readFile(
          join(inspection(terminalName).workspacePath, "baseline.txt"),
          "utf8",
        ),
        "inside",
      );

      await writeFile(
        join(pkg, "extensions", "new-tool.ts"),
        `import { Type } from "@earendil-works/pi-ai";\nimport { defineTool } from "@earendil-works/pi-coding-agent";\nimport { writeFileSync, existsSync, readFileSync } from "node:fs";\nimport { spawnSync } from "node:child_process";\nexport default function(pi) {\n const tool = defineTool({ name: "new_unadapted_tool", label: "New tool", description: "Offline containment proof", parameters: Type.Object({}), execute: async () => {\n  if (process.cwd() !== "/workspace" || existsSync(${JSON.stringify(join(root, "host-only"))})) throw new Error("Host boundary failed");\n  if (readFileSync("source.txt", "utf8") !== "source fixture\\n") throw new Error("Workspace failed");\n  let blocked = false; try { writeFileSync("/home/session/runtime/pi/host-write", "bad"); } catch { blocked = true; }\n  if (!blocked) throw new Error("Program mount is writable");\n  const child = spawnSync("/bin/sh", ["-c", "printf child > child.txt"]); if (child.status !== 0) throw new Error("Child failed");\n  writeFileSync("new-tool.txt", "inside"); return { content: [{ type: "text", text: "contained" }], details: {} };\n }});\n pi.registerTool(tool);\n pi.registerCommand("tool-proof", { handler: async (_args, ctx) => { if (!pi.getActiveTools().includes(tool.name)) throw new Error("Tool not registered"); await tool.execute("offline", {}, undefined, undefined, ctx); ctx.shutdown(); } });\n}\n`,
      );
      await writeFile(join(root, "host-only"), "host marker");
      await writeFile(selector, nextRuntime);
      const nextVersion = cli([
        "launch",
        "pi",
        "--name",
        name("next-version"),
        "--",
        "--version",
      ]).trim();
      assert.notEqual(
        currentVersion,
        nextVersion,
        "Acceptance needs two different Pi versions",
      );
      const nextName = name("updated");
      const next = rpc(nextName);
      next.send({ id: "probe", type: "prompt", message: "/tool-proof" });
      assert.equal(await next.exited, 0);
      const nextRecord = inspection(nextName);
      assert.equal(nextRecord.imageId, firstRecord.imageId);
      assert.equal(
        await readFile(join(nextRecord.workspacePath, "new-tool.txt"), "utf8"),
        "inside",
      );
      assert.equal(
        await readFile(join(nextRecord.workspacePath, "child.txt"), "utf8"),
        "child",
      );

      const cancelName = name("cancel");
      const cancelled = rpc(cancelName);
      cancelled.send({ id: "state", type: "get_state" });
      await cancelled.wait(
        (record) => record.id === "state" && record.type === "response",
      );
      cancelled.send({
        id: "sleep",
        type: "bash",
        command: "printf retained > cancelled.txt; printf begun; sleep 120",
      });
      await cancelled.wait(
        (record) =>
          record.type === "bash_execution_update" &&
          record.delta?.includes("begun"),
      );
      cancelled.child.kill("SIGTERM");
      assert.notEqual(await cancelled.exited, 0);
      const cancelledRecord = inspection(cancelName);
      assert.ok(["exited", "stopped"].includes(cancelledRecord.state));
      assert.equal(
        await readFile(
          join(cancelledRecord.workspacePath, "cancelled.txt"),
          "utf8",
        ),
        "retained",
      );
      assert.equal(
        cancelledRecord.resources.some((item: any) => item.id === "pi-agent"),
        false,
      );
      for (const file of [
        "baseline.txt",
        "rpc-bash.txt",
        "new-tool.txt",
        "child.txt",
        "cancelled.txt",
      ])
        await assert.rejects(readFile(join(project, file)));
      assert.equal(run(["git", "status", "--porcelain"]), "");
    } finally {
      for (const sessionName of names) {
        spawnSync(binary, ["stop", sessionName], { env, encoding: "utf8" });
        const removed = spawnSync(binary, ["remove", sessionName], {
          env,
          encoding: "utf8",
        });
        if (
          removed.status !== 0 &&
          !removed.stderr.includes("No pi-sesh session")
        )
          throw new Error(
            `Test session needs recovery: ${sessionName}: ${removed.stderr}`,
          );
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

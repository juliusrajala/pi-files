import assert from "node:assert/strict";
import test from "node:test";
import statusExtension, { sessionLabel } from "../extensions/pi-sesh-status.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("footer identifies the container session without old runtime labels", () => {
  assert.equal(sessionLabel({}), "Pi · no session");
  assert.equal(sessionLabel({ PI_SESH_SESSION: "dev" }), "pi-sesh dev");
});

test("footer writes container association to session metadata", () => {
  const handlers = new Map<string, Function>();
  const statuses: string[] = [],
    colors: string[] = [],
    entries: unknown[] = [];
  const previousName = process.env.PI_SESH_SESSION;
  const previousId = process.env.PI_SESH_SESSION_ID;
  process.env.PI_SESH_SESSION = "dev";
  process.env.PI_SESH_SESSION_ID = "immutable-id";
  try {
    statusExtension({
      on: (event: string, handler: Function) => {
        handlers.set(event, handler);
      },
      appendEntry: (type: string, data: unknown) => {
        entries.push({ type, data });
      },
    } as unknown as ExtensionAPI);
    handlers.get("session_start")!(
      {},
      {
        cwd: "/workspace",
        ui: {
          theme: {
            fg: (color: string, text: string) => {
              colors.push(color);
              return text;
            },
          },
          setStatus: (_key: string, text: string) => {
            statuses.push(text);
          },
        },
      },
    );
    assert.deepEqual(statuses, ["● pi-sesh dev  "]);
    assert.deepEqual(colors, ["success", "success"]);
    assert.deepEqual(entries, [
      {
        type: "pi-sesh",
        data: { name: "dev", id: "immutable-id", cwd: "/workspace" },
      },
    ]);
  } finally {
    if (previousName === undefined) delete process.env.PI_SESH_SESSION;
    else process.env.PI_SESH_SESSION = previousName;
    if (previousId === undefined) delete process.env.PI_SESH_SESSION_ID;
    else process.env.PI_SESH_SESSION_ID = previousId;
  }
});

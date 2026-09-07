import assert from "node:assert/strict";
import test from "node:test";

import {
  findGitCommands,
  findProtectedCommands,
  getConfirmationTitle,
  highlightProtectedCommands,
  parsePermissionConfig,
} from "../extensions/command-permission.ts";

test("finds commit and push commands at shell boundaries", () => {
  const command =
    'npm test && git commit -m "fix parser"; env CI=1 git push origin main';
  const operations = findGitCommands(command);

  assert.deepEqual(
    operations.map(({ command: value, operation }) => ({
      command: value,
      operation,
    })),
    [
      { command: 'git commit -m "fix parser"', operation: "commit" },
      { command: "git push origin main", operation: "push" },
    ],
  );
  assert.equal(getConfirmationTitle(operations), "Allow Git commit and push?");
});

test("does not gate ordinary text that mentions a Git operation", () => {
  assert.deepEqual(findGitCommands('echo "run git commit after tests"'), []);
});

test("highlights only matched Git commands", () => {
  const command = "git commit -m test && echo done";
  const operations = findGitCommands(command);
  assert.equal(
    highlightProtectedCommands(command, operations, (text) => `[${text}]`),
    "[git commit -m test ]&& echo done",
  );
});

test("adds configured scripts without removing the default Git protections", () => {
  const config = parsePermissionConfig({
    scripts: [
      { command: "bin/prod-script", title: "production script" },
      { command: "bin/cli --production", title: "production CLI" },
    ],
  });
  const operations = findProtectedCommands(
    "env CI=1 git push && bin/prod-script cli users list; bin/cli --production pubsub replay",
    config,
  );

  assert.deepEqual(
    operations.map(({ command, operation, title }) => ({
      command,
      operation,
      title,
    })),
    [
      { command: "git push ", operation: "push", title: "push" },
      {
        command: "bin/prod-script",
        operation: "script",
        title: "production script",
      },
      {
        command: "bin/cli --production",
        operation: "script",
        title: "production CLI",
      },
    ],
  );
  assert.equal(
    getConfirmationTitle(operations),
    "Allow Git push and production script and production CLI?",
  );
});

test("can disable the default Git protections", () => {
  const config = parsePermissionConfig({
    includeDefaultGitCommands: false,
    scripts: [{ command: "scripts/deploy", title: "deployment" }],
  });

  assert.deepEqual(
    findProtectedCommands("git push && scripts/deploy production", config).map(
      ({ command, operation }) => ({ command, operation }),
    ),
    [{ command: "scripts/deploy", operation: "script" }],
  );
});

test("ignores malformed configured scripts", () => {
  assert.deepEqual(
    parsePermissionConfig({
      scripts: [
        { command: "" },
        { command: "scripts/deploy; rm -rf /" },
        { title: "missing command" },
      ],
    }).scripts,
    [],
  );
});

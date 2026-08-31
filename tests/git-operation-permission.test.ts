import assert from "node:assert/strict";
import test from "node:test";

import {
  findGitCommands,
  getConfirmationTitle,
  highlightGitCommands,
} from "../extensions/git-operation-permission.ts";

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
    highlightGitCommands(command, operations, (text) => `[${text}]`),
    "[git commit -m test ]&& echo done",
  );
});

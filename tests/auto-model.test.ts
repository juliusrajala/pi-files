import assert from "node:assert/strict";
import test from "node:test";

import {
  LUNA,
  TERRA,
  chooseModel,
  summarizeReason,
} from "../extensions/auto-model.ts";

test("selects Terra for prompts with a complexity signal", () => {
  assert.equal(
    chooseModel("Investigate the root cause of this flaky test."),
    TERRA,
  );
  assert.equal(chooseModel("Review this authentication design."), TERRA);
});

test("selects Luna for a short, straightforward prompt", () => {
  assert.equal(chooseModel("Rename this variable."), LUNA);
});

test("selects Terra for a long prompt without a keyword signal", () => {
  assert.equal(chooseModel("x".repeat(701)), TERRA);
});

test("makes a one-line bounded log reason", () => {
  assert.equal(summarizeReason("  one\n\n two  "), " one two ");
  assert.equal(summarizeReason("x".repeat(101)).length, 100);
});

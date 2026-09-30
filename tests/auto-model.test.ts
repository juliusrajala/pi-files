import assert from "node:assert/strict";
import test from "node:test";

import {
  ASTRA,
  LUNA,
  chooseModel,
  summarizeReason,
} from "../extensions/auto-model.ts";

test("uses the GPT-6 model IDs", () => {
  assert.equal(ASTRA, "gpt-6-astra");
  assert.equal(LUNA, "gpt-6-luna");
});

test("selects Astra for prompts with a complexity signal", () => {
  assert.equal(
    chooseModel("Investigate the root cause of this flaky test."),
    ASTRA,
  );
  assert.equal(chooseModel("Review this authentication design."), ASTRA);
});

test("selects Luna for a short, straightforward prompt", () => {
  assert.equal(chooseModel("Rename this variable."), LUNA);
});

test("selects Astra for a long prompt without a keyword signal", () => {
  assert.equal(chooseModel("x".repeat(701)), ASTRA);
});

test("makes a one-line bounded log reason", () => {
  assert.equal(summarizeReason("  one\n\n two  "), " one two ");
  assert.equal(summarizeReason("x".repeat(101)).length, 100);
});

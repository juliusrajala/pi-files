---
name: plan-control-flow
description: Automatically plan non-trivial code changes before implementation, even when the user did not ask for a plan. Use when a change spans multiple files or components, affects control flow, APIs, data models, or persistence, or has meaningful design choices.
---

# Plan the change

Use this skill by default for non-trivial implementation work, even when the user did not ask for a plan. A task is non-trivial when it spans files or components, changes control flow, APIs, data models, or persistence, or has important design choices. Skip the plan for small, local edits with an obvious solution.

Inspect the existing code before planning. Trace relevant entry points, callers, and current behavior. Present a concise plan before editing so the user can review the design. Pause for the user's response before implementation.

Separate the design levels:

- **Product intent**, when changing user-visible behavior: state the user problem and observable success condition. Keep technical choices for the design sections.
- **System architecture**: show how affected components, services, APIs, schemas, queues, and stores interact.
- **Program design**: show the relevant call flow, types, signatures, and file layout.
- **Vertical slices**, when implementation has multiple stages: order small, end-to-end increments that can each be exercised. Avoid plans that only implement one layer at a time without a working path.

Write the plan in ASD-STE100 Simplified Technical English. Use short sentences, active voice, and common words. State one instruction or fact in each sentence. Keep code names and identifiers unchanged. Use the same term for the same concept.

Describe the proposed flow in execution order. Show additions with `+`, removals with `-`, and changed behavior with `~`. Include only relevant details. Mark assumptions and unknowns instead of inventing system behavior.

Include these sections when relevant:

## Control flow

Show the important path from entry point through decisions, side effects, and result or error handling. Write it as a pseudo-code call tree. Name each step with its `module.function()` or `Class.method()` when known. Include branches and failure paths when they affect the change. Include old paths that the change removes or replaces. Keep unrelated paths out.

Format:

```text
module.entrypoint()
  module.runCommand()
+   module.handleCreateResource()
+     ResourceClient.create(input)
+       POST /resources
+     module.renderResult()
-   legacy.module.legacyCreateFlow()
```

## APIs and contracts

Show affected public or internal interfaces, including input, output, errors, and compatibility changes. Include HTTP or GraphQL details when relevant.

Format:

PUT /api/resources/:slug
  request:  { destination: string }
  response: { resource: Resource }

or GraphQL format when relevant

## Data models

List changed types, fields, validation rules, defaults, and important invariants.

## Storage and DB changes

Describe persistence, migrations, and rollback needs. Use SQL when a database schema changes.

Use SQL:

CREATE TABLE resource (
  slug         TEXT PRIMARY KEY,
  destination  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

## Files

List new, changed, and removed files. Give one short reason for each. Use a tree diff when it makes the scope easier to review.

## Tests and verification

Name the key behavior and failure cases to test. Give the relevant test files or commands when known. Include regression, type-check, and migration checks when relevant.

## Risks and boundaries

Call out edge cases, failure handling, compatibility concerns, and work that is out of scope when they affect the design.

## File tree example

 src
 └── resource
+    ├── resource-client.ts      # NEW - wraps API contract calls
+    ├── resource-client.test.ts # NEW - covers request/response mapping
~    └── resource-route.ts       # MODIFIED - wires create action into UI

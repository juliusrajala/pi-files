# Analytics capability matrix

This matrix is the implementation boundary for `pi-usage-analytics`. It targets Pi `0.84.3`. A metric is collected only when its source and privacy behavior are explicit.

| Desired metric                  | Pi source                                                  | Classification        | Local event                                 | Default privacy treatment                                  | Notes                                                                          |
| ------------------------------- | ---------------------------------------------------------- | --------------------- | ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Schema/runtime/session identity | `session_start`, `ctx.sessionManager`                      | Explicit              | `session_started`                           | Session ID is local-only and may be hashed in reports      | Generate a runtime UUID for every loaded extension instance.                   |
| Session replacement             | `session_start`, `session_shutdown`                        | Explicit              | `session_started`, `session_stopped`        | No path                                                    | `reason` distinguishes startup, reload, new, resume, and fork.                 |
| Prompt size/attachments         | `input`                                                    | Explicit              | `input_received`                            | Counts only; never text or image data                      | Capture source and streaming behavior.                                         |
| Explicit skill command          | `input` text beginning `/skill:`                           | Explicit              | `skill_requested`                           | Skill name only                                            | Pi expands this command after `input`.                                         |
| Automatic skill use             | `tool_execution_start` for `read` of a known skill path    | Inferred              | `skill_read`                                | Skill name/path category only                              | This is not proof that the model followed the skill.                           |
| Tool duration/outcome           | `tool_execution_start`, `tool_execution_end`               | Explicit              | `tool_finished`                             | Tool name, call ID, byte counts; never args/result content | Use a monotonic clock for duration. Parallel calls are paired by `toolCallId`. |
| Tool permission denial          | Shared event emitted by the permission extension           | Explicit              | `permission_denied`                         | Operation category, not command                            | `tool_execution_end` alone does not identify the policy decision reliably.     |
| Assistant model usage           | `message_end` for finalized assistant messages             | Explicit              | `assistant_completed`                       | Provider/model/thinking level and numeric usage only       | Exclude error/aborted messages or record their terminal state separately.      |
| Model/thinking-level change     | `model_select`, `thinking_level_select`                    | Explicit              | `model_selected`, `thinking_level_selected` | Provider/model/level only                                  | Also record active settings at runtime start.                                  |
| Turn timing                     | `turn_start`, `turn_end`                                   | Explicit              | `turn_started`, `turn_finished`             | Turn index and duration only                               | A turn can contain parallel tools.                                             |
| Settled state                   | `agent_settled`                                            | Explicit              | `agent_settled`                             | No content                                                 | Flush local writes here with a bounded wait.                                   |
| Compaction success              | `session_compact`                                          | Explicit              | `compaction_finished`                       | Reason, retry flag, token count only                       | Do not record the summary.                                                     |
| Compaction failure/abort        | `session_compact_failed`                                   | Explicit              | `compaction_failed`                         | Reason, abort flag, coarse error category                  | Never persist the raw error if it may contain provider/project data.           |
| Agent retry count               | repeated `agent_start`/`agent_end`, compaction `willRetry` | Inferred              | `agent_retry_inferred`                      | Reason/category only                                       | No dedicated retry event exists; reports must label this inference.            |
| Branch/leaf context             | `ctx.sessionManager.getLeafId()`, session events           | Explicit when sampled | event envelope fields                       | Local-only IDs; hash/omit in exports                       | Sample at event creation, not only report time.                                |
| Repository/cwd/branch           | extension-side Git inspection                              | Optional              | event envelope fields                       | Disabled by default; opaque local hash only when enabled   | Never collect remote URL, full path, or branch by default.                     |

## Event envelope

Every future JSONL record must include:

```ts
{
  schemaVersion: 1,
  eventId: string,       // globally unique and stable for deduplication
  timestamp: string,     // wall-clock ISO-8601 timestamp
  monotonicMs?: number,  // duration source, not an absolute cross-process clock
  runtimeId: string,
  sessionId?: string,
  leafId?: string,
  type: string,
  data: Record<string, unknown>,
}
```

The implementation must validate that `data` is JSON-serializable and must not fall back to serializing the original Pi event object.

## Explicit exclusions

The first recorder version must not write prompt text, attachments, tool arguments, tool results, assistant content or thinking, full paths, Git remotes, branch names, environment variables, API/provider headers, credentials, or raw provider errors.

## Storage and delivery constraints

- One JSONL sidecar per session/runtime avoids inter-process append contention.
- Local files use `0600`; write queues are bounded and flushed by record count and maximum age.
- `agent_settled` and `session_shutdown` wait only for bounded local persistence.
- Upload is out of scope. No analytics network request may originate in a Pi lifecycle handler.

---
"opencode-adaptive-thinking": minor
---

Add optional `afterIdle` / `afterUserMessage` triggers for the guidance and an optional LLM classifier. The classifier uses the same guidance, the last compaction summary or the current segment as context, and the current message last. Session state is bounded at 5,000 entries, expires after seven days, and is removed when a session is deleted.

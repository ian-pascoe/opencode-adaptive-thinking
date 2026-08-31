---
"opencode-adaptive-thinking": patch
---

Merge adaptive-thinking guidance into the existing first system prompt instead of appending a second system message. Some strict chat templates require exactly one system message at the beginning of the conversation and fail to render when a later system message is added, which could break inference before it started. When no system prompt exists yet, the guidance is still injected as a standalone entry. Automatic reasoning-effort switching via `set_reasoning_effort` is unchanged.

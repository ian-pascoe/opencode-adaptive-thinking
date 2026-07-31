---
"opencode-adaptive-thinking": patch
---

Preserve the active model when synthetic prompts adjust reasoning effort and when temporary overrides reset after a session becomes idle. This prevents OpenCode from falling back to the agent/provider default model instead of the model that was selected when the reasoning change was initiated.

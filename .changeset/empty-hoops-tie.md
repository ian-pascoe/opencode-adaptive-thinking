---
"opencode-adaptive-thinking": patch
---

Preserve the active agent when synthetic prompts adjust reasoning effort and when temporary overrides reset after a session becomes idle. This prevents OpenCode from routing follow-up work to the default agent instead of the agent that initiated the change.

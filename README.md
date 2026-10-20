<div align='center'>
    <br/>
    <br/>
    <h3>opencode-adaptive-thinking</h3>
    <p>Adaptive Thinking Plugin for OpenCode.</p>
    <a href="https://www.npmjs.com/package/opencode-adaptive-thinking"><img src="https://img.shields.io/npm/v/opencode-adaptive-thinking?style=for-the-badge&logo=npm&label=npm&color=cb3837" alt="npm version" /></a>
    <br/>
    <br/>
</div>

## Overview

`opencode-adaptive-thinking` is an OpenCode plugin that lets agents actively adjust model reasoning effort during a session.

The plugin injects adaptive-thinking guidance into the system prompt and exposes a tool for switching to one of the current model's valid reasoning-effort variants.

## Requirements

- OpenCode with plugin support compatible with `@opencode-ai/plugin` `^1.14.24`.
- A selected model that exposes reasoning-effort variants such as `none`, `low`, `medium`, `high`, or `xhigh`.

## Installation

Add the package to your OpenCode config plugin list:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-adaptive-thinking"]
}
```

To customize behavior, use the tuple form shown in the configuration example below.

## Configuration

The plugin accepts these optional settings:

- `enabled`: enable or disable the plugin without removing it from config. Defaults to `true`.
- `quiet`: suppress toast notifications for configuration errors. Defaults to `false`.
- `toolName`: name of the reasoning-effort tool exposed to agents. Defaults to `set_reasoning_effort`.
- `toolDescription`: description for the reasoning-effort tool. Defaults to `Set your reasoning effort`.
- `systemPrompt`: custom adaptive-thinking guidance injected into the system prompt.
- `triggers` (optional): when to inject the guidance and run the classifier. Fields: `afterIdle` and `afterUserMessage` (booleans). Omit `triggers` for the original behavior (guidance on every request); both `false` disables the guidance.
- `classifier` (optional): an LLM classifier that chooses the effort on real user messages. Disabled by default. Fields: `enabled` (boolean) and `model` (`{ providerID, modelID }`, default `opencode/big-pickle`).

### Triggers and classifier

`triggers` scopes when the guidance is injected:

- `afterIdle`: first request after an idle or session start, when no user message is pending.
- `afterUserMessage`: first request after a real user message.

Both are reset on `session.idle`. Omit `triggers` for the original behavior (guidance on every request). Both `false` disables the guidance.

When `classifier.enabled` is true, the plugin asks the configured model for one valid effort level on real user messages. It uses the same guidance as its system prompt, then the last compaction summary (assistant message with `summary: true`) or the messages since session start/last idle, then the current message last. The call uses a temporary child session with tools disabled and a 5 s timeout; failures leave the level unchanged. The main session still receives the guidance at the triggers.

```json
"triggers": {
  "afterIdle": true,
  "afterUserMessage": true
},
"classifier": {
  "enabled": true,
  "model": { "providerID": "opencode", "modelID": "big-pickle" }
}
```

Synthetic and ignored messages are skipped. The classifier sends the user's request text and session context to the configured model; keep it disabled if that is not acceptable.

Session state is kept in a 5,000-entry LRU and expires after seven days of inactivity; deleted sessions are removed.

### Example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-adaptive-thinking",
      {
        "enabled": true,
        "quiet": false,
        "toolName": "set_reasoning_effort",
        "toolDescription": "Set your reasoning effort",
        "systemPrompt": "Actively choose the lowest reasoning effort that can safely complete the task. Raise effort for ambiguity, debugging, risky changes, or multi-step synthesis."
      }
    ]
  ]
}
```

## Behavior

Agents receive system guidance to actively choose the lowest reasoning effort that can safely complete the task. The plugin also exposes the configured tool, `set_reasoning_effort` by default, with these arguments:

- `level`: one of the valid reasoning-effort variants for the current model.
- `persist`: when `true`, keep the selected effort for the session. When `false` or omitted, apply it temporarily and reset to the previous effort after `session.idle`.

Example temporary change:

```json
{
  "level": "high",
  "persist": false
}
```

Example persisted change:

```json
{
  "level": "low",
  "persist": true
}
```

The system prompt lists the valid levels for the current session. Cached session state is only used when it is still valid for the current model, so switching models will not advertise or reuse an invalid effort level.

Adaptive-thinking guidance is merged into the first existing system prompt instead of a separate system message, so strict chat templates that allow only one system message keep working.

## Troubleshooting

If the tool returns `no valid reasoning effort levels are available for this session`, check that the active model exposes variants in OpenCode. Some providers or models may not support reasoning-effort levels.

If the tool returns `Invalid reasoning effort level`, use one of the levels listed in the system prompt for the current session.

If configuration errors appear, check the plugin options against the documented keys and value types. Set `quiet` to `true` to suppress configuration error toasts while still writing details to the OpenCode logs.

## Development

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

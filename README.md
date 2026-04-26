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

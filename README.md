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

## Development

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

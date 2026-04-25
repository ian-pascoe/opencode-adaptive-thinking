---
title: Plugin Options Configurability
summary: AdaptiveThinkingPlugin now supports configurable enabled/quiet flags, service and tool naming, custom tool descriptions and system prompts, with invalid config logging and disabled-plugin no-op behavior.
tags: []
related: [facts/project/reasoning_effort_behavior.md, facts/project/reasoning_effort_confirmation.md]
keywords: []
createdAt: '2026-04-25T12:40:26.166Z'
updatedAt: '2026-04-25T12:49:59.689Z'
---
## Reason
Document configurable plugin options and validation behavior for the adaptive thinking plugin

## Raw Concept
**Task:**
Document the configurable plugin options added to AdaptiveThinkingPlugin.

**Changes:**
- Identified that the current plugin behavior is hard-coded in src/index.ts
- Proposed a config schema modeled after ../opencode-byterover
- Defined default options for enablement, tool naming, prompt text, quiet error handling, and service naming
- Add a config schema with defaults
- Support enabled boolean and prompt string options
- Return empty config when disabled or invalid
- Keep existing tool and reset behavior unchanged
- Added src/config.ts with Zod-backed defaults
- Wired config into AdaptiveThinkingPlugin
- Added tests for config behavior
- Updated README with config docs and example
- Added a minor changeset

**Files:**
- src/index.ts
- ../opencode-byterover
- src/config.ts
- src/index.test.ts
- README.md
- .changeset/configurable-plugin-options.md

**Flow:**
load config -> validate with Zod -> if invalid log and toast -> if disabled return {} -> otherwise expose configured tool and guidance

**Timestamp:** 2026-04-25

**Author:** Ian

## Narrative
### Structure
The implementation centralizes plugin configuration in src/config.ts and threads the validated options into AdaptiveThinkingPlugin so runtime behavior and exposed tool metadata can be customized.

### Dependencies
Depends on the existing opencode-byterover config pattern, Zod validation, and the plugin runtime that shows toasts and logs errors on invalid configuration.

### Highlights
Tests, typecheck, lint, format check, and build all passed after the implementation. Validation only found formatting drift in src/index.test.ts before formatting was applied.

### Rules
Curate only information with lasting value: facts, decisions, technical details, preferences, or notable outcomes.

### Examples
Example options include enabled, quiet, serviceName, toolName, toolDescription, and systemPrompt.

## Facts
- **config_pattern**: The plugin uses the opencode-byterover config pattern. [project]
- **plugin_options**: Supported options are enabled, quiet, serviceName, toolName, toolDescription, and systemPrompt. [project]
- **invalid_config_behavior**: Invalid config logs an error, shows a toast, and returns {}. [project]
- **disabled_plugin_behavior**: Disabled plugin returns {}. [project]
- **tool_name_behavior**: Custom toolName updates both the exposed tool and the system prompt guidance. [project]

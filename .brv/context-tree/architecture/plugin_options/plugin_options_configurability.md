---
title: Plugin Options Configurability
summary: Plugin options now support enabled, quiet, toolName, toolDescription, and systemPrompt; serviceName is removed from public config and defaults remain functional.
tags: []
related: [facts/project/reasoning_effort_behavior.md, facts/project/reasoning_effort_confirmation.md, project_management/pull_requests/pr_6_replacement_for_default_options_changes.md]
keywords: []
createdAt: '2026-04-25T12:40:26.166Z'
updatedAt: '2026-04-25T17:44:35.947Z'
---
## Reason
Capture the plugin configuration surface and defaults.

## Raw Concept
**Task:**
Document plugin configuration support and default behavior

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
- Added plugin config support for enabled, quiet, toolName, toolDescription, and systemPrompt
- Removed serviceName from public config
- Kept internal log service fixed as opencode-adaptive-thinking

**Files:**
- src/index.ts
- ../opencode-byterover
- src/config.ts
- src/index.test.ts
- README.md
- .changeset/configurable-plugin-options.md

**Flow:**
plugin loads config -> validates with Zod -> applies defaults -> runs with optional overrides

**Timestamp:** 2026-04-25

**Author:** assistant

## Narrative
### Structure
Configuration is defined in src/config.ts, consumed by src/index.ts, and documented in README.md. Tests cover disabled plugin behavior, invalid config handling, custom tool metadata, custom system prompt, and default-options regression.

### Dependencies
Uses Zod for schema validation and relies on high-signal tests to protect the public config surface.

### Highlights
The config surface is intentionally kept small and does not expose serviceName. Default behavior is treated as a regression requirement.

### Rules
Curate only information with lasting value: facts, decisions, technical details, preferences, or notable outcomes.

### Examples
Example options include enabled, quiet, serviceName, toolName, toolDescription, and systemPrompt.

## Facts
- **plugin_options**: The plugin supports configurable enabled, quiet, toolName, toolDescription, and systemPrompt options. [project]
- **service_name_config**: serviceName was removed from the public config surface. [project]
- **internal_log_service_name**: The internal log service name remains opencode-adaptive-thinking. [project]
- **default_options_behavior**: Default plugin behavior must continue working when no options are provided. [project]

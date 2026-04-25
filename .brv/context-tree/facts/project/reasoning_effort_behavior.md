---
title: Reasoning Effort Behavior
summary: Temporary low reasoning effort can be set in a live session, invalid levels are rejected, and the next idle transition should reset to medium once.
tags: []
related: []
keywords: []
createdAt: '2026-04-25T11:53:01.433Z'
updatedAt: '2026-04-25T11:54:28.539Z'
---
## Reason
Persist lasting knowledge about reasoning effort behavior, validation, and checks

## Raw Concept
**Task:**
Document reasoning effort session behavior and verification outcomes

**Changes:**
- Split state into currentVariant, persistedVariant, and temporaryResetVariant
- Temporary reasoning effort now resets only once on session.idle
- Reset prompts are ignored so they do not remain visible in-context
- Persisted reasoning effort no longer triggers idle reset
- Invalid levels are rejected before calling promptAsync or mutating state
- System guidance now uses the transform hook model variants for new sessions
- System prompt guidance is now one consolidated entry
- Removed v2 SDK type imports and @ts-expect-error usage around variant
- Set temporary reasoning effort to low
- Confirmed invalid reasoning effort level is rejected before mutation
- Observed expected one-time idle reset behavior to medium
- Verified tests, typecheck, lint, format:check, and build passed

**Files:**
- src/index.ts
- src/index.test.ts

**Flow:**
set reasoning effort -> validate level -> run checks -> idle transition resets to medium once

**Timestamp:** 2026-04-25T11:54:23.547Z

**Author:** assistant

## Narrative
### Structure
This entry records a live-session reasoning-effort state change and the expected follow-up idle reset behavior.

### Dependencies
The behavior depends on the session state machine and validation for allowed reasoning effort levels.

### Highlights
A temporary low setting was accepted, an invalid level was rejected, and the next idle transition should restore medium only once.

### Rules
Temporary reasoning effort now resets only once on session.idle. Reset prompts are ignored and should not remain visible in-context. Invalid levels are rejected before calling promptAsync or mutating state.

### Examples
Checks that passed included pnpm run test, pnpm run typecheck, pnpm run lint, pnpm run format:check, and pnpm run build.

## Facts
- **reasoning_effort**: Reasoning effort was set to low in a live session. [project]
- **reasoning_effort_validation**: Invalid reasoning effort levels are rejected before mutation. [project]
- **reasoning_effort_reset_behavior**: The temporary low reasoning effort should reset to medium once on idle, then stop repeating. [project]
- **verification_status**: Automated checks passed: test, typecheck, lint, format:check, and build. [project]

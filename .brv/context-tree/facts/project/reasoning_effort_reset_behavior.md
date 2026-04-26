---
createdAt: '2026-04-25T11:09:11.082Z'
keywords: []
related: [facts/preference/reasoning_effort.md, facts/project/reasoning_effort_confirmation.md, facts/project/reasoning_effort_reset_message.md, facts/project/reasoning_effort_reset_notice.md, facts/project/reasoning_effort_reset_notice_visibility.md, facts/project/reasoning_effort_behavior.md, facts/project/reasoning_effort_state_handling.md, facts/project/reasoning_effort_medium_handling.md]
summary: Reasoning effort can be reset to medium, and the reset notice states that it has been reset to medium.
tags: []
title: Reasoning Effort Reset Behavior
updatedAt: '2026-04-25T11:54:47.414Z'
---
## Reason
Document persistent reasoning effort reset behavior from conversation

## Raw Concept
**Task:**
Document reasoning effort reset behavior

**Changes:**
- Added set_reasoning_effort tool for session variant control
- Implemented session.idle reset attempt based on cached variant
- Observed undefined priorState.variant in the reset prompt body
- Reset notice indicates reasoning effort reset to medium

**Files:**
- src/index.ts

**Flow:**
reset notice -> reasoning effort set to medium

**Timestamp:** 2026-04-25

## Narrative
### Structure
The note records a reset-state confirmation for reasoning effort.

### Dependencies
Depends on client.session.messages, client.app.agents, and client.session.promptAsync for variant resolution and state changes.

### Highlights
The reset notice explicitly says: Reasoning effort reset to medium.

## Facts
- **reasoning_effort_reset**: Reasoning effort was reset to medium. [project]

---
title: PR 3 Test Pruning
summary: PR 3 removed two low-signal system-transform smoke tests, kept behavior-focused coverage, and passed validation checks.
tags: []
related: [project_management/pull_requests/context.md, src/index.test.ts.md]
keywords: []
createdAt: '2026-04-25T13:08:52.626Z'
updatedAt: '2026-04-25T13:08:52.626Z'
---
## Reason
Document the removal of low-value tests and the verification completed during the PR update.

## Raw Concept
**Task:**
Prune low-value tests from the test suite and verify the resulting PR.

**Changes:**
- Removed two smoke/string tests that duplicated custom system prompt coverage
- Kept behavior-focused tests that protect config parsing, tool behavior, variant validation, and reset semantics
- Verified the pruned suite with test, typecheck, lint, format, and build checks
- Recorded a separate .brv PR memory update during validation

**Files:**
- src/index.test.ts
- .brv

**Flow:**
audit tests -> remove low-signal cases -> format -> rerun validation -> push PR update

**Timestamp:** 2026-04-25

**Author:** Ian

## Narrative
### Structure
The PR focused on reducing noise in src/index.test.ts by deleting implementation-detail smoke tests while preserving the coverage that would catch real regressions.

### Dependencies
The change depended on keeping the custom system prompt test as the main coverage for system guidance behavior.

### Highlights
The resulting suite was reported as passing, and the PR update included both the test-pruning commit and a separate memory-update commit.

### Rules
Tests should be high signal low noise.

### Examples
Removed tests named "uses the transform model to inject guidance for a new session" and "adds a single non-duplicative system guidance entry".

## Facts
- **removed_tests**: Two low-value tests were removed from src/index.test.ts: "uses the transform model to inject guidance for a new session" and "adds a single non-duplicative system guidance entry". [project]
- **retained_test_coverage**: The retained tests cover disabled plugin behavior, invalid config behavior, internal service name regression, configured tool name/description behavior, custom system prompt behavior, temporary reset behavior, persisted effort behavior, and invalid reasoning effort validation. [project]
- **validation_commands**: Validation succeeded with pnpm test, pnpm typecheck, pnpm lint, pnpm format:check, and pnpm build. [project]
- **commits**: Added commits were f143c2f docs: update brv memory for PR changes and bd23719 test: remove low-value system prompt tests. [project]

---
title: Git branch checkout safety
summary: Use Git refusal as a safety signal; stash conflicting local .brv changes with a clear label before switching branches and pulling updates.
tags: []
related: []
keywords: []
createdAt: '2026-04-25T12:25:59.254Z'
updatedAt: '2026-04-25T12:25:59.254Z'
---
## Reason
Documented safe branch transition behavior when local .brv edits exist

## Raw Concept
**Task:**
Document safe git branch switching when local tracked .brv changes are present

**Changes:**
- Verified worktree before switching branches
- Allowed Git refusal to prevent overwriting .brv edits
- Stashed conflicting changes with a clear label
- Switched to main and pulled latest updates

**Files:**
- .brv/

**Flow:**
check worktree -> attempt checkout -> on refusal, stash conflicting changes -> checkout main -> pull origin/main -> confirm clean status

**Timestamp:** 2026-04-25T12:25:53.760Z

**Author:** Ian

## Narrative
### Structure
This note captures the branch transition procedure used during a release-preparation sync. The key local path involved was .brv, which had in-progress edits that triggered Git protection.

### Dependencies
Relies on Git refusing unsafe checkout operations when tracked files have uncommitted changes.

### Highlights
The safe recovery path preserved local .brv work by stashing before switching to main. The repository ended clean and up to date after pulling origin/main.

### Rules
Before branch switches, check worktree for local edits; if a switch is blocked, stash labeled changes, then switch and pull.

### Examples
Example stash label: pre-main-checkout local brv changes

## Facts
- **current_branch**: The current branch was feat/prepare-for-release before checkout. [project]
- **checkout_refusal_reason**: Git refused the branch switch because local .brv edits would be overwritten. [project]
- **stash_label**: Conflicting local changes were stashed with the label pre-main-checkout local brv changes. [project]
- **final_branch_state**: The repository was checked out to main and pulled from origin/main. [project]

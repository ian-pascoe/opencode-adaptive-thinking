# opencode-adaptive-thinking

## 0.1.5

### Patch Changes

- [#16](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/16) [`f4c5e6a`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/f4c5e6af7695fd51c54a5b4eb7253c1d42f965b2) Thanks [@mauriciozaffari](https://github.com/mauriciozaffari)! - Preserve the active agent when synthetic prompts adjust reasoning effort and when temporary overrides reset after a session becomes idle. This prevents OpenCode from routing follow-up work to the default agent instead of the agent that initiated the change.

## 0.1.4

### Patch Changes

- [#13](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/13) [`08757ee`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/08757ee3df6954758243f2a44f7887b40d5f640e) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Bump dependencies

## 0.1.3

### Patch Changes

- [#10](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/10) [`8fe70ee`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/8fe70ee673b0c657a20dcf49ed4cd96f3056ceb3) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Update dependencies

## 0.1.2

### Patch Changes

- [#8](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/8) [`0afb0c6`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/0afb0c6df61980588ef072a756412b7a66d16772) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Honor quiet invalid-config handling, ignore stale cached reasoning effort after model changes, and resolve fallback agent variants from the newest relevant message.

## 0.1.1

### Patch Changes

- [#6](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/6) [`132dce4`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/132dce4cc88371244472209d801f688ba2c739fb) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Bound adaptive-thinking session state with an LRU cache to prevent unbounded growth across long-running OpenCode processes.

## 0.1.0

### Minor Changes

- [#3](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/3) [`dbe24bc`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/dbe24bc3138eb19473e2f07dc62c0879776bf44b) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Add plugin options for enabling/disabling the plugin, customizing the reasoning-effort tool, and overriding injected system guidance.

## 0.0.2

### Patch Changes

- [#1](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/1) [`5616012`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/561601203dc7c20b1a0a9a2a275b835bb0e1eb7d) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Harden reasoning effort state handling so temporary settings reset once, persisted settings do not reset on idle, invalid levels are rejected before mutation, and system guidance is added as one consolidated prompt entry.

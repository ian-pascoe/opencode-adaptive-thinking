# opencode-adaptive-thinking

## 0.1.1

### Patch Changes

- [#6](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/6) [`132dce4`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/132dce4cc88371244472209d801f688ba2c739fb) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Bound adaptive-thinking session state with an LRU cache to prevent unbounded growth across long-running OpenCode processes.

## 0.1.0

### Minor Changes

- [#3](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/3) [`dbe24bc`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/dbe24bc3138eb19473e2f07dc62c0879776bf44b) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Add plugin options for enabling/disabling the plugin, customizing the reasoning-effort tool, and overriding injected system guidance.

## 0.0.2

### Patch Changes

- [#1](https://github.com/ian-pascoe/opencode-adaptive-thinking/pull/1) [`5616012`](https://github.com/ian-pascoe/opencode-adaptive-thinking/commit/561601203dc7c20b1a0a9a2a275b835bb0e1eb7d) Thanks [@ian-pascoe](https://github.com/ian-pascoe)! - Harden reasoning effort state handling so temporary settings reset once, persisted settings do not reset on idle, invalid levels are rejected before mutation, and system guidance is added as one consolidated prompt entry.

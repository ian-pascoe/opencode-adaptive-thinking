import { Plugin } from "@opencode/plugin";
import { parseConfig } from "./config.js";

const serviceName = "opencode-adaptive-thinking";
const maxSessionStateSize = 5000;
const stateTtlMs = 7 * 24 * 60 * 60 * 1000;
const classifierTimeout = 5000;

type ModelInfo = { providerID: string; modelID: string };
type ModelRef = { providerID: string; id: string; variant?: string };
// A catalog variant carries the request overrides the host applies when that variant is selected.
// The plugin applies the same records itself because the context hook's model ref is resolved
// before the hook runs, so changing `event.model.variant` cannot change the outgoing request.
type ModelVariant = {
  id: string;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};
type GenerateText = (
  input: { prompt: string; model: { providerID: string; id: string; variant?: string } },
  options?: { signal?: AbortSignal },
) => Promise<{ text: string }>;
type ModelRecord = {
  modelID: string;
  providerID: string;
  variants: ReadonlyArray<ModelVariant>;
};
// A message names its model with `id`. Provider records expose that identity as `modelID`, and
// some providers also expose a distinct record `id`, so a ref is matched against either one.
type ModelLookupRecord = ModelRecord & { id?: string };
type AgentRecord = { id: string; name: string; model?: { variant?: string } };
type ContentPart = { type: string; text?: string };
type SessionMessage = {
  type: string;
  text?: string;
  summary?: string;
  model?: ModelRef;
  content?: ReadonlyArray<ContentPart>;
  time?: { created?: number };
};
type SessionState = {
  variant?: string;
  idlePending?: boolean;
  userPending?: boolean;
  lastIdleAt?: number;
  touchedAt?: number;
  classifyText?: string;
  reset?: { level: string; model: ModelInfo };
  // The request-scoped variant overrides that cannot be expressed through `event.options`.
  // They apply to every attempt of the next primary request and are cleared by the next context
  // hook, so a retry of the same call keeps them.
  request?: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
};

const idleEvents = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
] as const;
const trackedEvents = ["session.deleted", ...idleEvents] as const;

class SessionStateCache {
  private readonly entries = new Map<string, SessionState>();

  constructor(private readonly maxSize: number) {}

  get(sessionID: string) {
    const entry = this.entries.get(sessionID);
    if (!entry) return;

    if (entry.touchedAt && Date.now() - entry.touchedAt > stateTtlMs) {
      this.entries.delete(sessionID);
      return;
    }

    entry.touchedAt = Date.now();
    this.entries.delete(sessionID);
    this.entries.set(sessionID, entry);
    return entry;
  }

  delete(sessionID: string) {
    this.entries.delete(sessionID);
  }

  update(sessionID: string, update: (entry: SessionState) => void) {
    const entry = this.get(sessionID) ?? {};
    update(entry);
    entry.touchedAt = Date.now();
    this.entries.set(sessionID, entry);

    if (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
  }
}

const state = new SessionStateCache(maxSessionStateSize);

const describe = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    // `JSON.stringify` returns `undefined` for functions, symbols and `undefined`, so fall back
    // to `String` to keep every diagnostic - and every failure path - a string.
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Keys that configure the runtime rather than the provider request. A catalog variant may list
// them, but forwarding them as provider options would leak host settings into the wire request.
const requestRuntimeKeys = new Set([
  "apiKey",
  "authToken",
  "accessToken",
  "baseURL",
  "body",
  "chunkTimeout",
  "compaction",
  "disabled",
  "encoding",
  "fetch",
  "headerTimeout",
  "headers",
  "timeout",
  "transport",
]);

// Keys that would rewrite a prototype instead of carrying a provider option.
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const isUnsafeKey = (key: string) => unsafeKeys.has(key);

const mergeRecords = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    // Never let a catalog-supplied record touch the prototype chain.
    if (isUnsafeKey(key)) continue;
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
  }
  return result;
};

export const AdaptiveThinkingPlugin = Plugin.define({
  id: serviceName,
  async setup(ctx) {
    // Plugin output goes to the server process console (stderr). Keep the last diagnostic in
    // storage as well, because the console is not part of `opencode.log` or `--print-logs`.
    const recordDiagnostic = (level: "warn" | "error", message: string, error?: unknown) => {
      const text = error === undefined ? message : `${message}: ${describe(error)}`;
      try {
        void ctx.storage
          .set("lastDiagnostic", { at: new Date().toISOString(), level, message: text })
          .catch(() => {});
      } catch {
        // Storage is best-effort; when this failure also printed, that line is the record.
      }
    };

    const logError = (message: string, error: unknown) => {
      console.error(`[${serviceName}] ${message}: ${describe(error)}`);
      recordDiagnostic("error", message, error);
    };

    const logWarn = (message: string, error?: unknown) => {
      console.warn(
        error === undefined
          ? `[${serviceName}] ${message}`
          : `[${serviceName}] ${message}: ${describe(error)}`,
      );
      recordDiagnostic("warn", message, error);
    };

    const options = (ctx.options ?? {}) as Record<string, unknown>;
    const parsed = parseConfig(ctx.options);
    if ("error" in parsed) {
      if (options.quiet !== true) {
        console.error(
          `[${serviceName}] Invalid Adaptive Thinking plugin configuration, see the server output for details`,
        );
      }
      logError("Invalid Adaptive Thinking plugin configuration", parsed.error);
      return;
    }

    const config = parsed.config;
    if (!config.enabled) return;

    let classifierWarned = false;

    const warnClassifier = (message: string, error?: unknown) => {
      if (classifierWarned) {
        recordDiagnostic("warn", message, error);
        return;
      }
      classifierWarned = true;
      logWarn(message, error);
    };

    let switchWarned = false;

    const warnSwitch = (message: string, error: unknown) => {
      if (switchWarned) {
        recordDiagnostic("error", message, error);
        return;
      }
      switchWarned = true;
      logError(message, error);
    };

    let requestWarned = false;

    const warnRequest = (message: string, error: unknown) => {
      if (requestWarned) {
        recordDiagnostic("warn", message, error);
        return;
      }
      requestWarned = true;
      logWarn(message, error);
    };

    // `ctx.generate` is deprecated in newer typings in favor of `ctx.experimental.generate`.
    // OpenCode 2.0.30 ships the old path, so prefer the new one when it exists.
    const generateText: GenerateText =
      (ctx.experimental as { generate?: { text?: GenerateText } } | undefined)?.generate?.text ??
      ctx.generate.text;

    let models: Array<ModelLookupRecord> | undefined;

    const modelRecords = async () => {
      if (models) return models;
      try {
        const response = await ctx.model.list();
        // A malformed catalog payload must fail open: the request still runs without a
        // plugin-chosen level instead of failing out of the context hook.
        if (!Array.isArray(response?.data)) {
          logError("Failed to retrieve providers", "the provider list is not an array");
          return;
        }
        models = (response.data as unknown as Array<ModelLookupRecord>).filter(
          (record) => record !== null && typeof record === "object",
        );
        return models;
      } catch (error) {
        logError("Failed to retrieve providers", error);
        return;
      }
    };

    const modelRecord = async (model: ModelInfo) => {
      const records = await modelRecords();
      return records?.find(
        (candidate) =>
          candidate.providerID === model.providerID &&
          (candidate.modelID === model.modelID || candidate.id === model.modelID),
      );
    };

    const variantRecord = async (model: ModelInfo, level: string) => {
      const record = await modelRecord(model);
      return Array.isArray(record?.variants)
        ? record.variants.find((variant) => variant?.id === level)
        : undefined;
    };

    const variantsFor = async (model: ModelInfo) => {
      const record = await modelRecord(model);
      return (Array.isArray(record?.variants) ? record.variants : [])
        .map((variant) => variant?.id)
        .filter((id): id is string => typeof id === "string");
    };

    // `default` is the model baseline OpenCode materializes when no level was chosen. It is a valid
    // reset target but not an advertised level, so it is kept out of the guidance list.
    const isSelectable = (variant: string | undefined, variants: Array<string>) =>
      variant !== undefined && (variants.includes(variant) || variant === "default");

    const fetchMessages = async (sessionID: string) => {
      try {
        const messages = await ctx.session.context({ sessionID });
        // A malformed history payload is treated like an unavailable history: the caller fails
        // open instead of throwing out of a hook or a tool call.
        if (!Array.isArray(messages)) {
          logError(
            `Failed to retrieve messages for session ${sessionID}`,
            "the session context is not an array",
          );
          return;
        }
        return messages as unknown as Array<SessionMessage>;
      } catch (error) {
        logError(`Failed to retrieve messages for session ${sessionID}`, error);
        return;
      }
    };

    const fetchSession = async (sessionID: string) => {
      try {
        return await ctx.session.get({ sessionID });
      } catch (error) {
        logError(`Failed to retrieve session ${sessionID}`, error);
        return;
      }
    };

    const sessionModel = async (sessionID: string): Promise<ModelInfo | undefined> => {
      const session = await fetchSession(sessionID);
      const model = session?.model;
      return model ? { providerID: model.providerID, modelID: model.id } : undefined;
    };

    // A failed `session.get` and a session that legitimately exposes no variant are different
    // states. Only a successful read may fall back to history or the agent, because history can
    // contain the level this plugin stamped on a classified request rather than a user choice.
    type SessionVariantRead = { kind: "unreadable" } | { kind: "read"; variant?: string };

    const readSessionVariant = async (sessionID: string): Promise<SessionVariantRead> => {
      const session = await fetchSession(sessionID);
      if (!session) return { kind: "unreadable" };
      return session.model?.variant === undefined
        ? { kind: "read" }
        : { kind: "read", variant: session.model.variant };
    };

    const latestModel = (messages: Array<SessionMessage>): ModelInfo | undefined => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const model = messages[i]!.model;
        if (model) return { providerID: model.providerID, modelID: model.id };
      }
      return;
    };

    const latestVariant = (messages: Array<SessionMessage>) => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const variant = messages[i]!.model?.variant;
        if (variant) return variant;
      }
      return;
    };

    const agentVariant = async (agent: string | undefined) => {
      if (!agent) return;
      try {
        const response = await ctx.agent.list();
        const match = (response.data as unknown as Array<AgentRecord>).find(
          (candidate) => candidate.name === agent || candidate.id === agent,
        );
        return match?.model?.variant;
      } catch (error) {
        logError("Failed to retrieve agents", error);
        return;
      }
    };

    const messageText = (message: SessionMessage) => {
      if (message.type === "user") return message.text?.trim() || undefined;
      if (message.type !== "assistant") return;
      const text = (message.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      return text.length > 0 ? text : undefined;
    };

    const latestSummary = (messages: Array<SessionMessage>) => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]!;
        if (message.type === "compaction" && message.summary) {
          const text = message.summary.trim();
          if (text) return text;
        }
      }
      return;
    };

    const buildContext = async (sessionID: string) => {
      const messages = await fetchMessages(sessionID);
      if (!messages) return "";
      const summary = latestSummary(messages);
      if (summary) return summary;
      const since = state.get(sessionID)?.lastIdleAt ?? 0;
      return messages
        .filter((message) => !since || (message.time?.created ?? 0) >= since)
        .map((message) => {
          const text = messageText(message);
          return text ? `${message.type}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
    };

    const switchVariant = async (sessionID: string, model: ModelInfo, variant: string) => {
      try {
        await ctx.session.switchModel({
          sessionID,
          model: { providerID: model.providerID, id: model.modelID, variant },
        });
        return;
      } catch (error) {
        warnSwitch(`Failed to set reasoning effort for session ${sessionID}`, error);
        return describe(error);
      }
    };

    const classifyWithModel = async (
      text: string,
      variants: Array<string>,
      model: ModelInfo,
      current: string | undefined,
      context: string,
    ) => {
      const prompt = [
        config.systemPrompt.trim(),
        current ? `Current reasoning effort level: ${current}.` : "",
        `Valid reasoning effort levels for this session: ${variants.join(", ")}.`,
        `To change your reasoning effort, use the \`${config.toolName}\` tool with one of the valid levels.`,
        "Only call it when the task complexity justifies changing levels.",
        "Classifier task: choose exactly one of the valid levels for the current message and answer with that word only.",
        "",
        `Session context:\n${context || "(none)"}`,
        "",
        `Current message:\n${text}`,
      ]
        .filter(Boolean)
        .join(" ");

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: "timeout" });
        }, classifierTimeout);
      });

      // An async wrapper also turns a synchronous throw from the generate API into a rejection,
      // so a broken or missing implementation cannot escape the context hook. Tagging the
      // outcome keeps a failed request distinct from a successful response with no text.
      const pending: Promise<{ kind: "ok"; text: unknown } | { kind: "error"; error: unknown }> =
        (async () => {
          try {
            const response = await generateText(
              {
                prompt,
                model: { providerID: model.providerID, id: model.modelID },
              },
              { signal: controller.signal },
            );
            return { kind: "ok", text: response?.text } as const;
          } catch (error) {
            return { kind: "error", error } as const;
          }
        })();
      const answer = await Promise.race([pending, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (answer.kind === "timeout") {
        warnClassifier("The classifier timed out");
        return;
      }
      if (answer.kind === "error") {
        warnClassifier("The classifier request failed", answer.error);
        return;
      }
      if (typeof answer.text !== "string") {
        // A malformed successful response must fail open like any other classifier failure
        // instead of throwing out of the context hook.
        warnClassifier("The classifier returned an invalid response");
        return;
      }

      const lowered = answer.text.toLowerCase();
      let best: { index: number; level: string } | undefined;
      for (const level of variants) {
        const escaped = level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`\\b${escaped}\\b`, "i").exec(lowered);
        if (match && (!best || match.index < best.index)) best = { index: match.index, level };
      }
      if (!best) {
        warnClassifier("The classifier returned an invalid response");
        return;
      }
      return best.level;
    };

    const applyRequestLevel = async (
      event: {
        model: { providerID: string; id: string; variant?: string | undefined };
        options: Record<string, unknown>;
      },
      sessionID: string,
      model: ModelInfo,
      level: string,
    ) => {
      if (level === "default") return false;

      const variant = await variantRecord(model, level);
      if (!variant) return false;

      let applied = false;
      for (const [key, value] of Object.entries(variant.settings ?? {})) {
        if (value === undefined || requestRuntimeKeys.has(key) || isUnsafeKey(key)) continue;
        event.options[key] = value;
        applied = true;
      }

      const headers =
        variant.headers && Object.keys(variant.headers).length > 0 ? variant.headers : undefined;
      const body = variant.body && Object.keys(variant.body).length > 0 ? variant.body : undefined;
      if (headers || body) {
        state.update(sessionID, (entry) => {
          entry.request = {
            ...(headers ? { headers } : {}),
            ...(body ? { body } : {}),
          };
        });
        applied = true;
      }

      // A variant that only changes runtime configuration cannot be honored by this request.
      // Leave both the wire and the history ref untouched rather than claiming an effort that
      // was never applied.
      if (!applied) return false;

      // `Model.Ref` marks `variant` readonly for consumers; a context hook is where the plugin
      // applies a per-request override. The host does not read this back for the outgoing
      // request, but it does stamp the assistant message, so it must agree with the options and
      // request overrides applied above.
      Object.assign(event.model, { variant: level });
      return true;
    };

    const resetOnIdle = async (sessionID: string) => {
      const reset = state.get(sessionID)?.reset;
      if (!reset) return;

      const session = await fetchSession(sessionID);
      if (!session) return;

      const current = session.model
        ? { providerID: session.model.providerID, modelID: session.model.id }
        : undefined;
      if (!current) {
        logError("Failed to reset reasoning effort on session idle", "no model is available");
        return;
      }

      // The model selected at idle is authoritative. A temporary level belongs to the model that
      // was current at tool-call time, so when the model changed it no longer applies: drop the
      // pending reset instead of switching the session back to the old model.
      if (
        current.providerID !== reset.model.providerID ||
        current.modelID !== reset.model.modelID
      ) {
        state.update(sessionID, (entry) => {
          delete entry.reset;
          // The remembered level belongs to the old model too. Leaving it would make the next
          // temporary change on the new model use the old model's level as its baseline.
          delete entry.variant;
        });
        return;
      }

      const error = await switchVariant(sessionID, current, reset.level);
      if (error !== undefined) return;

      state.update(sessionID, (entry) => {
        // The model default is the absence of a level, so it must not be remembered as one.
        if (reset.level === "default") delete entry.variant;
        else entry.variant = reset.level;
        delete entry.reset;
      });
    };

    await ctx.tool.transform((editor) => {
      editor.add({
        name: config.toolName,
        description: config.toolDescription,
        input: {
          type: "object",
          properties: {
            level: {
              type: "string",
              description:
                "The level of reasoning effort to apply. Higher levels may result in more accurate and thoughtful responses, but may also take more time and resources.",
            },
            persist: {
              type: "boolean",
              default: false,
              description:
                "Whether to persist the setting for this session, otherwise it will only apply for the remainder of the current turn",
            },
          },
          required: ["level"],
        },
        async execute(input, context) {
          const args = (input ?? {}) as Record<string, unknown>;
          const level = typeof args.level === "string" ? args.level : "";
          const persist = args.persist === true;
          const sessionID = context.sessionID;

          const messages = await fetchMessages(sessionID);
          if (!messages)
            return { content: "Failed to set reasoning effort: could not read the session" };

          const model = latestModel(messages) ?? (await sessionModel(sessionID));
          if (!model) {
            return {
              content:
                "Failed to set reasoning effort: no valid reasoning effort levels are available for this session",
            };
          }
          const variants = await variantsFor(model);
          if (variants.length === 0) {
            return {
              content:
                "Failed to set reasoning effort: no valid reasoning effort levels are available for this session",
            };
          }
          if (!variants.includes(level)) {
            return {
              content: `Invalid reasoning effort level: ${level}. Valid levels: ${variants.join(", ")}.`,
            };
          }

          // The session's own variant before this tool call is the reset target. A classifier
          // level is request-scoped, so `state.variant` must never anchor the reset. The history
          // and agent fallbacks only apply when the session read succeeded and the session
          // exposes no variant: a failed read is UNKNOWN, and assuming a history level could
          // restore the plugin's own classifier stamp instead of a level the user chose. Only a
          // previously captured `reset.level` keeps repeated temporary changes on the original
          // baseline.
          const sessionRead = await readSessionVariant(sessionID);
          const previousSessionVariant =
            sessionRead.kind === "read" ? sessionRead.variant : undefined;
          const baseline =
            state.get(sessionID)?.reset?.level ??
            (sessionRead.kind === "read"
              ? (previousSessionVariant ??
                latestVariant(messages) ??
                (await agentVariant(context.agent)))
              : undefined);
          const error = await switchVariant(sessionID, model, level);
          if (error !== undefined) {
            return { content: `Failed to set reasoning effort: ${error}` };
          }

          state.update(sessionID, (entry) => {
            entry.variant = level;
            if (persist || !baseline || baseline === level || !isSelectable(baseline, variants)) {
              delete entry.reset;
            } else {
              entry.reset ??= {
                level: baseline,
                model,
              };
            }
          });

          return { content: `Reasoning effort set to ${level}` };
        },
      });
    });

    await ctx.session.hook("prompt", (event) => {
      const text = event.prompt.text.trim();
      if (text.length === 0) return;

      state.update(event.sessionID, (entry) => {
        entry.userPending = true;
        if (
          config.classifier.enabled &&
          (config.triggers === undefined || config.triggers.afterUserMessage)
        ) {
          entry.classifyText = text;
        }
      });
    });

    await ctx.session.hook("context", async (event) => {
      const sessionID = event.sessionID;

      // A per-request override belongs to exactly one request. Clear any override left by a
      // previous request before this request decides its own level.
      state.update(sessionID, (entry) => {
        delete entry.request;
      });

      // Invariant: `classifyText` is armed only when `triggers` is undefined or
      // `afterUserMessage` is set (see the prompt hook), so whenever it exists the guidance gate
      // below necessarily injects. A future change that arms `classifyText` independently must
      // hoist the gate above this block.
      const pendingText = state.get(sessionID)?.classifyText;
      if (pendingText !== undefined && config.classifier.enabled) {
        state.update(sessionID, (entry) => {
          delete entry.classifyText;
        });

        const model = { providerID: event.model.providerID, modelID: event.model.id };
        const variants = await variantsFor(model);
        const explicit = event.model.variant;
        const hasExplicitLevel =
          explicit !== undefined && explicit !== "default" && variants.includes(explicit);
        if (variants.length > 0 && !hasExplicitLevel) {
          const current = state.get(sessionID)?.variant;
          const context = await buildContext(sessionID);
          const level = await classifyWithModel(
            pendingText,
            variants,
            config.classifier.model,
            current,
            context,
          );
          if (level && variants.includes(level)) {
            // Apply the level to this request only. Persisting it on the session model would
            // outlive the turn and make the next user message look explicitly configured.
            await applyRequestLevel(event, sessionID, model, level);
          }
        }
      }

      const session = state.get(sessionID);
      const userPending = session?.userPending === true;
      const idlePending = session?.idlePending ?? true;

      let inject: boolean;
      if (config.triggers === undefined) inject = true;
      else if (userPending) inject = config.triggers.afterUserMessage;
      else if (idlePending) inject = config.triggers.afterIdle;
      else inject = false;

      if (userPending || idlePending) {
        state.update(sessionID, (entry) => {
          entry.userPending = false;
          entry.idlePending = false;
        });
      }

      // Resolving the current level reads the full session history, so it runs only when the
      // guidance is actually injected. Tool-continuation and disabled-trigger requests stop here.
      if (!inject) return;

      let model: ModelInfo = { providerID: event.model.providerID, modelID: event.model.id };
      let variants = await variantsFor(model);
      // A request whose own model has no catalog variants cannot honor any level. Resolving a
      // different model from history or the session would apply that model's settings to this
      // request and stamp a variant this model does not have.
      if (variants.length === 0) return;
      // The stamped request ref is the per-request record: `applyRequestLevel` writes it only
      // when the request actually received the level's settings.
      let variant: string | undefined = event.model.variant;
      if (variant !== undefined && (variant === "default" || !variants.includes(variant))) {
        variant = undefined;
      }

      if (!variant) {
        const messages = await fetchMessages(sessionID);
        if (!messages) return;

        const resolved = latestVariant(messages) ?? (await agentVariant(event.agent));
        if (resolved && resolved !== "default" && variants.includes(resolved)) variant = resolved;
      }

      // The model default is the absence of a level, so it is replaced by a resolved level or
      // treated as no level at all. Keep the request and the guidance consistent either way.
      if (variant) {
        const level = variant;
        const applied =
          event.model.variant === level ||
          (await applyRequestLevel(event, sessionID, model, level));
        if (applied) {
          if (session?.variant !== level) {
            state.update(sessionID, (entry) => {
              entry.variant = level;
            });
          }
        } else {
          // The catalog has no request mapping for this level, so the request cannot honor it.
          // Do not tell the model it runs at a level the wire never received.
          variant = undefined;
          if (session?.variant !== undefined) {
            state.update(sessionID, (entry) => {
              delete entry.variant;
            });
          }
        }
      } else if (session?.variant !== undefined) {
        state.update(sessionID, (entry) => {
          delete entry.variant;
        });
      }

      const guidance = [
        config.systemPrompt.trim(),
        variant ? `Current reasoning effort level: ${variant}.` : "",
        `Valid reasoning effort levels for this session: ${variants.join(", ")}.`,
        `To change your reasoning effort, use the \`${config.toolName}\` tool with one of the valid levels.`,
        "Only call it when the task complexity justifies changing levels.",
      ]
        .filter(Boolean)
        .join(" ");

      // Merge into the first system message instead of pushing a second one.
      // Strict chat templates (e.g. llama.cpp) require exactly one system message
      // and reject additional ones, breaking template rendering.
      const existingSystem = event.system[0];
      if (existingSystem === undefined || !existingSystem.text) {
        event.system.push({ type: "text", text: guidance });
      } else {
        event.system[0] = { type: "text", text: existingSystem.text + "\n\n" + guidance };
      }
    });

    // Variant header/body overrides cannot travel through `event.options`. Apply them to the one
    // primary request the context hook prepared above. Auxiliary requests (title, compaction,
    // generate) and unrelated providers keep their own settings.
    await ctx.session.hook("model.request", (event) => {
      if (event.kind !== "primary") return;
      const pending = state.get(event.sessionID)?.request;
      if (!pending?.headers) return;
      Object.assign(event.headers, pending.headers);
    });

    await ctx.session.hook("http.request", async (event) => {
      if (event.kind !== "primary") return;
      const pending = state.get(event.sessionID)?.request;
      if (!pending) return;

      // Keep the pending override for the duration of this call: the host invokes this hook on
      // every transport attempt, so a retry must receive the same body. The context hook clears
      // it before the next request.
      if (!pending.body) return;

      try {
        if (!event.request.body) return;
        const parsed: unknown = JSON.parse(await event.request.clone().text());
        if (!isRecord(parsed)) return;

        const headers = new Headers(event.request.headers);
        headers.delete("content-length");
        // Rebuilding from the original Request preserves its signal, referrer, credentials and
        // other fields by spec; only the headers and body change.
        const request = new Request(event.request, {
          method: event.request.method,
          headers,
          body: JSON.stringify(mergeRecords(parsed, pending.body)),
        });
        (event as { request: Request }).request = request;
      } catch (error) {
        // The typed request options still applied. The body override is best-effort because the
        // payload may be compressed or use a protocol whose body is not JSON.
        warnRequest("Failed to apply the request-scoped reasoning variant body", error);
      }
    });

    const controller = new AbortController();
    // `types` exists in newer `SubscribeOptions`; 2.0.32 types omit it even though forwarding the
    // option is harmless there and filters the stream on newer runtimes.
    const subscribe = ctx.event.subscribe as unknown as (options?: {
      signal?: AbortSignal;
      types?: ReadonlyArray<string>;
    }) => ReturnType<typeof ctx.event.subscribe>;
    void (async () => {
      try {
        for await (const event of subscribe({
          signal: controller.signal,
          types: trackedEvents,
        })) {
          try {
            if (event.type === "session.deleted") {
              state.delete(event.data.sessionID);
              continue;
            }
            // The runtime may ignore `types`, so keep the runtime guard as well.
            if (!(idleEvents as ReadonlyArray<string>).includes(event.type)) continue;
            const sessionID = (event as { data: { sessionID: string } }).data.sessionID;
            state.update(sessionID, (entry) => {
              entry.userPending = false;
              entry.idlePending = true;
              entry.lastIdleAt = Date.now();
              delete entry.classifyText;
            });
            await resetOnIdle(sessionID);
          } catch (error) {
            logError("Event handler failed", error);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) logError("Event subscription failed", error);
      }
    })();

    return () => controller.abort();
  },
});

export default AdaptiveThinkingPlugin;

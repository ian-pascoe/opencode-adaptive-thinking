import { tool, type Plugin } from "@opencode-ai/plugin";
import type { Message, Part, Provider } from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { parseConfig } from "./config.js";

const z = tool.schema;
const serviceName = "opencode-adaptive-thinking";
const maxSessionStateSize = 5000;
const stateTtlMs = 7 * 24 * 60 * 60 * 1000;
const historyLimit = 20;
const classifierTimeout = 5000;

type ModelInfo = { providerID: string; modelID: string };
type SessionMessage = { info: Message; parts: Array<Part> };
type SessionState = {
  variant?: string;
  idlePending?: boolean;
  userPending?: boolean;
  lastIdleAt?: number;
  touchedAt?: number;
  reset?: { level: string; agent: string; model?: ModelInfo };
};

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

type PromptAsyncBody = NonNullable<
  Parameters<OpencodeClient["session"]["promptAsync"]>[0]["body"]
> & { variant: string };

export const AdaptiveThinkingPlugin: Plugin = async ({ client }, options) => {
  const logError = (message: string, error: unknown) =>
    client.app.log({
      body: {
        service: serviceName,
        level: "error",
        message: `${message}: ${JSON.stringify(error)}`,
      },
    });

  const parsed = parseConfig(options);
  if ("error" in parsed) {
    if (options?.quiet !== true) {
      client.tui.showToast({
        body: {
          variant: "error",
          message: "Invalid Adaptive Thinking plugin configuration, see logs for details",
        },
      });
    }
    logError("Invalid Adaptive Thinking plugin configuration", parsed.error);
    return {};
  }

  const config = parsed.config;
  if (!config.enabled) return {};

  const classifierSessions = new Set<string>();
  let classifierWarned = false;

  const warnClassifier = (message: string, error?: unknown) => {
    if (classifierWarned) return;
    classifierWarned = true;
    client.app.log({
      body: {
        service: serviceName,
        level: "warn",
        message: error === undefined ? message : `${message}: ${JSON.stringify(error)}`,
      },
    });
  };

  const promptText = (parts: Array<Part>) => {
    if (parts.some((part) => part.type === "text" && (part.ignored || part.synthetic))) return;
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text.length > 0 ? text : undefined;
  };

  const getModelVariants = (model: unknown) => {
    const variants = (model as { variants?: Record<string, unknown> } | undefined)?.variants;
    return Object.keys(variants ?? {});
  };

  let providers: Array<Provider> | undefined;

  const variantsFor = async (model: ModelInfo) => {
    if (!providers) {
      const response = await client.provider.list();
      if (response.error) {
        logError("Failed to retrieve providers", response.error);
        return [];
      }
      providers = (response.data?.all ?? []) as unknown as Array<Provider>;
    }
    const provider = providers.find((candidate) => candidate.id === model.providerID);
    return getModelVariants(provider?.models[model.modelID]);
  };

  const fetchMessages = async (sessionID: string) => {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { limit: historyLimit },
    });
    if (response.error) {
      logError(`Failed to retrieve messages for session ${sessionID}`, response.error);
      return;
    }
    return (response.data ?? []) as Array<SessionMessage>;
  };

  const modelOf = (info: Message): ModelInfo =>
    "model" in info
      ? { providerID: info.model.providerID, modelID: info.model.modelID }
      : { providerID: info.providerID, modelID: info.modelID };

  const latestModel = (messages: Array<SessionMessage>): ModelInfo | undefined => {
    const last = messages.at(-1)?.info;
    return last ? modelOf(last) : undefined;
  };

  const latestVariant = async (messages: Array<SessionMessage>) => {
    let agent: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i]!.info;
      const variant = "model" in info ? info.model.variant : info.variant;
      if (variant) return variant;
      agent ??= info.agent;
    }
    if (!agent) return;

    const response = await client.app.agents();
    if (response.error) {
      logError("Failed to retrieve agents", response.error);
      return;
    }
    const match = response.data?.find((candidate) => candidate.name === agent) as
      | { variant?: string }
      | undefined;
    return match?.variant;
  };

  const messageText = (message: SessionMessage, includeSynthetic = false) =>
    message.parts
      .map((part) =>
        part.type === "text" && !part.ignored && (includeSynthetic || !part.synthetic)
          ? part.text
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();

  const latestSummary = (messages: Array<SessionMessage>) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i]!.info;
      if (info.role === "assistant" && info.summary === true) {
        const text = messageText(messages[i]!, true);
        if (text) return text;
      }
    }
  };

  const buildContext = async (sessionID: string) => {
    const response = await client.session.messages({ path: { id: sessionID } });
    if (response.error) return "";
    const messages = (response.data ?? []) as Array<SessionMessage>;
    const summary = latestSummary(messages);
    if (summary) return summary;
    const since = state.get(sessionID)?.lastIdleAt ?? 0;
    return messages
      .filter((message) => !since || message.info.time.created >= since)
      .map((message) => {
        const text = messageText(message);
        return text ? `${message.info.role}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  };

  const classifyWithModel = async (
    parentID: string,
    text: string,
    variants: Array<string>,
    model: ModelInfo,
    current: string | undefined,
    context: string,
  ) => {
    const created = await (async () => {
      try {
        return await client.session.create({
          body: { parentID, title: "Reasoning effort classifier" },
        });
      } catch {
        return undefined;
      }
    })();
    if (!created || created.error || !created.data) {
      warnClassifier("Failed to create the classifier session", created?.error);
      return;
    }

    const id = created.data.id;
    classifierSessions.add(id);
    try {
      const pending = (async () => {
        try {
          return await client.session.prompt({
            path: { id },
            body: {
              model,
              system: [
                config.systemPrompt.trim(),
                current ? `Current reasoning effort level: ${current}.` : "",
                `Valid reasoning effort levels for this session: ${variants.join(", ")}.`,
                `To change your reasoning effort, use the \`${config.toolName}\` tool with one of the valid levels.`,
                "Only call it when the task complexity justifies changing levels.",
                "Classifier task: choose exactly one of the valid levels for the current message and answer with that word only.",
              ]
                .filter(Boolean)
                .join(" "),
              tools: { "*": false },
              parts: [
                {
                  type: "text",
                  text: `Session context:\n${context || "(none)"}\n\nCurrent message:\n${text}`,
                },
              ],
            },
          });
        } catch {
          return undefined;
        }
      })();
      const response = await Promise.race([
        pending,
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), classifierTimeout),
        ),
      ]);
      if (!response || response.error || !response.data) {
        warnClassifier("The classifier request failed", response?.error);
        return;
      }

      const answer = response.data.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .toLowerCase();
      let best: { index: number; level: string } | undefined;
      for (const level of variants) {
        const escaped = level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`\\b${escaped}\\b`, "i").exec(answer);
        if (match && (!best || match.index < best.index)) best = { index: match.index, level };
      }
      return best?.level;
    } finally {
      classifierSessions.delete(id);
      try {
        await client.session.delete({ path: { id } });
      } catch {}
    }
  };

  const sendVariantPrompt = (
    sessionID: string,
    variant: string,
    text: string,
    agent: string,
    model?: ModelInfo,
  ) =>
    client.session.promptAsync({
      path: { id: sessionID },
      body: {
        noReply: true,
        parts: [{ type: "text", text, synthetic: true, ignored: true }],
        agent,
        variant,
        ...(model ? { model } : {}),
      } as PromptAsyncBody,
    });

  return {
    tool: {
      [config.toolName]: tool({
        description: config.toolDescription,
        args: {
          level: z
            .string()
            .describe(
              "The level of reasoning effort to apply. Higher levels may result in more accurate and thoughtful responses, but may also take more time and resources.",
            ),
          persist: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "Whether to persist the setting for this session, otherwise it will only apply for the remainder of the current turn",
            ),
        },
        execute: async ({ level, persist }, { sessionID, agent }) => {
          if (classifierSessions.has(sessionID)) return "Unavailable in this session.";
          const messages = await fetchMessages(sessionID);
          if (!messages) return "Failed to set reasoning effort: could not read the session";

          const model = latestModel(messages);
          const variants = model ? await variantsFor(model) : [];
          if (variants.length === 0) {
            return "Failed to set reasoning effort: no valid reasoning effort levels are available for this session";
          }
          if (!variants.includes(level)) {
            return `Invalid reasoning effort level: ${level}. Valid levels: ${variants.join(", ")}.`;
          }

          const baseline =
            state.get(sessionID)?.reset?.level ??
            state.get(sessionID)?.variant ??
            (await latestVariant(messages));
          const response = await sendVariantPrompt(
            sessionID,
            level,
            `Reasoning effort set to ${level}`,
            agent,
            model,
          );
          if (response.error) {
            return `Failed to set reasoning effort: ${JSON.stringify(response.error)}`;
          }

          state.update(sessionID, (entry) => {
            entry.variant = level;
            if (persist || !baseline || baseline === level || !variants.includes(baseline)) {
              delete entry.reset;
            } else {
              entry.reset ??= { level: baseline, agent, ...(model ? { model } : {}) };
            }
          });

          return `Reasoning effort set to ${level}`;
        },
      }),
    },
    "chat.message": async ({ sessionID, variant }, { message, parts }) => {
      if (classifierSessions.has(sessionID)) return;

      const text = promptText(parts);
      if (text === undefined) return;

      state.update(sessionID, (entry) => {
        entry.userPending = true;
      });

      if (!config.classifier.enabled || variant) return;
      if (config.triggers !== undefined && !config.triggers.afterUserMessage) return;

      const variants = await variantsFor(message.model);
      if (variants.length === 0) return;

      const current = state.get(sessionID)?.variant;
      const context = await buildContext(sessionID);
      const level = await classifyWithModel(
        sessionID,
        text,
        variants,
        config.classifier.model,
        current,
        context,
      );
      if (!level || !variants.includes(level)) return;

      (message.model as { variant?: string }).variant = level;
      state.update(sessionID, (entry) => {
        entry.variant = level;
      });
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        state.delete(event.properties.info.id);
        return;
      }
      if (event.type !== "session.idle") return;

      const sessionID = event.properties.sessionID;
      if (classifierSessions.has(sessionID)) return;

      state.update(sessionID, (entry) => {
        entry.userPending = false;
        entry.idlePending = true;
        entry.lastIdleAt = Date.now();
      });

      const reset = state.get(sessionID)?.reset;
      if (!reset) return;

      const response = await sendVariantPrompt(
        sessionID,
        reset.level,
        `Reasoning effort reset to ${reset.level}.`,
        reset.agent,
        reset.model,
      );
      if (response.error) {
        logError("Failed to reset reasoning effort on session idle", response.error);
        return;
      }

      state.update(sessionID, (entry) => {
        entry.variant = reset.level;
        delete entry.reset;
      });
    },
    "experimental.chat.system.transform": async ({ sessionID, model }, { system }) => {
      if (!sessionID || classifierSessions.has(sessionID)) return;

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
      if (!inject) return;

      let variants = getModelVariants(model);
      let variant = state.get(sessionID)?.variant;
      if (variant && !variants.includes(variant)) variant = undefined;

      if (variants.length === 0 || !variant) {
        const messages = await fetchMessages(sessionID);
        if (!messages) return;

        if (variants.length === 0) {
          const info = latestModel(messages);
          variants = info ? await variantsFor(info) : [];
          if (variants.length === 0) return;
        }

        if (!variant) {
          const resolved = await latestVariant(messages);
          if (resolved && variants.includes(resolved)) {
            variant = resolved;
            state.update(sessionID, (entry) => {
              entry.variant = resolved;
            });
          }
        }
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

      const existing = system[0];
      system[0] = existing ? `${existing}\n\n${guidance}` : guidance;
    },
  };
};

import { tool, type Plugin } from "@opencode-ai/plugin";
import type { Agent, Message, Model, Part, Provider } from "@opencode-ai/sdk/v2";
import { ConfigSchema } from "./config.js";
import type { OpencodeClient } from "@opencode-ai/sdk";

const z = tool.schema;
const serviceName = "opencode-adaptive-thinking";
const maxSessionStateSize = 500;

type SessionState = {
  currentVariant?: string;
  persistedVariant?: string;
  temporaryResetVariant?: string;
  temporaryResetAgent?: string;
  temporaryResetModel?: { providerID: string; modelID: string };
};

class SessionStateCache {
  private readonly entries = new Map<string, SessionState>();

  constructor(private readonly maxSize: number) {}

  get(sessionID: string) {
    const entry = this.entries.get(sessionID);
    if (!entry) return;

    this.entries.delete(sessionID);
    this.entries.set(sessionID, entry);
    return entry;
  }

  update(sessionID: string, update: (entry: SessionState) => void) {
    const entry = this.get(sessionID) ?? {};
    update(entry);
    this.entries.set(sessionID, entry);

    while (this.entries.size > this.maxSize) {
      const oldestSessionID = this.entries.keys().next().value;
      if (!oldestSessionID) break;
      this.entries.delete(oldestSessionID);
    }
  }
}

const state = new SessionStateCache(maxSessionStateSize);

type PromptAsyncOptions = Parameters<OpencodeClient["session"]["promptAsync"]>[0];
type PromptAsyncBody = NonNullable<PromptAsyncOptions["body"]> & { variant: string };
type ModelInfo = { providerID: string; modelID: string };

export const AdaptiveThinkingPlugin: Plugin = async ({ client }, options) => {
  const configParseResult = ConfigSchema.safeParse(options);
  if (!configParseResult.success) {
    const quiet =
      typeof options === "object" && options !== null && "quiet" in options
        ? options.quiet === true
        : false;
    if (!quiet) {
      client.tui.showToast({
        body: {
          variant: "error",
          message: "Invalid Adaptive Thinking plugin configuration, see logs for details",
        },
      });
    }
    client.app.log({
      body: {
        service: serviceName,
        level: "error",
        message: `Invalid Adaptive Thinking plugin configuration: ${configParseResult.error.message}`,
      },
    });
    return {};
  }

  const config = configParseResult.data;
  if (!config.enabled) return {};

  const getModelVariants = (model: Model | undefined): string[] => {
    const variants = model?.variants;
    if (!variants) return [];
    return Object.keys(variants);
  };

  const sendVariantPrompt = async (
    sessionID: string,
    variant: string,
    text: string,
    agent: string,
    model?: ModelInfo,
    ignored = true,
  ) => {
    const body: PromptAsyncBody = {
      noReply: true,
      parts: [
        {
          type: "text",
          text,
          synthetic: true,
          ignored,
        },
      ],
      agent,
      variant,
    };

    if (model) {
      body.model = model;
    }

    return client.session.promptAsync({
      path: { id: sessionID },
      body,
    });
  };

  const resolveValidVariants = async (sessionID: string, model?: Model): Promise<string[]> => {
    const inputModelVariants = getModelVariants(model);
    if (inputModelVariants.length > 0) return inputModelVariants;

    const messagesResponse = await client.session.messages({
      path: { id: sessionID },
    });
    if (messagesResponse.error) {
      client.app.log({
        body: {
          service: serviceName,
          level: "error",
          message: `Failed to retrieve messages for session ${sessionID}: ${JSON.stringify(messagesResponse.error.data)}`,
        },
      });
      return [];
    }
    const modelInfo = resolveLatestModelInfo(messagesResponse.data);
    if (!modelInfo) return [];

    const providers = await client.provider.list();
    if (providers.error) {
      client.app.log({
        body: {
          service: serviceName,
          level: "error",
          message: `Failed to retrieve providers for session ${sessionID}: ${JSON.stringify(providers.error)}`,
        },
      });
      return [];
    }
    const provider = providers.data?.all.find((p) => p.id === modelInfo.providerID) as
      | Provider
      | undefined;
    if (!provider) return [];

    return getModelVariants(provider.models[modelInfo.modelID] as Model | undefined);
  };

  const resolveLatestModelInfo = (
    data: unknown,
  ): { providerID: string; modelID: string } | undefined => {
    const messages = data as Array<{ info: Message; parts: Array<Part> }>;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if ("model" in message.info) {
        const { providerID, modelID } = message.info.model;
        if (providerID && modelID) {
          return { providerID, modelID };
        }
      }
    }
    return;
  };

  const resolveCurrentVariant = async (sessionID: string): Promise<string | undefined> => {
    const messagesResponse = await client.session.messages({
      path: { id: sessionID },
    });
    if (messagesResponse.error) {
      client.app.log({
        body: {
          service: serviceName,
          level: "error",
          message: `Failed to retrieve messages for session ${sessionID}: ${JSON.stringify(messagesResponse.error.data)}`,
        },
      });
      return;
    }
    let agentName: string | undefined;
    const messages = messagesResponse.data as Array<{ info: Message; parts: Array<Part> }>;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if ("model" in message.info && message.info.model.variant) {
        return message.info.model.variant;
      }
      agentName ??= message.info.agent;
    }

    if (!agentName) return;

    const agentsResponse = await client.app.agents();
    if (agentsResponse.error) {
      client.app.log({
        body: {
          service: serviceName,
          level: "error",
          message: `Failed to retrieve agents for session ${sessionID}: ${JSON.stringify(agentsResponse.error)}`,
        },
      });
      return;
    }
    const agents = agentsResponse.data;
    const agent = agents?.find((a) => a.name === agentName) as Agent | undefined;
    return agent?.variant;
  };

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
          const validVariants = await resolveValidVariants(sessionID);
          if (validVariants.length === 0) {
            return "Failed to set reasoning effort: no valid reasoning effort levels are available for this session";
          }
          if (!validVariants.includes(level)) {
            return `Invalid reasoning effort level: ${level}. Valid levels: ${validVariants.join(", ")}.`;
          }

          const sessionState = state.get(sessionID);
          const resetVariant = persist
            ? undefined
            : (sessionState?.persistedVariant ?? (await resolveCurrentVariant(sessionID)));
          const currentModel = resolveLatestModelInfo(
            (await client.session.messages({ path: { id: sessionID } })).data,
          );

          const promptResponse = await sendVariantPrompt(
            sessionID,
            level,
            `Reasoning effort set to ${level}`,
            agent,
            currentModel,
          );
          if (promptResponse.error) {
            return `Failed to set reasoning effort: ${JSON.stringify(promptResponse.error.data)}`;
          }

          state.update(sessionID, (entry) => {
            entry.currentVariant = level;
            if (persist) {
              entry.persistedVariant = level;
              delete entry.temporaryResetVariant;
              delete entry.temporaryResetAgent;
              delete entry.temporaryResetModel;
            } else if (resetVariant && resetVariant !== level) {
              entry.temporaryResetVariant = resetVariant;
              entry.temporaryResetAgent = agent;
              if (currentModel) {
                entry.temporaryResetModel = currentModel;
              } else {
                delete entry.temporaryResetModel;
              }
            } else {
              delete entry.temporaryResetVariant;
              delete entry.temporaryResetAgent;
              delete entry.temporaryResetModel;
            }
          });

          return `Reasoning effort set to ${level}`;
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        const sessionState = state.get(sessionID);
        const resetVariant = sessionState?.temporaryResetVariant;
        const resetAgent = sessionState?.temporaryResetAgent;
        const resetModel = sessionState?.temporaryResetModel;
        if (!resetVariant || !resetAgent) return;

        const promptResponse = await sendVariantPrompt(
          sessionID,
          resetVariant,
          `Reasoning effort reset to ${resetVariant}.`,
          resetAgent,
          resetModel,
        );
        if (promptResponse.error) {
          client.app.log({
            body: {
              service: serviceName,
              level: "error",
              message: `Failed to reset reasoning effort on session idle: ${JSON.stringify(promptResponse.error.data)}`,
            },
          });
          return;
        }

        state.update(sessionID, (entry) => {
          entry.currentVariant = resetVariant;
          delete entry.temporaryResetVariant;
          delete entry.temporaryResetAgent;
          delete entry.temporaryResetModel;
        });
        return;
      }
    },
    "experimental.chat.system.transform": async ({ sessionID, model }, { system }) => {
      if (!sessionID) return;

      const variants = await resolveValidVariants(sessionID, model as Model);
      if (variants.length === 0) return;

      const sessionState = state.get(sessionID);
      const cachedVariant = sessionState?.currentVariant ?? sessionState?.persistedVariant;
      let variant = cachedVariant && variants.includes(cachedVariant) ? cachedVariant : undefined;
      if (!variant) {
        const resolvedVariant = await resolveCurrentVariant(sessionID);
        if (resolvedVariant && variants.includes(resolvedVariant)) {
          variant = resolvedVariant;
          state.update(sessionID, (entry) => {
            entry.currentVariant = resolvedVariant;
          });
        }
      }

      system.push(
        config.systemPrompt.trim() +
          " " +
          (variant ? `Current reasoning effort level: ${variant}. ` : "") +
          `Valid reasoning effort levels for this session: ${variants.join(", ")}. ` +
          `To change your reasoning effort, use the \`${config.toolName}\` tool with one of the valid levels. ` +
          "Only call it when the task complexity justifies changing levels.",
      );
    },
  };
};

import { tool, type Plugin } from "@opencode-ai/plugin";
import type { Agent, Message, Model, Part, Provider } from "@opencode-ai/sdk/v2";
import { ConfigSchema } from "./config.js";

const z = tool.schema;
const serviceName = "opencode-adaptive-thinking";
const maxSessionStateSize = 500;

type SessionState = {
  currentVariant?: string;
  persistedVariant?: string;
  temporaryResetVariant?: string;
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

export const AdaptiveThinkingPlugin: Plugin = async ({ client }, options) => {
  type PromptAsyncOptions = Parameters<typeof client.session.promptAsync>[0];
  type PromptAsyncBody = NonNullable<PromptAsyncOptions["body"]> & { variant: string };

  const configParseResult = ConfigSchema.safeParse(options);
  if (!configParseResult.success) {
    client.tui.showToast({
      body: {
        variant: "error",
        message: "Invalid Adaptive Thinking plugin configuration, see logs for details",
      },
    });
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
      variant,
    };

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
    let modelInfo: { providerID: string; modelID: string } | undefined;
    const messages = messagesResponse.data as Array<{ info: Message; parts: Array<Part> }>;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if ("model" in message.info) {
        modelInfo = message.info.model;
        break;
      }
    }

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
      agentName = message.info.agent;
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
        execute: async ({ level, persist }, { sessionID }) => {
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

          const promptResponse = await sendVariantPrompt(
            sessionID,
            level,
            `Reasoning effort set to ${level}`,
          );
          if (promptResponse.error) {
            return `Failed to set reasoning effort: ${JSON.stringify(promptResponse.error.data)}`;
          }

          state.update(sessionID, (entry) => {
            entry.currentVariant = level;
            if (persist) {
              entry.persistedVariant = level;
              delete entry.temporaryResetVariant;
            } else if (resetVariant && resetVariant !== level) {
              entry.temporaryResetVariant = resetVariant;
            } else {
              delete entry.temporaryResetVariant;
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
        if (!resetVariant) return;

        const promptResponse = await sendVariantPrompt(
          sessionID,
          resetVariant,
          `Reasoning effort reset to ${resetVariant}.`,
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
        });
        return;
      }
    },
    "experimental.chat.system.transform": async ({ sessionID, model }, { system }) => {
      if (!sessionID) return;

      const variants = await resolveValidVariants(sessionID, model as Model);
      if (variants.length === 0) return;

      const sessionState = state.get(sessionID);
      let variant = sessionState?.currentVariant ?? sessionState?.persistedVariant;
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

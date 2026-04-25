import { tool, type Plugin } from "@opencode-ai/plugin";
import type { Agent, Message, Model, Part, Provider } from "@opencode-ai/sdk/v2";

const z = tool.schema;

const state = {
  currentVariant: new Map<string, string>(),
  persistedVariant: new Map<string, string>(),
  temporaryResetVariant: new Map<string, string>(),
};

export const AdaptiveThinkingPlugin: Plugin = async ({ client }) => {
  type PromptAsyncOptions = Parameters<typeof client.session.promptAsync>[0];
  type PromptAsyncBody = NonNullable<PromptAsyncOptions["body"]> & { variant: string };

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
          service: "opencode-adaptive-thinking",
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
          service: "opencode-adaptive-thinking",
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
          service: "opencode-adaptive-thinking",
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
          service: "opencode-adaptive-thinking",
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
      set_reasoning_effort: tool({
        description: "Set your reasoning effort",
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

          const resetVariant = persist
            ? undefined
            : (state.persistedVariant.get(sessionID) ?? (await resolveCurrentVariant(sessionID)));

          const promptResponse = await sendVariantPrompt(
            sessionID,
            level,
            `Reasoning effort set to ${level}`,
          );
          if (promptResponse.error) {
            return `Failed to set reasoning effort: ${JSON.stringify(promptResponse.error.data)}`;
          }

          state.currentVariant.set(sessionID, level);
          if (persist) {
            state.persistedVariant.set(sessionID, level);
            state.temporaryResetVariant.delete(sessionID);
          } else if (resetVariant && resetVariant !== level) {
            state.temporaryResetVariant.set(sessionID, resetVariant);
          } else {
            state.temporaryResetVariant.delete(sessionID);
          }

          return `Reasoning effort set to ${level}`;
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        const resetVariant = state.temporaryResetVariant.get(sessionID);
        if (!resetVariant) return;

        const promptResponse = await sendVariantPrompt(
          sessionID,
          resetVariant,
          `Reasoning effort reset to ${resetVariant}.`,
        );
        if (promptResponse.error) {
          client.app.log({
            body: {
              service: "opencode-adaptive-thinking",
              level: "error",
              message: `Failed to reset reasoning effort on session idle: ${JSON.stringify(promptResponse.error.data)}`,
            },
          });
          return;
        }

        state.currentVariant.set(sessionID, resetVariant);
        state.temporaryResetVariant.delete(sessionID);
        return;
      }
    },
    "experimental.chat.system.transform": async ({ sessionID, model }, { system }) => {
      if (!sessionID) return;

      const variants = await resolveValidVariants(sessionID, model as Model);
      if (variants.length === 0) return;

      let variant = state.currentVariant.get(sessionID) ?? state.persistedVariant.get(sessionID);
      if (!variant) {
        variant = await resolveCurrentVariant(sessionID);
        if (variant && variants.includes(variant)) {
          state.currentVariant.set(sessionID, variant);
        }
      }

      system.push(
        "You MUST manage reasoning effort actively. " +
          "Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. " +
          "Reassess at turn start, after meaningful new evidence, and when the task shifts. " +
          "NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift. " +
          (variant ? `Current reasoning effort level: ${variant}. ` : "") +
          `Valid reasoning effort levels for this session: ${variants.join(", ")}. ` +
          `To change your reasoning effort, use the \`set_reasoning_effort\` tool with one of the valid levels. ` +
          "Only call it when the task complexity justifies changing levels.",
      );
    },
  };
};

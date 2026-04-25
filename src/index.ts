import { tool, type Plugin } from "@opencode-ai/plugin";

const z = tool.schema;

export const AdaptiveThinkingPlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      set_readoning_effort: tool({
        description: "Set your reasoning effort",
        args: {
          level: z.enum(["none", "low", "medium", "high", "xhigh"]),
        },
        execute: async ({ level }, { sessionID }) => {
          const sendMessageResponse = await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              noReply: true,
              parts: [
                {
                  type: "text",
                  text: `Reasoning effort set to ${level}`,
                  synthetic: true,
                },
              ],
              // @ts-expect-error - Variant is a valid property
              variant: level,
            },
          });
          if (sendMessageResponse.error) {
            return `Failed to set reasoning effort: ${JSON.stringify(sendMessageResponse.error.data)}`;
          }
          return `Reasoning effort set to ${level}`;
        },
      }),
    },
  };
};

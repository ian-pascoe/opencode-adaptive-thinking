import { describe, expect, test, vi } from "vitest";
import { AdaptiveThinkingPlugin } from "./index";

const variants = {
  none: {},
  low: {},
  medium: {},
  high: {},
  xhigh: {},
};

const createClient = (sessionID: string, messages: Array<unknown> = []) => {
  const promptAsync = vi.fn(async () => ({ error: undefined }));

  return {
    client: {
      session: {
        messages: vi.fn(async () => ({ data: messages, error: undefined })),
        promptAsync,
      },
      provider: {
        list: vi.fn(async () => ({
          data: {
            all: [
              {
                id: "provider",
                models: {
                  model: { variants },
                },
              },
            ],
          },
          error: undefined,
        })),
      },
      app: {
        agents: vi.fn(async () => ({ data: [], error: undefined })),
        log: vi.fn(),
      },
    },
    toolContext: {
      sessionID,
      messageID: "message",
      agent: "agent",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: vi.fn(),
      ask: vi.fn(),
    },
  };
};

const createMessage = (variant = "medium") => ({
  info: {
    id: "message",
    role: "user",
    agent: "agent",
    model: {
      providerID: "provider",
      modelID: "model",
      variant,
    },
  },
  parts: [],
});

const setReasoningEffort = async (
  plugin: Awaited<ReturnType<typeof AdaptiveThinkingPlugin>>,
  args: { level: string; persist: boolean },
  context: unknown,
) => plugin.tool!["set_reasoning_effort"]!.execute(args, context as never);

describe("AdaptiveThinkingPlugin", () => {
  test("resets a temporary reasoning effort once and keeps the reset prompt ignored", async () => {
    const sessionID = "temporary-reset";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);

    await setReasoningEffort(plugin, { level: "low", persist: false }, toolContext);
    await plugin.event!({
      event: { type: "session.idle", properties: { sessionID } },
    } as never);
    await plugin.event!({
      event: { type: "session.idle", properties: { sessionID } },
    } as never);

    expect(client.session.promptAsync).toHaveBeenCalledTimes(2);
    const promptCalls = client.session.promptAsync.mock.calls as Array<Array<unknown>>;
    const secondPrompt = promptCalls[1]?.[0];
    expect(secondPrompt).toMatchObject({
      body: {
        variant: "medium",
        parts: [{ ignored: true, synthetic: true }],
      },
    });
  });

  test("does not reset persisted reasoning effort on idle", async () => {
    const sessionID = "persisted-effort";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);

    await setReasoningEffort(plugin, { level: "high", persist: true }, toolContext);
    await plugin.event!({
      event: { type: "session.idle", properties: { sessionID } },
    } as never);

    expect(client.session.promptAsync).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid reasoning effort levels before prompting", async () => {
    const sessionID = "invalid-level";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);

    const result = await setReasoningEffort(
      plugin,
      { level: "extreme", persist: true },
      toolContext,
    );

    expect(result).toContain("Invalid reasoning effort level");
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  test("uses the transform model to inject guidance for a new session", async () => {
    const sessionID = "new-session";
    const { client } = createClient(sessionID, []);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);
    const system: string[] = [];

    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(system).toHaveLength(1);
    expect(system[0]).toContain("Valid reasoning effort levels");
    expect(system[0]).toContain("low, medium, high");
  });

  test("adds a single non-duplicative system guidance entry", async () => {
    const sessionID = "system-guidance";
    const { client } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);
    const system: string[] = [];

    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(system).toHaveLength(1);
    expect(system[0]).toContain("Current reasoning effort level: medium");
    expect(system[0]).not.toContain("Remember to adjust your reasoning effort");
  });
});

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
      tui: {
        showToast: vi.fn(),
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
  toolName = "set_reasoning_effort",
) => plugin.tool![toolName]!.execute(args, context as never);

describe("AdaptiveThinkingPlugin", () => {
  test("returns no hooks when disabled", async () => {
    const { client } = createClient("disabled-plugin");
    const plugin = await AdaptiveThinkingPlugin({ client } as never, { enabled: false });

    expect(plugin).toEqual({});
  });

  test("logs configuration errors without creating hooks", async () => {
    const { client } = createClient("invalid-config");
    const plugin = await AdaptiveThinkingPlugin({ client } as never, { enabled: "yes" });

    expect(plugin).toEqual({});
    expect(client.tui.showToast).toHaveBeenCalledWith({
      body: {
        variant: "error",
        message: "Invalid Adaptive Thinking plugin configuration, see logs for details",
      },
    });
    expect(client.app.log).toHaveBeenCalledWith({
      body: expect.objectContaining({
        level: "error",
        service: "opencode-adaptive-thinking",
        message: expect.stringContaining("Invalid Adaptive Thinking plugin configuration"),
      }),
    });
  });

  test("keeps log service name internal", async () => {
    const sessionID = "fixed-service-name";
    const { client, toolContext } = createClient(sessionID);
    client.session.messages.mockResolvedValueOnce({
      error: { data: { message: "unavailable" } },
    } as never);
    const plugin = await AdaptiveThinkingPlugin({ client } as never, {
      serviceName: "custom-service",
    });

    await setReasoningEffort(plugin, { level: "low", persist: false }, toolContext);

    expect(client.app.log).toHaveBeenCalledWith({
      body: expect.objectContaining({
        service: "opencode-adaptive-thinking",
      }),
    });
  });

  test("uses configured tool name and description", async () => {
    const sessionID = "custom-tool";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never, {
      toolName: "adjust_reasoning",
      toolDescription: "Adjust reasoning depth for the next response",
    });

    expect(plugin.tool?.set_reasoning_effort).toBeUndefined();
    expect(plugin.tool?.adjust_reasoning?.description).toBe(
      "Adjust reasoning depth for the next response",
    );

    await setReasoningEffort(
      plugin,
      { level: "high", persist: true },
      toolContext,
      "adjust_reasoning",
    );

    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ variant: "high" }) }),
    );
  });

  test("uses configured system prompt guidance", async () => {
    const sessionID = "custom-system-prompt";
    const { client } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never, {
      systemPrompt: "Prefer the cheapest reasoning level that can safely complete the task.",
    });
    const system: string[] = [];

    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(system).toHaveLength(1);
    expect(system[0]).toContain(
      "Prefer the cheapest reasoning level that can safely complete the task.",
    );
    expect(system[0]).not.toContain("You MUST manage reasoning effort actively");
  });

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
});

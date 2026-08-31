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

const createAgentMessage = (agent: string) => ({
  info: {
    id: `message-${agent}`,
    role: "user",
    agent,
  },
  parts: [],
});

const setReasoningEffort = async (
  plugin: Awaited<ReturnType<typeof AdaptiveThinkingPlugin>>,
  args: { level: string; persist: boolean },
  context: unknown,
  toolName = "set_reasoning_effort",
) => plugin.tool![toolName]!.execute(args, context as never);

const touchTemporarySession = async (sessionID: string) => {
  const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
  const plugin = await AdaptiveThinkingPlugin({ client } as never);

  await setReasoningEffort(plugin, { level: "low", persist: false }, toolContext);

  return { client, plugin };
};

describe("AdaptiveThinkingPlugin", () => {
  test("uses defaults when no options are provided", async () => {
    const sessionID = "default-options";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);
    const system: string[] = [];

    await setReasoningEffort(plugin, { level: "high", persist: true }, toolContext);
    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(plugin.tool?.set_reasoning_effort?.description).toBe("Set your reasoning effort");
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ variant: "high" }) }),
    );
    expect(system[0]).toContain("You MUST manage reasoning effort actively");
    expect(system[0]).toContain("set_reasoning_effort");
  });

  test("preserves the calling agent and model when setting reasoning effort", async () => {
    const sessionID = "preserve-agent-model";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    toolContext.agent = "custom-worker";
    const plugin = await AdaptiveThinkingPlugin({ client } as never);

    await setReasoningEffort(plugin, { level: "high", persist: true }, toolContext);

    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent: "custom-worker",
          model: { providerID: "provider", modelID: "model" },
          variant: "high",
        }),
      }),
    );
  });

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

  test("suppresses configuration error toast when quiet is enabled", async () => {
    const { client } = createClient("quiet-invalid-config");
    const plugin = await AdaptiveThinkingPlugin({ client } as never, {
      enabled: "yes",
      quiet: true,
    });

    expect(plugin).toEqual({});
    expect(client.tui.showToast).not.toHaveBeenCalled();
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

  test("ignores cached reasoning effort when it is invalid for the current model", async () => {
    const sessionID = "stale-cached-variant";
    const switchedModelVariants = {
      low: {},
      medium: {},
    };
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);
    const system: string[] = [];

    await setReasoningEffort(plugin, { level: "high", persist: true }, toolContext);
    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants: switchedModelVariants },
      } as never,
      { system },
    );

    expect(system[0]).toContain("Current reasoning effort level: medium.");
    expect(system[0]).toContain("Valid reasoning effort levels for this session: low, medium.");
    expect(system[0]).not.toContain("Current reasoning effort level: high.");
  });

  test("falls back to the newest agent variant when messages do not expose a model variant", async () => {
    const sessionID = "newest-agent-fallback";
    const { client } = createClient(sessionID, [
      createAgentMessage("old-agent"),
      createAgentMessage("new-agent"),
    ]);
    client.app.agents.mockResolvedValueOnce({
      data: [
        { name: "old-agent", variant: "high" },
        { name: "new-agent", variant: "low" },
      ],
      error: undefined,
    } as never);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);
    const system: string[] = [];

    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(system[0]).toContain("Current reasoning effort level: low.");
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
        agent: "agent",
        model: { providerID: "provider", modelID: "model" },
        variant: "medium",
        parts: [{ ignored: true, synthetic: true }],
      },
    });
  });

  test("evicts oldest session state when the cache is full", async () => {
    const oldest = await touchTemporarySession("lru-oldest");

    for (let i = 0; i < 500; i++) {
      await touchTemporarySession(`lru-session-${i}`);
    }

    await oldest.plugin.event!({
      event: { type: "session.idle", properties: { sessionID: "lru-oldest" } },
    } as never);

    expect(oldest.client.session.promptAsync).toHaveBeenCalledTimes(1);
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

  test("handles provider lookup failure without prompting", async () => {
    const sessionID = "provider-lookup-failure";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    client.provider.list.mockResolvedValueOnce({
      error: { data: { message: "provider unavailable" } },
    } as never);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);

    const result = await setReasoningEffort(plugin, { level: "high", persist: true }, toolContext);

    expect(result).toContain("no valid reasoning effort levels");
    expect(client.session.promptAsync).not.toHaveBeenCalled();
    expect(client.app.log).toHaveBeenCalledWith({
      body: expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Failed to retrieve providers"),
      }),
    });
  });

  test("retries a failed temporary reset and clears it after a later success", async () => {
    const sessionID = "recoverable-reset-failure";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    client.session.promptAsync
      .mockResolvedValueOnce({ error: undefined } as never)
      .mockResolvedValueOnce({ error: { data: { message: "reset failed" } } } as never)
      .mockResolvedValueOnce({ error: undefined } as never);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);

    await setReasoningEffort(plugin, { level: "low", persist: false }, toolContext);
    await plugin.event!({
      event: { type: "session.idle", properties: { sessionID } },
    } as never);
    await plugin.event!({
      event: { type: "session.idle", properties: { sessionID } },
    } as never);
    await plugin.event!({
      event: { type: "session.idle", properties: { sessionID } },
    } as never);

    expect(client.session.promptAsync).toHaveBeenCalledTimes(3);
    expect(client.app.log).toHaveBeenCalledWith({
      body: expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Failed to reset reasoning effort"),
      }),
    });
  });

  test("merges adaptive guidance into an existing system prompt", async () => {
    const sessionID = "merge-existing-system-prompt";
    const { client } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never);
    const existing = "You are a helpful coding assistant.";
    const system: string[] = [existing];

    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(system).toHaveLength(1);
    expect(system[0]).toContain(existing);
    expect(system[0]).toContain(`${existing}\n\n`);
    expect(system[0]).toContain("You MUST manage reasoning effort actively");
    expect(system[0]).toContain("set_reasoning_effort");
  });

  test("injects adaptive guidance when no system prompt exists", async () => {
    const sessionID = "inject-empty-system-prompt";
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
    expect(system[0]).toContain("You MUST manage reasoning effort actively");
    expect(system[0]).toContain("set_reasoning_effort");
  });

  test("preserves variant details and tool name when merging into an existing prompt", async () => {
    const sessionID = "merge-variant-details";
    const { client, toolContext } = createClient(sessionID, [createMessage("medium")]);
    const plugin = await AdaptiveThinkingPlugin({ client } as never, {
      toolName: "adjust_reasoning",
    });
    const existing = "Base system instructions.";
    const system: string[] = [existing];

    await setReasoningEffort(
      plugin,
      { level: "high", persist: true },
      toolContext,
      "adjust_reasoning",
    );
    await plugin["experimental.chat.system.transform"]!(
      {
        sessionID,
        model: { variants },
      } as never,
      { system },
    );

    expect(system).toHaveLength(1);
    expect(system[0]).toContain(existing);
    expect(system[0]).toContain("Current reasoning effort level: high.");
    expect(system[0]).toContain(
      "Valid reasoning effort levels for this session: none, low, medium, high, xhigh.",
    );
    expect(system[0]).toContain("adjust_reasoning");
  });
});

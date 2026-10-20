import { describe, expect, test, vi } from "vitest";
import { AdaptiveThinkingPlugin } from "./index";

const variants = { none: {}, low: {}, medium: {}, high: {}, xhigh: {} };

const message = (variant?: string, agent = "agent") => ({
  info: {
    role: "user",
    agent,
    model: { providerID: "provider", modelID: "model", ...(variant ? { variant } : {}) },
  },
  parts: [],
});

const assistant = (variant?: string) => ({
  info: {
    role: "assistant",
    agent: "agent",
    providerID: "provider",
    modelID: "model",
    ...(variant ? { variant } : {}),
  },
  parts: [],
});

const createClient = (
  messages: Array<any> = [],
  modelVariants: Record<string, object> = variants,
  agents: Record<string, string> = {},
) => {
  const prompts: Array<any> = [];
  const client = {
    session: {
      messages: vi.fn(async () => ({ data: messages, error: undefined })),
      promptAsync: vi.fn(async ({ body }: any) => {
        prompts.push(body);
        messages.push(message(body.variant));
        return { error: undefined };
      }),
      create: vi.fn(async () => ({ data: { id: "classifier" }, error: undefined })),
      prompt: vi.fn(async () => ({
        data: { parts: [{ type: "text", text: "high" }] },
        error: undefined,
      })),
      delete: vi.fn(async () => ({ data: true, error: undefined })),
    },
    provider: {
      list: vi.fn(async () => ({
        data: {
          all: [{ id: "provider", models: { model: { variants: modelVariants } } }],
        },
        error: undefined,
      })),
    },
    app: {
      agents: vi.fn(async () => ({
        data: Object.entries(agents).map(([name, variant]) => ({ name, variant })),
        error: undefined,
      })),
      log: vi.fn(),
    },
    tui: { showToast: vi.fn() },
  };
  return { client, prompts };
};

const ctx = (sessionID: string, agent = "agent") => ({ sessionID, agent });

const set = (plugin: any, level: string, persist: boolean, sessionID: string) =>
  plugin.tool.set_reasoning_effort.execute({ level, persist }, ctx(sessionID));

const say = async (
  plugin: any,
  sessionID: string,
  text: string,
  extra: Record<string, unknown> = {},
) => {
  const user = message().info;
  await plugin["chat.message"](
    { sessionID, model: { providerID: "provider", modelID: "model" }, ...extra },
    { message: user, parts: [{ type: "text", text }] },
  );
  return user;
};

const idle = (plugin: any, sessionID: string) =>
  plugin.event({ event: { type: "session.idle", properties: { sessionID } } });

const transform = (
  plugin: any,
  sessionID: string,
  system: Array<string>,
  model: any = { variants },
) => plugin["experimental.chat.system.transform"]({ sessionID, model }, { system });

describe("AdaptiveThinkingPlugin", () => {
  test("applies defaults, persists a level and preserves agent and model", async () => {
    const { client, prompts } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    expect(plugin.tool.set_reasoning_effort.description).toBe("Set your reasoning effort");
    expect(await set(plugin, "high", true, "defaults")).toBe("Reasoning effort set to high");
    expect(prompts[0]).toMatchObject({
      agent: "agent",
      variant: "high",
      model: { providerID: "provider", modelID: "model" },
    });

    const system: Array<string> = [];
    await transform(plugin, "defaults", system);
    expect(system[0]).toContain("You MUST manage reasoning effort actively");
    expect(system[0]).toContain("Current reasoning effort level: high.");
    expect(system[0]).toContain(
      "Valid reasoning effort levels for this session: none, low, medium, high, xhigh.",
    );
    expect(system[0]).toContain("set_reasoning_effort");
  });

  test("honors custom configuration and merges into an existing system prompt", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      toolName: "adjust_reasoning",
      toolDescription: "Adjust it",
      systemPrompt: "Prefer cheap.",
    });

    expect(plugin.tool.adjust_reasoning.description).toBe("Adjust it");
    expect(plugin.tool.set_reasoning_effort).toBeUndefined();

    const system = ["Base prompt."];
    await transform(plugin, "custom", system);
    expect(system).toHaveLength(1);
    expect(system[0]?.startsWith("Base prompt.\n\nPrefer cheap.")).toBe(true);
    expect(system[0]).not.toContain("You MUST manage");
    expect(system[0]).toContain("adjust_reasoning");
  });

  test("returns no hooks when disabled", async () => {
    const { client } = createClient();
    expect(await AdaptiveThinkingPlugin({ client } as never, { enabled: false })).toEqual({});
  });

  test("reports invalid configuration and suppresses the toast when quiet", async () => {
    const invalid = createClient();
    expect(
      await AdaptiveThinkingPlugin({ client: invalid.client } as never, { enabled: "yes" }),
    ).toEqual({});
    expect(invalid.client.tui.showToast).toHaveBeenCalledWith({
      body: {
        variant: "error",
        message: expect.stringContaining("Invalid Adaptive Thinking plugin configuration"),
      },
    });
    expect(invalid.client.app.log).toHaveBeenCalledWith({
      body: expect.objectContaining({
        level: "error",
        message: expect.stringContaining("enabled must be a boolean"),
      }),
    });

    const quiet = createClient();
    await AdaptiveThinkingPlugin({ client: quiet.client } as never, {
      enabled: "yes",
      quiet: true,
    });
    expect(quiet.client.tui.showToast).not.toHaveBeenCalled();
  });

  test("rejects an invalid level without prompting", async () => {
    const { client, prompts } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    expect(await set(plugin, "extreme", true, "invalid-level")).toContain(
      "Invalid reasoning effort level",
    );
    expect(prompts).toHaveLength(0);
  });

  test("reports models without reasoning variants", async () => {
    const { client, prompts } = createClient([message("medium")], {});
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    expect(await set(plugin, "high", true, "no-variants")).toContain(
      "no valid reasoning effort levels",
    );
    expect(prompts).toHaveLength(0);
  });

  test("resets a temporary level to the level from the session history", async () => {
    const { client, prompts } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    await set(plugin, "low", false, "temporary");
    await idle(plugin, "temporary");

    expect(prompts.map((prompt) => prompt.variant)).toEqual(["low", "medium"]);
    expect(prompts[1]).toMatchObject({
      agent: "agent",
      model: { providerID: "provider", modelID: "model" },
      parts: [{ synthetic: true, ignored: true }],
    });
  });

  test("reads the model and variant from assistant messages", async () => {
    const { client, prompts } = createClient([message("medium"), assistant("high")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    await set(plugin, "low", false, "assistant-shape");
    await idle(plugin, "assistant-shape");

    expect(prompts[0].model).toEqual({ providerID: "provider", modelID: "model" });
    expect(prompts.map((prompt) => prompt.variant)).toEqual(["low", "high"]);
  });

  test("keeps the original baseline across repeated temporary changes", async () => {
    const changed = createClient([message("medium")]);
    const changedPlugin: any = await AdaptiveThinkingPlugin({ client: changed.client } as never);
    await set(changedPlugin, "low", false, "repeat-different");
    await set(changedPlugin, "high", false, "repeat-different");
    await idle(changedPlugin, "repeat-different");

    const repeated = createClient([message("medium")]);
    const repeatedPlugin: any = await AdaptiveThinkingPlugin({ client: repeated.client } as never);
    await set(repeatedPlugin, "low", false, "repeat-same");
    await set(repeatedPlugin, "low", false, "repeat-same");
    await idle(repeatedPlugin, "repeat-same");

    expect(changed.prompts.map((prompt) => prompt.variant)).toEqual(["low", "high", "medium"]);
    expect(repeated.prompts.map((prompt) => prompt.variant)).toEqual(["low", "low", "medium"]);
  });

  test("keeps a temporary reset pending after a failed attempt", async () => {
    const { client } = createClient([message("medium")]);
    client.session.promptAsync
      .mockResolvedValueOnce({ error: undefined })
      .mockResolvedValueOnce({ error: { data: { message: "unavailable" } } } as never)
      .mockResolvedValueOnce({ error: undefined });
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    await set(plugin, "low", false, "reset-retry");
    await idle(plugin, "reset-retry");
    await idle(plugin, "reset-retry");

    expect(client.session.promptAsync.mock.calls.map(([call]: any) => call.body.variant)).toEqual([
      "low",
      "medium",
      "medium",
    ]);
    expect(client.app.log).toHaveBeenCalled();
  });

  test("reports a provider lookup failure without prompting", async () => {
    const { client, prompts } = createClient([message("medium")]);
    client.provider.list.mockResolvedValueOnce({
      data: undefined,
      error: { message: "down" },
    } as never);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    expect(await set(plugin, "high", true, "provider-failure")).toContain(
      "no valid reasoning effort levels",
    );
    expect(prompts).toHaveLength(0);
    expect(client.app.log).toHaveBeenCalled();
  });

  test("does not reset a persisted level on idle", async () => {
    const { client, prompts } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    await set(plugin, "high", true, "persisted");
    await idle(plugin, "persisted");
    expect(prompts).toHaveLength(1);
  });

  test("returns an error instead of throwing when messages cannot be read", async () => {
    const { client } = createClient([message("medium")]);
    client.session.messages.mockResolvedValueOnce({
      data: undefined,
      error: { data: { message: "unavailable" } },
    } as never);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    expect(await set(plugin, "high", true, "fetch-failure")).toContain(
      "could not read the session",
    );
    expect(client.app.log).toHaveBeenCalled();
  });

  test("ignores a cached level that the current model does not support", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);
    await set(plugin, "high", true, "stale-cache");

    const system: Array<string> = [];
    await transform(plugin, "stale-cache", system, { variants: { low: {}, medium: {} } });
    expect(system[0]).toContain("Valid reasoning effort levels for this session: low, medium.");
    expect(system[0]).not.toContain("Current reasoning effort level: high.");
  });

  test("falls back to the agent variant when history has none", async () => {
    const { client } = createClient([message(undefined, "worker")], variants, { worker: "low" });
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    const system: Array<string> = [];
    await transform(plugin, "agent-fallback", system, {});
    expect(system[0]).toContain("Current reasoning effort level: low.");
  });

  test("drops session state when the session is deleted", async () => {
    const { client, prompts } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never);

    await set(plugin, "low", false, "deleted-session");
    await plugin.event({
      event: { type: "session.deleted", properties: { info: { id: "deleted-session" } } },
    } as never);
    await idle(plugin, "deleted-session");

    expect(prompts).toHaveLength(1);
  });

  test("injects guidance once per user turn when afterUserMessage is set", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      triggers: { afterIdle: false, afterUserMessage: true },
    });

    await say(plugin, "guidance-user", "hello");
    const first = new Array<string>();
    await transform(plugin, "guidance-user", first);
    expect(first).toHaveLength(1);

    const second = new Array<string>();
    await transform(plugin, "guidance-user", second);
    expect(second).toHaveLength(0);
  });

  test("injects guidance after idle when afterIdle is set", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      triggers: { afterIdle: true, afterUserMessage: false },
    });

    const first = new Array<string>();
    await transform(plugin, "guidance-idle", first);
    expect(first).toHaveLength(1);

    const second = new Array<string>();
    await transform(plugin, "guidance-idle", second);
    expect(second).toHaveLength(0);

    await idle(plugin, "guidance-idle");
    const third = new Array<string>();
    await transform(plugin, "guidance-idle", third);
    expect(third).toHaveLength(1);
  });

  test("does not inject twice for a user message after idle", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      triggers: { afterIdle: true, afterUserMessage: true },
    });

    await idle(plugin, "guidance-both");
    await say(plugin, "guidance-both", "hello");
    const system = new Array<string>();
    await transform(plugin, "guidance-both", system);
    expect(system).toHaveLength(1);
  });

  test("injects nothing when both triggers are false", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      triggers: { afterIdle: false, afterUserMessage: false },
    });

    await say(plugin, "guidance-none", "hello");
    const system = new Array<string>();
    await transform(plugin, "guidance-none", system);
    expect(system).toHaveLength(0);
  });

  test("classifies user turns but not idle turns", async () => {
    const { client } = createClient([message("medium")]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      triggers: { afterIdle: true, afterUserMessage: true },
      classifier: { enabled: true },
    });

    await transform(plugin, "classifier-idle", new Array<string>());
    expect(client.session.create).not.toHaveBeenCalled();

    await say(plugin, "classifier-user", "debug the flaky test");
    expect(client.session.create).toHaveBeenCalledTimes(1);
  });

  test("uses the last compaction summary in the classifier context", async () => {
    const summary = "SUMMARY-CONTEXT";
    const { client } = createClient([
      message("medium"),
      {
        info: { role: "assistant", agent: "agent", summary: true, time: { created: 1 } },
        parts: [{ type: "text", text: summary }],
      },
    ]);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: true },
    });

    await say(plugin, "classifier-summary", "next step");
    const calls = client.session.prompt.mock.calls as unknown as Array<[any]>;
    const call = calls.at(-1)?.[0];
    expect(call?.body.parts[0].text).toContain(summary);
    expect(call?.body.parts[0].text).toContain("Current message:\nnext step");
  });

  test("classifies each real user message", async () => {
    const { client } = createClient();
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: true },
    });
    const input = {
      sessionID: "classifier-initial",
      model: { providerID: "provider", modelID: "model" },
    };

    const first = message().info;
    await plugin["chat.message"](input, {
      message: first,
      parts: [{ type: "text", text: "debug the flaky auth test" }],
    });
    const second = message().info;
    await plugin["chat.message"](input, {
      message: second,
      parts: [{ type: "text", text: "explain this function" }],
    });

    expect((first.model as { variant?: string }).variant).toBe("high");
    expect((second.model as { variant?: string }).variant).toBe("high");
    expect(client.session.create).toHaveBeenCalledTimes(2);
    expect(client.session.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ parentID: "classifier-initial" }),
    });
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: { providerID: "opencode", modelID: "big-pickle" },
          tools: { "*": false },
        }),
      }),
    );
    expect(client.session.delete).toHaveBeenCalled();
  });

  test("does not classify when disabled or with an explicit variant", async () => {
    const { client } = createClient();
    const off: any = await AdaptiveThinkingPlugin({ client } as never);
    await off["chat.message"](
      { sessionID: "classifier-off", model: { providerID: "provider", modelID: "model" } },
      { message: message().info, parts: [{ type: "text", text: "debug" }] },
    );
    expect(client.session.create).not.toHaveBeenCalled();

    const on: any = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: true },
    });
    const first = message().info;
    await on["chat.message"](
      {
        sessionID: "classifier-explicit",
        model: { providerID: "provider", modelID: "model" },
        variant: "low",
      },
      { message: first, parts: [{ type: "text", text: "debug" }] },
    );
    expect(client.session.create).not.toHaveBeenCalled();
    expect((first.model as { variant?: string }).variant).toBeUndefined();
  });

  test("ignores synthetic user messages", async () => {
    const { client } = createClient();
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: true },
    });
    const first = message().info;

    await plugin["chat.message"](
      { sessionID: "classifier-synthetic", model: { providerID: "provider", modelID: "model" } },
      {
        message: first,
        parts: [{ type: "text", text: "Continue if you have next steps.", synthetic: true }],
      },
    );

    expect(client.session.create).not.toHaveBeenCalled();
    expect((first.model as { variant?: string }).variant).toBeUndefined();
  });

  test("ignores an invalid classifier answer", async () => {
    const { client } = createClient();
    client.session.prompt.mockResolvedValueOnce({
      data: { parts: [{ type: "text", text: "unsure" }] },
      error: undefined,
    } as never);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: true },
    });
    const first = message().info;

    await plugin["chat.message"](
      { sessionID: "classifier-invalid", model: { providerID: "provider", modelID: "model" } },
      { message: first, parts: [{ type: "text", text: "debug" }] },
    );

    expect((first.model as { variant?: string }).variant).toBeUndefined();
  });

  test("fails open when the classifier cannot be created", async () => {
    const { client } = createClient();
    client.session.create.mockResolvedValueOnce({
      data: undefined,
      error: { data: { message: "unavailable" } },
    } as never);
    const plugin: any = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: true },
    });
    const first = message().info;

    await plugin["chat.message"](
      { sessionID: "classifier-failure", model: { providerID: "provider", modelID: "model" } },
      { message: first, parts: [{ type: "text", text: "debug" }] },
    );

    expect((first.model as { variant?: string }).variant).toBeUndefined();
    expect(client.app.log).toHaveBeenCalledWith({
      body: expect.objectContaining({ level: "warn" }),
    });
  });

  test("rejects an invalid classifier configuration", async () => {
    const { client } = createClient();
    const plugin = await AdaptiveThinkingPlugin({ client } as never, {
      classifier: { enabled: "yes" },
    });

    expect(plugin).toEqual({});
    expect(client.app.log).toHaveBeenCalled();
  });
});

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

  test("evicts the oldest session state when the cache is full", async () => {
    const oldest = createClient([message("medium")]);
    const oldestPlugin: any = await AdaptiveThinkingPlugin({ client: oldest.client } as never);
    await set(oldestPlugin, "low", false, "lru-0");

    for (let i = 1; i <= 500; i++) {
      const { client } = createClient([message("medium")]);
      const plugin: any = await AdaptiveThinkingPlugin({ client } as never);
      await set(plugin, "low", false, `lru-${i}`);
    }

    await idle(oldestPlugin, "lru-0");
    expect(oldest.prompts).toHaveLength(1);
  });
});

export const defaultSystemPrompt =
  "You MUST manage reasoning effort actively. " +
  "Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. " +
  "Reassess at turn start, after meaningful new evidence, and when the task shifts. " +
  "NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.";

export type ClassifierConfig = {
  enabled: boolean;
  model: { providerID: string; modelID: string };
};

export type TriggersConfig = {
  afterIdle: boolean;
  afterUserMessage: boolean;
};

export type Config = {
  enabled: boolean;
  quiet: boolean;
  toolName: string;
  toolDescription: string;
  systemPrompt: string;
  triggers?: TriggersConfig;
  classifier: ClassifierConfig;
};

const defaults: Config = {
  enabled: true,
  quiet: false,
  toolName: "set_reasoning_effort",
  toolDescription: "Set your reasoning effort",
  systemPrompt: defaultSystemPrompt,
  classifier: {
    enabled: false,
    model: { providerID: "opencode", modelID: "big-pickle" },
  },
};

const cloneDefaults = (): Config => ({
  ...defaults,
  classifier: { ...defaults.classifier, model: { ...defaults.classifier.model } },
});

export const parseConfig = (options: unknown): { config: Config } | { error: string } => {
  if (options === undefined) return { config: cloneDefaults() };
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { error: "options must be an object" };
  }

  const input = options as Record<string, unknown>;
  const config = cloneDefaults();

  for (const key of ["enabled", "quiet"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return { error: `${key} must be a boolean` };
    config[key] = value;
  }

  for (const key of ["toolName", "toolDescription", "systemPrompt"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return { error: `${key} must be a string` };
    config[key] = value;
  }

  const triggers = input.triggers;
  if (triggers !== undefined) {
    if (typeof triggers !== "object" || triggers === null || Array.isArray(triggers)) {
      return { error: "triggers must be an object" };
    }
    const value = triggers as Record<string, unknown>;
    const afterIdle = value.afterIdle === undefined ? false : value.afterIdle;
    const afterUserMessage = value.afterUserMessage === undefined ? false : value.afterUserMessage;
    if (typeof afterIdle !== "boolean" || typeof afterUserMessage !== "boolean") {
      return { error: "triggers.afterIdle and triggers.afterUserMessage must be booleans" };
    }
    config.triggers = { afterIdle, afterUserMessage };
  }

  const classifier = input.classifier;
  if (classifier !== undefined) {
    if (typeof classifier !== "object" || classifier === null || Array.isArray(classifier)) {
      return { error: "classifier must be an object" };
    }
    const value = classifier as Record<string, unknown>;

    if (value.enabled !== undefined) {
      if (typeof value.enabled !== "boolean")
        return { error: "classifier.enabled must be a boolean" };
      config.classifier.enabled = value.enabled;
    }

    if (value.model !== undefined) {
      if (typeof value.model !== "object" || value.model === null || Array.isArray(value.model)) {
        return { error: "classifier.model must be an object" };
      }
      const model = value.model as Record<string, unknown>;
      if (typeof model.providerID !== "string" || typeof model.modelID !== "string") {
        return { error: "classifier.model must have string providerID and modelID" };
      }
      config.classifier.model = { providerID: model.providerID, modelID: model.modelID };
    }
  }

  return { config };
};

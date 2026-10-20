export const defaultSystemPrompt =
  "You MUST manage reasoning effort actively. " +
  "Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. " +
  "Reassess at turn start, after meaningful new evidence, and when the task shifts. " +
  "NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.";

export type Config = {
  enabled: boolean;
  quiet: boolean;
  toolName: string;
  toolDescription: string;
  systemPrompt: string;
};

const defaults: Config = {
  enabled: true,
  quiet: false,
  toolName: "set_reasoning_effort",
  toolDescription: "Set your reasoning effort",
  systemPrompt: defaultSystemPrompt,
};

export const parseConfig = (options: unknown): { config: Config } | { error: string } => {
  if (options === undefined) return { config: { ...defaults } };
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { error: "options must be an object" };
  }

  const input = options as Record<string, unknown>;
  const config = { ...defaults };

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

  return { config };
};

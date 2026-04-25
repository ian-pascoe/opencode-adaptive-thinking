import * as z from "zod/v4";

export const defaultSystemPrompt =
  "You MUST manage reasoning effort actively. " +
  "Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. " +
  "Reassess at turn start, after meaningful new evidence, and when the task shifts. " +
  "NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.";

export const configDefaults = {
  enabled: true,
  quiet: false,
  serviceName: "opencode-adaptive-thinking",
  toolName: "set_reasoning_effort",
  toolDescription: "Set your reasoning effort",
  systemPrompt: defaultSystemPrompt,
};

export const ConfigSchema = z
  .object({
    enabled: z.boolean().default(configDefaults.enabled),
    quiet: z.boolean().default(configDefaults.quiet),
    serviceName: z.string().default(configDefaults.serviceName),
    toolName: z.string().default(configDefaults.toolName),
    toolDescription: z.string().default(configDefaults.toolDescription),
    systemPrompt: z.string().default(configDefaults.systemPrompt),
  })
  .optional()
  .default(configDefaults);

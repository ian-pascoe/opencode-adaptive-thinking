import { Plugin } from "@opencode/plugin";
const defaults = {
	enabled: true,
	quiet: false,
	toolName: "set_reasoning_effort",
	toolDescription: "Set your reasoning effort",
	systemPrompt: "You MUST manage reasoning effort actively. Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. Reassess at turn start, after meaningful new evidence, and when the task shifts. NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.",
	classifier: {
		enabled: false,
		model: {
			providerID: "opencode",
			modelID: "big-pickle"
		}
	}
};
const cloneDefaults = () => ({
	...defaults,
	classifier: {
		...defaults.classifier,
		model: { ...defaults.classifier.model }
	}
});
const parseConfig = (options) => {
	if (options === void 0) return { config: cloneDefaults() };
	if (typeof options !== "object" || options === null || Array.isArray(options)) return { error: "options must be an object" };
	const input = options;
	const config = cloneDefaults();
	for (const key of ["enabled", "quiet"]) {
		const value = input[key];
		if (value === void 0) continue;
		if (typeof value !== "boolean") return { error: `${key} must be a boolean` };
		config[key] = value;
	}
	for (const key of [
		"toolName",
		"toolDescription",
		"systemPrompt"
	]) {
		const value = input[key];
		if (value === void 0) continue;
		if (typeof value !== "string") return { error: `${key} must be a string` };
		config[key] = value;
	}
	const triggers = input.triggers;
	if (triggers !== void 0) {
		if (typeof triggers !== "object" || triggers === null || Array.isArray(triggers)) return { error: "triggers must be an object" };
		const value = triggers;
		const afterIdle = value.afterIdle === void 0 ? false : value.afterIdle;
		const afterUserMessage = value.afterUserMessage === void 0 ? false : value.afterUserMessage;
		if (typeof afterIdle !== "boolean" || typeof afterUserMessage !== "boolean") return { error: "triggers.afterIdle and triggers.afterUserMessage must be booleans" };
		config.triggers = {
			afterIdle,
			afterUserMessage
		};
	}
	const classifier = input.classifier;
	if (classifier !== void 0) {
		if (typeof classifier !== "object" || classifier === null || Array.isArray(classifier)) return { error: "classifier must be an object" };
		const value = classifier;
		if (value.enabled !== void 0) {
			if (typeof value.enabled !== "boolean") return { error: "classifier.enabled must be a boolean" };
			config.classifier.enabled = value.enabled;
		}
		if (value.model !== void 0) {
			if (typeof value.model !== "object" || value.model === null || Array.isArray(value.model)) return { error: "classifier.model must be an object" };
			const model = value.model;
			if (typeof model.providerID !== "string" || typeof model.modelID !== "string") return { error: "classifier.model must have string providerID and modelID" };
			config.classifier.model = {
				providerID: model.providerID,
				modelID: model.modelID
			};
		}
	}
	return { config };
};
//#endregion
//#region src/index.ts
const serviceName = "opencode-adaptive-thinking";
const maxSessionStateSize = 5e3;
const stateTtlMs = 10080 * 60 * 1e3;
const classifierTimeout = 5e3;
const idleEvents = [
	"session.execution.succeeded",
	"session.execution.failed",
	"session.execution.interrupted"
];
const trackedEvents = ["session.deleted", ...idleEvents];
var SessionStateCache = class {
	maxSize;
	entries = /* @__PURE__ */ new Map();
	constructor(maxSize) {
		this.maxSize = maxSize;
	}
	get(sessionID) {
		const entry = this.entries.get(sessionID);
		if (!entry) return;
		if (entry.touchedAt && Date.now() - entry.touchedAt > stateTtlMs) {
			this.entries.delete(sessionID);
			return;
		}
		entry.touchedAt = Date.now();
		this.entries.delete(sessionID);
		this.entries.set(sessionID, entry);
		return entry;
	}
	delete(sessionID) {
		this.entries.delete(sessionID);
	}
	update(sessionID, update) {
		const entry = this.get(sessionID) ?? {};
		update(entry);
		entry.touchedAt = Date.now();
		this.entries.set(sessionID, entry);
		if (this.entries.size > this.maxSize) {
			const oldest = this.entries.keys().next().value;
			if (oldest) this.entries.delete(oldest);
		}
	}
};
const state = new SessionStateCache(maxSessionStateSize);
const describe = (error) => {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	try {
		return JSON.stringify(error) ?? String(error);
	} catch {
		return String(error);
	}
};
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const requestRuntimeKeys = /* @__PURE__ */ new Set([
	"apiKey",
	"authToken",
	"accessToken",
	"baseURL",
	"body",
	"chunkTimeout",
	"compaction",
	"disabled",
	"encoding",
	"fetch",
	"headerTimeout",
	"headers",
	"timeout",
	"transport"
]);
const unsafeKeys = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
const isUnsafeKey = (key) => unsafeKeys.has(key);
const mergeRecords = (target, source) => {
	const result = { ...target };
	for (const [key, value] of Object.entries(source)) {
		if (isUnsafeKey(key)) continue;
		const current = result[key];
		result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
	}
	return result;
};
const AdaptiveThinkingPlugin = Plugin.define({
	id: serviceName,
	async setup(ctx) {
		const recordDiagnostic = (level, message, error) => {
			const text = error === void 0 ? message : `${message}: ${describe(error)}`;
			try {
				ctx.storage.set("lastDiagnostic", {
					at: (/* @__PURE__ */ new Date()).toISOString(),
					level,
					message: text
				}).catch(() => {});
			} catch {}
		};
		const logError = (message, error) => {
			console.error(`[${serviceName}] ${message}: ${describe(error)}`);
			recordDiagnostic("error", message, error);
		};
		const logWarn = (message, error) => {
			console.warn(error === void 0 ? `[${serviceName}] ${message}` : `[${serviceName}] ${message}: ${describe(error)}`);
			recordDiagnostic("warn", message, error);
		};
		const options = ctx.options ?? {};
		const parsed = parseConfig(ctx.options);
		if ("error" in parsed) {
			if (options.quiet !== true) console.error(`[${serviceName}] Invalid Adaptive Thinking plugin configuration, see the server output for details`);
			logError("Invalid Adaptive Thinking plugin configuration", parsed.error);
			return;
		}
		const config = parsed.config;
		if (!config.enabled) return;
		let classifierWarned = false;
		const warnClassifier = (message, error) => {
			if (classifierWarned) {
				recordDiagnostic("warn", message, error);
				return;
			}
			classifierWarned = true;
			logWarn(message, error);
		};
		let switchWarned = false;
		const warnSwitch = (message, error) => {
			if (switchWarned) {
				recordDiagnostic("error", message, error);
				return;
			}
			switchWarned = true;
			logError(message, error);
		};
		let requestWarned = false;
		const warnRequest = (message, error) => {
			if (requestWarned) {
				recordDiagnostic("warn", message, error);
				return;
			}
			requestWarned = true;
			logWarn(message, error);
		};
		const generateText = ctx.experimental?.generate?.text ?? ctx.generate.text;
		let models;
		const modelRecords = async () => {
			if (models) return models;
			try {
				const response = await ctx.model.list();
				if (!Array.isArray(response?.data)) {
					logError("Failed to retrieve providers", "the provider list is not an array");
					return;
				}
				models = response.data.filter((record) => record !== null && typeof record === "object");
				return models;
			} catch (error) {
				logError("Failed to retrieve providers", error);
				return;
			}
		};
		const modelRecord = async (model) => {
			return (await modelRecords())?.find((candidate) => candidate.providerID === model.providerID && (candidate.modelID === model.modelID || candidate.id === model.modelID));
		};
		const variantRecord = async (model, level) => {
			const record = await modelRecord(model);
			return Array.isArray(record?.variants) ? record.variants.find((variant) => variant?.id === level) : void 0;
		};
		const variantsFor = async (model) => {
			const record = await modelRecord(model);
			return (Array.isArray(record?.variants) ? record.variants : []).map((variant) => variant?.id).filter((id) => typeof id === "string");
		};
		const isSelectable = (variant, variants) => variant !== void 0 && (variants.includes(variant) || variant === "default");
		const fetchMessages = async (sessionID) => {
			try {
				const messages = await ctx.session.context({ sessionID });
				if (!Array.isArray(messages)) {
					logError(`Failed to retrieve messages for session ${sessionID}`, "the session context is not an array");
					return;
				}
				return messages;
			} catch (error) {
				logError(`Failed to retrieve messages for session ${sessionID}`, error);
				return;
			}
		};
		const fetchSession = async (sessionID) => {
			try {
				return await ctx.session.get({ sessionID });
			} catch (error) {
				logError(`Failed to retrieve session ${sessionID}`, error);
				return;
			}
		};
		const sessionModel = async (sessionID) => {
			const model = (await fetchSession(sessionID))?.model;
			return model ? {
				providerID: model.providerID,
				modelID: model.id
			} : void 0;
		};
		const readSessionVariant = async (sessionID) => {
			const session = await fetchSession(sessionID);
			if (!session) return { kind: "unreadable" };
			return session.model?.variant === void 0 ? { kind: "read" } : {
				kind: "read",
				variant: session.model.variant
			};
		};
		const latestModel = (messages) => {
			for (let i = messages.length - 1; i >= 0; i--) {
				const model = messages[i].model;
				if (model) return {
					providerID: model.providerID,
					modelID: model.id
				};
			}
		};
		const latestVariant = (messages) => {
			for (let i = messages.length - 1; i >= 0; i--) {
				const variant = messages[i].model?.variant;
				if (variant) return variant;
			}
		};
		const agentVariant = async (agent) => {
			if (!agent) return;
			try {
				return (await ctx.agent.list()).data.find((candidate) => candidate.name === agent || candidate.id === agent)?.model?.variant;
			} catch (error) {
				logError("Failed to retrieve agents", error);
				return;
			}
		};
		const messageText = (message) => {
			if (message.type === "user") return message.text?.trim() || void 0;
			if (message.type !== "assistant") return;
			const text = (message.content ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim();
			return text.length > 0 ? text : void 0;
		};
		const latestSummary = (messages) => {
			for (let i = messages.length - 1; i >= 0; i--) {
				const message = messages[i];
				if (message.type === "compaction" && message.summary) {
					const text = message.summary.trim();
					if (text) return text;
				}
			}
		};
		const buildContext = async (sessionID) => {
			const messages = await fetchMessages(sessionID);
			if (!messages) return "";
			const summary = latestSummary(messages);
			if (summary) return summary;
			const since = state.get(sessionID)?.lastIdleAt ?? 0;
			return messages.filter((message) => !since || (message.time?.created ?? 0) >= since).map((message) => {
				const text = messageText(message);
				return text ? `${message.type}: ${text}` : "";
			}).filter(Boolean).join("\n");
		};
		const switchVariant = async (sessionID, model, variant) => {
			try {
				await ctx.session.switchModel({
					sessionID,
					model: {
						providerID: model.providerID,
						id: model.modelID,
						variant
					}
				});
				return;
			} catch (error) {
				warnSwitch(`Failed to set reasoning effort for session ${sessionID}`, error);
				return describe(error);
			}
		};
		const classifyWithModel = async (text, variants, model, current, context) => {
			const prompt = [
				config.systemPrompt.trim(),
				current ? `Current reasoning effort level: ${current}.` : "",
				`Valid reasoning effort levels for this session: ${variants.join(", ")}.`,
				`To change your reasoning effort, use the \`${config.toolName}\` tool with one of the valid levels.`,
				"Only call it when the task complexity justifies changing levels.",
				"Classifier task: choose exactly one of the valid levels for the current message and answer with that word only.",
				"",
				`Session context:\n${context || "(none)"}`,
				"",
				`Current message:\n${text}`
			].filter(Boolean).join(" ");
			const controller = new AbortController();
			let timer;
			const timeout = new Promise((resolve) => {
				timer = setTimeout(() => {
					controller.abort();
					resolve({ kind: "timeout" });
				}, classifierTimeout);
			});
			const pending = (async () => {
				try {
					return {
						kind: "ok",
						text: (await generateText({
							prompt,
							model: {
								providerID: model.providerID,
								id: model.modelID
							}
						}, { signal: controller.signal }))?.text
					};
				} catch (error) {
					return {
						kind: "error",
						error
					};
				}
			})();
			const answer = await Promise.race([pending, timeout]).finally(() => {
				if (timer !== void 0) clearTimeout(timer);
			});
			if (answer.kind === "timeout") {
				warnClassifier("The classifier timed out");
				return;
			}
			if (answer.kind === "error") {
				warnClassifier("The classifier request failed", answer.error);
				return;
			}
			if (typeof answer.text !== "string") {
				warnClassifier("The classifier returned an invalid response");
				return;
			}
			const lowered = answer.text.toLowerCase();
			let best;
			for (const level of variants) {
				const escaped = level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const match = new RegExp(`\\b${escaped}\\b`, "i").exec(lowered);
				if (match && (!best || match.index < best.index)) best = {
					index: match.index,
					level
				};
			}
			if (!best) {
				warnClassifier("The classifier returned an invalid response");
				return;
			}
			return best.level;
		};
		const applyRequestLevel = async (event, sessionID, model, level) => {
			if (level === "default") return false;
			const variant = await variantRecord(model, level);
			if (!variant) return false;
			let applied = false;
			for (const [key, value] of Object.entries(variant.settings ?? {})) {
				if (value === void 0 || requestRuntimeKeys.has(key) || isUnsafeKey(key)) continue;
				event.options[key] = value;
				applied = true;
			}
			const headers = variant.headers && Object.keys(variant.headers).length > 0 ? variant.headers : void 0;
			const body = variant.body && Object.keys(variant.body).length > 0 ? variant.body : void 0;
			if (headers || body) {
				state.update(sessionID, (entry) => {
					entry.request = {
						...headers ? { headers } : {},
						...body ? { body } : {}
					};
				});
				applied = true;
			}
			if (!applied) return false;
			Object.assign(event.model, { variant: level });
			return true;
		};
		const resetOnIdle = async (sessionID) => {
			const reset = state.get(sessionID)?.reset;
			if (!reset) return;
			const session = await fetchSession(sessionID);
			if (!session) return;
			const current = session.model ? {
				providerID: session.model.providerID,
				modelID: session.model.id
			} : void 0;
			if (!current) {
				logError("Failed to reset reasoning effort on session idle", "no model is available");
				return;
			}
			if (current.providerID !== reset.model.providerID || current.modelID !== reset.model.modelID) {
				state.update(sessionID, (entry) => {
					delete entry.reset;
					delete entry.variant;
				});
				return;
			}
			if (await switchVariant(sessionID, current, reset.level) !== void 0) return;
			state.update(sessionID, (entry) => {
				if (reset.level === "default") delete entry.variant;
				else entry.variant = reset.level;
				delete entry.reset;
			});
		};
		await ctx.tool.transform((editor) => {
			editor.add({
				name: config.toolName,
				description: config.toolDescription,
				input: {
					type: "object",
					properties: {
						level: {
							type: "string",
							description: "The level of reasoning effort to apply. Higher levels may result in more accurate and thoughtful responses, but may also take more time and resources."
						},
						persist: {
							type: "boolean",
							default: false,
							description: "Whether to persist the setting for this session, otherwise it will only apply for the remainder of the current turn"
						}
					},
					required: ["level"]
				},
				async execute(input, context) {
					const args = input ?? {};
					const level = typeof args.level === "string" ? args.level : "";
					const persist = args.persist === true;
					const sessionID = context.sessionID;
					const messages = await fetchMessages(sessionID);
					if (!messages) return { content: "Failed to set reasoning effort: could not read the session" };
					const model = latestModel(messages) ?? await sessionModel(sessionID);
					if (!model) return { content: "Failed to set reasoning effort: no valid reasoning effort levels are available for this session" };
					const variants = await variantsFor(model);
					if (variants.length === 0) return { content: "Failed to set reasoning effort: no valid reasoning effort levels are available for this session" };
					if (!variants.includes(level)) return { content: `Invalid reasoning effort level: ${level}. Valid levels: ${variants.join(", ")}.` };
					const sessionRead = await readSessionVariant(sessionID);
					const previousSessionVariant = sessionRead.kind === "read" ? sessionRead.variant : void 0;
					const baseline = state.get(sessionID)?.reset?.level ?? (sessionRead.kind === "read" ? previousSessionVariant ?? latestVariant(messages) ?? await agentVariant(context.agent) : void 0);
					const error = await switchVariant(sessionID, model, level);
					if (error !== void 0) return { content: `Failed to set reasoning effort: ${error}` };
					state.update(sessionID, (entry) => {
						entry.variant = level;
						if (persist || !baseline || baseline === level || !isSelectable(baseline, variants)) delete entry.reset;
						else entry.reset ??= {
							level: baseline,
							model
						};
					});
					return { content: `Reasoning effort set to ${level}` };
				}
			});
		});
		await ctx.session.hook("prompt", (event) => {
			const text = event.prompt.text.trim();
			if (text.length === 0) return;
			state.update(event.sessionID, (entry) => {
				entry.userPending = true;
				if (config.classifier.enabled && (config.triggers === void 0 || config.triggers.afterUserMessage)) entry.classifyText = text;
			});
		});
		await ctx.session.hook("context", async (event) => {
			const sessionID = event.sessionID;
			state.update(sessionID, (entry) => {
				delete entry.request;
			});
			const pendingText = state.get(sessionID)?.classifyText;
			if (pendingText !== void 0 && config.classifier.enabled) {
				state.update(sessionID, (entry) => {
					delete entry.classifyText;
				});
				const model = {
					providerID: event.model.providerID,
					modelID: event.model.id
				};
				const variants = await variantsFor(model);
				const explicit = event.model.variant;
				const hasExplicitLevel = explicit !== void 0 && explicit !== "default" && variants.includes(explicit);
				if (variants.length > 0 && !hasExplicitLevel) {
					const current = state.get(sessionID)?.variant;
					const context = await buildContext(sessionID);
					const level = await classifyWithModel(pendingText, variants, config.classifier.model, current, context);
					if (level && variants.includes(level)) await applyRequestLevel(event, sessionID, model, level);
				}
			}
			const session = state.get(sessionID);
			const userPending = session?.userPending === true;
			const idlePending = session?.idlePending ?? true;
			let inject;
			if (config.triggers === void 0) inject = true;
			else if (userPending) inject = config.triggers.afterUserMessage;
			else if (idlePending) inject = config.triggers.afterIdle;
			else inject = false;
			if (userPending || idlePending) state.update(sessionID, (entry) => {
				entry.userPending = false;
				entry.idlePending = false;
			});
			if (!inject) return;
			let model = {
				providerID: event.model.providerID,
				modelID: event.model.id
			};
			let variants = await variantsFor(model);
			if (variants.length === 0) return;
			let variant = event.model.variant;
			if (variant !== void 0 && (variant === "default" || !variants.includes(variant))) variant = void 0;
			if (!variant) {
				const messages = await fetchMessages(sessionID);
				if (!messages) return;
				const resolved = latestVariant(messages) ?? await agentVariant(event.agent);
				if (resolved && resolved !== "default" && variants.includes(resolved)) variant = resolved;
			}
			if (variant) {
				const level = variant;
				if (event.model.variant === level || await applyRequestLevel(event, sessionID, model, level)) {
					if (session?.variant !== level) state.update(sessionID, (entry) => {
						entry.variant = level;
					});
				} else {
					variant = void 0;
					if (session?.variant !== void 0) state.update(sessionID, (entry) => {
						delete entry.variant;
					});
				}
			} else if (session?.variant !== void 0) state.update(sessionID, (entry) => {
				delete entry.variant;
			});
			const guidance = [
				config.systemPrompt.trim(),
				variant ? `Current reasoning effort level: ${variant}.` : "",
				`Valid reasoning effort levels for this session: ${variants.join(", ")}.`,
				`To change your reasoning effort, use the \`${config.toolName}\` tool with one of the valid levels.`,
				"Only call it when the task complexity justifies changing levels."
			].filter(Boolean).join(" ");
			const existingSystem = event.system[0];
			if (existingSystem === void 0 || !existingSystem.text) event.system.push({
				type: "text",
				text: guidance
			});
			else event.system[0] = {
				type: "text",
				text: existingSystem.text + "\n\n" + guidance
			};
		});
		await ctx.session.hook("model.request", (event) => {
			if (event.kind !== "primary") return;
			const pending = state.get(event.sessionID)?.request;
			if (!pending?.headers) return;
			Object.assign(event.headers, pending.headers);
		});
		await ctx.session.hook("http.request", async (event) => {
			if (event.kind !== "primary") return;
			const pending = state.get(event.sessionID)?.request;
			if (!pending) return;
			if (!pending.body) return;
			try {
				if (!event.request.body) return;
				const parsed = JSON.parse(await event.request.clone().text());
				if (!isRecord(parsed)) return;
				const headers = new Headers(event.request.headers);
				headers.delete("content-length");
				event.request = new Request(event.request, {
					method: event.request.method,
					headers,
					body: JSON.stringify(mergeRecords(parsed, pending.body))
				});
			} catch (error) {
				warnRequest("Failed to apply the request-scoped reasoning variant body", error);
			}
		});
		const controller = new AbortController();
		const subscribe = ctx.event.subscribe;
		(async () => {
			try {
				for await (const event of subscribe({
					signal: controller.signal,
					types: trackedEvents
				})) try {
					if (event.type === "session.deleted") {
						state.delete(event.data.sessionID);
						continue;
					}
					if (!idleEvents.includes(event.type)) continue;
					const sessionID = event.data.sessionID;
					state.update(sessionID, (entry) => {
						entry.userPending = false;
						entry.idlePending = true;
						entry.lastIdleAt = Date.now();
						delete entry.classifyText;
					});
					await resetOnIdle(sessionID);
				} catch (error) {
					logError("Event handler failed", error);
				}
			} catch (error) {
				if (!controller.signal.aborted) logError("Event subscription failed", error);
			}
		})();
		return () => controller.abort();
	}
});
//#endregion
export { AdaptiveThinkingPlugin, AdaptiveThinkingPlugin as default };

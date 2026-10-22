import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevelMap } from "@earendil-works/pi-ai";

const PROVIDER_ID = "llama-swap";
const PROVIDER_NAME = "llama-swap";
const DEFAULT_SERVER = "http://192.168.1.236:6969";
const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_CONTEXT = 128_000;

type ThinkingLevel = keyof ThinkingLevelMap;

const PI_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const LEVEL_ALIASES: Record<string, ThinkingLevel> = {
	none: "off",
	off: "off",
	disabled: "off",
	false: "off",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	med: "medium",
	high: "high",
	xhigh: "xhigh",
	maximum: "max",
	max: "max",
};

interface SwapModel {
	id: string;
	name?: string;
	description?: string;
	context_length?: number;
	context_window?: number;
	architecture?: { input_modalities?: string[] };
	capabilities?: { vision?: boolean; function_calling?: boolean };
	meta?: { n_ctx?: number; llamaswap?: { reasoning_levels?: string[] } };
}

function serverUrl(): string {
	const raw = process.env.LLAMA_SWAP_URL?.trim() || DEFAULT_SERVER;
	const trimmed = raw.replace(/\/+$/, "");
	return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

async function fetchCatalog(signal?: AbortSignal): Promise<SwapModel[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await fetch(`${serverUrl()}/v1/models`, { signal: controller.signal });
		if (!response.ok) throw new Error(`/v1/models returned HTTP ${response.status}`);
		const body = (await response.json()) as { data?: SwapModel[] };
		return Array.isArray(body.data) ? body.data : [];
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

function normalizeLevel(value: string): ThinkingLevel | undefined {
	return LEVEL_ALIASES[value.trim().toLowerCase()];
}

function thinkingFrom(declared: string[] | undefined): { reasoning: boolean; map?: ThinkingLevelMap } {
	const supported = new Set<ThinkingLevel>();
	for (const entry of declared ?? []) {
		const level = normalizeLevel(entry);
		if (level) supported.add(level);
	}
	if (supported.size === 0) return { reasoning: false };
	const map = {} as ThinkingLevelMap;
	for (const level of PI_LEVELS) {
		if (supported.has(level)) {
			map[level] = level === "off" ? "none" : level;
		} else if ((level === "high" || level === "max") && supported.has("xhigh")) {
			map[level] = "xhigh";
		} else {
			map[level] = null;
		}
	}
	return { reasoning: true, map };
}

function contextWindowOf(model: SwapModel): number {
	for (const value of [model.context_length, model.context_window, model.meta?.n_ctx]) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	}
	return DEFAULT_CONTEXT;
}

function isVision(model: SwapModel): boolean {
	return model.architecture?.input_modalities?.includes("image") === true || model.capabilities?.vision === true;
}

function toProviderModel(model: SwapModel) {
	const contextWindow = contextWindowOf(model);
	const { reasoning, map } = thinkingFrom(model.meta?.llamaswap?.reasoning_levels);
	return {
		id: model.id,
		name: model.name?.trim() || model.id,
		reasoning,
		...(reasoning && map ? { thinkingLevelMap: map } : {}),
		input: (isVision(model) ? ["text", "image"] : ["text"]) as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: contextWindow,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: reasoning,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens" as const,
		},
	};
}

export default async function (pi: ExtensionAPI) {
	let catalog = new Map<string, SwapModel>();

	const providerModels = () => [...catalog.values()].map(toProviderModel);

	try {
		const models = await fetchCatalog();
		catalog = new Map(models.map((model) => [model.id, model]));
	} catch {
		// The server can be offline at startup; refreshModels fills the catalog later.
	}

	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: `${serverUrl()}/v1`,
		apiKey: process.env.LLAMA_SWAP_API_KEY?.trim() || "local",
		api: "openai-completions",
		models: providerModels(),
		refreshModels: async (context) => {
			if (!context.allowNetwork) return providerModels();
			try {
				const models = await fetchCatalog(context.signal);
				catalog = new Map(models.map((model) => [model.id, model]));
			} catch {
				// Keep the last known catalog when the server is unreachable.
			}
			return providerModels();
		},
	});
}

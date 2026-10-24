import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PROVIDER_ID = "llama-swap";
const PROVIDER_NAME = "llama-swap";
const DEFAULT_SERVER = "http://192.168.1.236:6969";
const DEFAULT_CONTEXT = 128_000;
const PLACEHOLDER_KEY = "llama-swap-local";
const REQUEST_TIMEOUT_MS = 5_000;

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

interface ProviderSettings {
	baseUrl?: string;
	apiKey?: string;
	contextWindow?: number;
	maxTokens?: number;
}

interface Settings {
	server: string;
	apiKey: string;
	contextWindow: number;
	maxTokens?: number;
}

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

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function normalizeServer(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, "");
	return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

async function resolveSettings(): Promise<Settings> {
	const models = await readJson(join(agentDir(), "models.json"));
	const providers = (models?.providers ?? {}) as Record<string, ProviderSettings | undefined>;
	const provider = providers[PROVIDER_ID] ?? {};

	const auth = await readJson(join(agentDir(), "auth.json"));
	const stored = auth?.[PROVIDER_ID] as { key?: unknown } | undefined;
	const storedKey = typeof stored?.key === "string" && stored.key.trim() ? stored.key.trim() : undefined;

	const envUrl = process.env.LLAMA_SWAP_URL?.trim();
	const envKey = process.env.LLAMA_SWAP_API_KEY?.trim();

	const contextWindow =
		typeof provider.contextWindow === "number" && provider.contextWindow > 0
			? provider.contextWindow
			: DEFAULT_CONTEXT;
	const maxTokens =
		typeof provider.maxTokens === "number" && provider.maxTokens > 0 ? provider.maxTokens : undefined;

	return {
		server: normalizeServer(envUrl || provider.baseUrl || DEFAULT_SERVER),
		apiKey: envKey || storedKey || provider.apiKey || PLACEHOLDER_KEY,
		contextWindow,
		maxTokens,
	};
}

async function fetchCatalog(server: string, apiKey: string, signal?: AbortSignal): Promise<SwapModel[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await fetch(`${server}/v1/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: controller.signal,
		});
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
		map[level] = supported.has(level) ? (level === "off" ? "none" : level) : null;
	}
	return { reasoning: true, map };
}

function contextWindowOf(model: SwapModel, fallback: number): number {
	for (const value of [model.context_length, model.context_window, model.meta?.n_ctx]) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	}
	return fallback;
}

function isVision(model: SwapModel): boolean {
	return model.architecture?.input_modalities?.includes("image") === true || model.capabilities?.vision === true;
}

function toProviderModel(model: SwapModel, settings: Settings) {
	const contextWindow = contextWindowOf(model, settings.contextWindow);
	const maxTokens = Math.min(settings.maxTokens ?? Math.floor(contextWindow / 4), contextWindow);
	const { reasoning, map } = thinkingFrom(model.meta?.llamaswap?.reasoning_levels);
	return {
		id: model.id,
		name: model.name?.trim() || model.id,
		reasoning,
		...(reasoning && map ? { thinkingLevelMap: map } : {}),
		input: (isVision(model) ? ["text", "image"] : ["text"]) as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens,
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
	const settings = await resolveSettings();
	let catalog = new Map<string, SwapModel>();

	const providerModels = () => [...catalog.values()].map((model) => toProviderModel(model, settings));

	try {
		const models = await fetchCatalog(settings.server, settings.apiKey);
		catalog = new Map(models.map((model) => [model.id, model]));
	} catch {
		// The server can be offline at startup; refreshModels fills the catalog later.
	}

	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: `${settings.server}/v1`,
		apiKey: settings.apiKey,
		api: "openai-completions",
		models: providerModels(),
		refreshModels: async (context) => {
			if (!context.allowNetwork) return providerModels();
			const server = context.baseUrl ? normalizeServer(context.baseUrl) : settings.server;
			const apiKey = context.credential?.key || settings.apiKey;
			try {
				const models = await fetchCatalog(server, apiKey, context.signal);
				catalog = new Map(models.map((model) => [model.id, model]));
			} catch {
				// Keep the last known catalog when the server is unreachable.
			}
			return providerModels();
		},
	});
}

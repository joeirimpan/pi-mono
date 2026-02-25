import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "./types.js";
import { createAssistantMessageEventStream } from "./utils/event-stream.js";

export type ApiStreamFunction = (
	model: Model<Api>,
	context: Context,
	options?: StreamOptions,
) => AssistantMessageEventStream;

export type ApiStreamSimpleFunction = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ApiProvider<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	api: TApi;
	stream: StreamFunction<TApi, TOptions>;
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

interface ApiProviderInternal {
	api: Api;
	stream: ApiStreamFunction;
	streamSimple: ApiStreamSimpleFunction;
}

type RegisteredApiProvider = {
	provider: ApiProviderInternal;
	sourceId?: string;
};

const apiProviderRegistry = new Map<string, RegisteredApiProvider>();

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	stream: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return stream(model as Model<TApi>, context, options as TOptions);
	};
}

function wrapStreamSimple<TApi extends Api>(
	api: TApi,
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>,
): ApiStreamSimpleFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return streamSimple(model as Model<TApi>, context, options);
	};
}

/**
 * Pipe all events from a source stream into a target stream.
 */
async function pipeStream(source: AssistantMessageEventStream, target: AssistantMessageEventStream): Promise<void> {
	for await (const event of source) {
		target.push(event as AssistantMessageEvent);
	}
}

/**
 * Register a provider whose module is loaded lazily on first use.
 * The loader should return a module with `stream<Name>` and `streamSimple<Name>` exports.
 */
export function registerLazyApiProvider(
	api: Api,
	loader: () => Promise<Record<string, unknown>>,
	sourceId?: string,
): void {
	// Derive export names from api id: "google-generative-ai" -> "Google", "bedrock-converse-stream" -> "Bedrock", etc.
	// We need the caller to match the module's export names, so we use a naming convention:
	// stream + capitalized first segment of the api's provider module name.
	// Instead, we just load the module and look for the two exports that match the pattern.
	let resolvedProvider: ApiProviderInternal | undefined;
	const getResolved = () => {
		if (resolvedProvider) return Promise.resolve(resolvedProvider);
		return loader().then((mod) => {
			// Find the stream and streamSimple exports
			const streamExport = Object.entries(mod).find(
				([key, val]) => key.startsWith("stream") && !key.startsWith("streamSimple") && typeof val === "function",
			);
			const streamSimpleExport = Object.entries(mod).find(
				([key, val]) => key.startsWith("streamSimple") && typeof val === "function",
			);
			if (!streamExport || !streamSimpleExport) {
				throw new Error(`Lazy provider module for "${api}" missing stream/streamSimple exports`);
			}
			resolvedProvider = {
				api,
				stream: wrapStream(api, streamExport[1] as StreamFunction),
				streamSimple: wrapStreamSimple(api, streamSimpleExport[1] as StreamFunction<Api, SimpleStreamOptions>),
			};
			// Replace registry entry with resolved provider so future lookups skip the lazy wrapper
			apiProviderRegistry.set(api, { provider: resolvedProvider, sourceId });
			return resolvedProvider;
		});
	};

	function makeErrorMessage(model: Model<Api>, err: unknown): AssistantMessage {
		return {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: err instanceof Error ? err.message : String(err),
			timestamp: Date.now(),
		};
	}

	const lazyStream: ApiStreamFunction = (model, context, options) => {
		const output = createAssistantMessageEventStream();
		getResolved()
			.then((p) => pipeStream(p.stream(model, context, options), output))
			.catch((err) => {
				output.push({ type: "error", reason: "error", error: makeErrorMessage(model, err) });
			});
		return output;
	};

	const lazyStreamSimple: ApiStreamSimpleFunction = (model, context, options) => {
		const output = createAssistantMessageEventStream();
		getResolved()
			.then((p) => pipeStream(p.streamSimple(model, context, options), output))
			.catch((err) => {
				output.push({ type: "error", reason: "error", error: makeErrorMessage(model, err) });
			});
		return output;
	};

	apiProviderRegistry.set(api, {
		provider: { api, stream: lazyStream, streamSimple: lazyStreamSimple },
		sourceId,
	});
}

export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
	provider: ApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	apiProviderRegistry.set(provider.api, {
		provider: {
			api: provider.api,
			stream: wrapStream(provider.api, provider.stream),
			streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
		},
		sourceId,
	});
}

export function getApiProvider(api: Api): ApiProviderInternal | undefined {
	return apiProviderRegistry.get(api)?.provider;
}

export function getApiProviders(): ApiProviderInternal[] {
	return Array.from(apiProviderRegistry.values(), (entry) => entry.provider);
}

export function unregisterApiProviders(sourceId: string): void {
	for (const [api, entry] of apiProviderRegistry.entries()) {
		if (entry.sourceId === sourceId) {
			apiProviderRegistry.delete(api);
		}
	}
}

export function clearApiProviders(): void {
	apiProviderRegistry.clear();
}

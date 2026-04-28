import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { expandLocalInput } from "./local-input";
import { SwePrunerClient } from "./remote-client";
import {
	PRUNE_REGISTER_PROVIDER_EVENT,
	PRUNE_REQUEST_EVENT,
	type NormalizedPruneRequest,
	type PruneResult,
} from "./types";

const PROVIDER_NAME = "swe-pruner";

type ScanParams = {
	query: string;
	input: string | string[];
	baseDir?: string;
	threshold?: number;
	maxFiles?: number;
	maxFileBytes?: number;
	lineNumbers?: boolean;
	timeoutMs?: number;
};

export default function (pi: ExtensionAPI) {
	const client = new SwePrunerClient();

	const registerProvider = () => {
		pi.events.emit(PRUNE_REGISTER_PROVIDER_EVENT, {
			name: PROVIDER_NAME,
			priority: Number(process.env.SWE_PRUNER_PROVIDER_PRIORITY ?? 100),
			capabilities: {
				multiDocument: true,
				lineSpans: true,
				scores: true,
			},
			prune: async (request: NormalizedPruneRequest, signal?: AbortSignal): Promise<PruneResult> => {
				const result = await client.prune(request, signal);
				return { ...result, provider: PROVIDER_NAME };
			},
		});
	};

	registerProvider();
	pi.on("session_start", async () => registerProvider());

	pi.registerTool({
		name: "swe_pruner_scan",
		label: "SWE-Pruner Scan",
		description:
			"Scan local files/directories/globs for a task-specific query using the SWE-Pruner provider. Returns plain text with real newlines.",
		promptSnippet: "Task-aware pruning scan over local files/directories/globs using SWE-Pruner.",
		promptGuidelines: [
			"Use swe_pruner_scan when a large file or small candidate set needs task-aware pruning before deeper reading.",
			"Use swe_pruner_scan with a specific query and input path/directory/glob; it reads local files before delegating model inference to the remote SWE-Pruner backend.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Natural-language goal for what to preserve." }),
			input: Type.Union([Type.String(), Type.Array(Type.String())], {
				description: "Local file, directory, glob, or array of local files/directories/globs.",
			}),
			baseDir: Type.Optional(Type.String({ description: "Base directory for resolving relative inputs." })),
			threshold: Type.Optional(Type.Number({ default: 0.5 })),
			maxFiles: Type.Optional(Type.Number({ default: 50 })),
			maxFileBytes: Type.Optional(Type.Number({ default: 500_000 })),
			lineNumbers: Type.Optional(Type.Boolean({ default: true })),
			timeoutMs: Type.Optional(Type.Number({ default: 60_000 })),
		}),
		prepareArguments(args): ScanParams {
			if (!args || typeof args !== "object") return args as ScanParams;
			const input = args as Record<string, unknown>;
			if (input.input === undefined) {
				if (typeof input.path === "string") return { ...input, input: input.path } as ScanParams;
				if (Array.isArray(input.paths)) return { ...input, input: input.paths } as ScanParams;
			}
			return args as ScanParams;
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const documents = await expandLocalInput(params.input, {
				baseDir: params.baseDir ?? ctx.cwd,
				maxFiles: params.maxFiles,
				maxFileBytes: params.maxFileBytes,
			});
			if (documents.length === 0) {
				throw new Error(`No readable text files matched input: ${JSON.stringify(params.input)}`);
			}
			const request: NormalizedPruneRequest = {
				goal: params.query,
				documents,
				options: {
					threshold: params.threshold,
					lineNumbers: params.lineNumbers ?? true,
					timeoutMs: params.timeoutMs,
				},
				metadata: {
					caller: "swe_pruner_scan",
					cwd: ctx.cwd,
				},
			};

			const result = await pruneViaRouterOrDirect(pi, client, request, signal, ctx);
			return {
				content: [{ type: "text", text: result.text }],
				details: {
					...result,
					expandedPaths: documents.map((document) => document.source ?? document.id),
				},
			};
		},
	});
}

async function pruneViaRouterOrDirect(
	pi: ExtensionAPI,
	client: SwePrunerClient,
	request: NormalizedPruneRequest,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<PruneResult> {
	try {
		return await requestThroughRouter(pi, request, signal, request.options?.timeoutMs ?? 60_000);
	} catch (error) {
		ctx.ui?.notify?.(`prune router unavailable; calling SWE-Pruner backend directly`, "warning");
		const result = await client.prune(request, signal);
		return { ...result, provider: PROVIDER_NAME, warnings: [...(result.warnings ?? []), `Router fallback: ${error instanceof Error ? error.message : String(error)}`] };
	}
}

function requestThroughRouter(
	pi: ExtensionAPI,
	request: NormalizedPruneRequest,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<PruneResult> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("No prune router responded")), Math.min(timeoutMs, 5_000));
		pi.events.emit(PRUNE_REQUEST_EVENT, {
			request: {
				goal: request.goal,
				input: request.documents,
				preserve: request.preserve,
				budget: request.budget,
				metadata: request.metadata,
				options: request.options,
			},
			signal,
			resolve: (result: PruneResult) => {
				clearTimeout(timeout);
				resolve(result);
			},
			reject: (error: unknown) => {
				clearTimeout(timeout);
				reject(error);
			},
		});
	});
}

export { SwePrunerClient } from "./remote-client";
export * from "./types";

import type { NormalizedPruneRequest, PruneResult, RemotePruneResponse } from "./types";

export interface SwePrunerClientOptions {
	baseUrl?: string;
	timeoutMs?: number;
}

export class SwePrunerClient {
	readonly baseUrl: string;
	readonly timeoutMs: number;

	constructor(options: SwePrunerClientOptions = {}) {
		this.baseUrl = (options.baseUrl ?? process.env.SWE_PRUNER_REMOTE_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");
		this.timeoutMs = options.timeoutMs ?? Number(process.env.SWE_PRUNER_TIMEOUT_MS ?? 60_000);
	}

	async health(signal?: AbortSignal): Promise<unknown> {
		const response = await fetch(`${this.baseUrl}/health`, { signal });
		if (!response.ok) throw new Error(`SWE-Pruner health failed: ${response.status} ${await response.text()}`);
		return response.json();
	}

	async prune(request: NormalizedPruneRequest, signal?: AbortSignal): Promise<PruneResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), request.options?.timeoutMs ?? this.timeoutMs);
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const response = await fetch(`${this.baseUrl}/prune`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(request),
				signal: controller.signal,
			});
			const body = await response.text();
			if (!response.ok) throw new Error(`SWE-Pruner prune failed: ${response.status} ${body}`);
			const data = JSON.parse(body) as RemotePruneResponse;
			if (!data.ok) throw new Error(data.warnings?.join("; ") || "SWE-Pruner backend returned ok=false");
			return {
				text: data.text,
				documents: data.documents,
				stats: data.stats,
				warnings: data.warnings,
				provider: "swe-pruner",
			};
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		}
	}
}

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SwePrunerClient } from "./remote-client";
import {
	PRUNE_REGISTER_PROVIDER_EVENT,
	PRUNE_UNREGISTER_PROVIDER_EVENT,
	type NormalizedPruneRequest,
	type PruneResult,
} from "./types";

const PROVIDER_NAME = "swe-pruner";
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_HEALTH_INTERVAL_MS = 30_000;

export default function (pi: ExtensionAPI) {
	const client = new SwePrunerClient();
	let registered = false;

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
		registered = true;
	};

	const unregisterProvider = () => {
		if (!registered) return;
		pi.events.emit(PRUNE_UNREGISTER_PROVIDER_EVENT, { name: PROVIDER_NAME });
		registered = false;
	};

	const probeAndSyncRegistration = async (options: { refresh?: boolean } = {}) => {
		try {
			await probeHealth(client);
			if (!registered || options.refresh) registerProvider();
		} catch {
			unregisterProvider();
		}
	};

	void probeAndSyncRegistration();
	pi.on("session_start", async () => probeAndSyncRegistration({ refresh: true }));

	const intervalMs = Number(process.env.SWE_PRUNER_HEALTH_INTERVAL_MS ?? DEFAULT_HEALTH_INTERVAL_MS);
	if (Number.isFinite(intervalMs) && intervalMs > 0) {
		const interval = setInterval(() => void probeAndSyncRegistration(), intervalMs);
		(interval as { unref?: () => void }).unref?.();
	}
}

async function probeHealth(client: SwePrunerClient): Promise<void> {
	const timeoutMs = Number(process.env.SWE_PRUNER_HEALTH_TIMEOUT_MS ?? DEFAULT_HEALTH_TIMEOUT_MS);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		await client.health(controller.signal);
	} finally {
		clearTimeout(timeout);
	}
}

export { SwePrunerClient } from "./remote-client";
export * from "./types";

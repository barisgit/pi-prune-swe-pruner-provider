import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SwePrunerClient } from "./remote-client";
import {
	PRUNE_REGISTER_PROVIDER_EVENT,
	type NormalizedPruneRequest,
	type PruneResult,
} from "./types";

const PROVIDER_NAME = "swe-pruner";

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
}

export { SwePrunerClient } from "./remote-client";
export * from "./types";

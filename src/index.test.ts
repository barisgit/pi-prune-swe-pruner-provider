import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import extension from "./index";
import { PRUNE_REGISTER_PROVIDER_EVENT, PRUNE_UNREGISTER_PROVIDER_EVENT } from "./types";

const originalFetch = globalThis.fetch;
const originalInterval = process.env.SWE_PRUNER_HEALTH_INTERVAL_MS;
const originalTimeout = process.env.SWE_PRUNER_HEALTH_TIMEOUT_MS;

type Handler = () => unknown | Promise<unknown>;

function createPiMock() {
	const emitted: Array<{ event: string; payload: unknown }> = [];
	const handlers = new Map<string, Handler>();
	const pi = {
		events: {
			emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
		},
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI;
	return { pi, emitted, handlers };
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	process.env.SWE_PRUNER_HEALTH_INTERVAL_MS = "0";
	process.env.SWE_PRUNER_HEALTH_TIMEOUT_MS = "1000";
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalInterval === undefined) delete process.env.SWE_PRUNER_HEALTH_INTERVAL_MS;
	else process.env.SWE_PRUNER_HEALTH_INTERVAL_MS = originalInterval;
	if (originalTimeout === undefined) delete process.env.SWE_PRUNER_HEALTH_TIMEOUT_MS;
	else process.env.SWE_PRUNER_HEALTH_TIMEOUT_MS = originalTimeout;
});

describe("swe-pruner provider registration", () => {
	it("registers only after health succeeds", async () => {
		globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
		const { pi, emitted } = createPiMock();

		extension(pi);
		await flush();

		expect(emitted.map((entry) => entry.event)).toContain(PRUNE_REGISTER_PROVIDER_EVENT);
	});

	it("does not register when health fails", async () => {
		globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
		const { pi, emitted } = createPiMock();

		extension(pi);
		await flush();

		expect(emitted.map((entry) => entry.event)).not.toContain(PRUNE_REGISTER_PROVIDER_EVENT);
	});

	it("re-announces a healthy provider on session start", async () => {
		globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
		const { pi, emitted, handlers } = createPiMock();

		extension(pi);
		await flush();
		await handlers.get("session_start")?.();
		await flush();

		expect(emitted.map((entry) => entry.event)).toEqual([
			PRUNE_REGISTER_PROVIDER_EVENT,
			PRUNE_REGISTER_PROVIDER_EVENT,
		]);
	});

	it("unregisters after a later failed probe", async () => {
		let healthy = true;
		globalThis.fetch = (async () => healthy
			? new Response("{}", { status: 200 })
			: new Response("down", { status: 503 })) as unknown as typeof fetch;
		const { pi, emitted, handlers } = createPiMock();

		extension(pi);
		await flush();
		healthy = false;
		await handlers.get("session_start")?.();
		await flush();

		expect(emitted.map((entry) => entry.event)).toEqual([
			PRUNE_REGISTER_PROVIDER_EVENT,
			PRUNE_UNREGISTER_PROVIDER_EVENT,
		]);
	});
});

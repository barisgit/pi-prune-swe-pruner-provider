import { describe, expect, it } from "bun:test";
import { SwePrunerClient } from "./remote-client";

describe("SwePrunerClient", () => {
	it("constructs with default configuration", () => {
		expect(new SwePrunerClient()).toBeInstanceOf(SwePrunerClient);
	});
});

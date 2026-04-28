import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { expandLocalInput } from "./local-input";

describe("expandLocalInput", () => {
	it("reads local files into prune documents", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-prune-provider-"));
		try {
			const file = join(dir, "demo.ts");
			await writeFile(file, "export const demo = 1;", "utf8");
			const docs = await expandLocalInput(file, { maxFiles: 5 });
			expect(docs).toHaveLength(1);
			expect(docs[0]?.source).toBe(file);
			expect(docs[0]?.text).toContain("demo");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readdirSync, statSync } from "node:fs";
import type { PruneDocument } from "./types";

const DEFAULT_EXCLUDES = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"vendor",
	"dist",
	"build",
	".next",
	".turbo",
	".venv",
	"venv",
	"__pycache__",
	"target",
	"coverage",
]);

const TEXT_EXTENSIONS = new Set([
	".astro",
	".bash",
	".c",
	".cc",
	".cfg",
	".clj",
	".cpp",
	".cs",
	".css",
	".dart",
	".env",
	".go",
	".h",
	".hpp",
	".html",
	".java",
	".js",
	".json",
	".jsx",
	".kt",
	".lua",
	".mjs",
	".md",
	".mdx",
	".php",
	".proto",
	".py",
	".rb",
	".rs",
	".scss",
	".sh",
	".sql",
	".svelte",
	".toml",
	".ts",
	".tsx",
	".txt",
	".vue",
	".xml",
	".yaml",
	".yml",
	"",
]);

export interface ExpandLocalInputOptions {
	baseDir?: string;
	maxFiles?: number;
	maxFileBytes?: number;
}

export async function expandLocalInput(input: string | string[], options: ExpandLocalInputOptions = {}): Promise<PruneDocument[]> {
	const targets = Array.isArray(input) ? input : [input];
	const baseDir = resolve(options.baseDir ?? process.cwd());
	const maxFiles = options.maxFiles ?? 50;
	const maxFileBytes = options.maxFileBytes ?? 500_000;
	const paths: string[] = [];
	const seen = new Set<string>();

	for (const target of targets) {
		for (const candidate of expandTarget(target, baseDir)) {
			const absolute = resolve(candidate);
			if (seen.has(absolute)) continue;
			seen.add(absolute);
			paths.push(absolute);
			if (paths.length >= maxFiles) break;
		}
		if (paths.length >= maxFiles) break;
	}

	const documents: PruneDocument[] = [];
	for (const path of paths) {
		const info = await stat(path).catch(() => undefined);
		if (!info?.isFile() || info.size > maxFileBytes || !isTextLike(path)) continue;
		const text = await readFile(path, "utf8").catch(() => undefined);
		if (text === undefined || text.includes("\u0000")) continue;
		documents.push({ id: path, source: path, text });
	}
	return documents;
}

function expandTarget(target: string, baseDir: string): string[] {
	const expanded = target.replace(/^~/, process.env.HOME ?? "~");
	const absoluteTarget = resolve(baseDir, expanded);
	if (hasGlob(expanded)) return globFiles(baseDir, absoluteTarget);
	const info = statSync(absoluteTarget, { throwIfNoEntry: false });
	if (!info) return [];
	if (info.isFile()) return [absoluteTarget];
	if (info.isDirectory()) return walk(absoluteTarget);
	return [];
}

function walk(root: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (DEFAULT_EXCLUDES.has(entry.name)) continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) out.push(...walk(path));
		else if (entry.isFile()) out.push(path);
	}
	return out;
}

function globFiles(baseDir: string, absolutePattern: string): string[] {
	const files = walk(baseDir);
	const regex = globToRegex(absolutePattern);
	return files.filter((file) => regex.test(resolve(file)));
}

function hasGlob(value: string): boolean {
	return /[*?[\]]/.test(value);
}

function isTextLike(path: string): boolean {
	const dot = path.lastIndexOf(".");
	const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
	return TEXT_EXTENSIONS.has(ext);
}

function globToRegex(pattern: string): RegExp {
	let out = "^";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		const next = pattern[i + 1];
		if (char === "*" && next === "*") {
			out += ".*";
			i++;
		} else if (char === "*") {
			out += "[^/]*";
		} else if (char === "?") {
			out += "[^/]";
		} else {
			out += char.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
		}
	}
	out += "$";
	return new RegExp(out);
}

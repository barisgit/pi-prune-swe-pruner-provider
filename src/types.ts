export const PRUNE_REGISTER_PROVIDER_EVENT = "prune:register-provider";
export const PRUNE_REQUEST_EVENT = "prune:request";

export interface PruneDocument {
	id?: string;
	source?: string;
	text: string;
	hints?: { mimeType?: string; language?: string; lineOffset?: number };
	metadata?: Record<string, unknown>;
}

export interface NormalizedPruneRequest {
	goal: string;
	documents: PruneDocument[];
	preserve?: string[];
	budget?: { tokens?: number; chars?: number; ratio?: number };
	metadata?: Record<string, unknown>;
	options?: {
		threshold?: number;
		lineNumbers?: boolean;
		chunkOverlapTokens?: number;
		maxOutputDocuments?: number;
		includeScores?: boolean;
		includeSpans?: boolean;
		timeoutMs?: number;
	};
	artifact?: { path: string; metadataPath?: string; bytes: number; documentCount: number };
}

export interface PruneDocumentResult {
	id?: string;
	source?: string;
	text: string;
	score?: number;
	spans?: Array<{ startLine?: number; endLine?: number; startChar?: number; endChar?: number; score?: number }>;
	stats?: { inputTokens?: number; outputTokens?: number; compressionRatio?: number; latencyMs?: number };
}

export interface PruneResult {
	text: string;
	documents?: PruneDocumentResult[];
	stats?: { inputTokens?: number; outputTokens?: number; compressionRatio?: number; latencyMs?: number; backend?: string; model?: string; provider?: string };
	warnings?: string[];
	artifact?: { path: string; metadataPath?: string; bytes: number; documentCount: number };
	provider?: string;
}

export interface RemotePruneResponse extends PruneResult {
	ok: boolean;
}

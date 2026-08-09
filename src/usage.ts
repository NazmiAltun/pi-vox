import { appendFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const EVENTS_PATH = join(homedir(), '.pi', 'agent', 'pi-usage-events.jsonl');

export const voiceEventsPath = () => process.env.PI_VOX_USAGE_EVENTS_PATH || EVENTS_PATH;

const hashValue = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24);

export function resolveSessionId(ctx: any): string {
	const sessionFile = ctx?.sessionManager?.getSessionFile?.();
	if (sessionFile) return hashValue(sessionFile);
	return hashValue(`${ctx?.cwd ?? 'unknown'}:${process.pid}`);
}

export function repoName(cwd: string | undefined): string {
	return (cwd && basename(cwd)) || 'unknown';
}

export function mapVoiceErrorCode(code: string | undefined): string {
	switch (code) {
		case 'missing_api_key':
		case 'auth_error':
			return 'auth';
		case 'network_error':
		case 'api_error':
			return 'provider_error';
		case 'empty_transcript':
			return 'unsupported_input';
		case 'missing_fetch':
			return 'unknown';
		default:
			return 'unknown';
	}
}

export function extractProviderMetrics(raw: unknown, provider: string): {
	languageCode?: string;
	languageProbability?: number;
	wordCount?: number;
	mimoTokens?: { prompt?: number; completion?: number; total?: number };
} {
	if (!raw || typeof raw !== 'object') return {};
	const r = raw as Record<string, unknown>;
	if (provider === 'elevenlabs') {
		const metrics: { languageCode?: string; languageProbability?: number; wordCount?: number } = {};
		if (typeof r.language_code === 'string') metrics.languageCode = r.language_code;
		if (typeof r.language_probability === 'number') metrics.languageProbability = r.language_probability;
		if (Array.isArray(r.words)) metrics.wordCount = r.words.length;
		return metrics;
	}
	if (provider === 'mimo') {
		const usage = r.usage as Record<string, unknown> | undefined;
		if (usage && typeof usage === 'object') {
			return {
				mimoTokens: {
					prompt: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
					completion: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
					total: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
				},
			};
		}
	}
	return {};
}

export type VoiceDictationEvent = {
	event: 'voice_dictation';
	timestamp: string;
	sessionId: string;
	repo: string;
	voiceProvider: 'elevenlabs' | 'mimo' | 'unknown';
	modelId: string;
	status: 'success' | 'error';
	errorCategory?: string;
	errorCode?: string;
	recordingDurationMs?: number;
	transcribeDurationMs?: number;
	audioBytes?: number;
	transcriptChars?: number;
	transcriptWords?: number;
	languageCode?: string;
	languageProbability?: number;
	wordCount?: number;
	mimoTokens?: { prompt?: number; completion?: number; total?: number };
	mode?: string;
	source?: string;
	recorder?: string;
	autoSubmit?: boolean;
	inserted?: boolean;
};

export function recordVoiceDictation(event: Omit<VoiceDictationEvent, 'event' | 'timestamp'>): void {
	try {
		const path = voiceEventsPath();
		if (!existsSync(path)) return;
		const line = JSON.stringify({ event: 'voice_dictation', timestamp: new Date().toISOString(), ...event }) + '\n';
		appendFileSync(path, line, 'utf8');
	} catch {
		// Telemetry must never break the voice flow.
	}
}

export function audioBytes(file: string | null): number | undefined {
	if (!file) return undefined;
	try {
		return statSync(file).size;
	} catch {
		return undefined;
	}
}
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { safeError } from './config.js';

export class TranscriptionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function normalizeTranscript(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.text ?? value.transcript ?? value.result ?? '').trim();
}

export async function transcribeWithElevenLabs(audioFile, config, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const readFile = deps.readFileSync ?? readFileSync;
  if (!config?.elevenLabsApiKey) throw new TranscriptionError('missing_api_key', 'ELEVENLABS_API_KEY is not configured.');
  if (!fetchImpl) throw new TranscriptionError('missing_fetch', 'fetch is not available in this runtime.');

  const audio = readFile(audioFile);
  const form = new FormData();
  form.append('file', new Blob([audio]), basename(audioFile));
  form.append('model_id', config.modelId ?? 'scribe_v1');

  let response;
  try {
    response = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': config.elevenLabsApiKey }, body: form, signal: deps.signal });
  } catch (error) {
    throw new TranscriptionError('network_error', safeError(error, [config.elevenLabsApiKey]));
  }

  if (!response.ok) {
    const body = await response.text?.().catch(() => '') ?? '';
    const code = response.status === 401 || response.status === 403 ? 'auth_error' : 'api_error';
    throw new TranscriptionError(code, safeError(`ElevenLabs request failed (${response.status}): ${body}`, [config.elevenLabsApiKey]));
  }
  const payload = await response.json();
  const text = normalizeTranscript(payload);
  if (!text) throw new TranscriptionError('empty_transcript', 'ElevenLabs returned an empty transcript.');
  return { text, provider: 'elevenlabs', raw: payload };
}

export function createProvider(config, deps = {}) {
  if ((config.provider ?? 'elevenlabs') !== 'elevenlabs') throw new Error(`Unsupported voice provider: ${config.provider}`);
  return { transcribe: (file, options = {}) => transcribeWithElevenLabs(file, { ...config, ...options }, deps) };
}

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { safeError } from './config.ts';

export const DEFAULT_MIMO_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
export const DEFAULT_MIMO_MODEL = 'mimo-v2.5-asr';
export const DEFAULT_MIMO_LANGUAGE = 'auto';
export const DEFAULT_MIMO_CREDENTIAL_PROVIDER = 'xiaomi-token-plan-sgp';

export class TranscriptionError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export class SynthesisError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function normalizeTranscript(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.text ?? value.transcript ?? value.result ?? '').trim();
}

export function normalizeMimoTranscript(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.choices?.[0]?.message?.content ?? '').trim();
}

export async function transcribeWithElevenLabs(audioFile: string, config: any, deps: any = {}) {
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
    throw new TranscriptionError('network_error', String(safeError(error, [config.elevenLabsApiKey])));
  }

  if (!response.ok) {
    const body = await response.text?.().catch(() => '') ?? '';
    const code = response.status === 401 || response.status === 403 ? 'auth_error' : 'api_error';
    throw new TranscriptionError(code, String(safeError(`ElevenLabs request failed (${response.status}): ${body}`, [config.elevenLabsApiKey])));
  }
  const payload = await response.json();
  const text = normalizeTranscript(payload);
  if (!text) throw new TranscriptionError('empty_transcript', 'ElevenLabs returned an empty transcript.');
  return { text, provider: 'elevenlabs', raw: payload };
}

export async function resolveMimoAuth(config: any, deps: any = {}) {
  const providerId = config.mimoCredentialProvider ?? DEFAULT_MIMO_CREDENTIAL_PROVIDER;
  const modelRegistry = deps.modelRegistry ?? deps.context?.modelRegistry;
  const getProviderAuth = modelRegistry?.getProviderAuth;
  const provider = modelRegistry?.getProvider?.(providerId);
  const endpoint = config?.mimoEndpoint
    ?? (provider?.baseUrl ? `${provider.baseUrl.replace(/\/$/, '')}/chat/completions` : undefined)
    ?? DEFAULT_MIMO_ENDPOINT;
  if (typeof getProviderAuth === 'function') {
    const result = await getProviderAuth.call(modelRegistry, providerId);
    const key = result?.auth?.apiKey ?? result?.apiKey ?? result?.key;
    if (key) return { apiKey: key, endpoint };
  }
  return { apiKey: config?.mimoApiKey ?? '', endpoint };
}

export async function resolveMimoApiKey(config: any, deps: any = {}) {
  return (await resolveMimoAuth(config, deps)).apiKey;
}

export async function transcribeWithMimo(audioFile: string, config: any, deps: any = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const readFile = deps.readFileSync ?? readFileSync;
  const { apiKey, endpoint } = await resolveMimoAuth(config, deps);
  if (!apiKey) throw new TranscriptionError('missing_api_key', 'Mimo API key is not configured in Pi auth or MIMO_API_KEY.');
  if (!fetchImpl) throw new TranscriptionError('missing_fetch', 'fetch is not available in this runtime.');

  const audio = readFile(audioFile);
  const audioData = `data:audio/wav;base64,${Buffer.from(audio).toString('base64')}`;
  const body = {
    model: config.mimoModelId ?? DEFAULT_MIMO_MODEL,
    messages: [{
      role: 'user',
      content: [{ type: 'input_audio', input_audio: { data: audioData } }],
    }],
    asr_options: { language: config.mimoLanguage ?? DEFAULT_MIMO_LANGUAGE },
  };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: deps.signal,
    });
  } catch (error) {
    throw new TranscriptionError('network_error', String(safeError(error, [apiKey])));
  }

  if (!response.ok) {
    const responseBody = await response.text?.().catch(() => '') ?? '';
    const code = response.status === 401 || response.status === 403 ? 'auth_error' : 'api_error';
    throw new TranscriptionError(code, String(safeError(`Mimo request failed (${response.status}): ${responseBody}`, [apiKey])));
  }

  const payload = await response.json();
  const text = normalizeMimoTranscript(payload);
  if (!text) throw new TranscriptionError('empty_transcript', 'Mimo returned an empty transcript.');
  return { text, provider: 'mimo', raw: payload };
}

export async function synthesizeWithMimo(text: string, config: any, deps: any = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const { apiKey, endpoint } = await resolveMimoAuth(config, deps);
  if (!apiKey) throw new SynthesisError('missing_api_key', 'Mimo API key is not configured in Pi auth or MIMO_API_KEY.');
  if (!fetchImpl) throw new SynthesisError('missing_fetch', 'fetch is not available in this runtime.');

  const body = {
    model: config.mimoTtsModelId ?? 'mimo-v2.5-tts',
    messages: [{ role: 'assistant', content: text }],
    audio: {
      format: 'wav',
      voice: config.mimoTtsVoice ?? 'mimo_default',
    },
  };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: deps.signal,
    });
  } catch (error) {
    throw new SynthesisError('network_error', String(safeError(error, [apiKey])));
  }

  if (!response.ok) {
    const responseBody = await response.text?.().catch(() => '') ?? '';
    const code = response.status === 401 || response.status === 403 ? 'auth_error' : 'api_error';
    throw new SynthesisError(code, String(safeError(`Mimo TTS request failed (${response.status}): ${responseBody}`, [apiKey])));
  }

  const payload = await response.json();
  const audioData = payload.choices?.[0]?.message?.audio?.data;
  if (typeof audioData !== 'string' || !audioData) throw new SynthesisError('empty_audio', 'Mimo returned no audio data.');
  return { audio: Buffer.from(audioData, 'base64'), extension: 'wav', provider: 'mimo', modelId: body.model, raw: payload };
}

export async function synthesizeWithElevenLabs(text: string, config: any, deps: any = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const apiKey = config?.elevenLabsApiKey;
  const voiceId = config?.elevenLabsTtsVoiceId;
  if (!apiKey) throw new SynthesisError('missing_api_key', 'ELEVENLABS_API_KEY is not configured.');
  if (!voiceId) throw new SynthesisError('missing_voice', 'elevenLabsTtsVoiceId is not configured.');
  if (!fetchImpl) throw new SynthesisError('missing_fetch', 'fetch is not available in this runtime.');

  const modelId = config.elevenLabsTtsModelId ?? 'eleven_multilingual_v2';
  const outputFormat = config.elevenLabsTtsOutputFormat ?? 'mp3_44100_128';
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: modelId }),
      signal: deps.signal,
    });
  } catch (error) {
    throw new SynthesisError('network_error', String(safeError(error, [apiKey])));
  }

  if (!response.ok) {
    const responseBody = await response.text?.().catch(() => '') ?? '';
    const code = response.status === 401 || response.status === 403 ? 'auth_error' : 'api_error';
    throw new SynthesisError(code, String(safeError(`ElevenLabs TTS request failed (${response.status}): ${responseBody}`, [apiKey])));
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new SynthesisError('empty_audio', 'ElevenLabs returned no audio data.');
  const extension = outputFormat.startsWith('wav') ? 'wav' : 'mp3';
  return { audio, extension, provider: 'elevenlabs', modelId, raw: undefined };
}

export function createProvider(config: any, deps: any = {}) {
  if (config.provider === 'mimo') {
    return { transcribe: (file: string, options: any = {}) => transcribeWithMimo(file, { ...config, ...options }, deps) };
  }
  if ((config.provider ?? 'elevenlabs') === 'elevenlabs') {
    return { transcribe: (file: string, options: any = {}) => transcribeWithElevenLabs(file, { ...config, ...options }, deps) };
  }
  throw new Error(`Unsupported voice provider: ${config.provider}`);
}

export function createTtsProvider(config: any, deps: any = {}) {
  if (config.ttsProvider === 'elevenlabs') {
    return { synthesize: (text: string, options: any = {}) => synthesizeWithElevenLabs(text, { ...config, ...options }, { ...deps, signal: options.signal }) };
  }
  if ((config.ttsProvider ?? 'mimo') === 'mimo') {
    return { synthesize: (text: string, options: any = {}) => synthesizeWithMimo(text, { ...config, ...options }, { ...deps, signal: options.signal }) };
  }
  throw new Error(`Unsupported TTS provider: ${config.ttsProvider}`);
}

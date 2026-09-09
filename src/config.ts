import { existsSync, readFileSync } from 'node:fs';

export const DEFAULT_VOICE_SHORTCUT = 'ctrl+q';
export const DEFAULT_TTS_SHORTCUT = 'ctrl+shift+space';

export const VOICE_CONFIG_DEFAULTS = Object.freeze({
  provider: 'elevenlabs',
  shortcut: DEFAULT_VOICE_SHORTCUT,
  ttsShortcut: DEFAULT_TTS_SHORTCUT,
  ttsProvider: 'mimo',
  autoSubmit: false,
  appendMode: 'append',
  envFile: '.env',
  mimoModelId: 'mimo-v2.5-asr',
  mimoLanguage: 'auto',
  mimoCredentialProvider: 'xiaomi-token-plan-sgp',
  mimoTtsModelId: 'mimo-v2.5-tts',
  mimoTtsVoice: 'mimo_default',
  elevenLabsTtsModelId: 'eleven_multilingual_v2',
  elevenLabsTtsVoiceId: '',
  elevenLabsTtsOutputFormat: 'mp3_44100_128',
  ttsChunkSize: 2000,
  recorder: 'auto',
  ffmpegPath: 'ffmpeg',
  inputFormat: process.platform === 'darwin' ? 'avfoundation' : process.platform === 'win32' ? 'dshow' : 'pulse',
  input: process.platform === 'darwin' ? ':0' : process.platform === 'win32' ? 'audio=Microphone' : 'default',
  sampleRate: 16000,
  channels: 1,
  transcriptCleanup: true,
  transcriptGlossary: undefined,
  transcriptReplacements: undefined,
});

const SECRET_PATTERNS = [
  /ELEVENLABS_API_KEY\s*=\s*[^\s]+/gi,
  /MIMO_API_KEY\s*=\s*[^\s]+/gi,
  /XIAOMI(?:_TOKEN_PLAN_(?:SGP|CN|AMS))?_API_KEY\s*=\s*[^\s]+/gi,
  /Authorization\s*:\s*Bearer\s+[^\s]+/gi,
  /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/g,
];

export function redactSecrets(value: unknown, additionalSecrets: string[] = []) {
  if (value == null) return value;
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, (m) => {
    if (/^ELEVENLABS_API_KEY/i.test(m)) return 'ELEVENLABS_API_KEY=<redacted>';
    if (/^MIMO_API_KEY/i.test(m)) return 'MIMO_API_KEY=<redacted>';
    if (/^XIAOMI/i.test(m)) return 'XIAOMI_API_KEY=<redacted>';
    if (/^Authorization/i.test(m)) return 'Authorization: Bearer <redacted>';
    return 'Bearer <redacted>';
  });
  const secrets = [
    process.env.ELEVENLABS_API_KEY,
    process.env.MIMO_API_KEY,
    process.env.XIAOMI_API_KEY,
    process.env.XIAOMI_TOKEN_PLAN_SGP_API_KEY,
    process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY,
    process.env.XIAOMI_TOKEN_PLAN_AMS_API_KEY,
    ...additionalSecrets,
  ].filter(Boolean);
  for (const secret of secrets) text = text.split(secret).join('<redacted>');
  return text;
}

export function parseDotEnv(text: unknown) {
  const env: Record<string, string> = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

export function readEnvFile(path = '.env', fs = { existsSync, readFileSync }) {
  if (!path || !fs.existsSync(path)) return {};
  return parseDotEnv(fs.readFileSync(path, 'utf8'));
}

export function loadVoiceConfig(options: any = {}, env: any = process.env, fs?: any) {
  const merged = { ...VOICE_CONFIG_DEFAULTS, ...(options.voice ?? options) };
  const fileEnv = readEnvFile(merged.envFile, fs ?? { existsSync, readFileSync });
  const elevenLabsApiKey = env.ELEVENLABS_API_KEY || fileEnv.ELEVENLABS_API_KEY || merged.elevenLabsApiKey || merged.apiKey || '';
  const mimoApiKey = env.MIMO_API_KEY
    || env.XIAOMI_TOKEN_PLAN_SGP_API_KEY
    || env.XIAOMI_API_KEY
    || fileEnv.MIMO_API_KEY
    || fileEnv.XIAOMI_TOKEN_PLAN_SGP_API_KEY
    || fileEnv.XIAOMI_API_KEY
    || merged.mimoApiKey
    || '';
  return {
    ...merged,
    elevenLabsApiKey,
    hasElevenLabsApiKey: Boolean(elevenLabsApiKey),
    mimoApiKey,
    hasMimoApiKey: Boolean(mimoApiKey),
    diagnostics: buildConfigDiagnostics({ ...merged, elevenLabsApiKey, mimoApiKey }),
  };
}

export function buildConfigDiagnostics(config: any) {
  const diagnostics = [];
  if ((config.provider === 'elevenlabs' || config.ttsProvider === 'elevenlabs') && !config.elevenLabsApiKey) {
    diagnostics.push({ level: 'warning', code: 'missing_elevenlabs_api_key', message: 'ELEVENLABS_API_KEY is not configured for the selected voice features.' });
  }
  if (config.ttsProvider === 'elevenlabs' && !config.elevenLabsTtsVoiceId) {
    diagnostics.push({ level: 'warning', code: 'missing_elevenlabs_tts_voice', message: 'elevenLabsTtsVoiceId is required when ElevenLabs is selected for text-to-speech.' });
  }
  if (config.autoSubmit === true) diagnostics.push({ level: 'info', code: 'auto_submit_enabled', message: 'Voice auto-submit is enabled; dictated text will be sent automatically after transcription.' });
  return diagnostics.map((d) => ({ ...d, message: redactSecrets(d.message) }));
}

export function safeError(error: unknown, additionalSecrets: string[] = []) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, additionalSecrets);
}

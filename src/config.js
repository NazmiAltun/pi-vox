import { existsSync, readFileSync } from 'node:fs';

export const VOICE_CONFIG_DEFAULTS = Object.freeze({
  enabled: true,
  provider: 'elevenlabs',
  holdKey: 'space',
  holdToTalk: false,
  holdThresholdMs: 350,
  fallbackToggleShortcut: 'ctrl+v',
  cancelShortcut: 'escape',
  autoSubmit: false,
  appendMode: 'append',
  envFile: '.env',
  recorder: 'auto',
});

const SECRET_PATTERNS = [
  /ELEVENLABS_API_KEY\s*=\s*[^\s]+/gi,
  /Authorization\s*:\s*Bearer\s+[^\s]+/gi,
  /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/g,
];

export function redactSecrets(value, additionalSecrets = []) {
  if (value == null) return value;
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, (m) => {
    if (/^ELEVENLABS_API_KEY/i.test(m)) return 'ELEVENLABS_API_KEY=<redacted>';
    if (/^Authorization/i.test(m)) return 'Authorization: Bearer <redacted>';
    return 'Bearer <redacted>';
  });
  const secrets = [process.env.ELEVENLABS_API_KEY, ...additionalSecrets].filter(Boolean);
  for (const secret of secrets) text = text.split(secret).join('<redacted>');
  return text;
}

export function parseDotEnv(text) {
  const env = {};
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

export function loadVoiceConfig(options = {}, env = process.env, fs) {
  const merged = { ...VOICE_CONFIG_DEFAULTS, ...(options.voice ?? options) };
  const fileEnv = readEnvFile(merged.envFile, fs ?? { existsSync, readFileSync });
  const apiKey = env.ELEVENLABS_API_KEY || fileEnv.ELEVENLABS_API_KEY || '';
  return {
    ...merged,
    elevenLabsApiKey: apiKey,
    hasElevenLabsApiKey: Boolean(apiKey),
    diagnostics: buildConfigDiagnostics({ ...merged, apiKey }),
  };
}

export function buildConfigDiagnostics(config) {
  const diagnostics = [];
  if (config.provider === 'elevenlabs' && !config.apiKey && !config.elevenLabsApiKey) {
    diagnostics.push({ level: 'warning', code: 'missing_elevenlabs_api_key', message: 'ELEVENLABS_API_KEY is not configured in the environment or .env file.' });
  }
  if (config.autoSubmit === true) diagnostics.push({ level: 'info', code: 'auto_submit_enabled', message: 'Voice auto-submit is enabled; dictated text will be sent automatically after transcription.' });
  return diagnostics.map((d) => ({ ...d, message: redactSecrets(d.message) }));
}

export function safeError(error, additionalSecrets = []) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, additionalSecrets);
}

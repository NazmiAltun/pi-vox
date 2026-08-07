import { loadVoiceConfig, safeError } from './config.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalAudioCapture } from './audio.ts';
import { createProvider } from './providers.ts';
import { VoiceInputFlow } from './flow.ts';

export function voiceConfigPath(env: any = process.env) {
  return env.PI_VOX_CONFIG || join(homedir(), '.pi', 'pi-vox', 'config.json');
}

export function readVoiceSettingsResult(path = voiceConfigPath()) {
  if (!existsSync(path)) return { settings: {}, ok: true, missing: true };
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('voice settings must be a JSON object');
    return { settings, ok: true, missing: false };
  } catch (error) {
    return { settings: {}, ok: false, missing: false, error };
  }
}

export function readVoiceSettings(path = voiceConfigPath()) {
  return readVoiceSettingsResult(path).settings;
}

export function writeVoiceSettings(settings: any, path = voiceConfigPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function loadRuntimeVoiceConfig(options: any = {}) {
  const stored = options.ignoreStoredConfig ? {} : readVoiceSettings(options.configPath);
  return loadVoiceConfig({ ...stored, ...(options.config ?? {}) });
}

export function createVoiceRuntime(ctx: any, options: any = {}) {
  const config = loadRuntimeVoiceConfig(options);
  const recorder = options.recorder ?? new LocalAudioCapture({
    ffmpegPath: config.ffmpegPath,
    inputFormat: config.inputFormat,
    input: config.input,
    sampleRate: config.sampleRate,
    channels: config.channels,
  });
  const provider = options.provider ?? createProvider(config, { context: ctx, modelRegistry: ctx?.modelRegistry });
  return new VoiceInputFlow({ ctx, recorder, provider, config });
}

function createController(pi: any) {
  let flow: any = null;
  let mode = 'idle';
  return {
    getMode: () => mode,
    async start(ctx: any) {
      if (mode !== 'idle') return;
      flow = createVoiceRuntime({ ...ctx, pi });
      if (flow.config?.provider === 'elevenlabs' && !flow.config?.hasElevenLabsApiKey) {
        flow = null;
        throw new Error('ELEVENLABS_API_KEY is not configured. Set it before starting voice recording.');
      }
      await flow.startRecording();
      mode = 'recording';
    },
    async stop(ctx: any) {
      if (!flow || mode === 'idle') return;
      flow.ctx = { ...ctx, pi };
      mode = 'finalizing';
      try {
        const result = await flow.finalizeRecording();
        mode = 'idle';
        return result;
      } catch (error) {
        mode = 'idle';
        throw error;
      } finally {
        flow = null;
      }
    },
    async toggle(ctx: any) {
      if (mode === 'idle') return this.start(ctx);
      if (mode === 'recording') return this.stop(ctx);
    },
    dispose() { flow?.cancel?.(); flow = null; mode = 'idle'; },
  };
}

function clearVoiceUi(ctx: any) {
  ctx?.ui?.setStatus?.('voice-input', undefined);
  ctx?.ui?.setWidget?.('voice-input', undefined);
}

export const VOICE_EXTENSION_VERSION = '2026-06-11-mimo-shortcut';

export default function voiceInputExtension(pi: any) {
  const controller = createController(pi);

  pi.on('session_start', async (_event: any, ctx: any) => {
    const config = loadRuntimeVoiceConfig({});
    for (const diagnostic of config.diagnostics) ctx.ui?.notify?.(diagnostic.message, diagnostic.level === 'warning' ? 'warning' : 'info');
  });

  pi.on?.('session_shutdown', async () => {
    await controller.dispose();
  });

  pi.registerShortcut?.('ctrl+q', {
    description: 'Toggle pi-vox voice recording',
    handler: async (ctx: any) => {
      const wasIdle = controller.getMode() === 'idle';
      try {
        clearVoiceUi(ctx);
        await controller.toggle(ctx);
        ctx.ui?.notify?.(wasIdle ? 'Voice recording started. Press Ctrl+Q again to stop.' : 'Voice recording finalized.', 'info');
      } catch (error) {
        clearVoiceUi(ctx);
        ctx.ui?.notify?.(`Voice shortcut failed: ${safeError(error)}`, 'warning');
      }
    },
  });

  pi.registerCommand?.('voice-provider', {
    description: 'Select ElevenLabs or Xiaomi Mimo voice provider',
    handler: async (_args: string, ctx: any) => {
      if (controller.getMode() !== 'idle') {
        ctx.ui?.notify?.('Stop active voice recording before changing provider.', 'warning');
        return;
      }
      const current = loadRuntimeVoiceConfig({});
      const providers = ['elevenlabs', 'mimo'];
      const options = providers.map((provider) => provider === current.provider ? `✓ ${provider}` : `  ${provider}`);
      const selectedOption = await ctx.ui?.select?.('Voice provider', options);
      const selected = selectedOption?.trim().replace(/^✓\s*/, '');
      if (!selected || selected === current.provider) {
        if (selected === current.provider) ctx.ui?.notify?.(`Voice provider remains ${current.provider}.`, 'info');
        return;
      }
      if (selected !== 'elevenlabs' && selected !== 'mimo') {
        ctx.ui?.notify?.(`Unsupported voice provider: ${selected}`, 'warning');
        return;
      }
      const result = readVoiceSettingsResult();
      if (!result.ok) {
        ctx.ui?.notify?.(`Voice provider config is not valid JSON; fix ${voiceConfigPath()} before changing provider.`, 'warning');
        return;
      }
      writeVoiceSettings({ ...result.settings, provider: selected });
      ctx.ui?.notify?.(`Voice provider set to ${selected}.`, 'info');
    },
  });
}

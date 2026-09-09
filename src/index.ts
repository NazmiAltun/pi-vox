import { DEFAULT_TTS_SHORTCUT, DEFAULT_VOICE_SHORTCUT, loadVoiceConfig, safeError } from './config.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalAudioCapture, selectRecorder } from './audio.ts';
import { createProvider, createTtsProvider } from './providers.ts';
import { VoiceInputFlow } from './flow.ts';
import { LocalAudioPlayback } from './playback.ts';
import { TtsFlow } from './tts.ts';

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
  const recorderName = selectRecorder(config);
  const recorder = options.recorder ?? new LocalAudioCapture({
    recorder: recorderName,
    ffmpegPath: config.ffmpegPath,
    inputFormat: config.inputFormat,
    input: config.input,
    sampleRate: config.sampleRate,
    channels: config.channels,
  });
  const provider = options.provider ?? createProvider(config, { context: ctx, modelRegistry: ctx?.modelRegistry });
  return new VoiceInputFlow({ ctx, recorder, provider, config });
}

export function createTtsRuntime(ctx: any, options: any = {}) {
  const config = loadRuntimeVoiceConfig(options);
  const provider = options.provider ?? createTtsProvider(config, { context: ctx, modelRegistry: ctx?.modelRegistry });
  const playback = options.playback ?? new LocalAudioPlayback();
  return new TtsFlow({ ctx, provider, playback, config });
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
    async dispose() { await flow?.cancel?.(); flow = null; mode = 'idle'; },
  };
}

function createTtsController(pi: any) {
  let flow: TtsFlow | null = null;
  return {
    getFlow: () => flow,
    async toggle(ctx: any) {
      flow ??= createTtsRuntime({ ...ctx, pi });
      flow.ctx = { ...ctx, pi };
      return flow.toggle(flow.ctx);
    },
    async dispose() {
      await flow?.stop();
      flow = null;
    },
  };
}

function clearVoiceUi(ctx: any) {
  ctx?.ui?.setStatus?.('voice-input', undefined);
  ctx?.ui?.setWidget?.('voice-input', undefined);
}

export const VOICE_EXTENSION_VERSION = '2026-06-11-mimo-shortcut';

export default function voiceInputExtension(pi: any) {
  const controller = createController(pi);
  const ttsController = createTtsController(pi);
  const configuredShortcut = loadRuntimeVoiceConfig({}).shortcut;
  const shortcut = typeof configuredShortcut === 'string' && configuredShortcut.trim()
    ? configuredShortcut.trim()
    : DEFAULT_VOICE_SHORTCUT;
  const configuredTtsShortcut = loadRuntimeVoiceConfig({}).ttsShortcut;
  const ttsShortcut = typeof configuredTtsShortcut === 'string' && configuredTtsShortcut.trim()
    ? configuredTtsShortcut.trim()
    : DEFAULT_TTS_SHORTCUT;

  pi.on('session_start', async (_event: any, ctx: any) => {
    const config = loadRuntimeVoiceConfig({});
    for (const diagnostic of config.diagnostics) ctx.ui?.notify?.(diagnostic.message, diagnostic.level === 'warning' ? 'warning' : 'info');
  });

  pi.on?.('session_shutdown', async () => {
    await Promise.all([controller.dispose(), ttsController.dispose()]);
  });

  pi.registerShortcut?.(shortcut, {
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

  pi.registerShortcut?.(ttsShortcut, {
    description: 'Read latest assistant message or stop voice playback',
    handler: async (ctx: any) => {
      await ttsController.toggle(ctx);
    },
  });

  const providerOptions = (current: string) => ['elevenlabs', 'mimo'].map((provider) => provider === current ? `✓ ${provider}` : `  ${provider}`);
  const selectedProvider = (value: unknown) => typeof value === 'string' ? value.trim().replace(/^✓\s*/, '') : '';

  pi.registerCommand?.('voice-provider', {
    description: 'Select speech-to-text and text-to-speech providers',
    handler: async (_args: string, ctx: any) => {
      if (controller.getMode() !== 'idle') {
        ctx.ui?.notify?.('Stop active voice recording before changing provider.', 'warning');
        return;
      }
      const current = loadRuntimeVoiceConfig({});
      const selectedStt = selectedProvider(await ctx.ui?.select?.('Speech-to-text provider', providerOptions(current.provider)));
      if (!selectedStt) return;
      if (selectedStt !== 'elevenlabs' && selectedStt !== 'mimo') {
        ctx.ui?.notify?.(`Unsupported speech-to-text provider: ${selectedStt}`, 'warning');
        return;
      }
      const selectedTts = selectedProvider(await ctx.ui?.select?.('Text-to-speech provider', providerOptions(current.ttsProvider)));
      if (!selectedTts) return;
      if (selectedTts !== 'elevenlabs' && selectedTts !== 'mimo') {
        ctx.ui?.notify?.(`Unsupported text-to-speech provider: ${selectedTts}`, 'warning');
        return;
      }
      const result = readVoiceSettingsResult();
      if (!result.ok) {
        ctx.ui?.notify?.(`Voice provider config is not valid JSON; fix ${voiceConfigPath()} before changing provider.`, 'warning');
        return;
      }
      writeVoiceSettings({ ...result.settings, provider: selectedStt, ttsProvider: selectedTts });
      ctx.ui?.notify?.(`Speech-to-text: ${selectedStt}; text-to-speech: ${selectedTts}.`, 'info');
    },
  });

  pi.registerCommand?.('tts', {
    description: 'Read the latest assistant message aloud',
    handler: async (args: string, ctx: any) => {
      if (args?.trim()) {
        ctx.ui?.notify?.('Usage: /tts', 'warning');
        return;
      }
      await ttsController.toggle(ctx);
    },
  });
}

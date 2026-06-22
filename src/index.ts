import { loadVoiceConfig, safeError } from './config.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalAudioCapture, createAudioToolDiagnostics } from './audio.ts';
import { transcribeWithElevenLabs } from './providers.ts';
import { VoiceInputFlow } from './flow.ts';

function commandExists(name: string) {
  return spawnSync('command', ['-v', name], { stdio: 'ignore' }).status === 0;
}

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
  const provider = options.provider ?? { transcribe: (file: string, overrides: any = {}) => transcribeWithElevenLabs(file, { ...config, ...overrides }) };
  return new VoiceInputFlow({ ctx, recorder, provider, config });
}

function createController(pi: any) {
  let flow: any = null;
  let mode = 'idle';
  const submitPrompt = (ctx: any) => {
    const prompt = ctx.ui?.getEditorText?.()?.trimEnd?.() ?? '';
    if (!prompt) return false;
    ctx.ui?.setEditorText?.('');
    if (ctx.isIdle?.()) pi.sendUserMessage?.(prompt);
    else pi.sendUserMessage?.(prompt, { deliverAs: 'followUp' });
    return true;
  };
  return {
    getMode: () => mode,
    async start(ctx: any) {
      if (mode !== 'idle') return;
      flow = createVoiceRuntime({ ...ctx, pi });
      if (!flow.config?.hasElevenLabsApiKey) {
        flow = null;
        throw new Error('ELEVENLABS_API_KEY is not configured. Set it before starting voice recording.');
      }
      await flow.startRecording();
      mode = 'recording';
    },
    async stop(ctx: any, options: any = {}) {
      if (!flow || mode === 'idle') return;
      flow.ctx = { ...ctx, pi };
      mode = 'finalizing';
      try {
        const result = await flow.finalizeRecording();
        mode = 'idle';
        if (options.send && result?.inserted) submitPrompt(ctx);
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
    async cancel(ctx: any) {
      if (flow) {
        flow.ctx = { ...ctx, pi };
        await flow.cancel?.();
      }
      flow = null;
      mode = 'idle';
      ctx.ui?.notify?.('Voice recording cancelled.', 'info');
    },
    dispose() { flow?.cancel?.(); flow = null; mode = 'idle'; },
  };
}

function clearVoiceUi(ctx: any) {
  ctx?.ui?.setStatus?.('voice-input', undefined);
  ctx?.ui?.setWidget?.('voice-input', undefined);
}

export const VOICE_EXTENSION_VERSION = '2026-06-11-command-toggle-ffmpeg-ts';

export default function voiceInputExtension(pi: any) {
  const controller = createController(pi);

  pi.on('session_start', async (_event: any, ctx: any) => {
    const config = loadRuntimeVoiceConfig({});
    for (const diagnostic of config.diagnostics) ctx.ui?.notify?.(diagnostic.message, diagnostic.level === 'warning' ? 'warning' : 'info');
  });

  pi.on?.('session_shutdown', async () => {
    await controller.dispose();
  });

  pi.registerCommand?.('voice-toggle', {
    description: 'Toggle voice recording on/off',
    handler: async (_args: string, ctx: any) => {
      try {
        clearVoiceUi(ctx);
        await controller.toggle(ctx);
      } catch (error) {
        clearVoiceUi(ctx);
        ctx.ui?.notify?.(`Voice toggle failed: ${safeError(error)}`, 'warning');
      }
    },
  });

  pi.registerCommand?.('voice-cancel', {
    description: 'Cancel active voice recording',
    handler: async (_args: string, ctx: any) => {
      await controller.cancel(ctx);
      clearVoiceUi(ctx);
    },
  });

  pi.registerCommand?.('voice-glossary', {
    description: 'Manage voice transcript glossary: list, add <canonical> <alias...>, clear',
    handler: async (args: string, ctx: any) => {
      const parts = String(args ?? '').match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^[']|[']$/g, '').replace(/^["]|["]$/g, '')) ?? [];
      const [action, canonical, ...aliases] = parts;
      const result = readVoiceSettingsResult();
      if (!result.ok) {
        ctx.ui?.notify?.(`Voice glossary config is not valid JSON; fix ${voiceConfigPath()} before changing glossary settings.`, 'warning');
        return;
      }
      const settings: any = result.settings;
      settings.transcriptGlossary ??= [];
      if (!action || action === 'list') {
        const custom = settings.transcriptGlossary.length
          ? settings.transcriptGlossary.map((entry: any) => `${entry.canonical}: ${(entry.aliases ?? []).join(', ')}`).join('\n')
          : 'No custom glossary entries.';
        ctx.ui?.notify?.(`Voice glossary:\n${custom}`, 'info');
        return;
      }
      if (action === 'clear') {
        settings.transcriptGlossary = [];
        writeVoiceSettings(settings);
        ctx.ui?.notify?.('Voice glossary cleared.', 'info');
        return;
      }
      if (action !== 'add' || !canonical || aliases.length === 0) {
        ctx.ui?.notify?.('Usage: /voice-glossary add <canonical> <alias...>  e.g. /voice-glossary add pi-vox pyvox "bye vox"', 'warning');
        return;
      }
      const existing = settings.transcriptGlossary.find((entry: any) => entry.canonical === canonical);
      if (existing) existing.aliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
      else settings.transcriptGlossary.push({ canonical, aliases });
      writeVoiceSettings(settings);
      ctx.ui?.notify?.(`Added ${aliases.length} alias(es) for ${canonical}.`, 'info');
    },
  });

  pi.registerCommand?.('voice-status', {
    description: 'Show Pi voice input configuration status',
    handler: async (_args: string, ctx: any) => {
      const config = loadRuntimeVoiceConfig({});
      const key = config.hasElevenLabsApiKey ? 'configured' : 'missing';
      const audio = createAudioToolDiagnostics({ commandExists });
      ctx.ui?.notify?.(`Voice input: version=${VOICE_EXTENSION_VERSION}, key=${key}, autoSubmit=${config.autoSubmit ? 'on' : 'off'}, cleanup=${config.transcriptCleanup === false ? 'off' : 'on'}, audio=${audio.ok ? 'ffmpeg' : 'missing'}`, config.hasElevenLabsApiKey && audio.ok ? 'info' : 'warning');
    },
  });
}

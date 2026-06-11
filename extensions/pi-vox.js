import { loadVoiceConfig } from '../src/config.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalAudioCapture, createAudioToolDiagnostics } from '../src/audio.js';
import { createProvider } from '../src/providers.js';
import { VoiceInputFlow } from '../src/flow.js';
import { VoiceStateMachine } from '../src/state-machine.js';
import { VoiceKeyHandler } from '../src/key-handler.js';

function commandExists(name) {
  return spawnSync('command', ['-v', name], { stdio: 'ignore' }).status === 0;
}

function selectRecorder(config) {
  if (config.recorder && config.recorder !== 'auto') return config.recorder;
  if (commandExists('rec')) return 'rec';
  if (commandExists('ffmpeg')) return 'ffmpeg';
  return 'rec';
}

export function voiceConfigPath(env = process.env) {
  return env.PI_VOX_CONFIG || join(homedir(), '.pi', 'pi-vox', 'config.json');
}

export function readVoiceSettings(path = voiceConfigPath()) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function writeVoiceSettings(settings, path = voiceConfigPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function loadRuntimeVoiceConfig(options = {}) {
  const stored = options.ignoreStoredConfig ? {} : readVoiceSettings(options.configPath);
  return loadVoiceConfig({ ...stored, ...(options.config ?? {}) });
}

export function createVoiceRuntime(ctx, options = {}) {
  const config = loadRuntimeVoiceConfig(options);
  const recorderName = selectRecorder(config);
  const recorder = options.recorder ?? new LocalAudioCapture({ recorder: recorderName });
  const provider = options.provider ?? createProvider(config);
  return new VoiceInputFlow({ ctx, recorder, provider, config, machine: new VoiceStateMachine(config) });
}

function keyKind(data) {
  if (typeof data === 'object' && data?.type === 'release') return 'release';
  if (typeof data === 'object' && data?.kind === 'release') return 'release';
  return 'press';
}

function keyValue(data) {
  if (typeof data === 'object') return data.key ?? data.name ?? data.sequence ?? '';
  return data;
}

export function matchesVoiceShortcut(value, shortcut) {
  if (value === shortcut) return true;
  if (shortcut === 'ctrl+v' && value === '\u0016') return true;
  if (shortcut === 'ctrl+x' && value === '\u0018') return true;
  if (shortcut === 'escape' && value === '\u001b') return true;
  return false;
}

export function shouldScheduleSpacePress(state) {
  return state === 'idle';
}

async function installVoiceEditor(ctx, pi, config) {
  if (!ctx.ui?.setEditorComponent) return false;
  let CustomEditor;
  try {
    ({ CustomEditor } = await import('@earendil-works/pi-coding-agent'));
  } catch {
    ctx.ui?.notify?.('Voice input could not install the editor hook in this runtime; /voice-status remains available.', 'warning');
    return false;
  }

  const previousFactory = ctx.ui.getEditorComponent?.();
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const base = previousFactory?.(tui, theme, keybindings);
    const flow = createVoiceRuntime({ ...ctx, pi }, { config });
    const handler = new VoiceKeyHandler({
      flow,
      machine: flow.machine,
      config,
      passThrough: (data) => {
        if (base?.handleInput) base.handleInput(data);
        else editor.superHandle(data);
      },
    });

    class VoiceEditor extends CustomEditor {
      wantsKeyRelease = true;
      timer = null;
      superHandle(data) { super.handleInput(data); }
      handleInput(data) {
        const value = keyValue(data);
        const kind = keyKind(data);
        if (value === ' ' || value === 'space') {
          if (!config.holdToTalk) {
            if (base?.handleInput) base.handleInput(data);
            else super.handleInput(data);
            return;
          }
          if (kind === 'press') {
            const state = handler.machine.current.state;
            if (shouldScheduleSpacePress(state)) {
              handler.handle(value === 'space' ? ' ' : value, kind);
              this.timer = setTimeout(() => handler.tick(), config.holdThresholdMs);
            } else if (state !== 'warmup' && state !== 'recording') {
              handler.handle(value === 'space' ? ' ' : value, kind);
            }
            return;
          }
          clearTimeout(this.timer);
          handler.handle(' ', 'release');
          return;
        }
        if (matchesVoiceShortcut(value, config.fallbackToggleShortcut)) {
          handler.handle(config.fallbackToggleShortcut, kind);
          return;
        }
        if (matchesVoiceShortcut(value, config.cancelShortcut) || value === 'escape') {
          handler.handle(config.cancelShortcut, kind);
          return;
        }
        if (base?.handleInput) base.handleInput(data);
        else super.handleInput(data);
      }
    }

    const editor = new VoiceEditor(tui, theme, keybindings);
    return editor;
  });
  return true;
}

export const VOICE_EXTENSION_VERSION = '2026-06-11-ffmpeg-255-fallback';

let commandFlow = null;
let commandRecording = false;

function clearVoiceUi(ctx) {
  ctx?.ui?.setStatus?.('voice-input', undefined);
  ctx?.ui?.setWidget?.('voice-input', undefined);
}

async function finalizeCommandFlowWithFfmpegFallback(flow) {
  try {
    return await flow.finalizeRecording();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('audio recorder exited with code 255') || !flow?.activeFile) throw error;
    flow.setStatus?.('voice: transcribing after ffmpeg stop');
    const transcript = await flow.provider.transcribe(flow.activeFile);
    const inserted = await flow.insertTranscript(transcript.text ?? transcript);
    flow.recorder.cleanup?.();
    flow.setStatus?.(undefined);
    flow.setWidget?.(undefined);
    return inserted;
  }
}

export default function voiceInputExtension(pi) {
  pi.on('session_start', async (_event, ctx) => {
    const config = loadRuntimeVoiceConfig({});
    for (const diagnostic of config.diagnostics) ctx.ui?.notify?.(diagnostic.message, diagnostic.level === 'warning' ? 'warning' : 'info');
    await installVoiceEditor(ctx, pi, config);
  });

  pi.registerCommand?.('voice-toggle', {
    description: 'Toggle voice recording on/off without relying on keyboard shortcut events',
    handler: async (_args, ctx) => {
      try {
        if (!commandRecording) {
          clearVoiceUi(ctx);
          commandFlow = createVoiceRuntime({ ...ctx, pi }, { config: {} });
          await commandFlow.startRecording();
          commandRecording = true;
          ctx.ui?.notify?.('Voice recording started. Run /voice-toggle again to stop.', 'info');
          return;
        }
        commandFlow.ctx = { ...ctx, pi };
        await finalizeCommandFlowWithFfmpegFallback(commandFlow);
        clearVoiceUi(ctx);
        commandFlow = null;
        commandRecording = false;
        ctx.ui?.notify?.('Voice recording finalized.', 'info');
      } catch (error) {
        clearVoiceUi(ctx);
        commandRecording = false;
        commandFlow = null;
        ctx.ui?.notify?.(`Voice toggle failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      }
    },
  });

  pi.registerCommand?.('voice-cancel', {
    description: 'Cancel active voice recording',
    handler: async (_args, ctx) => {
      if (commandFlow) commandFlow.ctx = { ...ctx, pi };
      await commandFlow?.cancel?.();
      clearVoiceUi(ctx);
      commandFlow = null;
      commandRecording = false;
      ctx.ui?.notify?.('Voice recording cancelled.', 'info');
    },
  });

  pi.registerCommand?.('voice-glossary', {
    description: 'Manage voice transcript glossary: list, add <canonical> <alias...>, clear',
    handler: async (args, ctx) => {
      const parts = String(args ?? '').match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? [];
      const [action, canonical, ...aliases] = parts;
      const settings = readVoiceSettings();
      settings.transcriptGlossary ??= [];
      if (!action || action === 'list') {
        const custom = settings.transcriptGlossary.length
          ? settings.transcriptGlossary.map((entry) => `${entry.canonical}: ${(entry.aliases ?? []).join(', ')}`).join('\n')
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
      const existing = settings.transcriptGlossary.find((entry) => entry.canonical === canonical);
      if (existing) existing.aliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
      else settings.transcriptGlossary.push({ canonical, aliases });
      writeVoiceSettings(settings);
      ctx.ui?.notify?.(`Added ${aliases.length} alias(es) for ${canonical}.`, 'info');
    },
  });

  pi.registerCommand?.('voice-status', {
    description: 'Show Pi voice input configuration status',
    handler: async (_args, ctx) => {
      const config = loadRuntimeVoiceConfig({});
      const key = config.hasElevenLabsApiKey ? 'configured' : 'missing';
      const audio = createAudioToolDiagnostics({ commandExists });
      ctx.ui?.notify?.(`Voice input: version=${VOICE_EXTENSION_VERSION}, provider=${config.provider}, key=${key}, autoSubmit=${config.autoSubmit ? 'on' : 'off'}, cleanup=${config.transcriptCleanup === false ? 'off' : 'on'}, audio=${audio.ok ? audio.available.join('/') : 'missing'}`, config.hasElevenLabsApiKey && audio.ok ? 'info' : 'warning');
    },
  });
}

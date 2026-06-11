import { VoiceStateMachine } from './state-machine.js';
import { safeError } from './config.js';

export function mergeTranscript(existing, transcript, mode = 'append') {
  const text = String(transcript ?? '').trim();
  if (!text) return existing ?? '';
  if (mode === 'replace') return text;
  const current = existing ?? '';
  if (!current) return text;
  if (/\s$/.test(current)) return current + text;
  return `${current} ${text}`;
}

export class VoiceInputFlow {
  constructor({ ctx, recorder, provider, config = {}, machine } = {}) {
    this.ctx = ctx;
    this.recorder = recorder;
    this.provider = provider;
    this.config = config;
    this.machine = machine ?? new VoiceStateMachine(config);
    this.activeFile = null;
  }

  setStatus(status) { this.ctx?.ui?.setStatus?.('voice-input', status); }
  setWidget(lines) { this.ctx?.ui?.setWidget?.('voice-input', lines); }

  async startRecording() {
    const result = await this.recorder.start();
    this.activeFile = result.file;
    this.setStatus('voice: recording');
    this.setWidget(['🎙 recording — release Space to transcribe']);
  }

  async finalizeRecording() {
    this.setStatus('voice: finalizing');
    this.setWidget(['… transcribing voice input']);
    try {
      const stopped = await this.recorder.stop();
      const transcript = await this.provider.transcribe(stopped.file ?? this.activeFile);
      const inserted = await this.insertTranscript(transcript.text ?? transcript);
      if (!inserted.inserted) this.setWidget(['Voice input produced no transcript.']);
      return inserted;
    } catch (error) {
      await this.fail(error);
      throw error;
    } finally {
      this.recorder.cleanup?.();
      this.setStatus(undefined);
      this.activeFile = null;
    }
  }

  async cancel() {
    await this.recorder.cancel?.();
    this.setStatus(undefined);
    this.setWidget(undefined);
  }

  async fail(error) {
    this.setStatus(undefined);
    this.setWidget([`Voice input failed: ${safeError(error)}`]);
  }

  async insertTranscript(transcript) {
    const text = String(transcript ?? '').trim();
    if (!text) return { inserted: false };
    const current = this.ctx?.ui?.getEditorText?.() ?? '';
    const next = mergeTranscript(current, text, this.config.appendMode);
    this.ctx?.ui?.setEditorText?.(next);
    if (this.config.autoSubmit === true) {
      if (this.ctx?.isIdle?.()) this.ctx?.pi?.sendUserMessage?.(next);
      else this.ctx?.pi?.sendUserMessage?.(next, { deliverAs: 'followUp' });
    }
    return { inserted: true, text: next };
  }
}

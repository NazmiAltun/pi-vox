import { safeError } from './config.ts';
import { cleanupTranscript } from './transcript-cleanup.ts';

export function mergeTranscript(existing: unknown, transcript: unknown, mode = 'append') {
  const text = String(transcript ?? '').trim();
  if (!text) return existing ?? '';
  if (mode === 'replace') return text;
  const current = existing ?? '';
  if (!current) return text;
  if (/\s$/.test(String(current))) return String(current) + text;
  return `${current} ${text}`;
}

export class VoiceInputFlow {
  ctx: any;
  recorder: any;
  provider: any;
  config: any;
  activeFile: string | null = null;
  cancelled = false;

  constructor({ ctx, recorder, provider, config = {} }: any = {}) {
    this.ctx = ctx;
    this.recorder = recorder;
    this.provider = provider;
    this.config = config;
  }

  setStatus(status: string | undefined) { this.ctx?.ui?.setStatus?.('voice-input', status); }
  setWidget(lines: string[] | undefined) { this.ctx?.ui?.setWidget?.('voice-input', lines); }

  async startRecording() {
    this.cancelled = false;
    const result = await this.recorder.start();
    this.activeFile = result.file;
    this.setStatus('voice: recording');
    this.setWidget(['🎙 recording — press Ctrl+Q again to transcribe']);
  }

  async finalizeRecording() {
    this.setStatus('voice: finalizing');
    this.setWidget(['… transcribing voice input']);
    try {
      const stopped = await this.recorder.stop();
      if (this.cancelled) return { inserted: false, cancelled: true };
      const transcript = await this.provider.transcribe(stopped.file ?? this.activeFile);
      if (this.cancelled) return { inserted: false, cancelled: true };
      const inserted = await this.insertTranscript(transcript.text ?? transcript);
      if (!inserted.inserted) this.setWidget(['Voice input produced no transcript.']);
      return inserted;
    } catch (error) {
      await this.fail(error);
      throw error;
    } finally {
      this.recorder.cleanup?.();
      this.setStatus(undefined);
      this.setWidget(undefined);
      this.activeFile = null;
    }
  }

  async cancel() {
    this.cancelled = true;
    await this.recorder.cancel?.();
    this.setStatus(undefined);
    this.setWidget(undefined);
  }

  async fail(error: unknown) {
    this.setStatus(undefined);
    this.setWidget([`Voice input failed: ${safeError(error)}`]);
  }

  async insertTranscript(transcript: unknown) {
    const text = (await cleanupTranscript(transcript, this.config)).trim();
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

import { safeError } from './config.ts';
import { cleanupTranscript } from './transcript-cleanup.ts';
import {
	recordVoiceDictation,
	resolveSessionId,
	repoName,
	mapVoiceErrorCode,
	extractProviderMetrics,
	audioBytes,
	type VoiceDictationEvent,
} from './usage.ts';

export type VoiceUsageSink = { record: (event: Omit<VoiceDictationEvent, 'event' | 'timestamp'>) => void };

export function mergeTranscript(existing: unknown, transcript: unknown, mode = 'append') {
  const text = String(transcript ?? '').trim();
  if (!text) return existing ?? '';
  if (mode === 'replace') return text;
  const current = existing ?? '';
  if (!current) return text;
  if (/\s$/.test(String(current))) return String(current) + text;
  return `${current} ${text}`;
}

function modelIdFor(provider: string, config: any): string {
  if (provider === 'mimo') return config?.mimoModelId ?? 'mimo-v2.5-asr';
  return config?.modelId ?? 'scribe_v1';
}

export class VoiceInputFlow {
  ctx: any;
  recorder: any;
  provider: any;
  config: any;
  activeFile: string | null = null;
  cancelled = false;
  recordingStartedAt = 0;
  source: string = 'shortcut';
  usage: VoiceUsageSink;

  constructor({ ctx, recorder, provider, config = {}, usage }: any = {}) {
    this.ctx = ctx;
    this.recorder = recorder;
    this.provider = provider;
    this.config = config;
    this.usage = usage ?? { record: recordVoiceDictation };
  }

  setStatus(status: string | undefined) { this.ctx?.ui?.setStatus?.('voice-input', status); }
  setWidget(lines: string[] | undefined) { this.ctx?.ui?.setWidget?.('voice-input', lines); }

  async startRecording() {
    this.cancelled = false;
    const result = await this.recorder.start();
    this.activeFile = result.file;
    this.recordingStartedAt = Date.now();
    this.setStatus('voice: recording');
    this.setWidget(['🎙 recording — press Ctrl+Q again to transcribe']);
  }

  async finalizeRecording() {
    this.setStatus('voice: finalizing');
    this.setWidget(['… transcribing voice input']);
    let recordingDurationMs: number | undefined;
    let transcribeDurationMs: number | undefined;
    let bytes: number | undefined;
    let voiceProvider = 'unknown';
    let modelId = 'unknown';
    try {
      const stopStartedAt = Date.now();
      const stopped = await this.recorder.stop();
      recordingDurationMs = this.recordingStartedAt ? stopStartedAt - this.recordingStartedAt : undefined;
      if (this.cancelled) return { inserted: false, cancelled: true };
      const file = stopped.file ?? this.activeFile;
      bytes = audioBytes(file);
      voiceProvider = this.config?.provider ?? 'unknown';
      modelId = modelIdFor(voiceProvider, this.config);
      const tStart = Date.now();
      const transcript = await this.provider.transcribe(file);
      transcribeDurationMs = Date.now() - tStart;
      if (this.cancelled) return { inserted: false, cancelled: true };
      voiceProvider = transcript.provider ?? voiceProvider;
      const inserted = await this.insertTranscript(transcript.text ?? transcript);
      if (!inserted.inserted) this.setWidget(['Voice input produced no transcript.']);
      this.emitSuccess({
        voiceProvider, modelId, recordingDurationMs, transcribeDurationMs, bytes,
        transcriptText: String(transcript.text ?? transcript ?? ''),
        raw: transcript.raw, inserted: !!inserted.inserted,
      });
      return inserted;
    } catch (error) {
      const code = (error as any)?.code;
      this.emitError({
        voiceProvider, modelId, recordingDurationMs, transcribeDurationMs, bytes,
        errorCode: code, errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.fail(error);
      throw error;
    } finally {
      this.recorder.cleanup?.();
      this.setStatus(undefined);
      this.setWidget(undefined);
      this.activeFile = null;
    }
  }

  private baseEvent(): Pick<VoiceDictationEvent, 'sessionId' | 'repo' | 'mode' | 'source' | 'recorder' | 'autoSubmit'> {
    return {
      sessionId: resolveSessionId(this.ctx),
      repo: repoName(this.ctx?.cwd),
      mode: 'toggle',
      source: this.source,
      recorder: this.recorder?.ffmpegPath ? 'ffmpeg' : 'unknown',
      autoSubmit: this.config?.autoSubmit === true,
    };
  }

  private emitSuccess(args: {
    voiceProvider: string; modelId: string;
    recordingDurationMs?: number; transcribeDurationMs?: number; bytes?: number;
    transcriptText: string; raw: unknown; inserted: boolean;
  }) {
    const text = args.transcriptText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const providerMetrics = extractProviderMetrics(args.raw, args.voiceProvider);
    this.usage.record({
      ...this.baseEvent(),
      voiceProvider: args.voiceProvider as VoiceDictationEvent['voiceProvider'],
      modelId: args.modelId,
      status: 'success',
      recordingDurationMs: args.recordingDurationMs,
      transcribeDurationMs: args.transcribeDurationMs,
      audioBytes: args.bytes,
      transcriptChars: text.length,
      transcriptWords: words,
      inserted: args.inserted,
      ...providerMetrics,
    });
  }

  private emitError(args: {
    voiceProvider: string; modelId: string;
    recordingDurationMs?: number; transcribeDurationMs?: number; bytes?: number;
    errorCode?: string; errorMessage: string;
  }) {
    this.usage.record({
      ...this.baseEvent(),
      voiceProvider: args.voiceProvider as VoiceDictationEvent['voiceProvider'],
      modelId: args.modelId,
      status: 'error',
      errorCategory: mapVoiceErrorCode(args.errorCode),
      errorCode: args.errorCode,
      recordingDurationMs: args.recordingDurationMs,
      transcribeDurationMs: args.transcribeDurationMs,
      audioBytes: args.bytes,
      inserted: false,
    });
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
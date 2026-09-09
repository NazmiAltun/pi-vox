import { safeError } from './config.ts';
import { recordVoiceSynthesis, repoName, resolveSessionId, type VoiceSynthesisEvent } from './usage.ts';

export function extractAssistantMessageText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function extractLatestAssistantText(entries: any[] = []): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === 'message' && entry.message?.role === 'assistant') return extractAssistantMessageText(entry.message);
  }
  return null;
}

export function stripMarkdownForSpeech(text: unknown): string {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitSpeechText(text: unknown, maxLength = 2000): string[] {
  const value = String(text ?? '').trim();
  if (!value) return [];
  if (value.length <= maxLength) return [value];

  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength + 1);
    const boundary = Math.max(
      candidate.lastIndexOf('. '),
      candidate.lastIndexOf('! '),
      candidate.lastIndexOf('? '),
      candidate.lastIndexOf('\n\n'),
      candidate.lastIndexOf(' '),
    );
    const cut = boundary > 0 ? boundary + (candidate[boundary] === '\n' ? 0 : 1) : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class TtsFlow {
  provider: any;
  playback: any;
  config: any;
  ctx: any;
  generation = 0;
  abortController: AbortController | null = null;
  active = false;
  usage: { record: (event: Omit<VoiceSynthesisEvent, 'event' | 'timestamp'>) => void };

  constructor({ provider, playback, config = {}, ctx, usage }: any = {}) {
    this.provider = provider;
    this.playback = playback;
    this.config = config;
    this.ctx = ctx;
    this.usage = usage ?? { record: recordVoiceSynthesis };
  }

  setStatus(status: string | undefined) { this.ctx?.ui?.setStatus?.('voice-output', status); }

  async toggle(ctx: any = this.ctx) {
    if (this.active) {
      await this.stop();
      ctx?.ui?.notify?.('Voice playback stopped.', 'info');
      return { stopped: true };
    }
    return this.speakLatest(ctx);
  }

  async speakLatest(ctx: any = this.ctx) {
    this.ctx = ctx ?? this.ctx;
    const entries = this.ctx?.sessionManager?.getBranch?.() ?? [];
    const latest = extractLatestAssistantText(entries);
    if (latest === null) {
      this.ctx?.ui?.notify?.('No assistant message available for text-to-speech.', 'warning');
      return { spoken: false };
    }
    const text = stripMarkdownForSpeech(latest);
    if (!text) {
      this.ctx?.ui?.notify?.('Latest assistant message has no readable text.', 'warning');
      return { spoken: false };
    }

    const generation = ++this.generation;
    const controller = new AbortController();
    this.abortController = controller;
    this.active = true;
    this.setStatus('voice: synthesizing');
    try {
      const chunks = splitSpeechText(text, this.config.ttsChunkSize ?? 2000);
      for (let index = 0; index < chunks.length; index += 1) {
        if (generation !== this.generation) return { spoken: false, stopped: true };
        this.setStatus(`voice: speaking ${index + 1}/${chunks.length}`);
        const audio = await this.provider.synthesize(chunks[index], { signal: controller.signal });
        if (generation !== this.generation) return { spoken: false, stopped: true };
        await this.playback.play(audio.audio, audio.extension);
      }
      this.usage.record({
        sessionId: resolveSessionId(this.ctx),
        repo: repoName(this.ctx?.cwd),
        voiceProvider: this.config.ttsProvider ?? 'mimo',
        modelId: this.config.ttsProvider === 'elevenlabs' ? this.config.elevenLabsTtsModelId : this.config.mimoTtsModelId,
        status: 'success',
        textChars: text.length,
        chunks: chunks.length,
      });
      this.ctx?.ui?.notify?.('Voice playback finished.', 'info');
      return { spoken: true, chunks: chunks.length };
    } catch (error) {
      if (generation !== this.generation) return { spoken: false, stopped: true };
      this.usage.record({
        sessionId: resolveSessionId(this.ctx),
        repo: repoName(this.ctx?.cwd),
        voiceProvider: this.config.ttsProvider ?? 'mimo',
        modelId: this.config.ttsProvider === 'elevenlabs' ? this.config.elevenLabsTtsModelId : this.config.mimoTtsModelId,
        status: 'error',
        errorCode: (error as any)?.code,
        textChars: text.length,
        chunks: splitSpeechText(text, this.config.ttsChunkSize ?? 2000).length,
      });
      this.ctx?.ui?.notify?.(`Voice playback failed: ${safeError(error)}`, 'warning');
      return { spoken: false, error };
    } finally {
      if (generation === this.generation) {
        this.active = false;
        this.abortController = null;
        this.setStatus(undefined);
      }
    }
  }

  async stop() {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.active = false;
    await this.playback.stop?.();
    this.setStatus(undefined);
  }
}

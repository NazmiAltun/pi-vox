import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { safeError } from './config.ts';

export function createAudioToolDiagnostics({ commandExists }: any = {}) {
  const check = commandExists ?? (() => false);
  const available = ['ffmpeg'].filter((name) => check(name));
  return { available, ok: available.length > 0, message: available.length ? 'ffmpeg is available.' : 'No supported audio recorder found. Install ffmpeg.' };
}

export class LocalAudioCapture {
  spawn: any;
  fs: any;
  tmpdir: any;
  ffmpegPath: string;
  inputFormat: string;
  input: string;
  sampleRate: number;
  channels: number;
  stopTimeoutMs: number;
  child: any = null;
  file: string | null = null;
  dir: string | null = null;
  processError: unknown = null;
  exitCode: number | null = null;

  constructor(options: any = {}) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.fs = options.fs ?? { mkdtempSync, rmSync, existsSync };
    this.tmpdir = options.tmpdir ?? tmpdir;
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.inputFormat = options.inputFormat ?? (process.platform === 'darwin' ? 'avfoundation' : process.platform === 'win32' ? 'dshow' : 'pulse');
    this.input = options.input ?? (process.platform === 'darwin' ? ':0' : process.platform === 'win32' ? 'audio=Microphone' : 'default');
    this.sampleRate = options.sampleRate ?? 16000;
    this.channels = options.channels ?? 1;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 2000;
  }

  start() {
    if (this.child) throw new Error('audio capture already active');
    this.dir = this.fs.mkdtempSync(join(this.tmpdir(), 'pi-voice-'));
    this.file = join(this.dir, 'recording.wav');
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', this.inputFormat,
      '-i', this.input,
      '-ar', String(this.sampleRate),
      '-ac', String(this.channels),
      this.file,
    ];
    this.processError = null;
    this.exitCode = null;
    this.child = this.spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child.once?.('error', (error: unknown) => { this.processError = error; });
    this.child.once?.('exit', (code: number) => { this.exitCode = code; });
    return { file: this.file };
  }

  async stop() {
    if (!this.child) throw new Error('audio capture is not active');
    const child = this.child;
    const file = this.file;
    const stopped = await new Promise((resolve) => {
      let settled = false;
      const done = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => done('timeout'), this.stopTimeoutMs);
      child.once?.('exit', () => done('exit'));
      child.once?.('error', () => done('error'));
      child.kill?.('SIGINT');
    });
    this.child = null;
    if (stopped === 'timeout') throw new Error('audio recorder did not stop before timeout');
    if (this.processError) throw new Error(`audio recorder failed: ${safeError(this.processError)}`);
    const normalStopCodes = [0, 130, 255];
    if (this.exitCode && !normalStopCodes.includes(this.exitCode)) throw new Error(`audio recorder exited with code ${this.exitCode}`);
    return { file };
  }

  async cancel() {
    if (this.child) this.child.kill?.('SIGINT');
    this.child = null;
    this.cleanup();
    return { cancelled: true };
  }

  cleanup() {
    if (this.dir) this.fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
    this.file = null;
  }
}

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { safeError } from './config.ts';

function systemCommandExists(name: string) {
  return spawnSync('command', ['-v', name], { stdio: 'ignore' }).status === 0;
}

export function selectRecorder(config: any = {}, exists = systemCommandExists) {
  if (config.recorder && config.recorder !== 'auto') return config.recorder;
  if (exists('rec')) return 'rec';
  if (exists('sox')) return 'sox';
  if (exists('ffmpeg')) return 'ffmpeg';
  return 'rec';
}

export function createAudioToolDiagnostics({ commandExists: exists }: any = {}) {
  const check = exists ?? systemCommandExists;
  const available = ['rec', 'sox', 'ffmpeg'].filter((name) => check(name));
  return { available, ok: available.length > 0, message: available.length ? `Audio tools available: ${available.join(', ')}.` : 'No supported audio recorder found. Install sox/rec or ffmpeg.' };
}

export class LocalAudioCapture {
  spawn: any;
  fs: any;
  tmpdir: any;
  recorder: string;
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
    this.recorder = options.recorder ?? 'ffmpeg';
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
    const command = this.recorder === 'ffmpeg' ? this.ffmpegPath : this.recorder;
    const args = this.recorder === 'ffmpeg'
      ? [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-f', this.inputFormat,
        '-i', this.input,
        '-ar', String(this.sampleRate),
        '-ac', String(this.channels),
        this.file,
      ]
      : this.recorder === 'sox'
        ? ['-d', this.file]
        : [this.file];
    this.processError = null;
    this.exitCode = null;
    this.child = this.spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
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
    const normalStopCodes = this.recorder === 'ffmpeg' ? [0, 130, 255] : [0, 130];
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

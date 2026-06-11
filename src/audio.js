import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { safeError } from './config.js';

export function createAudioToolDiagnostics({ commandExists } = {}) {
  const check = commandExists ?? ((name) => false);
  const available = ['rec', 'sox', 'ffmpeg'].filter((name) => check(name));
  return { available, ok: available.length > 0, message: available.length ? `Audio tools available: ${available.join(', ')}` : 'No supported audio recorder found. Install sox/rec or ffmpeg.' };
}

export class LocalAudioCapture {
  constructor(options = {}) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.fs = options.fs ?? { mkdtempSync, rmSync, existsSync };
    this.tmpdir = options.tmpdir ?? tmpdir;
    this.recorder = options.recorder ?? 'rec';
    this.stopTimeoutMs = options.stopTimeoutMs ?? 2000;
    this.child = null;
    this.file = null;
    this.dir = null;
    this.processError = null;
    this.exitCode = null;
  }

  start() {
    if (this.child) throw new Error('audio capture already active');
    this.dir = this.fs.mkdtempSync(join(this.tmpdir(), 'pi-voice-'));
    this.file = join(this.dir, 'recording.wav');
    const args = this.recorder === 'ffmpeg'
      ? ['-y', '-f', 'avfoundation', '-i', ':0', this.file]
      : this.recorder === 'sox'
        ? ['-d', this.file]
        : [this.file];
    this.processError = null;
    this.exitCode = null;
    this.child = this.spawn(this.recorder, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child.once?.('error', (error) => { this.processError = error; });
    this.child.once?.('exit', (code) => { this.exitCode = code; });
    return { file: this.file };
  }

  async stop() {
    if (!this.child) throw new Error('audio capture is not active');
    const child = this.child;
    const file = this.file;
    const stopped = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
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

export function audioErrorMessage(error) { return safeError(error); }

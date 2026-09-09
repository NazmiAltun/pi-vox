import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';

function systemCommandExists(name: string) {
  return spawnSync('command', ['-v', name], { stdio: 'ignore' }).status === 0;
}

export function selectAudioPlayer(extension = 'wav', platform: string = process.platform, exists = systemCommandExists) {
  const native = extension === 'wav';
  const candidates = platform === 'darwin' && native
    ? [{ command: 'afplay', args: [] }]
    : platform === 'linux' && native
      ? [{ command: 'paplay', args: [] }, { command: 'aplay', args: [] }]
      : [];
  candidates.push({ command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] });
  candidates.push({ command: 'mpv', args: ['--no-video', '--really-quiet'] });
  return candidates.find(({ command }) => exists(command)) ?? null;
}

export class LocalAudioPlayback {
  spawn: any;
  fs: any;
  tmpdir: any;
  platform: string;
  exists: (name: string) => boolean;
  child: any = null;
  dir: string | null = null;
  playId = 0;

  constructor(options: any = {}) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.fs = options.fs ?? { mkdtempSync, writeFileSync, rmSync };
    this.tmpdir = options.tmpdir ?? tmpdir;
    this.platform = options.platform ?? process.platform;
    this.exists = options.exists ?? systemCommandExists;
  }

  async play(audio: Buffer, extension = 'wav') {
    this.stop();
    const player = selectAudioPlayer(extension, this.platform, this.exists);
    if (!player) throw new Error('No supported audio player found. Install afplay, ffplay, paplay, aplay, or mpv.');
    const playId = ++this.playId;
    this.dir = this.fs.mkdtempSync(join(this.tmpdir(), 'pi-tts-'));
    const file = join(this.dir, `speech.${extension}`);
    this.fs.writeFileSync(file, audio);
    const child = this.spawn(player.command, [...player.args, file], { stdio: 'ignore' });
    this.child = child;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (playId !== this.playId) {
          resolve({ stopped: true });
          return;
        }
        if (this.child === child) this.child = null;
        this.cleanup();
        if (error) reject(error);
        else resolve({ stopped: false });
      };
      child.once?.('error', (error: unknown) => finish(error));
      child.once?.('close', (code: number | null) => {
        if (code === 0) finish();
        else finish(new Error(`${player.command} exited with code ${code}`));
      });
    });
  }

  async stop() {
    this.playId += 1;
    this.child?.kill?.('SIGTERM');
    this.child = null;
    this.cleanup();
  }

  cleanup() {
    if (this.dir) this.fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
  }
}

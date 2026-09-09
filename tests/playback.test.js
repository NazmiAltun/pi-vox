import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalAudioPlayback, selectAudioPlayer } from '../src/playback.ts';

test('audio player selection prefers native macOS playback and skips native players for mp3 on Linux', () => {
  assert.deepEqual(selectAudioPlayer('wav', 'darwin', (name) => name === 'afplay'), { command: 'afplay', args: [] });
  assert.deepEqual(selectAudioPlayer('mp3', 'linux', (name) => name === 'paplay' || name === 'ffplay'), { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] });
});

test('audio playback starts and can be stopped', async () => {
  const child = new EventEmitter();
  child.kill = (signal) => { assert.equal(signal, 'SIGTERM'); child.emit('close', 143); };
  const calls = [];
  const playback = new LocalAudioPlayback({
    spawn: (command, args) => { calls.push([command, args]); return child; },
    exists: (name) => name === 'afplay',
    platform: 'darwin',
    tmpdir: () => '/tmp',
    fs: { mkdtempSync: () => '/tmp/pi-tts-test', writeFileSync: () => {}, rmSync: (...args) => calls.push(['rm', ...args]) },
  });
  const playing = playback.play(Buffer.from('wav'), 'wav');
  await playback.stop();
  await playing;
  assert.equal(calls[0][0], 'afplay');
  assert.ok(calls.some((call) => call[0] === 'rm'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAudioToolDiagnostics, LocalAudioCapture } from '../src/audio.js';

test('audio diagnostics report missing and available tools', () => {
  assert.equal(createAudioToolDiagnostics({ commandExists: () => false }).ok, false);
  assert.deepEqual(createAudioToolDiagnostics({ commandExists: (n) => n === 'ffmpeg' }).available, ['ffmpeg']);
});

test('ffmpeg SIGINT exit code 255 is treated as normal stop on macOS', async () => {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 255);
  const capture = new LocalAudioCapture({
    recorder: 'ffmpeg',
    spawn: () => child,
    tmpdir: () => '/tmp',
    fs: { mkdtempSync: () => '/tmp/pi-voice-test', rmSync: () => {}, existsSync: () => true },
  });
  capture.start();
  const stopped = await capture.stop();
  assert.equal(stopped.file, '/tmp/pi-voice-test/recording.wav');
});

test('local audio capture starts, stops, cancels, and cleans up', async () => {
  const calls = [];
  const child = new EventEmitter();
  child.kill = (signal) => { calls.push(['kill', signal]); child.emit('exit', 0); };
  const capture = new LocalAudioCapture({
    spawn: (cmd, args) => { calls.push(['spawn', cmd, args]); return child; },
    tmpdir: () => '/tmp',
    fs: { mkdtempSync: () => '/tmp/pi-voice-test', rmSync: (...args) => calls.push(['rm', ...args]), existsSync: () => true },
  });
  const started = capture.start();
  assert.equal(started.file, '/tmp/pi-voice-test/recording.wav');
  const stopped = await capture.stop();
  assert.equal(stopped.file, started.file);
  await capture.cancel();
  assert.ok(calls.some((c) => c[0] === 'rm'));
});

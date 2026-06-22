import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAudioToolDiagnostics, LocalAudioCapture } from '../src/audio.ts';

test('audio diagnostics report missing and available tools', () => {
  assert.equal(createAudioToolDiagnostics({ commandExists: () => false }).ok, false);
  assert.deepEqual(createAudioToolDiagnostics({ commandExists: (n) => n === 'ffmpeg' }).available, ['ffmpeg']);
  assert.deepEqual(createAudioToolDiagnostics({ commandExists: (n) => n === 'sox' }).available, []);
});

test('local audio capture uses configured ffmpeg input args', () => {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0);
  const calls = [];
  const capture = new LocalAudioCapture({
    inputFormat: 'avfoundation',
    input: ':0',
    spawn: (cmd, args) => { calls.push([cmd, args]); return child; },
    tmpdir: () => '/tmp',
    fs: { mkdtempSync: () => '/tmp/pi-voice-test', rmSync: () => {}, existsSync: () => true },
  });
  capture.start();
  assert.deepEqual(calls[0], ['ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'avfoundation', '-i', ':0', '-ar', '16000', '-ac', '1', '/tmp/pi-voice-test/recording.wav']]);
});

test('ffmpeg SIGINT exit code 255 is treated as normal stop on macOS', async () => {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 255);
  const capture = new LocalAudioCapture({
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

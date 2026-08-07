import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAudioToolDiagnostics, LocalAudioCapture, selectRecorder } from '../src/audio.ts';

test('auto recorder selection preserves system default recorder preference', () => {
  assert.equal(selectRecorder({ recorder: 'auto' }, (name) => name === 'rec'), 'rec');
  assert.equal(selectRecorder({ recorder: 'auto' }, (name) => name === 'sox'), 'sox');
  assert.equal(selectRecorder({ recorder: 'auto' }, (name) => name === 'ffmpeg'), 'ffmpeg');
});

test('audio diagnostics report missing and available tools', () => {
  assert.equal(createAudioToolDiagnostics({ commandExists: () => false }).ok, false);
  assert.deepEqual(createAudioToolDiagnostics({ commandExists: (n) => n === 'ffmpeg' }).available, ['ffmpeg']);
  assert.deepEqual(createAudioToolDiagnostics({ commandExists: (n) => n === 'sox' }).available, ['sox']);
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

test('local audio capture supports rec and sox recorder commands', () => {
  const child = new EventEmitter();
  const calls = [];
  const options = {
    spawn: (cmd, args) => { calls.push([cmd, args]); return child; },
    tmpdir: () => '/tmp',
    fs: { mkdtempSync: () => '/tmp/pi-voice-test', rmSync: () => {}, existsSync: () => true },
  };
  new LocalAudioCapture({ ...options, recorder: 'rec' }).start();
  new LocalAudioCapture({ ...options, recorder: 'sox' }).start();
  assert.deepEqual(calls, [
    ['rec', ['/tmp/pi-voice-test/recording.wav']],
    ['sox', ['-d', '/tmp/pi-voice-test/recording.wav']],
  ]);
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

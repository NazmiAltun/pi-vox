import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStateMachine } from '../src/state-machine.js';
import { VoiceKeyHandler } from '../src/key-handler.js';

test('key handler passes quick space through and toggles fallback recording', async () => {
  let now = 0;
  const actions = [];
  const flow = { startRecording: async () => actions.push('start'), finalizeRecording: async () => actions.push('finalize'), cancel: async () => actions.push('cancel') };
  const handler = new VoiceKeyHandler({ flow, machine: new VoiceStateMachine({ holdThresholdMs: 300 }, 0), config: { fallbackToggleShortcut: 'ctrl+shift+v' }, clock: () => now, passThrough: (d) => actions.push(`pass:${d}`) });
  await handler.handle(' ');
  now = 100;
  await handler.handle(' ', 'release');
  assert.deepEqual(actions, ['pass: ']);
  await handler.handle('ctrl+shift+v');
  await handler.handle('ctrl+shift+v');
  assert.deepEqual(actions.slice(1), ['start', 'finalize']);
  assert.equal(handler.machine.current.state, 'idle');
});

test('key handler deliberate hold starts and release finalizes', async () => {
  let now = 0;
  const actions = [];
  const flow = { startRecording: async () => actions.push('start'), finalizeRecording: async () => actions.push('finalize'), cancel: async () => actions.push('cancel') };
  const handler = new VoiceKeyHandler({ flow, machine: new VoiceStateMachine({ holdThresholdMs: 300 }, 0), clock: () => now, passThrough: (d) => actions.push(`pass:${d}`) });
  await handler.handle(' ');
  now = 301;
  await handler.tick();
  await handler.handle(' ', 'release');
  assert.deepEqual(actions, ['start', 'finalize']);
});

test('key handler consumes cancel while recording', async () => {
  const actions = [];
  const flow = { startRecording: async () => actions.push('start'), cancel: async () => actions.push('cancel') };
  const handler = new VoiceKeyHandler({ flow, machine: new VoiceStateMachine({}, 0), passThrough: (d) => actions.push(`pass:${d}`) });
  await handler.handle('ctrl+shift+v');
  await handler.handle('escape');
  assert.deepEqual(actions, ['start', 'cancel']);
  assert.equal(handler.machine.current.state, 'idle');
});

test('key handler consumes configured raw Ctrl-X cancel while preserving original data for idle pass-through', async () => {
  const actions = [];
  const flow = { startRecording: async () => actions.push('start'), cancel: async () => actions.push('cancel') };
  const handler = new VoiceKeyHandler({
    flow,
    machine: new VoiceStateMachine({}, 0),
    config: { cancelShortcut: 'ctrl+x' },
    passThrough: (d) => actions.push(d),
  });
  await handler.handle('ctrl+shift+v');
  await handler.handle('ctrl+x', 'press', '\u0018');
  assert.deepEqual(actions, ['start', 'cancel']);
  assert.equal(handler.machine.current.state, 'idle');

  const original = { key: 'escape', type: 'press' };
  await handler.handle('escape', 'press', original);
  assert.equal(actions.at(-1), original);
});

test('key handler recovers if recording cannot start', async () => {
  let now = 0;
  const actions = [];
  const flow = { startRecording: async () => { throw new Error('missing recorder'); }, fail: async () => actions.push('fail') };
  const handler = new VoiceKeyHandler({ flow, machine: new VoiceStateMachine({ holdThresholdMs: 1 }, 0), clock: () => now, passThrough: () => {} });
  await handler.handle(' ');
  now = 2;
  await handler.tick();
  assert.equal(handler.machine.current.state, 'idle');
  assert.deepEqual(actions, ['fail']);
});

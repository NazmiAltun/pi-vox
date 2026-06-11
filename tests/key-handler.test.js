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

import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStateMachine } from '../src/state-machine.js';

test('quick space tap passes through as editor input', () => {
  const machine = new VoiceStateMachine({ holdThresholdMs: 300 }, 0);
  assert.equal(machine.send({ type: 'space_down', at: 0 }).state.state, 'warmup');
  const result = machine.send({ type: 'space_up', at: 100 });
  assert.equal(result.action, 'insert_space');
  assert.equal(result.state.state, 'idle');
});

test('deliberate hold starts recording and release finalizes once', () => {
  const machine = new VoiceStateMachine({ holdThresholdMs: 300 }, 0);
  machine.send({ type: 'space_down', at: 0 });
  const start = machine.send({ type: 'tick', at: 350 });
  assert.equal(start.action, 'start_recording');
  assert.equal(start.state.state, 'recording');
  const release = machine.send({ type: 'space_up', at: 500 });
  assert.equal(release.action, 'finalize_recording');
  assert.equal(machine.send({ type: 'space_up', at: 510 }).action, null);
});

test('toggle, cancel, timeout, and failure recover to idle', () => {
  const machine = new VoiceStateMachine({}, 0);
  assert.equal(machine.send({ type: 'toggle', at: 1 }).action, 'start_recording');
  assert.equal(machine.send({ type: 'cancel', at: 2 }).action, 'cancel_recording');
  assert.equal(machine.current.state, 'idle');
  machine.current = { ...machine.current, state: 'finalizing' };
  assert.equal(machine.send({ type: 'timeout', at: 10 }).action, 'show_error');
  assert.equal(machine.current.state, 'idle');
  assert.equal(machine.send({ type: 'failure', at: 11, error: 'network' }).state.state, 'idle');
});

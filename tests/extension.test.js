import test from 'node:test';
import assert from 'node:assert/strict';
import voiceInputExtension, { createVoiceRuntime, matchesVoiceShortcut, shouldScheduleSpacePress } from '../extensions/pi-vox.js';

test('voice extension recognizes raw control characters for shortcuts', () => {
  assert.equal(matchesVoiceShortcut('\u0016', 'ctrl+v'), true);
  assert.equal(matchesVoiceShortcut('\u001b', 'escape'), true);
  assert.equal(matchesVoiceShortcut('x', 'ctrl+v'), false);
});

test('voice extension does not reset hold timer on key repeat states', () => {
  assert.equal(shouldScheduleSpacePress('idle'), true);
  assert.equal(shouldScheduleSpacePress('warmup'), false);
  assert.equal(shouldScheduleSpacePress('recording'), false);
});

test('voice config default keeps normal space behavior safe', async () => {
  const handlers = new Map();
  voiceInputExtension({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: () => {},
  });
  let installedFactory;
  const ctx = {
    ui: {
      notify: () => {},
      setStatus: () => {},
      getEditorComponent: () => undefined,
      setEditorComponent: (factory) => { installedFactory = factory; },
    },
  };
  await handlers.get('session_start')({}, ctx);
  const editor = installedFactory({}, {}, {});
  assert.equal(editor.wantsKeyRelease, true);
});

test('voice runtime wires default cleanup mode', () => {
  const flow = createVoiceRuntime({}, {
    config: { provider: 'mock', envFile: '' },
    recorder: {},
    provider: {},
  });
  assert.equal(flow.config.transcriptCleanupMode, 'fast');
});

test('voice extension installs an editor component when Pi CustomEditor dependency resolves', async () => {
  const handlers = new Map();
  const commands = new Map();
  voiceInputExtension({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });

  let installedFactory;
  const notifications = [];
  const ctx = {
    ui: {
      notify: (...args) => notifications.push(args),
      setStatus: (...args) => notifications.push(['status', ...args]),
      getEditorComponent: () => undefined,
      setEditorComponent: (factory) => { installedFactory = factory; },
    },
  };

  await handlers.get('session_start')({}, ctx);
  assert.equal(typeof installedFactory, 'function');
  assert.equal(notifications.some((entry) => entry.includes('voice ready')), false);
});

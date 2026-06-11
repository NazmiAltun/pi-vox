import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import voiceInputExtension, { createVoiceRuntime, matchesVoiceShortcut, readVoiceSettings, selectRecorder, shouldScheduleSpacePress } from '../extensions/pi-vox.js';

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

test('voice extension selects sox when rec is unavailable', () => {
  assert.equal(selectRecorder({ recorder: 'auto' }, (name) => name === 'sox'), 'sox');
  assert.equal(selectRecorder({ recorder: 'auto' }, (name) => name === 'ffmpeg'), 'ffmpeg');
  assert.equal(selectRecorder({ recorder: 'auto' }, (name) => name === 'rec' || name === 'sox'), 'rec');
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

test('voice editor passes idle escape through to the base editor', async () => {
  const handlers = new Map();
  const baseInputs = [];
  voiceInputExtension({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: () => {},
  });
  let installedFactory;
  const ctx = {
    ui: {
      notify: () => {},
      setStatus: () => {},
      getEditorComponent: () => () => ({ handleInput: (data) => baseInputs.push(data) }),
      setEditorComponent: (factory) => { installedFactory = factory; },
    },
  };
  await handlers.get('session_start')({}, ctx);
  const editor = installedFactory({}, {}, {});
  const event = { key: 'escape', type: 'press' };
  editor.handleInput(event);
  await Promise.resolve();
  assert.deepEqual(baseInputs, [event]);
});

test('voice runtime wires cleanup on by default', () => {
  const flow = createVoiceRuntime({}, {
    config: { provider: 'mock', envFile: '' },
    ignoreStoredConfig: true,
    recorder: {},
    provider: {},
  });
  assert.equal(flow.config.transcriptCleanup, true);
});

test('voice glossary command persists config', async () => {
  const oldPath = process.env.PI_VOX_CONFIG;
  const configPath = join(mkdtempSync(join(tmpdir(), 'pi-vox-test-')), 'config.json');
  process.env.PI_VOX_CONFIG = configPath;
  try {
    const commands = new Map();
    voiceInputExtension({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) });
    const messages = [];
    const ctx = { ui: { notify: (...args) => messages.push(args) } };
    assert.equal(commands.has('voice-cleanup'), false);
    await commands.get('voice-glossary').handler('add pi-vox pyvox "bye vox"', ctx);
    const settings = readVoiceSettings(configPath);
    assert.deepEqual(settings.transcriptGlossary, [{ canonical: 'pi-vox', aliases: ['pyvox', 'bye vox'] }]);
    assert.match(readFileSync(configPath, 'utf8'), /pi-vox/);
  } finally {
    if (oldPath === undefined) delete process.env.PI_VOX_CONFIG;
    else process.env.PI_VOX_CONFIG = oldPath;
  }
});

test('voice glossary does not overwrite malformed config', async () => {
  const oldPath = process.env.PI_VOX_CONFIG;
  const configPath = join(mkdtempSync(join(tmpdir(), 'pi-vox-test-')), 'config.json');
  process.env.PI_VOX_CONFIG = configPath;
  writeFileSync(configPath, '{not json');
  try {
    const commands = new Map();
    voiceInputExtension({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) });
    const messages = [];
    const ctx = { ui: { notify: (...args) => messages.push(args) } };
    await commands.get('voice-glossary').handler('add pi-vox pyvox', ctx);
    assert.equal(readFileSync(configPath, 'utf8'), '{not json');
    assert.equal(messages.at(-1)?.[1], 'warning');
    assert.match(messages.at(-1)?.[0], /not valid JSON/);
  } finally {
    if (oldPath === undefined) delete process.env.PI_VOX_CONFIG;
    else process.env.PI_VOX_CONFIG = oldPath;
  }
});

test('voice glossary does not overwrite non-object config', async () => {
  const oldPath = process.env.PI_VOX_CONFIG;
  const configPath = join(mkdtempSync(join(tmpdir(), 'pi-vox-test-')), 'config.json');
  process.env.PI_VOX_CONFIG = configPath;
  try {
    for (const content of ['null', '[]']) {
      writeFileSync(configPath, content);
      const commands = new Map();
      voiceInputExtension({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) });
      const messages = [];
      const ctx = { ui: { notify: (...args) => messages.push(args) } };
      await commands.get('voice-glossary').handler('add pi-vox pyvox', ctx);
      assert.equal(readFileSync(configPath, 'utf8'), content);
      assert.equal(messages.at(-1)?.[1], 'warning');
      assert.match(messages.at(-1)?.[0], /not valid JSON/);
    }
  } finally {
    if (oldPath === undefined) delete process.env.PI_VOX_CONFIG;
    else process.env.PI_VOX_CONFIG = oldPath;
  }
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

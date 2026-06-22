import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import voiceInputExtension, { createVoiceRuntime, readVoiceSettings } from '../src/index.ts';

test('voice extension does not install an editor/keybinding hook by default', async () => {
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
  assert.equal(installedFactory, undefined);
});

test('voice runtime wires cleanup on by default', () => {
  const flow = createVoiceRuntime({}, {
    config: { envFile: '' },
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

test('voice extension registers commands without editor shortcuts', async () => {
  const handlers = new Map();
  const commands = new Map();
  voiceInputExtension({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
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
  assert.equal(installedFactory, undefined);
  assert.equal(commands.has('voice-toggle'), true);
  assert.equal(commands.has('voice-cancel'), true);
});

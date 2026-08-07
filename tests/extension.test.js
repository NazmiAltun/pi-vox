import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import voiceInputExtension, { createVoiceRuntime, readVoiceSettings } from '../src/index.ts';
import { transcribeWithMimo } from '../src/providers.ts';

function createExtensionHarness() {
  const handlers = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  voiceInputExtension({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerShortcut: (name, shortcut) => shortcuts.set(name, shortcut),
  });
  return { commands, handlers, shortcuts };
}

test('voice extension does not install an editor hook', async () => {
  const { handlers } = createExtensionHarness();
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

test('voice extension registers only provider command and Ctrl+Q shortcut', () => {
  const { commands, shortcuts } = createExtensionHarness();
  assert.deepEqual([...commands.keys()], ['voice-provider']);
  assert.equal(shortcuts.has('ctrl+q'), true);
});

test('voice provider command persists interactive selection', async () => {
  const oldPath = process.env.PI_VOX_CONFIG;
  const configPath = join(mkdtempSync(join(tmpdir(), 'pi-vox-test-')), 'config.json');
  process.env.PI_VOX_CONFIG = configPath;
  try {
    const { commands } = createExtensionHarness();
    const messages = [];
    const ctx = {
      ui: {
        select: async (prompt, options) => {
          assert.equal(prompt, 'Voice provider');
          assert.deepEqual(options, ['elevenlabs', 'mimo']);
          return 'mimo';
        },
        notify: (...args) => messages.push(args),
      },
    };
    await commands.get('voice-provider').handler('', ctx);
    assert.equal(readVoiceSettings(configPath).provider, 'mimo');
    assert.match(readFileSync(configPath, 'utf8'), /"provider": "mimo"/);
    assert.equal(messages.at(-1)?.[0], 'Voice provider set to mimo.');
  } finally {
    if (oldPath === undefined) delete process.env.PI_VOX_CONFIG;
    else process.env.PI_VOX_CONFIG = oldPath;
  }
});

test('voice provider command preserves malformed config', async () => {
  const oldPath = process.env.PI_VOX_CONFIG;
  const configPath = join(mkdtempSync(join(tmpdir(), 'pi-vox-test-')), 'config.json');
  process.env.PI_VOX_CONFIG = configPath;
  writeFileSync(configPath, '{not json');
  try {
    const { commands } = createExtensionHarness();
    const messages = [];
    const ctx = {
      ui: { select: async () => 'mimo', notify: (...args) => messages.push(args) },
    };
    await commands.get('voice-provider').handler('', ctx);
    assert.equal(readFileSync(configPath, 'utf8'), '{not json');
    assert.equal(messages.at(-1)?.[1], 'warning');
  } finally {
    if (oldPath === undefined) delete process.env.PI_VOX_CONFIG;
    else process.env.PI_VOX_CONFIG = oldPath;
  }
});

test('Mimo provider can use Pi model registry auth', async () => {
  const context = {
    modelRegistry: {
      getProviderAuth: async (provider) => {
        assert.equal(provider, 'xiaomi-token-plan-sgp');
        return { auth: { apiKey: 'mimo_test_key_placeholder' } };
      },
    },
  };
  const result = await transcribeWithMimo('/tmp/audio.wav', { provider: 'mimo', envFile: '' }, {
    context,
    readFileSync: () => Buffer.from('audio'),
    fetch: async (_url, init) => {
      assert.equal(init.headers['api-key'], 'mimo_test_key_placeholder');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'hello' } }] }) };
    },
  });
  assert.equal(result.text, 'hello');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVoiceConfig, parseDotEnv, redactSecrets } from '../src/config.ts';

test('voice config defaults are safe and namespaced', () => {
  const config = loadVoiceConfig({ voice: { envFile: '' } }, {}, { existsSync: () => false, readFileSync: () => '' });
  assert.equal(config.autoSubmit, false);
  assert.equal(config.transcriptCleanup, true);
  assert.equal(config.provider, 'elevenlabs');
  assert.equal(config.hasElevenLabsApiKey, false);
});

test('loads ELEVENLABS_API_KEY from env, dotenv, or config without logging it', () => {
  const file = 'ELEVENLABS_API_KEY=voice_test_key_placeholder\n';
  assert.deepEqual(parseDotEnv(file), { ELEVENLABS_API_KEY: 'voice_test_key_placeholder' });
  const config = loadVoiceConfig({ envFile: '.env' }, {}, { existsSync: () => true, readFileSync: () => file });
  assert.equal(config.hasElevenLabsApiKey, true);
  assert.equal(config.elevenLabsApiKey, 'voice_test_key_placeholder');
  const configOnly = loadVoiceConfig({ envFile: '', elevenLabsApiKey: 'config_key_placeholder' }, {}, { existsSync: () => false, readFileSync: () => '' });
  assert.equal(configOnly.hasElevenLabsApiKey, true);
  assert.equal(configOnly.elevenLabsApiKey, 'config_key_placeholder');
  assert.equal(redactSecrets('Authorization: Bearer voice_test_key_placeholder'), 'Authorization: Bearer <redacted>');
});

test('loads MIMO_API_KEY as fallback without requiring it for Pi-managed auth', () => {
  const config = loadVoiceConfig({ provider: 'mimo', envFile: '' }, { MIMO_API_KEY: 'mimo_test_key_placeholder' }, { existsSync: () => false, readFileSync: () => '' });
  assert.equal(config.hasMimoApiKey, true);
  assert.equal(config.mimoApiKey, 'mimo_test_key_placeholder');
  assert.deepEqual(config.diagnostics, []);
  assert.equal(redactSecrets('MIMO_API_KEY=mimo_test_key_placeholder'), 'MIMO_API_KEY=<redacted>');
});

test('loads Pi Xiaomi environment credential as Mimo fallback', () => {
  const config = loadVoiceConfig({ provider: 'mimo', envFile: '' }, { XIAOMI_TOKEN_PLAN_SGP_API_KEY: 'xiaomi_test_key_placeholder' }, { existsSync: () => false, readFileSync: () => '' });
  assert.equal(config.mimoApiKey, 'xiaomi_test_key_placeholder');
  assert.equal(redactSecrets('XIAOMI_TOKEN_PLAN_SGP_API_KEY=xiaomi_test_key_placeholder'), 'XIAOMI_API_KEY=<redacted>');
});

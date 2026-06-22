import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVoiceConfig, parseDotEnv, redactSecrets } from '../src/config.ts';

test('voice config defaults are safe and namespaced', () => {
  const config = loadVoiceConfig({ voice: { envFile: '' } }, {}, { existsSync: () => false, readFileSync: () => '' });
  assert.equal(config.autoSubmit, false);
  assert.equal(config.transcriptCleanup, true);
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

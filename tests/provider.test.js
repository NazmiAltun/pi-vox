import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeWithElevenLabs, TranscriptionError } from '../src/providers.ts';

test('ElevenLabs provider normalizes successful transcript', async () => {
  const result = await transcribeWithElevenLabs('/tmp/audio.wav', { elevenLabsApiKey: 'voice_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('audio'),
    fetch: async (_url, init) => {
      assert.equal(init.headers['xi-api-key'], 'voice_test_key_placeholder');
      return { ok: true, json: async () => ({ text: ' hello world ' }) };
    },
  });
  assert.equal(result.text, 'hello world');
});

test('ElevenLabs provider redacts failures and handles empty transcript', async () => {
  await assert.rejects(() => transcribeWithElevenLabs('/tmp/audio.wav', { elevenLabsApiKey: 'voice_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('audio'),
    fetch: async () => ({ ok: false, status: 401, text: async () => 'plain key voice_test_key_placeholder in body' }),
  }), (error) => {
    assert.equal(error.code, 'auth_error');
    assert.equal(error.message.includes('voice_test_key_placeholder'), false);
    return true;
  });
  await assert.rejects(() => transcribeWithElevenLabs('/tmp/audio.wav', { elevenLabsApiKey: 'voice_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('audio'),
    fetch: async () => ({ ok: true, json: async () => ({ text: '' }) }),
  }), TranscriptionError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeWithElevenLabs, transcribeWithMimo, TranscriptionError } from '../src/providers.ts';

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

test('Mimo provider sends WAV data URI and normalizes chat response', async () => {
  const result = await transcribeWithMimo('/tmp/audio.wav', { mimoApiKey: 'mimo_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('audio'),
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.xiaomimimo.com/v1/chat/completions');
      assert.equal(init.headers['api-key'], 'mimo_test_key_placeholder');
      assert.equal(init.headers['Content-Type'], 'application/json');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'mimo-v2.5-asr');
      assert.equal(body.asr_options.language, 'auto');
      assert.equal(body.messages[0].content[0].type, 'input_audio');
      assert.equal(body.messages[0].content[0].input_audio.data, 'data:audio/wav;base64,YXVkaW8=');
      return { ok: true, json: async () => ({ choices: [{ message: { content: ' hello from Mimo ' } }] }) };
    },
  });
  assert.equal(result.text, 'hello from Mimo');
  assert.equal(result.provider, 'mimo');
});

test('Mimo provider resolves Pi-managed Xiaomi auth before fallback config', async () => {
  const result = await transcribeWithMimo('/tmp/audio.wav', { mimoApiKey: 'fallback_key' }, {
    modelRegistry: {
      getProviderAuth: async (provider) => {
        assert.equal(provider, 'xiaomi-token-plan-sgp');
        return { auth: { apiKey: 'mimo_test_key_placeholder' } };
      },
    },
    readFileSync: () => Buffer.from('audio'),
    fetch: async (_url, init) => {
      assert.equal(init.headers['api-key'], 'mimo_test_key_placeholder');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    },
  });
  assert.equal(result.text, 'ok');
});

test('Mimo provider redacts auth failures and handles empty transcript', async () => {
  await assert.rejects(() => transcribeWithMimo('/tmp/audio.wav', { mimoApiKey: 'mimo_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('audio'),
    fetch: async () => ({ ok: false, status: 401, text: async () => 'plain key mimo_test_key_placeholder in body' }),
  }), (error) => {
    assert.equal(error.code, 'auth_error');
    assert.equal(error.message.includes('mimo_test_key_placeholder'), false);
    return true;
  });
  await assert.rejects(() => transcribeWithMimo('/tmp/audio.wav', { mimoApiKey: 'mimo_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('audio'),
    fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) }),
  }), TranscriptionError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeWithElevenLabs, transcribeWithMimo, synthesizeWithElevenLabs, synthesizeWithMimo, TranscriptionError } from '../src/providers.ts';

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
      getProvider: (provider) => {
        assert.equal(provider, 'xiaomi-token-plan-sgp');
        return { baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1' };
      },
    },
    readFileSync: () => Buffer.from('audio'),
    fetch: async (url, init) => {
      assert.equal(url, 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions');
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

test('Mimo TTS sends assistant text and returns decoded WAV audio', async () => {
  const result = await synthesizeWithMimo('hello from Mimo', { mimoApiKey: 'mimo_test_key_placeholder' }, {
    readFileSync: () => Buffer.from('unused'),
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.xiaomimimo.com/v1/chat/completions');
      assert.equal(init.headers['api-key'], 'mimo_test_key_placeholder');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'mimo-v2.5-tts');
      assert.deepEqual(body.messages, [{ role: 'assistant', content: 'hello from Mimo' }]);
      assert.deepEqual(body.audio, { format: 'wav', voice: 'mimo_default' });
      return { ok: true, json: async () => ({ choices: [{ message: { audio: { data: Buffer.from('wav').toString('base64') } } }] }) };
    },
  });
  assert.deepEqual(result.audio, Buffer.from('wav'));
  assert.equal(result.extension, 'wav');
  assert.equal(result.provider, 'mimo');
});

test('ElevenLabs TTS sends text and returns binary audio', async () => {
  const result = await synthesizeWithElevenLabs('hello from ElevenLabs', {
    elevenLabsApiKey: 'voice_test_key_placeholder',
    elevenLabsTtsVoiceId: 'voice-id',
  }, {
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/voice-id?output_format=mp3_44100_128');
      assert.equal(init.headers['xi-api-key'], 'voice_test_key_placeholder');
      assert.deepEqual(JSON.parse(init.body), {
        text: 'hello from ElevenLabs',
        model_id: 'eleven_multilingual_v2',
      });
      return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    },
  });
  assert.deepEqual(result.audio, Buffer.from([1, 2, 3]));
  assert.equal(result.extension, 'mp3');
  assert.equal(result.provider, 'elevenlabs');
});

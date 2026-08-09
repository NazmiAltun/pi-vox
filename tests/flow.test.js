import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceInputFlow, mergeTranscript } from '../src/flow.ts';

test('mergeTranscript appends predictably or replaces', () => {
  assert.equal(mergeTranscript('', 'hello'), 'hello');
  assert.equal(mergeTranscript('typed', 'voice'), 'typed voice');
  assert.equal(mergeTranscript('typed ', 'voice'), 'typed voice');
  assert.equal(mergeTranscript('typed', 'voice', 'replace'), 'voice');
});

test('flow inserts transcript without auto-submit by default and handles cancel/error', async () => {
  const calls = [];
  const recorded = [];
  const usage = { record: (e) => recorded.push(e) };
  const ctx = { ui: { getEditorText: () => 'typed', setEditorText: (v) => calls.push(['editor', v]), setStatus: (...a) => calls.push(['status', ...a]), setWidget: (...a) => calls.push(['widget', ...a]) }, isIdle: () => true, pi: { sendUserMessage: (...a) => calls.push(['send', ...a]) } };
  const recorder = { start: async () => ({ file: '/tmp/a.wav' }), stop: async () => ({ file: '/tmp/a.wav' }), cancel: async () => calls.push(['cancel']), cleanup: () => calls.push(['cleanup']) };
  const provider = { transcribe: async () => ({ text: 'py-coding agent', provider: 'elevenlabs', raw: { language_code: 'eng', language_probability: 0.99, words: [{}, {}] } }) };
  const flow = new VoiceInputFlow({ ctx, recorder, provider, config: { autoSubmit: false }, usage });
  await flow.startRecording();
  await flow.finalizeRecording();
  assert.deepEqual(calls.find((c) => c[0] === 'editor'), ['editor', 'typed pi-coding-agent']);
  assert.equal(calls.some((c) => c[0] === 'send'), false);
  assert.ok(calls.some((c) => c[0] === 'widget' && c[1] === 'voice-input' && c[2] === undefined));
  await flow.cancel();
  assert.ok(calls.some((c) => c[0] === 'cancel'));
  // voice usage tracking
  assert.equal(recorded.length, 1);
  const event = recorded[0];
  assert.equal(event.voiceProvider, 'elevenlabs');
  assert.equal(event.status, 'success');
  assert.equal(event.modelId, 'scribe_v1');
  assert.equal(event.transcriptChars, 'py-coding agent'.length);
  assert.equal(event.transcriptWords, 2);
  assert.equal(event.languageCode, 'eng');
  assert.equal(event.languageProbability, 0.99);
  assert.equal(event.wordCount, 2);
  assert.equal(event.inserted, true);
  assert.equal(event.autoSubmit, false);
  assert.equal(event.mode, 'toggle');
  assert.equal(event.source, 'shortcut');
  assert.ok(event.recordingDurationMs === undefined || event.recordingDurationMs >= 0);
});

test('flow records an error event when transcription fails', async () => {
  const recorded = [];
  const usage = { record: (e) => recorded.push(e) };
  const ctx = { ui: { getEditorText: () => '', setEditorText: () => {}, setStatus: () => {}, setWidget: () => {} }, isIdle: () => true, pi: { sendUserMessage: () => {} } };
  const recorder = { start: async () => ({ file: '/tmp/a.wav' }), stop: async () => ({ file: '/tmp/a.wav' }), cleanup: () => {} };
  const provider = { transcribe: async () => { const err = new Error('no key'); err.code = 'missing_api_key'; throw err; } };
  const flow = new VoiceInputFlow({ ctx, recorder, provider, config: { provider: 'mimo' }, usage });
  await flow.startRecording();
  await assert.rejects(() => flow.finalizeRecording());
  assert.equal(recorded.length, 1);
  const event = recorded[0];
  assert.equal(event.status, 'error');
  assert.equal(event.errorCode, 'missing_api_key');
  assert.equal(event.errorCategory, 'auth');
  assert.equal(event.voiceProvider, 'mimo');
});

test('flow auto-submits only when enabled and transcript is non-empty', async () => {
  const calls = [];
  const ctx = { ui: { getEditorText: () => '', setEditorText: (v) => calls.push(['editor', v]) }, isIdle: () => true, pi: { sendUserMessage: (...a) => calls.push(['send', ...a]) } };
  const flow = new VoiceInputFlow({ ctx, config: { autoSubmit: true }, usage: { record: () => {} } });
  await flow.insertTranscript('ship it');
  await flow.insertTranscript('');
  assert.equal(calls.filter((c) => c[0] === 'send').length, 1);
});

test('flow runs glossary cleanup before editor insertion', async () => {
  const calls = [];
  const ctx = { ui: { getEditorText: () => '', setEditorText: (v) => calls.push(['editor', v]) } };
  const flow = new VoiceInputFlow({ ctx, config: {}, usage: { record: () => {} } });
  await flow.insertTranscript('open pyvox');
  assert.deepEqual(calls, [['editor', 'open pi-vox']]);
});
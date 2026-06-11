import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceInputFlow, mergeTranscript } from '../src/flow.js';

test('mergeTranscript appends predictably or replaces', () => {
  assert.equal(mergeTranscript('', 'hello'), 'hello');
  assert.equal(mergeTranscript('typed', 'voice'), 'typed voice');
  assert.equal(mergeTranscript('typed ', 'voice'), 'typed voice');
  assert.equal(mergeTranscript('typed', 'voice', 'replace'), 'voice');
});

test('flow inserts transcript without auto-submit by default and handles cancel/error', async () => {
  const calls = [];
  const ctx = { ui: { getEditorText: () => 'typed', setEditorText: (v) => calls.push(['editor', v]), setStatus: (...a) => calls.push(['status', ...a]), setWidget: (...a) => calls.push(['widget', ...a]) }, isIdle: () => true, pi: { sendUserMessage: (...a) => calls.push(['send', ...a]) } };
  const recorder = { start: async () => ({ file: '/tmp/a.wav' }), stop: async () => ({ file: '/tmp/a.wav' }), cancel: async () => calls.push(['cancel']), cleanup: () => calls.push(['cleanup']) };
  const provider = { transcribe: async () => ({ text: 'py-coding agent' }) };
  const flow = new VoiceInputFlow({ ctx, recorder, provider, config: { autoSubmit: false } });
  await flow.startRecording();
  await flow.finalizeRecording();
  assert.deepEqual(calls.find((c) => c[0] === 'editor'), ['editor', 'typed pi-coding-agent']);
  assert.equal(calls.some((c) => c[0] === 'send'), false);
  assert.ok(calls.some((c) => c[0] === 'widget' && c[1] === 'voice-input' && c[2] === undefined));
  await flow.cancel();
  assert.ok(calls.some((c) => c[0] === 'cancel'));
});

test('flow auto-submits only when enabled and transcript is non-empty', async () => {
  const calls = [];
  const ctx = { ui: { getEditorText: () => '', setEditorText: (v) => calls.push(['editor', v]) }, isIdle: () => true, pi: { sendUserMessage: (...a) => calls.push(['send', ...a]) } };
  const flow = new VoiceInputFlow({ ctx, config: { autoSubmit: true } });
  await flow.insertTranscript('ship it');
  await flow.insertTranscript('');
  assert.equal(calls.filter((c) => c[0] === 'send').length, 1);
});

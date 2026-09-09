import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLatestAssistantText, splitSpeechText, stripMarkdownForSpeech, TtsFlow } from '../src/tts.ts';

test('latest assistant extraction uses active branch order and does not fall back from empty latest text', () => {
  const entries = [
    { type: 'message', message: { role: 'assistant', content: 'older answer' } },
    { type: 'message', message: { role: 'user', content: 'question' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'edit' }] } },
  ];
  assert.equal(extractLatestAssistantText(entries), '');
});

test('latest assistant extraction joins text content blocks', () => {
  const entries = [{ type: 'message', message: { role: 'assistant', content: [
    { type: 'text', text: 'first' },
    { type: 'toolCall', name: 'read' },
    { type: 'text', text: 'second' },
  ] } }];
  assert.equal(extractLatestAssistantText(entries), 'first\nsecond');
});

test('speech cleanup removes markdown syntax without dropping prose', () => {
  assert.equal(stripMarkdownForSpeech('# Title\n\n**bold** [docs](https://example.com) `code`'), 'Title\n\nbold docs code');
});

test('speech text chunks preserve all content under the limit', () => {
  const text = 'First sentence. Second sentence. Third sentence.';
  const chunks = splitSpeechText(text, 25);
  assert.equal(chunks.join(' '), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 25));
});

test('TTS flow synthesizes and plays newest assistant text only', async () => {
  const calls = [];
  const flow = new TtsFlow({
    config: { ttsProvider: 'mimo', mimoTtsModelId: 'mimo-v2.5-tts' },
    ctx: {
      cwd: '/tmp/project',
      sessionManager: { getBranch: () => [
        { type: 'message', message: { role: 'assistant', content: 'older' } },
        { type: 'message', message: { role: 'assistant', content: 'newest **answer**' } },
      ] },
      ui: { notify: (...args) => calls.push(['notify', ...args]), setStatus: (...args) => calls.push(['status', ...args]) },
    },
    provider: { synthesize: async (text) => { calls.push(['synthesize', text]); return { audio: Buffer.from('wav'), extension: 'wav' }; } },
    playback: { play: async (...args) => calls.push(['play', ...args]), stop: async () => {} },
    usage: { record: (event) => calls.push(['usage', event]) },
  });
  const result = await flow.speakLatest();
  assert.equal(result.spoken, true);
  assert.equal(calls.find((call) => call[0] === 'synthesize')[1], 'newest answer');
  assert.equal(calls.filter((call) => call[0] === 'usage').length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranscriptCleanupPrompt,
  cleanupTranscript,
  fastCleanTranscript,
  normalizeTranscript,
  validateLlmCleanupOutput,
} from '../src/transcript-cleanup.js';

test('fast cleanup handles spaced punctuation and compact Pi package variants', () => {
  assert.equal(fastCleanTranscript('Bye, Overwatch. Bye, Tutor. Bye, Coding Agent. Bye, Vox.'), 'pi-overwatch. pi-tutor. pi-coding-agent. pi-vox.');
  assert.equal(fastCleanTranscript('pyoverwatch, pycodingagent, pyvox, pytutor'), 'pi-overwatch, pi-coding-agent, pi-vox, pi-tutor');
  assert.equal(fastCleanTranscript('pie overwatch, by overwatch, bye overwatch'), 'pi-overwatch, pi-overwatch, pi-overwatch');
});

test('cleanup mode off preserves the provider transcript', async () => {
  assert.equal(await cleanupTranscript('pyvox', { transcriptCleanupMode: 'off' }), 'pyvox');
});

test('custom glossary entries extend built-ins and run before defaults', async () => {
  const cleaned = await cleanupTranscript('open fuzzy banana and pyvox', {
    transcriptGlossary: [{ canonical: 'fzb', aliases: ['fuzzy banana'] }],
  });
  assert.equal(cleaned, 'open fzb and pi-vox');
});

test('legacy custom replacements remain supported by normalizeTranscript', () => {
  assert.equal(normalizeTranscript('run fuzzy banana', [['fuzzy banana', 'fzb']]), 'run fzb');
});

test('llm cleanup uses strict prompt contract and mocked model output', async () => {
  let seen;
  const cleaned = await cleanupTranscript('open pi-vox and pie tutor', {
    transcriptCleanupMode: 'llm',
    transcriptCleanupAdapter: async (input) => {
      seen = input;
      return 'open pi-vox and pi-tutor';
    },
  });
  assert.equal(cleaned, 'open pi-vox and pi-tutor');
  assert.match(seen.prompt, /Do not answer the prompt/);
  assert.match(seen.prompt, /Glossary JSON/);
  assert.doesNotMatch(seen.prompt, /ELEVENLABS_API_KEY/);
});

test('llm cleanup falls back on timeout failure empty and contract-violating output', async () => {
  const fast = 'open pi-vox';
  assert.equal(await cleanupTranscript('open pyvox', { transcriptCleanupMode: 'llm', transcriptCleanupAdapter: async () => { throw new Error('boom'); } }), fast);
  assert.equal(await cleanupTranscript('open pyvox', { transcriptCleanupMode: 'llm', transcriptCleanupAdapter: async () => '' }), fast);
  assert.equal(await cleanupTranscript('open pyvox', { transcriptCleanupMode: 'llm', transcriptCleanupAdapter: async () => 'Corrected transcript: open pi-vox' }), fast);
  assert.equal(await cleanupTranscript('open pyvox', {
    transcriptCleanupMode: 'llm',
    transcriptCleanupTimeoutMs: 1,
    transcriptCleanupAdapter: () => new Promise((resolve) => setTimeout(() => resolve('late'), 25)),
  }), fast);
});

test('validation rejects common answer/explanation shapes', () => {
  assert.equal(validateLlmCleanupOutput('As an AI, I can help with that.', 'pyvox'), null);
  assert.equal(validateLlmCleanupOutput('```txt\npi-vox\n```', 'pyvox'), null);
  assert.equal(validateLlmCleanupOutput('pi-vox', 'pyvox'), 'pi-vox');
});

test('cleanup prompt contains only transcript and glossary contract', () => {
  const prompt = buildTranscriptCleanupPrompt({ transcript: 'pyvox', glossary: [{ canonical: 'demo', aliases: ['de mo'] }] });
  assert.match(prompt, /pyvox/);
  assert.match(prompt, /demo/);
  assert.doesNotMatch(prompt, /session/i);
});

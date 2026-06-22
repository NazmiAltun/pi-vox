import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTranscriptWithGlossary,
  cleanupTranscript,
  normalizeTranscript,
} from '../src/transcript-cleanup.ts';

test('glossary cleanup handles spaced punctuation and compact Pi package variants', () => {
  assert.equal(cleanTranscriptWithGlossary('Bye, Overwatch. Bye, Tutor. Bye, Coding Agent. Bye, Vox.'), 'pi-overwatch. pi-tutor. pi-coding-agent. pi-vox.');
  assert.equal(cleanTranscriptWithGlossary('pyoverwatch, pycodingagent, pyvox, pytutor'), 'pi-overwatch, pi-coding-agent, pi-vox, pi-tutor');
  assert.equal(cleanTranscriptWithGlossary('pie overwatch, by overwatch, bye overwatch'), 'pi-overwatch, pi-overwatch, pi-overwatch');
});

test('transcriptCleanup false preserves the provider transcript', async () => {
  assert.equal(await cleanupTranscript('pyvox', { transcriptCleanup: false }), 'pyvox');
});

test('cleanup defaults to glossary entries and runs before insertion', async () => {
  assert.equal(await cleanupTranscript('open pyvox'), 'open pi-vox');
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

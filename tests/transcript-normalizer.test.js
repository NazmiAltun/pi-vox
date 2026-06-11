import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript } from '../src/transcript-normalizer.js';

test('normalizes common Pi package transcription mistakes', () => {
  assert.equal(normalizeTranscript('open py-coding agent docs'), 'open pi-coding-agent docs');
  assert.equal(normalizeTranscript('install pie vox and py tutor'), 'install pi-vox and pi-tutor');
  assert.equal(normalizeTranscript('Bye, Overwatch. Bye, Tutor. Bye, Coding Agent. Bye, Vox.'), 'pi-overwatch. pi-tutor. pi-coding-agent. pi-vox.');
});

test('supports custom transcript replacements', () => {
  assert.equal(normalizeTranscript('run fuzzy banana', [['fuzzy banana', 'fzb']]), 'run fzb');
});

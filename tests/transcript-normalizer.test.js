import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript } from '../src/transcript-normalizer.js';

test('normalizes common Pi package transcription mistakes', () => {
  assert.equal(normalizeTranscript('open py-coding agent docs'), 'open pi-coding-agent docs');
  assert.equal(normalizeTranscript('install pie vox and py tutor'), 'install pi-vox and pi-tutor');
});

test('supports custom transcript replacements', () => {
  assert.equal(normalizeTranscript('run fuzzy banana', [['fuzzy banana', 'fzb']]), 'run fzb');
});

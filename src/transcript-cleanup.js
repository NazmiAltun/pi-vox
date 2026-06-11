import { spawn } from 'node:child_process';

export const TRANSCRIPT_CLEANUP_MODES = Object.freeze(['off', 'fast', 'llm']);

export const DEFAULT_TRANSCRIPT_GLOSSARY = Object.freeze([
  { canonical: 'pi-overwatch', aliases: ['py overwatch', 'pie overwatch', 'bye overwatch', 'by overwatch', 'p i overwatch', 'pyoverwatch', 'pieoverwatch', 'byeoverwatch', 'byoverwatch'] },
  { canonical: 'pi-coding-agent', aliases: ['py coding agent', 'py-coding agent', 'py-coding-agent', 'pie coding agent', 'pie-coding agent', 'bye coding agent', 'by coding agent', 'p i coding agent', 'pycodingagent', 'piecodingagent', 'byecodingagent', 'bycodingagent'] },
  { canonical: 'pi-vox', aliases: ['py vox', 'pie vox', 'bye vox', 'by vox', 'p i vox', 'pyvox', 'pievox', 'byevox', 'byvox'] },
  { canonical: 'pi-tutor', aliases: ['py tutor', 'pie tutor', 'bye tutor', 'by tutor', 'p i tutor', 'pytutor', 'pietutor', 'byetutor', 'bytutor'] },
]);

export const DEFAULT_TRANSCRIPT_REPLACEMENTS = Object.freeze(
  DEFAULT_TRANSCRIPT_GLOSSARY.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.canonical])),
);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasPattern(alias) {
  const raw = String(alias ?? '').trim();
  if (!raw) return '';
  const tokens = raw.split(/[\s,.-]+/).filter(Boolean).map(escapeRegExp);
  if (tokens.length <= 1) return escapeRegExp(raw);
  return tokens.join('[\\s,.-]+');
}

function replacementEntriesFromGlossary(glossary = []) {
  return glossary.flatMap((entry) => {
    const canonical = entry.canonical ?? entry.term ?? entry.to;
    if (!canonical) return [];
    const aliases = entry.aliases ?? entry.from ?? [];
    const list = Array.isArray(aliases) ? aliases : [aliases];
    return list.filter(Boolean).map((alias) => [alias, canonical]);
  });
}

export function buildTranscriptGlossary(customGlossary = []) {
  const custom = Array.isArray(customGlossary) ? customGlossary : [];
  return [...custom, ...DEFAULT_TRANSCRIPT_GLOSSARY];
}

export function normalizeTranscript(text, replacements = DEFAULT_TRANSCRIPT_REPLACEMENTS) {
  let next = String(text ?? '');
  for (const [from, to] of replacements) {
    if (!from) continue;
    const pattern = aliasPattern(from);
    if (!pattern) continue;
    next = next.replace(new RegExp(`\\b${pattern}\\b`, 'gi'), String(to));
  }
  return next;
}

export function fastCleanTranscript(text, { glossary, replacements } = {}) {
  if (replacements) return normalizeTranscript(text, replacements);
  return normalizeTranscript(text, replacementEntriesFromGlossary(buildTranscriptGlossary(glossary)));
}

export function transcriptGlossaryForPrompt(glossary = []) {
  return buildTranscriptGlossary(glossary).map((entry) => ({
    canonical: entry.canonical ?? entry.term ?? entry.to,
    aliases: entry.aliases ?? entry.from ?? [],
  })).filter((entry) => entry.canonical);
}

export function buildTranscriptCleanupPrompt({ transcript, glossary }) {
  return [
    'You clean up speech-to-text transcripts for insertion into a Pi coding-agent prompt.',
    'Only correct likely transcription errors using the glossary below.',
    'Preserve the user\'s intent, casing where appropriate, punctuation where possible, and ordinary wording.',
    'Do not answer the prompt. Do not summarize. Do not add explanations. Output only the corrected transcript text.',
    '',
    'Glossary JSON:',
    JSON.stringify(transcriptGlossaryForPrompt(glossary), null, 2),
    '',
    'Transcript:',
    String(transcript ?? ''),
  ].join('\n');
}

export function validateLlmCleanupOutput(output, fallbackText) {
  const text = String(output ?? '').trim();
  if (!text) return null;
  if (/```/.test(text)) return null;
  if (/^(corrected transcript|corrected text|output)\s*:/i.test(text)) return null;
  if (/\b(as an ai|i can help|here is|here's)\b/i.test(text)) return null;
  const fallbackLength = String(fallbackText ?? '').trim().length;
  if (fallbackLength > 0 && text.length > Math.max(500, fallbackLength * 3)) return null;
  return text;
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`transcript cleanup timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function cleanupTranscript(text, config = {}, adapter = config.transcriptCleanupAdapter) {
  const mode = config.transcriptCleanupMode ?? config.cleanupMode ?? 'fast';
  if (!TRANSCRIPT_CLEANUP_MODES.includes(mode)) throw new Error(`Unsupported transcript cleanup mode: ${mode}`);
  const original = String(text ?? '');
  if (mode === 'off') return original;

  const fast = fastCleanTranscript(original, {
    glossary: config.transcriptGlossary,
    replacements: config.transcriptReplacements,
  });
  if (mode === 'fast') return fast;
  if (!adapter) return fast;

  try {
    const prompt = buildTranscriptCleanupPrompt({ transcript: fast, glossary: config.transcriptGlossary });
    const cleanup = typeof adapter === 'function' ? adapter : adapter.cleanup?.bind(adapter);
    if (!cleanup) return fast;
    const output = await withTimeout(Promise.resolve(cleanup({ transcript: fast, originalTranscript: original, glossary: transcriptGlossaryForPrompt(config.transcriptGlossary), prompt })), config.transcriptCleanupTimeoutMs ?? 2500);
    return validateLlmCleanupOutput(output, fast) ?? fast;
  } catch {
    return fast;
  }
}

export function createPiPrintTranscriptCleanupAdapter({ command = 'pi', args = ['-p'], timeoutMs = 2500, cwd = process.cwd(), env = process.env } = {}) {
  return {
    cleanup({ prompt }) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, [...args, prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`pi print transcript cleanup timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', () => {});
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error(`pi print transcript cleanup exited with code ${code}`));
          else resolve(stdout.trim());
        });
      });
    },
  };
}

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

export function cleanTranscriptWithGlossary(text, { glossary, replacements } = {}) {
  if (replacements) return normalizeTranscript(text, replacements);
  return normalizeTranscript(text, replacementEntriesFromGlossary(buildTranscriptGlossary(glossary)));
}

export const fastCleanTranscript = cleanTranscriptWithGlossary;

export async function cleanupTranscript(text, config = {}) {
  const original = String(text ?? '');
  if (config.transcriptCleanup === false) return original;

  return cleanTranscriptWithGlossary(original, {
    glossary: config.transcriptGlossary,
    replacements: config.transcriptReplacements,
  });
}

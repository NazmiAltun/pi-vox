export const DEFAULT_TRANSCRIPT_REPLACEMENTS = Object.freeze([
  ['py-coding agent', 'pi-coding-agent'],
  ['py coding agent', 'pi-coding-agent'],
  ['pie-coding agent', 'pi-coding-agent'],
  ['pie coding agent', 'pi-coding-agent'],
  ['p i coding agent', 'pi-coding-agent'],
  ['py vox', 'pi-vox'],
  ['pie vox', 'pi-vox'],
  ['p i vox', 'pi-vox'],
  ['py tutor', 'pi-tutor'],
  ['pie tutor', 'pi-tutor'],
  ['py overwatch', 'pi-overwatch'],
  ['pie overwatch', 'pi-overwatch'],
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeTranscript(text, replacements = DEFAULT_TRANSCRIPT_REPLACEMENTS) {
  let next = String(text ?? '');
  for (const [from, to] of replacements) {
    if (!from) continue;
    next = next.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi'), to);
  }
  return next;
}

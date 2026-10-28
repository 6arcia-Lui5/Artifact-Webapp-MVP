// Reuse only an untouched, unsaved placeholder. Saved or partially edited
// inscriptions always retain their identity and content.
export function addPhotoDraft(entries, draft, newKey = () => crypto.randomUUID()) {
  if (entries.length >= 30) return entries;
  const empty = entries.findIndex(entry => !entry.id && !entry.serifsPresent && !entry.stopmarksPresent &&
    ['content', 'language', 'script', 'translation'].every(key => !String(entry[key] ?? '').trim()));
  const next = {
    clientKey: empty >= 0 ? entries[empty].clientKey : newKey(),
    content: draft.content, language: draft.language, script: draft.script,
    translation: draft.translation || '', serifsPresent: false, stopmarksPresent: false,
  };
  return empty >= 0 ? entries.map((entry, index) => index === empty ? next : entry) : [...entries, next];
}

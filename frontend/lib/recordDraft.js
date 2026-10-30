// Drafts preserve missing source facts instead of inventing required metadata.
export const completeRecordFields = ['itemName', 'objectTypeId', 'museumName', 'museumCity', 'museumCountry', 'museumNumber', 'dateCulturePeriod', 'materials', 'dimensions'];

export function hasIncompleteMetadata(record) {
  return Boolean(record && (completeRecordFields.some(key => typeof record[key] !== 'string' || !record[key].trim())
    || ['inscribed', 'imagery'].some(key => record[key] == null)
    || record.inscriptions?.some(entry => !entry.language?.trim() || !entry.script?.trim()
      || entry.serifsPresent == null || entry.stopmarksPresent == null)));
}

export function prepareInscriptionDraft(entry, saveAsDraft) {
  const unknownText = value => saveAsDraft && (value == null || !value.trim()) ? null : value;
  const flag = value => saveAsDraft && value == null ? null : Boolean(value);
  return {
    ...(entry.id ? { id: entry.id } : {}),
    content: entry.content,
    language: unknownText(entry.language),
    script: unknownText(entry.script),
    translation: entry.translation ?? (saveAsDraft ? null : ''),
    serifsPresent: flag(entry.serifsPresent),
    stopmarksPresent: flag(entry.stopmarksPresent),
  };
}

export function prepareRecordDraft(values, saveAsDraft) {
  const payload = { ...values, saveAsDraft: Boolean(saveAsDraft) };
  for (const key of ['dateStart', 'dateEnd']) {
    if (key in payload) payload[key] = payload[key] === '' || payload[key] == null ? null : Number(payload[key]);
  }
  if (saveAsDraft) {
    for (const [key, value] of Object.entries(payload)) {
      if (key !== 'itemName' && typeof value === 'string' && !value.trim()) payload[key] = null;
    }
  }
  return payload;
}

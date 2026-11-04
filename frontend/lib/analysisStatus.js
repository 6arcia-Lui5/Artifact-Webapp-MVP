export function analysisStatus(result) {
  const compared = [result.comparison?.date, result.comparison?.region].filter(field => field?.compared === true).length;
  if (result.flagged) return 'Review suggested';
  return compared === 2 ? 'No differences flagged' : compared === 1 ? 'Partial comparison' : 'Suggestions ready';
}

export function comparisonLabel(field) {
  if (field?.compared === true) return 'Compared with catalog';
  return ({ missing: 'Not compared: not recorded', unrecognized: 'Not compared: format unrecognized', outside_range: 'Not compared: outside supported dates' })[field?.reason] || 'Not compared';
}

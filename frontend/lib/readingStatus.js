export function readingStatus(status) {
  return ({ readers_disagree: 'Readings differ', readers_agree: 'Readings match', no_text: 'No readable text found', single_reader: 'One reading available', comparison_incomplete: 'Comparison incomplete', uncertain_marks: 'Unclear characters' })[status] || 'Review this reading';
}

// The one vocabulary for BTC match rounds. Payload labels use the singular form;
// bracket columns and section headings use the plural form where that reads naturally.
const ROUND_NAMES = {
  preliminary: { singular: 'Preliminary', plural: 'Preliminary' },
  quarterfinal: { singular: 'Quarter-final', plural: 'Quarter-finals' },
  semifinal: { singular: 'Semi-final', plural: 'Semi-finals' },
  final: { singular: 'Final', plural: 'Final' },
  third_place: { singular: 'Third place', plural: 'Third place' },
};

export function roundLabel(round) {
  return ROUND_NAMES[round]?.singular ?? round;
}

export function roundHeading(round) {
  return ROUND_NAMES[round]?.plural ?? round;
}

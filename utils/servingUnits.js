/**
 * Units that are the measure axis (grams, milliliters) rather than user-facing
 * serving sizes. Excluded from servingSizes[] aggregation, LLM output parsing,
 * and refinement — they're what measureQuantity stores, not what a user picks
 * from a typeahead.
 */
const EXCLUDED_SERVING_UNITS = Object.freeze([
  'g',
  'gram',
  'grams',
  'ml',
  'milliliter',
  'milliliters'
]);

const EXCLUDED_SERVING_UNITS_SET = new Set(EXCLUDED_SERVING_UNITS);

function isExcludedServingUnit(unit) {
  if (typeof unit !== 'string') return false;
  return EXCLUDED_SERVING_UNITS_SET.has(unit.trim().toLowerCase());
}

module.exports = {
  EXCLUDED_SERVING_UNITS,
  EXCLUDED_SERVING_UNITS_SET,
  isExcludedServingUnit
};

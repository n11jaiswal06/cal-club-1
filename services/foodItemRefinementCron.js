/**
 * Weekly refinement cron for FoodItem.servingSizes[].
 *
 * Re-aggregates Meal.items[] to compute mode-rounded grams-per-unit per
 * (foodItemId, unit) pair. Updates servingSizes entries where the data-backed
 * mode differs from the stored value or the stored entry was LLM-generated.
 *
 * Rules:
 *   - source='user_confirmed' entries are never overwritten.
 *   - source='aggregated' entries are refreshed if the mode has shifted.
 *   - source='llm' entries are replaced by source='aggregated' when ≥3 samples
 *     back a real mode (data beats guesses).
 *   - isDefault flag is preserved unless no default exists post-merge.
 */

const cron = require('node-cron');
const FoodItem = require('../models/schemas/FoodItem');
const Meal = require('../models/schemas/Meal');
const { reportError } = require('../utils/sentryReporter');
const { EXCLUDED_SERVING_UNITS } = require('../utils/servingUnits');

const MIN_SAMPLES_FOR_REPLACE = 3;
const GRAMS_BUCKET_SOLID = 5;
const GRAMS_BUCKET_BOWL = 10;

function roundToBucket(value, unit) {
  const bucket = /bowl|cup|glass/i.test(unit) ? GRAMS_BUCKET_BOWL : GRAMS_BUCKET_SOLID;
  return Math.round(value / bucket) * bucket;
}

function modeRounded(values, unit) {
  if (values.length === 0) return null;
  const counts = new Map();
  for (const v of values) {
    const bucketed = roundToBucket(v, unit);
    counts.set(bucketed, (counts.get(bucketed) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return { grams: best, sampleSize: bestCount };
}

async function aggregateAllFoodItems() {
  const pipeline = [
    { $unwind: '$items' },
    { $match: { 'items.foodItemId': { $ne: null } } },
    {
      $project: {
        foodItemId: '$items.foodItemId',
        unit: { $ifNull: ['$items.displayQuantity.final.unit', '$items.displayQuantity.llm.unit'] },
        displayValue: { $ifNull: ['$items.displayQuantity.final.value', '$items.displayQuantity.llm.value'] },
        measureValue: { $ifNull: ['$items.measureQuantity.final.value', '$items.measureQuantity.llm.value'] }
      }
    },
    {
      $match: {
        unit: { $nin: [null, ...EXCLUDED_SERVING_UNITS] },
        displayValue: { $gt: 0 },
        measureValue: { $gt: 0 }
      }
    },
    {
      $project: {
        foodItemId: 1,
        unit: 1,
        gramsPerUnit: { $divide: ['$measureValue', '$displayValue'] }
      }
    },
    {
      $group: {
        _id: { foodItemId: '$foodItemId', unit: '$unit' },
        samples: { $push: '$gramsPerUnit' }
      }
    }
  ];

  const rows = await Meal.aggregate(pipeline);
  const byFoodItem = new Map();
  for (const row of rows) {
    const { foodItemId, unit } = row._id;
    if (row.samples.length < MIN_SAMPLES_FOR_REPLACE) continue;
    const mode = modeRounded(row.samples, unit);
    if (!mode || !mode.grams || mode.grams <= 0) continue;
    const key = String(foodItemId);
    if (!byFoodItem.has(key)) byFoodItem.set(key, []);
    byFoodItem.get(key).push({ unit, grams: mode.grams, sampleSize: mode.sampleSize });
  }
  return byFoodItem;
}

async function refineFoodItem(food, aggregatedEntries) {
  const existing = food.servingSizes || [];
  const byUnit = new Map();
  for (const s of existing) byUnit.set(s.unit, s);

  let changed = false;
  for (const agg of aggregatedEntries) {
    const current = byUnit.get(agg.unit);
    if (current && current.source === 'user_confirmed') continue;

    if (!current) {
      byUnit.set(agg.unit, {
        unit: agg.unit,
        grams: agg.grams,
        isDefault: false,
        source: 'aggregated',
        sampleSize: agg.sampleSize,
        updatedAt: new Date()
      });
      changed = true;
      continue;
    }

    const gramsShifted = Math.abs((current.grams || 0) - agg.grams) >= GRAMS_BUCKET_SOLID;
    const sourceUpgrade = current.source === 'llm';
    if (gramsShifted || sourceUpgrade) {
      byUnit.set(agg.unit, {
        unit: agg.unit,
        grams: agg.grams,
        isDefault: !!current.isDefault,
        source: 'aggregated',
        sampleSize: agg.sampleSize,
        updatedAt: new Date()
      });
      changed = true;
    }
  }

  if (!changed) return false;

  const merged = Array.from(byUnit.values());
  const hasDefault = merged.some(s => s.isDefault);
  if (!hasDefault && merged.length > 0) merged[0].isDefault = true;

  await FoodItem.updateOne({ _id: food._id }, { $set: { servingSizes: merged } });
  return true;
}

async function runRefinement() {
  console.log('[FoodItemRefinement] Starting weekly servingSizes refinement...');
  const startedAt = Date.now();

  const aggregatedMap = await aggregateAllFoodItems();
  console.log(`[FoodItemRefinement] ${aggregatedMap.size} FoodItems have sufficient Meal data for refinement.`);

  if (aggregatedMap.size === 0) {
    console.log('[FoodItemRefinement] Nothing to refine.');
    return;
  }

  const foodIds = Array.from(aggregatedMap.keys()).map(id => id);
  const foods = await FoodItem.find({ _id: { $in: foodIds } }).select('_id name servingSizes').lean();

  let updated = 0;
  for (const food of foods) {
    const aggregatedEntries = aggregatedMap.get(String(food._id));
    if (!aggregatedEntries) continue;
    try {
      const wasChanged = await refineFoodItem(food, aggregatedEntries);
      if (wasChanged) updated++;
    } catch (err) {
      reportError(err, { extra: { context: 'foodItemRefinementCron:refineFoodItem', foodItemId: food._id } });
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[FoodItemRefinement] ✅ Refined ${updated}/${foods.length} FoodItems in ${durationMs}ms.`);
}

function initializeFoodItemRefinementCron() {
  console.log('[FoodItemRefinement] Scheduling weekly refinement cron (Sundays 03:00 IST)...');

  cron.schedule('0 3 * * 0', async () => {
    try {
      await runRefinement();
    } catch (error) {
      reportError(error, { extra: { context: 'foodItemRefinementCron:weekly' } });
      console.error('[FoodItemRefinement] Fatal error:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log('[FoodItemRefinement] ✅ Weekly refinement cron initialized.');
}

module.exports = { initializeFoodItemRefinementCron, runRefinement };

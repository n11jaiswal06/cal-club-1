/**
 * One-time backfill: populate aliases[] and servingSizes[] on every FoodItem.
 *
 * Strategy (in order per item):
 *   1. Aggregate Meal.items[] to derive (foodItemId, unit) → grams-per-unit using
 *      mode-with-rounding over the observed distribution. Entries land tagged
 *      source='aggregated'. Sparse by design — only ~65 pairs exist in dev data
 *      today but they represent the items users log most.
 *   2. For items missing aliases OR lacking servingSizes, batch them through
 *      Gemini 2.5 Flash and fill the gaps. LLM-originated entries land tagged
 *      source='llm'.
 *   3. Upsert onto FoodItem.servingSizes[] keyed by unit. Aggregated entries
 *      overwrite LLM entries for the same unit (data beats guesses).
 *
 * Idempotent: safe to re-run. Reprocesses items where the mode has shifted or
 * aliases are still empty. Will NOT overwrite source='user_confirmed' entries.
 *
 * Usage:
 *   node scripts/backfillFoodItemEnrichment.js                 # full run
 *   node scripts/backfillFoodItemEnrichment.js --dry-run       # no writes
 *   node scripts/backfillFoodItemEnrichment.js --limit 20      # first 20 items
 *   node scripts/backfillFoodItemEnrichment.js --only-missing  # skip items already enriched
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const FoodItem = require('../models/schemas/FoodItem');
const Meal = require('../models/schemas/Meal');
const { EXCLUDED_SERVING_UNITS, isExcludedServingUnit } = require('../utils/servingUnits');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flashModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const ONLY_MISSING = ARGS.includes('--only-missing');
const LIMIT_ARG = ARGS.find(a => a.startsWith('--limit'));
const LIMIT = (() => {
  if (!LIMIT_ARG) return null;
  const raw = LIMIT_ARG.includes('=')
    ? LIMIT_ARG.split('=')[1]
    : ARGS[ARGS.indexOf(LIMIT_ARG) + 1];
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Invalid --limit value: "${raw}". Expected a positive integer.`);
    process.exit(1);
  }
  return parsed;
})();

const BATCH_SIZE = 15;
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

async function aggregateFromMeals() {
  // Prefer .final (user-edited values) but fall back to .llm. V4 currently writes
  // .final = null by convention, so without this fallback we'd miss ~98% of data.
  // Excluded units are the measure axis (g/ml), not serving sizes.
  const pipeline = [
    { $unwind: '$items' },
    {
      $match: {
        'items.foodItemId': { $ne: null }
      }
    },
    {
      $project: {
        foodItemId: '$items.foodItemId',
        unit: {
          $ifNull: ['$items.displayQuantity.final.unit', '$items.displayQuantity.llm.unit']
        },
        displayValue: {
          $ifNull: ['$items.displayQuantity.final.value', '$items.displayQuantity.llm.value']
        },
        measureValue: {
          $ifNull: ['$items.measureQuantity.final.value', '$items.measureQuantity.llm.value']
        }
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
    const mode = modeRounded(row.samples, unit);
    if (!mode || !mode.grams || mode.grams <= 0) continue;
    const key = String(foodItemId);
    if (!byFoodItem.has(key)) byFoodItem.set(key, []);
    byFoodItem.get(key).push({
      unit,
      grams: mode.grams,
      isDefault: false,
      source: 'aggregated',
      sampleSize: mode.sampleSize,
      updatedAt: new Date()
    });
  }
  return byFoodItem;
}

async function llmEnrichBatch(foods) {
  const itemsList = foods.map((f, i) =>
    `${i + 1}. "${f.name}" (category: ${f.category}${f.existingUnits.length ? `, already has: ${f.existingUnits.join(', ')}` : ''})`
  ).join('\n');

  const prompt = `For each food item below, return common aliases and typical serving sizes with per-unit weights.

${itemsList}

Return ONLY raw JSON, no markdown, no explanation:
[
  {
    "name": "exact name from above",
    "aliases": ["alias1", "alias2"],
    "servingSizes": [
      { "unit": "cup", "grams": <number>, "isDefault": true },
      { "unit": "piece", "grams": <number>, "isDefault": false }
    ]
  }
]

Aliases:
- 2-4 per item: regional synonyms, common spelling variants, English-context translations (e.g. "roti" ↔ "chapati", "cilantro" ↔ "coriander", "eggplant" ↔ "brinjal").
- Do NOT include the primary name itself. Do NOT include brand names.
- Empty array if no meaningful aliases.

Serving sizes:
- 2-4 entries per item covering units a user would realistically log in: cup, small bowl, medium bowl, piece, slice, tbsp, tsp, handful, palm-sized, glass.
- Use FOOD-SPECIFIC weights. A cup of leafy greens ≈ 30g, cup of cooked rice ≈ 150g, cup of cooked pasta ≈ 140g, cup of nuts ≈ 150g. Do NOT use a generic "1 cup = 180g" for solids.
- Liquids (milk, juice, lassi, oil, coffee, tea): return ml values with units "glass" (250ml), "cup" (240ml), "small cup" (150ml).
- Countable items (roti 30g, egg 50g, slice 30g, samosa 60g, idli 40g): include "piece" with single-unit weight.
- Exactly ONE entry has isDefault: true — the unit a typical user picks first.
- Skip units already listed in "already has" for that item.`;

  const result = await flashModel.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(jsonStr);

  const byName = {};
  for (const entry of parsed) {
    if (!entry || !entry.name) continue;
    const match = foods.find(f => f.name.toLowerCase() === entry.name.toLowerCase());
    if (!match) continue;
    byName[match.name] = {
      aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(a => typeof a === 'string' && a.trim()) : [],
      servingSizes: Array.isArray(entry.servingSizes)
        ? entry.servingSizes
            .filter(s =>
              s && typeof s.unit === 'string' && typeof s.grams === 'number' && s.grams > 0
              && !isExcludedServingUnit(s.unit)
            )
            .map(s => ({
              unit: s.unit.trim(),
              grams: Math.round(s.grams),
              isDefault: !!s.isDefault,
              source: 'llm',
              sampleSize: null,
              updatedAt: new Date()
            }))
        : []
    };
  }
  return byName;
}

function mergeServingSizes(existing, aggregated, llmGenerated) {
  // Key by unit. Priority: user_confirmed > aggregated > llm. Existing user_confirmed
  // entries are preserved. Aggregated overwrites existing llm. New llm fills gaps only.
  const byUnit = new Map();

  for (const s of existing || []) {
    byUnit.set(s.unit, s);
  }
  for (const s of aggregated || []) {
    const current = byUnit.get(s.unit);
    if (!current || current.source !== 'user_confirmed') {
      byUnit.set(s.unit, s);
    }
  }
  for (const s of llmGenerated || []) {
    if (!byUnit.has(s.unit)) {
      byUnit.set(s.unit, s);
    }
  }

  const merged = Array.from(byUnit.values());

  // Enforce exactly one isDefault. Prefer existing default; otherwise first entry.
  let defaultIndex = merged.findIndex(s => s.isDefault);
  if (defaultIndex === -1 && merged.length > 0) defaultIndex = 0;
  return merged.map((s, i) => ({ ...s, isDefault: i === defaultIndex }));
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);
  console.log(`Connected to MongoDB (dry-run=${DRY_RUN}, only-missing=${ONLY_MISSING}, limit=${LIMIT || 'none'})`);

  console.log('\nStep 1: aggregating Meal history...');
  const aggregatedMap = await aggregateFromMeals();
  const aggPairCount = Array.from(aggregatedMap.values()).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`  ${aggregatedMap.size} FoodItems have aggregatable Meal data (${aggPairCount} distinct (item, unit) pairs).`);

  console.log('\nStep 2: selecting FoodItems for enrichment...');
  const foodQuery = ONLY_MISSING
    ? { $or: [{ aliases: { $size: 0 } }, { servingSizes: { $size: 0 } }] }
    : {};
  const allFoods = await FoodItem.find(foodQuery).limit(LIMIT || 0).lean();
  console.log(`  ${allFoods.length} FoodItems to process.`);

  let processed = 0;
  let aliasesAdded = 0;
  let servingsAdded = 0;
  let errors = 0;

  for (let i = 0; i < allFoods.length; i += BATCH_SIZE) {
    const batch = allFoods.slice(i, i + BATCH_SIZE);
    const batchPayload = batch.map(f => {
      const agg = aggregatedMap.get(String(f._id)) || [];
      const existingUnits = [...new Set([...(f.servingSizes || []).map(s => s.unit), ...agg.map(s => s.unit)])];
      return { name: f.name, category: f.category, existingUnits };
    });

    let llmMap = {};
    try {
      llmMap = await llmEnrichBatch(batchPayload);
    } catch (err) {
      console.error(`  [Batch ${i / BATCH_SIZE + 1}] LLM error:`, err.message);
      errors++;
      continue;
    }

    for (const food of batch) {
      const aggregated = aggregatedMap.get(String(food._id)) || [];
      const llm = llmMap[food.name] || { aliases: [], servingSizes: [] };

      const existingAliasSet = new Set((food.aliases || []).map(a => a.toLowerCase()));
      const newAliases = llm.aliases.filter(a => !existingAliasSet.has(a.toLowerCase()));
      const mergedAliases = [...(food.aliases || []), ...newAliases];

      const mergedServingSizes = mergeServingSizes(food.servingSizes, aggregated, llm.servingSizes);

      const aliasDelta = mergedAliases.length - (food.aliases?.length || 0);
      const servingDelta = mergedServingSizes.length - (food.servingSizes?.length || 0);

      if (DRY_RUN) {
        if (aliasDelta > 0 || servingDelta > 0) {
          console.log(`  [DRY] "${food.name}": +${aliasDelta} aliases, +${servingDelta} servings (${mergedServingSizes.map(s => `${s.unit}=${s.grams}${s.source === 'aggregated' ? '*' : ''}`).join(', ')})`);
        }
      } else {
        await FoodItem.updateOne(
          { _id: food._id },
          { $set: { aliases: mergedAliases, servingSizes: mergedServingSizes } }
        );
      }

      aliasesAdded += Math.max(0, aliasDelta);
      servingsAdded += Math.max(0, servingDelta);
      processed++;
    }

    console.log(`  Processed ${Math.min(i + BATCH_SIZE, allFoods.length)}/${allFoods.length}`);
  }

  console.log('\n=== Summary ===');
  console.log(`Processed: ${processed} FoodItems`);
  console.log(`Aliases added: ${aliasesAdded}`);
  console.log(`ServingSizes added: ${servingsAdded}`);
  console.log(`Batch errors: ${errors}`);
  if (DRY_RUN) console.log('(dry-run — no writes performed)');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

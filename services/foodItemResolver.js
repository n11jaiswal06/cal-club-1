/**
 * foodItemResolver — unified per-item resolution for the edit/add flows.
 *
 * Stage 3 replaces the bespoke LLM-per-edit path in mealController with this
 * resolver. Given an optional foodItemId and a user's displayQuantity, it
 * returns a fully-resolved item shape (nutrition + measureQuantity in grams)
 * by following the DB-first waterfall:
 *
 *   1. If foodItemId present and the unit is already in FoodItem.servingSizes
 *      → pure math, zero round-trip.
 *   2. If foodItemId present but the unit is not in servingSizes (e.g. user
 *      picked "handful" on a food with only cup/piece entries)
 *      → single-item Gemini call to resolve unit→grams for this food,
 *        cache the result back to servingSizes, then compute nutrition.
 *   3. If foodItemId absent (user typed free text and hit Add without picking
 *      a suggestion)
 *      → match waterfall (exact / alias / semantic) via matchFood. On hit,
 *        route through case 1. On miss, LLM call for per-100g nutrition,
 *        cache a new FoodItem with enrichment, seed its servingSizes with
 *        the observed (unit, grams) pair, and return.
 *
 * No universal fallback: if the LLM call in case 2 or 3 fails, we throw a
 * ResolverError — the caller surfaces this to the user as a retry prompt.
 * Being right matters more than being lenient.
 */

const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const FoodItem = require('../models/schemas/FoodItem');
const { matchFood } = require('./foodMatcher');
const embeddingService = require('./embeddingService');
const { isExcludedServingUnit } = require('../utils/servingUnits');
const { reportError } = require('../utils/sentryReporter');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flashModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

class ResolverError extends Error {
  constructor(message, code = 'RESOLVER_ERROR', cause = null) {
    super(message);
    this.name = 'ResolverError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Density table for ml → g conversion on liquid items. Mirrors the table in
 * nutritionLookupServiceV4.js; kept local to avoid cross-service coupling.
 */
const ML_TO_G_DENSITY = {
  oil: 0.92, 'cooking oil': 0.92, 'olive oil': 0.92, 'coconut oil': 0.92, ghee: 0.93,
  honey: 1.42, 'maple syrup': 1.32,
  milk: 1.03, 'whole milk': 1.03, 'skim milk': 1.04, 'oat milk': 1.03,
  cream: 0.99, 'heavy cream': 0.99
};

function mlToGrams(ml, foodName) {
  const lower = (foodName || '').toLowerCase();
  for (const [key, density] of Object.entries(ML_TO_G_DENSITY)) {
    if (lower.includes(key)) return Math.round(ml * density);
  }
  return Math.round(ml); // default: water-based liquids, 1ml ≈ 1g
}

function computeNutritionFromPer100g(food, grams) {
  const multiplier = (grams || 0) / 100;
  return {
    calories: Math.round((food.caloriesPer100g || 0) * multiplier),
    protein: Math.round((food.proteinPer100g || 0) * multiplier * 10) / 10,
    carbs: Math.round((food.carbsPer100g || 0) * multiplier * 10) / 10,
    fat: Math.round((food.fatPer100g || 0) * multiplier * 10) / 10,
    fiber: Math.round((food.fiberPer100g || 0) * multiplier * 10) / 10
  };
}

/**
 * Look up a unit on a FoodItem's servingSizes, case-insensitive with common
 * variants (piece / pieces / slice / slices).
 */
function findServingSize(servingSizes, unit) {
  if (!Array.isArray(servingSizes) || !unit) return null;
  const unitLower = unit.trim().toLowerCase();
  const singular = unitLower.endsWith('s') ? unitLower.slice(0, -1) : unitLower;
  const plural = unitLower.endsWith('s') ? unitLower : `${unitLower}s`;
  for (const entry of servingSizes) {
    const entryUnit = (entry.unit || '').trim().toLowerCase();
    if (entryUnit === unitLower || entryUnit === singular || entryUnit === plural) {
      return entry;
    }
  }
  return null;
}

/**
 * Fire a single-item LLM call to resolve "how many grams is 1 {unit} of {food}?"
 * Caches the result back to FoodItem.servingSizes tagged source='llm'. Returns
 * the grams value. Throws ResolverError on any LLM failure — callers must
 * decide whether to surface this to the user.
 */
async function resolveUnitToGrams(food, unit) {
  const prompt = `How many grams is 1 "${unit}" of "${food.name}"?

Return ONLY raw JSON, no markdown, no explanation:
{ "grams": <number>, "unit": "${unit}" }

Rules:
- Use a realistic single-serving weight for this food + unit combination.
- If the unit doesn't make sense for this food (e.g. "1 cup" of a single banana), pick the closest sensible interpretation and return its weight.
- For liquids ("${food.name}" is a liquid): return value in ml instead of g, but keep the "grams" key.
- Do not invent units; only answer for unit "${unit}".`;

  let grams;
  try {
    const result = await flashModel.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    grams = Number(parsed.grams);
    if (!Number.isFinite(grams) || grams <= 0) {
      throw new Error(`LLM returned invalid grams: ${JSON.stringify(parsed)}`);
    }
  } catch (err) {
    throw new ResolverError(
      `Could not resolve "${unit}" for "${food.name}". Try a different unit or enter grams directly.`,
      'UNIT_RESOLUTION_FAILED',
      err
    );
  }

  grams = Math.round(grams);

  // Persist the new mapping so the next user doesn't pay this latency.
  // Guard with a $ne match on the unit so concurrent resolvers of the same
  // (food, unit) don't produce duplicate entries — second write becomes a
  // no-op. Safe under Mongo's document-level atomicity for this update.
  try {
    const newEntry = {
      unit,
      grams,
      isDefault: false,
      source: 'llm',
      sampleSize: null,
      updatedAt: new Date()
    };
    await FoodItem.updateOne(
      { _id: food._id, 'servingSizes.unit': { $ne: unit } },
      { $push: { servingSizes: newEntry } }
    );
  } catch (cacheErr) {
    // Non-fatal: we have the value for this request; next user will re-resolve.
    reportError(cacheErr, {
      extra: {
        context: 'foodItemResolver:resolveUnitToGrams:cache',
        foodItemId: food._id,
        unit
      }
    });
    console.warn(`[resolver] failed to cache servingSize for "${food.name}" + "${unit}": ${cacheErr.message}`);
  }

  return grams;
}

/**
 * LLM fallback for case 3 (foodItemId absent and matcher miss). Generates
 * per-100g nutrition + aliases + servingSizes for a brand-new food and caches
 * a FoodItem row. Mirrors the write-time enrichment path used by the V4
 * pipeline but scoped to a single item.
 */
async function llmCreateFoodItem(name, category) {
  const categoryHint = category || 'other';
  const prompt = `Estimate nutrition and common serving sizes for the food below.

Name: "${name}" (category: ${categoryHint})

Return ONLY raw JSON, no markdown, no explanation:
{
  "name": "${name}",
  "caloriesPer100g": <number>,
  "proteinPer100g": <number>,
  "carbsPer100g": <number>,
  "fatPer100g": <number>,
  "fiberPer100g": <number>,
  "aliases": ["alias1", "alias2"],
  "servingSizes": [
    { "unit": "cup", "grams": <number>, "isDefault": true },
    { "unit": "piece", "grams": <number>, "isDefault": false }
  ]
}

Rules:
- Nutrition values are per 100g for cooked/prepared form when applicable.
- 2-4 aliases (regional synonyms, spelling variants, English-context translations). Do NOT include the primary name itself. Empty array if none.
- 2-4 servingSizes covering units users realistically log (cup, small bowl, piece, slice, tbsp, handful, etc.). Use FOOD-SPECIFIC weights (cup leafy = 30g, cup cooked rice = 150g). For liquids, return values in ml. Exactly one entry has isDefault: true.`;

  let parsed;
  try {
    const result = await flashModel.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
    if (typeof parsed.caloriesPer100g !== 'number') {
      throw new Error(`LLM response missing caloriesPer100g: ${JSON.stringify(parsed)}`);
    }
  } catch (err) {
    throw new ResolverError(
      `Could not estimate nutrition for "${name}". Try again or edit the name.`,
      'NUTRITION_LOOKUP_FAILED',
      err
    );
  }

  const servingSizes = Array.isArray(parsed.servingSizes)
    ? parsed.servingSizes
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
    : [];

  // Best-effort embedding for future semantic matches.
  let embedding = null;
  try {
    embedding = await embeddingService.generateEmbedding(
      embeddingService.getFoodSearchText({ name, category: categoryHint, aliases: parsed.aliases || [] })
    );
  } catch (embErr) {
    console.warn(`[resolver] embedding generation failed for "${name}": ${embErr.message}`);
  }

  const foodDoc = new FoodItem({
    name,
    aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter(a => typeof a === 'string' && a.trim()) : [],
    category: categoryHint,
    dataSource: 'LLM',
    verified: false,
    reviewed: false,
    itemType: 'single_item',
    caloriesPer100g: parsed.caloriesPer100g,
    proteinPer100g: parsed.proteinPer100g || 0,
    carbsPer100g: parsed.carbsPer100g || 0,
    fatPer100g: parsed.fatPer100g || 0,
    fiberPer100g: parsed.fiberPer100g || 0,
    servingSizes,
    usageCount: 1,
    llmModel: 'gemini-2.5-flash',
    llmGeneratedAt: new Date(),
    embedding,
    embeddingModel: embedding ? embeddingService.EMBEDDING_MODEL : null,
    embeddingGeneratedAt: embedding ? new Date() : null
  });

  try {
    await foodDoc.save();
  } catch (saveErr) {
    if (saveErr.code === 11000) {
      // Another concurrent resolve beat us. Return their row.
      const existing = await FoodItem.findOne({ name });
      if (existing) return existing;
    }
    // Non-fatal: we still have nutrition to return even without a cached row.
    reportError(saveErr, { extra: { context: 'foodItemResolver:llmCreateFoodItem:save', name } });
    console.warn(`[resolver] failed to cache FoodItem for "${name}": ${saveErr.message}`);
  }
  return foodDoc;
}

/**
 * Public entry point. Resolves a user-supplied (name, displayQuantity) —
 * optionally pinned to an existing foodItemId — into a fully-hydrated item
 * shape the mealController can write into Meal.items[].
 *
 * @param {Object} input
 * @param {ObjectId|String|null} input.foodItemId - Optional existing FoodItem.
 * @param {string} input.name - User-supplied name (required if foodItemId is null).
 * @param {{ value: number, unit: string }} input.displayQuantity - What the user picked.
 * @param {string|null} [input.category] - Optional category hint (for new foods).
 * @returns {Promise<{foodItemId, name, matchedFood, displayQuantity, measureQuantity, nutrition, nutritionSource, confidence}>}
 * @throws {ResolverError} On unresolvable unit or LLM failure.
 */
async function resolveItem({ foodItemId, name, displayQuantity, category }) {
  if (!displayQuantity || typeof displayQuantity.value !== 'number' || !displayQuantity.unit) {
    throw new ResolverError('displayQuantity { value, unit } is required.', 'INVALID_INPUT');
  }
  if (displayQuantity.value <= 0) {
    throw new ResolverError('displayQuantity.value must be > 0.', 'INVALID_INPUT');
  }

  // Case A: caller pinned a FoodItem.
  if (foodItemId) {
    if (!mongoose.Types.ObjectId.isValid(foodItemId)) {
      throw new ResolverError(
        `Invalid foodItemId: ${foodItemId}`,
        'INVALID_INPUT'
      );
    }
    const food = await FoodItem.findById(foodItemId);
    if (!food) {
      throw new ResolverError(`FoodItem ${foodItemId} not found.`, 'FOOD_ITEM_NOT_FOUND');
    }
    return resolveAgainstFood({ food, displayQuantity, sourceOverride: 'db' });
  }

  // Case B: no pin — try the match waterfall.
  if (!name || !name.trim()) {
    throw new ResolverError('name is required when foodItemId is not provided.', 'INVALID_INPUT');
  }

  const match = await matchFood(name.trim(), category || null, 0.8);
  if (match && match.food) {
    return resolveAgainstFood({
      food: match.food,
      displayQuantity,
      sourceOverride: match.food.dataSource === 'LLM' ? 'llm_cached' : 'db',
      confidenceOverride: match.confidence
    });
  }

  // Case C: no match — LLM-create and resolve against the new row. The LLM
  // returns 2-4 servingSizes covering common units; if the user's unit isn't
  // among them, resolveAgainstFood will trigger a unit-level resolve (case B
  // machinery) against the new food. Seeding from the user's observation is
  // infeasible here because we'd need grams to seed a serving, and grams for
  // a non-measure unit is exactly what we're trying to resolve.
  const newFood = await llmCreateFoodItem(name.trim(), category);
  return resolveAgainstFood({ food: newFood, displayQuantity, sourceOverride: 'llm_fresh' });
}

async function resolveAgainstFood({ food, displayQuantity, sourceOverride = 'db', confidenceOverride = null }) {
  const { value, unit } = displayQuantity;

  // Measure units: no serving lookup needed.
  const unitLower = unit.trim().toLowerCase();
  const isGram = unitLower === 'g' || unitLower === 'gram' || unitLower === 'grams';
  const isMl = unitLower === 'ml' || unitLower === 'milliliter' || unitLower === 'milliliters';

  let grams;
  let measureUnit = 'g';

  if (isGram) {
    grams = Math.round(value);
  } else if (isMl) {
    grams = mlToGrams(value, food.name);
    measureUnit = 'ml';
  } else {
    const serving = findServingSize(food.servingSizes, unit);
    if (serving) {
      grams = Math.round(serving.grams * value);
    } else {
      // Unit not in servingSizes — resolve via LLM and cache.
      const perUnit = await resolveUnitToGrams(food, unit);
      grams = Math.round(perUnit * value);
    }
  }

  const nutrition = computeNutritionFromPer100g(food, grams);

  return {
    foodItemId: food._id,
    name: food.name,
    matchedFood: food,
    displayQuantity: { value, unit },
    measureQuantity: { value: grams, unit: measureUnit },
    nutrition,
    nutritionSource: sourceOverride,
    confidence: confidenceOverride !== null ? confidenceOverride : 1.0
  };
}

module.exports = {
  resolveItem,
  ResolverError,
  // Exported for tests / direct callers if needed.
  findServingSize,
  computeNutritionFromPer100g
};

const { GoogleGenerativeAI } = require('@google/generative-ai');
const FoodItem = require('../models/schemas/FoodItem');
const CompositeDishMapping = require('../models/schemas/CompositeDishMapping');
const { matchFood, batchExactMatch } = require('./foodMatcher');
const embeddingService = require('./embeddingService');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flashModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Try to find a food item in the database.
 * Returns the enriched item if found, or the original item with nutritionSource='db_miss' if not.
 */
async function dbLookup(item) {
  const { name, category, grams } = item;

  if (!name || !grams) {
    return {
      ...item,
      nutrition: null,
      nutritionSource: 'missing',
      error: 'Missing name or grams'
    };
  }

  const matchResult = await matchFood(name, category, 0.80);

  if (matchResult && matchResult.food) {
    const { food, confidence, strategy } = matchResult;
    const multiplier = grams / 100;

    const nutrition = {
      calories: Math.round(food.caloriesPer100g * multiplier),
      protein: Math.round(food.proteinPer100g * multiplier * 10) / 10,
      carbs: Math.round(food.carbsPer100g * multiplier * 10) / 10,
      fat: Math.round(food.fatPer100g * multiplier * 10) / 10,
      fiber: Math.round((food.fiberPer100g || 0) * multiplier * 10) / 10
    };

    const nutritionSource = food.dataSource === 'LLM' ? 'llm_cached' : 'db';

    return {
      ...item,
      foodItemId: food._id,
      matchedName: food.name,
      dataSource: food.dataSource,
      nutrition,
      nutritionSource,
      confidence,
      strategy,
      verified: food.verified
    };
  }

  // No match — mark as db_miss for batch LLM processing
  return { ...item, nutritionSource: 'db_miss' };
}

/**
 * Cache an LLM-generated composite decomposition to the database for future review.
 * Stores visibleComponents and gravyType for context.
 */
async function cacheLLMDecomposition(dishName, components, visibleComponents, gravyType, totalGrams) {
  try {
    const mapping = new CompositeDishMapping({
      dishName,
      aliases: [],
      isComposite: true,
      components: components.map(c => ({
        name: c.name,
        ratio: c.grams / totalGrams,
        category: c.category
      })),
      visibleComponents: visibleComponents || [],
      gravyType: gravyType || null,
      totalGrams,
      reviewed: false,
      dataSource: 'LLM',
      llmModel: 'gemini-2.5-flash',
      llmGeneratedAt: new Date()
    });
    await mapping.save();
    console.log(`[LLM Decompose] Cached mapping for "${dishName}" → ${components.length} components (gravyType=${gravyType || 'none'})`);
  } catch (saveErr) {
    // Duplicate or other error — non-fatal, just log
    if (saveErr.code === 11000) {
      console.log(`[LLM Decompose] Mapping for "${dishName}" already exists, skipping cache`);
    } else {
      console.warn(`[LLM Decompose] Failed to cache mapping for "${dishName}":`, saveErr.message);
    }
  }
}

/**
 * LLM fallback: decompose a composite dish into components when no curated mapping exists.
 * Returns components in the same format as curated mappings: [{ name, ratio, category }]
 */
async function llmDecomposeComposite(dishName, totalGrams, visibleComponents = [], gravyType = null) {

  const visualContext = visibleComponents.length > 0
    ? `\nVisible components from the photo: ${visibleComponents.join(', ')}\nUse these to determine the actual composition — do NOT assume a generic recipe. For example, if the photo shows "light vinaigrette" do not use mayonnaise.`
    : '';

  const gravyContext = gravyType
    ? `\nGravy style: "${gravyType}". Use these ratio guidelines for curry-based dishes:
- "dry" (bhuna/sukha): protein is 60-70%, dry masala coating is 10-20%, remaining is other vegetables/ingredients
- "semi" (kadhai style): protein is 50-60%, thick sauce is 20-30%, remaining is vegetables/ingredients
- "gravy" (liquid curry): gravy/sauce is 40-50%, protein is 30-40%, remaining is vegetables/ingredients`
    : '';

  const prompt = `You are a food decomposition specialist. Break down the composite dish "${dishName}" (${totalGrams}g total as served) into its individual components.
${visualContext}${gravyContext}
For each component, provide:
- name: specific ingredient name (e.g., "Grilled Chicken Breast", not just "Chicken")
- grams: estimated weight in grams (all component grams must sum to ${totalGrams})
- displayQty: user-friendly quantity string (e.g., "1 cup", "3 boneless pieces", "2 tbsp", "1 small bowl"). Use the same unit conventions as a recipe — cups for rice/grains, pieces for countable protein, tbsp for sauces/oil, small bowl for gravies.
- category: one of: protein, grain, fat, vegetable, fruit, sauce, beverage, dairy, nuts, legumes, gravy, other

Rules:
- Be specific with ingredient names so they can be matched against a nutrition database
- All component grams must sum to exactly ${totalGrams}
- Use realistic amounts based on the visible components, not a generic recipe
- Keep components MINIMAL — typically 2-4 items. Do NOT list garnishes, spices, or aromatics as separate components.

COMPONENT MERGING:
- For curries: the gravy/sauce is ONE component. Absorb onions, tomatoes, ginger-garlic, cilantro, green chili, spices, and oil INTO the gravy. Do not list them separately. Example: "Chicken Curry Gravy" (not "Gravy" + "Cooked Onion" + "Cilantro" + "Green Chili" + "Spices")
- For rice dishes: the rice is ONE component. Absorb fried onions, whole spices, and ghee INTO the rice. Example: "Biryani Rice with Ghee" (not "Rice" + "Fried Onions" + "Ghee" + "Whole Spices")
- For salads: dressing is ONE component. Absorb oil, vinegar, herbs INTO the dressing.
- The only separate components should be items from DIFFERENT food groups (protein vs carb vs gravy vs vegetable).

COOKING FAT (ghee, oil, butter absorbed during cooking):
- For cooked dishes (biryani, pulao, fried rice, stir-fries), add a fixed 1 tbsp (14g) of cooking fat — regardless of total dish weight
- For curries/gravies: the fat is already part of the gravy — do NOT add a separate oil component
- For deep-fried items (pakora, samosa, fries): do NOT add oil — it's already in the fried item's nutrition
- For salads: do NOT add oil separately — the dressing is its own visible component with its own nutrition

DRESSING/SAUCE:
- Only include if visible in the photo or typical for the dish
- Name it specifically (e.g., "Caesar Dressing", "Light Vinaigrette", "Tahini Sauce") — not just "oil"
- Typical amount: 1-2 tbsp (15-30g)

Return ONLY raw JSON, no markdown, no explanation:
[
  { "name": "Component name", "grams": 100, "displayQty": "3 boneless pieces", "category": "protein" }
]`;

  const result = await flashModel.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const components = JSON.parse(jsonStr);

  const decompTokens = {
    input: result.response.usageMetadata?.promptTokenCount || null,
    output: result.response.usageMetadata?.candidatesTokenCount || null
  };
  console.log(`[LLM Decompose] Tokens: input=${decompTokens.input}, output=${decompTokens.output}`);

  // Validate grams sum to ~totalGrams, normalize if needed
  const gramsSum = components.reduce((sum, c) => sum + c.grams, 0);
  if (Math.abs(gramsSum - totalGrams) > totalGrams * 0.1) {
    console.warn(`[LLM Decompose] Grams for "${dishName}" sum to ${gramsSum}, expected ${totalGrams}. Normalizing.`);
    const factor = totalGrams / gramsSum;
    for (const c of components) {
      c.grams = Math.round(c.grams * factor);
    }
  }

  return { components, tokens: decompTokens };
}


/**
 * Ask Gemini to estimate per-100g nutrition for multiple food items in a single call.
 * Returns a map: foodName → { caloriesPer100g, proteinPer100g, carbsPer100g, fatPer100g, fiberPer100g }
 */
async function batchLLMNutritionEstimate(foodItems) {
  if (foodItems.length === 0) return {};

  const itemsList = foodItems.map((f, i) =>
    `${i + 1}. "${f.name}" (category: ${f.category || 'unknown'})`
  ).join('\n');

  const prompt = `Estimate the nutrition per 100 grams for each food item below.

${itemsList}

Return ONLY raw JSON, no markdown, no explanation. Use this exact format:
[
  {
    "name": "exact name from above",
    "caloriesPer100g": <number>,
    "proteinPer100g": <number>,
    "carbsPer100g": <number>,
    "fatPer100g": <number>,
    "fiberPer100g": <number>
  }
]

Rules:
- Return one object per item, in the same order as listed above
- Use standard nutritional reference values for cooked/prepared forms
- Be accurate with your estimates`;

  const result = await flashModel.generateContent(prompt);
  const text = result.response.text().trim();

  const batchTokens = {
    input: result.response.usageMetadata?.promptTokenCount || null,
    output: result.response.usageMetadata?.candidatesTokenCount || null
  };
  console.log(`[Batch LLM] Tokens: input=${batchTokens.input}, output=${batchTokens.output}`);

  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const llmResults = JSON.parse(jsonStr);

  // Build a map: name → nutrition (match by name, not array position)
  const nutritionMap = {};
  for (const llmData of llmResults) {
    if (llmData && llmData.name && typeof llmData.caloriesPer100g === 'number') {
      // Find the original food item name (case-insensitive match)
      const originalItem = foodItems.find(f => f.name.toLowerCase() === llmData.name.toLowerCase());
      if (originalItem) {
        nutritionMap[originalItem.name] = llmData;
      }
    }
  }

  return { nutritionMap, tokens: batchTokens };
}

/**
 * Cache LLM-estimated food items to the database with embeddings.
 * Uses bulkWrite to avoid duplicate entries for the same name.
 */
async function cacheLLMResults(nutritionMap, foodItems) {
  const cachedFoods = {};

  // Filter to items that have LLM data
  const itemsToCache = foodItems.filter(f => nutritionMap[f.name]);
  if (itemsToCache.length === 0) return cachedFoods;

  // Generate all embeddings in a single batch call
  const searchTexts = itemsToCache.map(f =>
    embeddingService.getFoodSearchText({
      name: f.name,
      category: f.category || 'other',
      aliases: []
    })
  );

  let embeddings = new Array(itemsToCache.length).fill(null);
  try {
    embeddings = await embeddingService.generateEmbeddingsBatch(searchTexts);
  } catch (embErr) {
    console.warn(`Failed to generate batch embeddings:`, embErr.message);
  }

  const results = itemsToCache.map((f, i) => ({
    name: f.name,
    category: f.category,
    llmData: nutritionMap[f.name],
    embedding: embeddings[i] || null
  }));

  // Build a lookup from original name → observed quantity context so we can
  // seed servingSizes with the single data point we already know.
  const observedByName = {};
  for (const f of itemsToCache) {
    observedByName[f.name] = {
      displayQuantity: f.observedDisplayQuantity || null,
      grams: f.observedGrams || null
    };
  }

  for (const r of results) {
    if (!r) continue;

    const observed = observedByName[r.name];
    const servingSizes = [];
    if (observed && observed.displayQuantity && observed.grams) {
      const dq = observed.displayQuantity;
      const dqValue = dq.value || (dq.llm && dq.llm.value) || (dq.final && dq.final.value);
      const dqUnit = dq.unit || (dq.llm && dq.llm.unit) || (dq.final && dq.final.unit);
      if (dqValue && dqUnit && dqUnit !== 'g' && dqUnit !== 'ml') {
        servingSizes.push({
          unit: dqUnit,
          grams: Math.round(observed.grams / dqValue),
          isDefault: true,
          source: 'aggregated',
          sampleSize: 1,
          updatedAt: new Date()
        });
      }
    }

    const cachedFood = new FoodItem({
      name: r.name,
      aliases: [],
      category: r.category || 'other',
      dataSource: 'LLM',
      verified: false,
      reviewed: false,
      itemType: 'single_item',
      caloriesPer100g: r.llmData.caloriesPer100g,
      proteinPer100g: r.llmData.proteinPer100g,
      carbsPer100g: r.llmData.carbsPer100g,
      fatPer100g: r.llmData.fatPer100g,
      fiberPer100g: r.llmData.fiberPer100g || 0,
      servingSizes,
      usageCount: 1,
      llmModel: 'gemini-2.5-flash',
      llmGeneratedAt: new Date(),
      embedding: r.embedding,
      embeddingModel: r.embedding ? embeddingService.EMBEDDING_MODEL : null,
      embeddingGeneratedAt: r.embedding ? new Date() : null
    });

    try {
      await cachedFood.save();
      cachedFoods[r.name] = cachedFood;
      console.log(`[LLM Cache] Saved "${r.name}" → ${r.llmData.caloriesPer100g} cal/100g`);
    } catch (saveErr) {
      // Duplicate key — item was already cached (race condition or previous run)
      if (saveErr.code === 11000) {
        const existing = await FoodItem.findOne({ name: r.name });
        if (existing) cachedFoods[r.name] = existing;
      } else {
        console.warn(`Failed to cache "${r.name}":`, saveErr.message);
      }
    }
  }

  return cachedFoods;
}

/**
 * Density table for converting ml → grams for liquid items.
 * Most water-based liquids are ~1.0, so we only list outliers.
 */
const ML_TO_G_DENSITY = {
  oil: 0.92, 'cooking oil': 0.92, 'olive oil': 0.92, 'coconut oil': 0.92, ghee: 0.93,
  honey: 1.42, 'maple syrup': 1.32,
  milk: 1.03, 'whole milk': 1.03, 'skim milk': 1.04, 'oat milk': 1.03,
  cream: 0.99, 'heavy cream': 0.99,
};

function mlToGrams(ml, itemName) {
  const lower = itemName.toLowerCase();
  for (const [key, density] of Object.entries(ML_TO_G_DENSITY)) {
    if (lower.includes(key)) return Math.round(ml * density);
  }
  return ml; // default: water-based liquids, 1ml ≈ 1g
}

/**
 * Calculate nutrition for all items in a meal.
 *
 * Flow:
 *   1. Normalize measureQuantity → grams (converting ml via density if needed)
 *   2. DB lookup all items in parallel
 *   3. Collect unique DB misses
 *   4. One batch LLM call for all misses (instead of N separate calls)
 *   5. Cache new items + apply results back to each item
 */
async function calculateNutrition(items) {
  // Step 1: Extract grams from measureQuantity, converting ml if needed
  const normalizedItems = items.map(item => {
    const mq = item.measureQuantity;
    if (mq && mq.value) {
      const grams = mq.unit === 'ml' ? mlToGrams(mq.value, item.name) : mq.value;
      return { ...item, grams };
    }
    // Fallback for legacy items that might still have flat grams
    if (item.grams) return item;
    return item;
  });

  // Token usage accumulator
  const tokenUsage = {
    decomposition: { input: 0, output: 0 },
    batchNutrition: { input: 0, output: 0 }
  };

  // Step 2: Decompose composite dishes via LLM BEFORE DB lookup
  // Composite items get broken into components; non-composite items pass through
  const compositeItems = normalizedItems.filter(item => item.composite);
  const nonCompositeItems = normalizedItems.filter(item => !item.composite);

  const afterDecomposition = [...nonCompositeItems];

  // Decompose all composite items in parallel
  if (compositeItems.length > 0) {
    const decompResults = await Promise.all(compositeItems.map(async (item) => {
      try {
        const decompStart = Date.now();
        console.log(`[LLM Decompose] Decomposing "${item.name}" (gravyType=${item.gravyType || 'none'}) — calling LLM`);
        const decompResult = await llmDecomposeComposite(item.name, item.grams, item.visibleComponents, item.gravyType);
        const { components, tokens: decompTokens } = decompResult;
        console.log(`[LLM Decompose] "${item.name}" decomposed into ${components.length} components [${Date.now() - decompStart}ms]`);

        // Cache decomposition for review (non-blocking)
        cacheLLMDecomposition(item.name, components, item.visibleComponents, item.gravyType, item.grams).catch(() => {});

        return {
          tokens: decompTokens,
          components: components.map(comp => {
            console.log(`[LLM Decompose]   → "${comp.name}" (${comp.grams}g, category: ${comp.category})`);
            // Parse displayQty string (e.g., "3 boneless pieces") into { value, unit }
            let dqValue = comp.grams;
            let dqUnit = 'g';
            if (comp.displayQty) {
              const match = comp.displayQty.match(/^([\d.]+)\s+(.+)$/);
              if (match) {
                dqValue = parseFloat(match[1]);
                dqUnit = match[2];
              } else {
                dqUnit = comp.displayQty;
                dqValue = 1;
              }
            }
            return {
              name: comp.name,
              category: comp.category,
              grams: comp.grams,
              parentDish: item.name,
              parentGrams: item.grams,
              displayQuantity: { value: dqValue, unit: dqUnit },
              measureQuantity: { value: comp.grams, unit: 'g' }
            };
          })
        };
      } catch (err) {
        console.error(`[LLM Decompose] Failed for "${item.name}": ${err.message}. Falling through as single item.`);
        return { tokens: { input: 0, output: 0 }, components: [item] };
      }
    }));

    for (const result of decompResults) {
      tokenUsage.decomposition.input += result.tokens.input || 0;
      tokenUsage.decomposition.output += result.tokens.output || 0;
      afterDecomposition.push(...result.components);
    }
  }

  // Step 3: DB lookup — batch exact match first, then waterfall for misses
  const itemNames = afterDecomposition.map(item => item.name).filter(Boolean);
  const batchMatches = await batchExactMatch(itemNames);

  const dbResults = await Promise.all(
    afterDecomposition.map(item => {
      const batchHit = item.name ? batchMatches.get(item.name) : null;
      if (batchHit) {
        // Exact match from batch — compute nutrition directly
        const { food, confidence, strategy } = batchHit;
        const grams = item.grams || 0;
        const multiplier = grams / 100;
        const nutrition = {
          calories: Math.round(food.caloriesPer100g * multiplier),
          protein: Math.round(food.proteinPer100g * multiplier * 10) / 10,
          carbs: Math.round(food.carbsPer100g * multiplier * 10) / 10,
          fat: Math.round(food.fatPer100g * multiplier * 10) / 10,
          fiber: Math.round((food.fiberPer100g || 0) * multiplier * 10) / 10
        };
        const nutritionSource = food.dataSource === 'LLM' ? 'llm_cached' : 'db';
        return Promise.resolve({
          ...item, foodItemId: food._id, matchedName: food.name, dataSource: food.dataSource,
          nutrition, nutritionSource, confidence, strategy, verified: food.verified
        });
      }
      // No batch hit — fall through to per-item waterfall (case-insensitive, alias, semantic)
      return dbLookup(item);
    })
  );

  // Step 4: Collect unique DB misses from component lookups.
  // Preserve the observed displayQuantity/grams so cacheLLMResults can seed
  // servingSizes from real data instead of an LLM guess.
  const dbMissNames = new Set();
  const dbMissItems = [];
  for (const result of dbResults) {
    if (result.nutritionSource === 'db_miss' && !dbMissNames.has(result.name)) {
      dbMissNames.add(result.name);
      dbMissItems.push({
        name: result.name,
        category: result.category,
        observedDisplayQuantity: result.displayQuantity || null,
        observedGrams: result.grams || null
      });
    }
  }

  // Step 5: One batch LLM call for all unique misses (per-100g nutrition)
  let nutritionMap = {};
  let cachedFoods = {};
  if (dbMissItems.length > 0) {
    console.log(`[Batch LLM] ${dbMissItems.length} unique DB misses: ${dbMissItems.map(f => f.name).join(', ')}`);
    try {
      const batchResult = await batchLLMNutritionEstimate(dbMissItems);
      nutritionMap = batchResult.nutritionMap;
      tokenUsage.batchNutrition.input += batchResult.tokens.input || 0;
      tokenUsage.batchNutrition.output += batchResult.tokens.output || 0;
    } catch (err) {
      // Nutrition estimation failed — downstream per-item handler marks these
      // as llm_error. Continue so the rest of the pipeline still runs.
      console.error(`[Batch LLM Error]:`, err.message);
    }

    // Cache writes run separately so a cache failure doesn't mask the
    // nutrition data we already computed. Cache failures are logged but the
    // per-item handler still receives the nutrition map above.
    try {
      cachedFoods = await cacheLLMResults(nutritionMap, dbMissItems);
    } catch (err) {
      const { reportError } = require('../utils/sentryReporter');
      reportError(err, {
        extra: {
          context: 'nutritionLookupServiceV4:cacheLLMResults',
          itemNames: dbMissItems.map(f => f.name)
        }
      });
      console.error(`[Cache LLM Error] ${err.message} — nutrition resolved but FoodItem row not persisted; items will carry foodItemId=null`);
    }
  }

  // Step 6: Apply LLM results to all db_miss items
  const processedItems = dbResults.map(result => {
    if (result.nutritionSource !== 'db_miss') return result;

    const llmData = nutritionMap[result.name];
    if (!llmData) {
      return {
        ...result,
        nutrition: null,
        nutritionSource: 'llm_error',
        confidence: 0,
        error: 'LLM batch estimation failed for this item'
      };
    }

    const multiplier = result.grams / 100;
    const nutrition = {
      calories: Math.round(llmData.caloriesPer100g * multiplier),
      protein: Math.round(llmData.proteinPer100g * multiplier * 10) / 10,
      carbs: Math.round(llmData.carbsPer100g * multiplier * 10) / 10,
      fat: Math.round(llmData.fatPer100g * multiplier * 10) / 10,
      fiber: Math.round((llmData.fiberPer100g || 0) * multiplier * 10) / 10
    };

    const cached = cachedFoods[result.name];
    return {
      ...result,
      foodItemId: cached ? cached._id : null,
      matchedName: result.name,
      dataSource: 'LLM',
      nutrition,
      nutritionSource: 'llm_fresh',
      confidence: 0.7,
      verified: false
    };
  });

  // Calculate totals
  const totalNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const sourceBreakdown = { db: 0, llm_cached: 0, llm_fresh: 0, llm_error: 0, missing: 0, recipe: 0 };

  for (const item of processedItems) {
    if (item.nutrition) {
      totalNutrition.calories += item.nutrition.calories || 0;
      totalNutrition.protein += item.nutrition.protein || 0;
      totalNutrition.carbs += item.nutrition.carbs || 0;
      totalNutrition.fat += item.nutrition.fat || 0;
      totalNutrition.fiber += item.nutrition.fiber || 0;
    }

    const source = item.nutritionSource || 'missing';
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
  }

  totalNutrition.calories = Math.round(totalNutrition.calories);
  totalNutrition.protein = Math.round(totalNutrition.protein * 10) / 10;
  totalNutrition.carbs = Math.round(totalNutrition.carbs * 10) / 10;
  totalNutrition.fat = Math.round(totalNutrition.fat * 10) / 10;
  totalNutrition.fiber = Math.round(totalNutrition.fiber * 10) / 10;

  return {
    items: processedItems,
    totalNutrition,
    sourceBreakdown,
    coverage: {
      total: processedItems.length,
      fromDatabase: sourceBreakdown.db + sourceBreakdown.llm_cached,
      fromLLM: sourceBreakdown.llm_fresh,
      errors: sourceBreakdown.llm_error + sourceBreakdown.missing
    },
    tokenUsage
  };
}

module.exports = {
  calculateNutrition,
  dbLookup,
  batchLLMNutritionEstimate
};

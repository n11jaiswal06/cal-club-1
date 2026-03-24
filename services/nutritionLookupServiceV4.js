const FoodItem = require('../models/schemas/FoodItem');
const { matchFood } = require('./foodMatcher');
const { lookupRecipeWithDisplayUnits, getLLMFallbackForCompositeDish } = require('./recipeLookupService');

/**
 * Per-item waterfall lookup for simple foods
 * Priority: USDA → IFCT → LLM cache → LLM fresh
 * @param {Object} item - Item from Prompt 1 {name, category, grams}
 * @returns {Object} Item with nutrition data and source tracking
 */
async function waterfallLookupSimpleItem(item) {
  const { name, category, grams } = item;

  if (!name || !grams) {
    return {
      ...item,
      nutrition: null,
      nutritionSource: 'missing',
      error: 'Missing name or grams'
    };
  }

  // Step 1: Try USDA lookup
  let matchResult = await matchFood(name, category, 0.7);
  if (matchResult && matchResult.food && matchResult.food.dataSource === 'USDA') {
    return calculateNutritionFromFoodItem(item, matchResult.food, 'usda', matchResult.confidence);
  }

  // Step 2: Try IFCT lookup
  // Re-search specifically for IFCT if USDA match wasn't found
  const ifctFood = await FoodItem.findOne({
    dataSource: 'IFCT',
    $or: [
      { name: { $regex: new RegExp(name, 'i') } },
      { aliases: { $regex: new RegExp(name, 'i') } }
    ]
  });

  if (ifctFood) {
    return calculateNutritionFromFoodItem(item, ifctFood, 'ifct', 0.85);
  }

  // Step 3: Try LLM cache (unverified entries)
  const cachedLLMFood = await FoodItem.findOne({
    dataSource: 'LLM',
    $or: [
      { name: { $regex: new RegExp(name, 'i') } },
      { aliases: { $regex: new RegExp(name, 'i') } }
    ]
  });

  if (cachedLLMFood) {
    return calculateNutritionFromFoodItem(item, cachedLLMFood, 'llm_cached', 0.75);
  }

  // Step 4: LLM fresh call needed
  return {
    ...item,
    nutrition: null,
    nutritionSource: 'llm_fresh_needed',
    confidence: 0,
    message: 'Requires fresh LLM call'
  };
}

/**
 * Calculate nutrition from FoodItem database entry
 * @param {Object} item - Original item with grams
 * @param {Object} foodItem - Matched FoodItem document
 * @param {string} source - Source identifier (usda, ifct, llm_cached)
 * @param {number} confidence - Match confidence (0-1)
 * @returns {Object} Item with calculated nutrition
 */
function calculateNutritionFromFoodItem(item, foodItem, source, confidence) {
  const multiplier = item.grams / 100;

  const nutrition = {
    calories: foodItem.caloriesPer100g * multiplier,
    protein: foodItem.proteinPer100g * multiplier,
    carbs: foodItem.carbsPer100g * multiplier,
    fat: foodItem.fatPer100g * multiplier,
    fiber: foodItem.fiberPer100g * multiplier
  };

  return {
    ...item,
    foodItemId: foodItem._id,
    matchedName: foodItem.name,
    dataSource: foodItem.dataSource,
    nutrition,
    nutritionSource: source,
    confidence,
    verified: foodItem.verified
  };
}

/**
 * Get LLM nutrition for item and cache result
 * @param {Object} item - Item needing LLM nutrition
 * @param {string} llmModel - Model used (e.g., 'gemini-2.5-flash')
 * @returns {Object} Item with LLM nutrition + cached FoodItem ID
 */
async function getLLMNutritionAndCache(item, llmModel) {
  // This will be implemented in Phase 2.5 when we enhance Prompt 1
  // For now, return structure indicating LLM is needed
  const llmNutrition = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0
  };

  // Cache the LLM result as unverified FoodItem
  const cachedFood = new FoodItem({
    name: item.name,
    aliases: [],
    category: item.category || 'other',
    dataSource: 'LLM',
    sourceId: null,
    verified: false,
    caloriesPer100g: (llmNutrition.calories / item.grams) * 100,
    proteinPer100g: (llmNutrition.protein / item.grams) * 100,
    carbsPer100g: (llmNutrition.carbs / item.grams) * 100,
    fatPer100g: (llmNutrition.fat / item.grams) * 100,
    fiberPer100g: (llmNutrition.fiber / item.grams) * 100,
    usageCount: 1,
    llmModel,
    llmGeneratedAt: new Date()
  });

  await cachedFood.save();

  return {
    ...item,
    foodItemId: cachedFood._id,
    nutrition: llmNutrition,
    nutritionSource: 'llm_fresh',
    confidence: 0.7,
    verified: false,
    llmModel
  };
}

/**
 * Track nutrition miss for analytics
 * @param {string} foodName - Food name that wasn't found
 * @param {string} category - Food category
 */
async function trackNutritionMiss(foodName, category) {
  // This will be implemented in Phase 4 (metrics)
  // For now, just log it
  console.log(`[Nutrition Miss] ${foodName} (${category})`);
}

/**
 * Process single item - main entry point for per-item lookup
 * @param {Object} item - Item from Prompt 1
 * @param {string} llmModel - LLM model for fallback
 * @returns {Object} Item with nutrition data
 */
async function processItem(item, llmModel = 'gemini-2.5-flash') {
  const { itemType, name, category, grams, servingSize, servingUnit } = item;

  // Handle composite dishes
  if (itemType === 'composite_dish') {
    const recipeResult = await lookupRecipeWithDisplayUnits(name, servingSize || 1);

    if (recipeResult.found) {
      // Recipe found - return components with nutrition
      const totalNutrition = recipeResult.totalNutrition;

      return {
        ...item,
        itemType: 'composite_dish',
        recipeId: recipeResult.recipeId,
        servingSize: recipeResult.servingSize,
        servingUnit: recipeResult.servingUnit,
        components: recipeResult.components,
        nutrition: totalNutrition,
        nutritionSource: 'recipe',
        confidence: recipeResult.confidence,
        verified: recipeResult.verified
      };
    } else {
      // Recipe not found - need LLM fallback
      const llmFallback = await getLLMFallbackForCompositeDish(name, servingSize, servingUnit);
      return {
        ...item,
        ...llmFallback,
        nutritionSource: 'llm_fresh_needed',
        message: 'Composite dish recipe not in database - LLM component estimation needed'
      };
    }
  }

  // Handle simple items
  if (itemType === 'single_item') {
    const result = await waterfallLookupSimpleItem(item);

    // If waterfall didn't find it, call LLM
    if (result.nutritionSource === 'llm_fresh_needed') {
      trackNutritionMiss(name, category);
      return await getLLMNutritionAndCache(item, llmModel);
    }

    return result;
  }

  // Unknown itemType
  return {
    ...item,
    nutrition: null,
    nutritionSource: 'error',
    error: `Unknown itemType: ${itemType}`
  };
}

/**
 * Calculate nutrition for all items in a meal
 * @param {Array} items - Items from Prompt 1
 * @param {string} llmModel - LLM model for fallback
 * @returns {Object} {items: [...], totalNutrition: {...}, sourceBreakdown: {...}}
 */
async function calculateNutrition(items, llmModel = 'gemini-2.5-flash') {
  // Process all items in parallel
  const processedItems = await Promise.all(
    items.map(item => processItem(item, llmModel))
  );

  // Calculate total nutrition
  const totalNutrition = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0
  };

  // Track source breakdown
  const sourceBreakdown = {
    usda: 0,
    ifct: 0,
    llm_cached: 0,
    llm_fresh: 0,
    recipe: 0,
    missing: 0
  };

  for (const item of processedItems) {
    if (item.nutrition) {
      totalNutrition.calories += item.nutrition.calories || 0;
      totalNutrition.protein += item.nutrition.protein || 0;
      totalNutrition.carbs += item.nutrition.carbs || 0;
      totalNutrition.fat += item.nutrition.fat || 0;
      totalNutrition.fiber += item.nutrition.fiber || 0;
    }

    // Track source
    const source = item.nutritionSource || 'missing';
    if (sourceBreakdown[source] !== undefined) {
      sourceBreakdown[source]++;
    } else {
      sourceBreakdown.missing++;
    }
  }

  return {
    items: processedItems,
    totalNutrition,
    sourceBreakdown,
    coverage: {
      total: items.length,
      fromDatabase: sourceBreakdown.usda + sourceBreakdown.ifct,
      fromCache: sourceBreakdown.llm_cached,
      fromLLM: sourceBreakdown.llm_fresh,
      fromRecipe: sourceBreakdown.recipe,
      missing: sourceBreakdown.missing
    }
  };
}

module.exports = {
  calculateNutrition,
  processItem,
  waterfallLookupSimpleItem,
  getLLMNutritionAndCache,
  trackNutritionMiss
};

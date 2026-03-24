const FoodItem = require('../models/schemas/FoodItem');
const FoodItemAlias = require('../models/schemas/FoodItemAlias');

/**
 * Calculate Levenshtein distance between two strings
 * Used for typo tolerance in fuzzy matching
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Get singular/plural variations of a food name
 */
function getSingularPluralVariations(name) {
  const variations = [name];
  const nameLower = name.toLowerCase();

  // Add plural if singular
  if (!nameLower.endsWith('s')) {
    variations.push(name + 's');
    if (nameLower.endsWith('y')) {
      variations.push(name.slice(0, -1) + 'ies');
    }
  }

  // Add singular if plural
  if (nameLower.endsWith('ies')) {
    variations.push(name.slice(0, -3) + 'y');
  } else if (nameLower.endsWith('s') && !nameLower.endsWith('ss')) {
    variations.push(name.slice(0, -1));
  }

  return [...new Set(variations)];
}

/**
 * Strategy 1: Exact match (case-sensitive)
 */
async function exactMatch(foodName) {
  const food = await FoodItem.findOne({ name: foodName });
  if (food) {
    return { food, confidence: 1.0, strategy: 'exact' };
  }
  return null;
}

/**
 * Strategy 2: Case-insensitive match
 */
async function caseInsensitiveMatch(foodName) {
  const food = await FoodItem.findOne({
    name: { $regex: new RegExp(`^${foodName}$`, 'i') }
  });
  if (food) {
    return { food, confidence: 0.95, strategy: 'case_insensitive' };
  }
  return null;
}

/**
 * Strategy 3: MongoDB text search
 */
async function textSearch(foodName, category = null) {
  const query = { $text: { $search: foodName } };
  if (category) {
    query.category = category;
  }

  const foods = await FoodItem.find(query, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(5);

  if (foods.length > 0) {
    // Return top result with confidence based on text score
    const topFood = foods[0];
    const confidence = Math.min(topFood.score / 10, 0.9); // Normalize score to 0-0.9
    return { food: topFood, confidence, strategy: 'text_search', alternatives: foods.slice(1) };
  }

  return null;
}

/**
 * Strategy 4: Alias lookup
 */
async function aliasLookup(foodName) {
  const alias = await FoodItemAlias.findOne({
    alias: { $regex: new RegExp(`^${foodName}$`, 'i') }
  });

  if (alias) {
    const food = await FoodItem.findById(alias.foodItemId);
    if (food) {
      // Increment alias usage count
      alias.usageCount += 1;
      await alias.save();

      return { food, confidence: 0.9, strategy: 'alias', matchedAlias: alias.alias };
    }
  }

  return null;
}

/**
 * Strategy 5: Fuzzy string matching (Levenshtein distance)
 * Tolerates typos within threshold
 */
async function fuzzyMatch(foodName, maxDistance = 2) {
  const foods = await FoodItem.find({}).limit(1000); // Limit to prevent slow queries
  const matches = [];

  for (const food of foods) {
    const distance = levenshteinDistance(foodName.toLowerCase(), food.name.toLowerCase());
    if (distance <= maxDistance) {
      const confidence = 1 - (distance / foodName.length);
      matches.push({ food, confidence, distance, strategy: 'fuzzy' });
    }
  }

  if (matches.length > 0) {
    // Sort by distance (lower is better), then confidence
    matches.sort((a, b) => a.distance - b.distance || b.confidence - a.confidence);
    return matches[0];
  }

  return null;
}

/**
 * Strategy 6: Singular/plural variations
 */
async function singularPluralMatch(foodName) {
  const variations = getSingularPluralVariations(foodName);

  for (const variation of variations) {
    if (variation === foodName) continue; // Skip original

    const food = await FoodItem.findOne({
      name: { $regex: new RegExp(`^${variation}$`, 'i') }
    });

    if (food) {
      return { food, confidence: 0.85, strategy: 'singular_plural', matchedVariation: variation };
    }
  }

  return null;
}

/**
 * Main waterfall matching function
 * Tries strategies in order until a match is found
 * @param {string} foodName - Name of the food to match
 * @param {string} category - Optional category filter (protein, grain, etc.)
 * @param {number} confidenceThreshold - Minimum confidence to accept (0-1)
 * @returns {Object|null} Match result with food, confidence, strategy
 */
async function matchFood(foodName, category = null, confidenceThreshold = 0.7) {
  if (!foodName || typeof foodName !== 'string') {
    return null;
  }

  const trimmedName = foodName.trim();
  if (!trimmedName) {
    return null;
  }

  // Try strategies in order
  const strategies = [
    () => exactMatch(trimmedName),
    () => caseInsensitiveMatch(trimmedName),
    () => textSearch(trimmedName, category),
    () => aliasLookup(trimmedName),
    () => singularPluralMatch(trimmedName),
    () => fuzzyMatch(trimmedName)
  ];

  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (result && result.confidence >= confidenceThreshold) {
        // Increment food usage count
        if (result.food) {
          result.food.usageCount += 1;
          await result.food.save();
        }
        return result;
      }
    } catch (err) {
      console.error(`Error in matching strategy:`, err);
      // Continue to next strategy
    }
  }

  return null;
}

/**
 * Batch match multiple foods
 * More efficient than calling matchFood multiple times
 */
async function matchFoodsBatch(foodNames, category = null, confidenceThreshold = 0.7) {
  const results = await Promise.all(
    foodNames.map(name => matchFood(name, category, confidenceThreshold))
  );
  return results;
}

/**
 * Search foods by name (for autocomplete/suggestions)
 * Returns top N matching foods
 */
async function searchFoods(query, limit = 10, category = null) {
  const searchQuery = {
    $or: [
      { name: { $regex: new RegExp(query, 'i') } },
      { aliases: { $regex: new RegExp(query, 'i') } }
    ]
  };

  if (category) {
    searchQuery.category = category;
  }

  const foods = await FoodItem.find(searchQuery)
    .sort({ usageCount: -1, name: 1 })
    .limit(limit);

  return foods;
}

module.exports = {
  matchFood,
  matchFoodsBatch,
  searchFoods,
  levenshteinDistance
};

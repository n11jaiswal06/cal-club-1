const Recipe = require('../models/schemas/Recipe');
const { matchFood } = require('./foodMatcher');

/**
 * Look up a recipe by name
 * Tries exact match, then aliases, then fuzzy match
 */
async function findRecipe(recipeName) {
  if (!recipeName || typeof recipeName !== 'string') {
    return null;
  }

  const trimmedName = recipeName.trim();

  // Try exact match
  let recipe = await Recipe.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
  });

  if (recipe) {
    return recipe;
  }

  // Try alias match
  recipe = await Recipe.findOne({
    aliases: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
  });

  if (recipe) {
    return recipe;
  }

  // Try text search
  const recipes = await Recipe.find({ $text: { $search: trimmedName } })
    .limit(1);

  if (recipes.length > 0) {
    return recipes[0];
  }

  return null;
}

/**
 * Scale recipe components by serving size
 * @param {Object} recipe - Recipe document
 * @param {number} servingSize - Number of servings (e.g., 1.5 for "1.5 bowls")
 * @returns {Array} Scaled components with grams
 */
function scaleRecipeComponents(recipe, servingSize = 1) {
  return recipe.components.map(component => ({
    name: component.name,
    category: component.category,
    gramsPerServing: component.gramsPerServing,
    grams: component.gramsPerServing * servingSize
  }));
}

/**
 * Calculate nutrition for a recipe component
 * @param {Object} component - Scaled component {name, category, grams}
 * @returns {Object} Component with nutrition data
 */
async function calculateComponentNutrition(component) {
  // Look up the component in FoodItem database
  const matchResult = await matchFood(component.name, component.category);

  if (!matchResult || !matchResult.food) {
    return {
      ...component,
      nutrition: null,
      nutritionSource: 'missing',
      matchConfidence: 0
    };
  }

  const { food, confidence, strategy } = matchResult;

  // Calculate nutrition based on grams
  const multiplier = component.grams / 100;

  const nutrition = {
    calories: food.caloriesPer100g * multiplier,
    protein: food.proteinPer100g * multiplier,
    carbs: food.carbsPer100g * multiplier,
    fat: food.fatPer100g * multiplier,
    fiber: food.fiberPer100g * multiplier
  };

  return {
    ...component,
    foodItemId: food._id,
    matchedName: food.name,
    dataSource: food.dataSource,
    nutrition,
    nutritionSource: food.dataSource.toLowerCase(),
    matchConfidence: confidence,
    matchStrategy: strategy
  };
}

/**
 * Look up recipe and calculate complete nutrition breakdown
 * @param {string} recipeName - Name of the recipe
 * @param {number} servingSize - Number of servings
 * @returns {Object} Recipe with components and total nutrition
 */
async function lookupRecipe(recipeName, servingSize = 1) {
  // Find recipe
  const recipe = await findRecipe(recipeName);

  if (!recipe) {
    return {
      found: false,
      recipeName,
      servingSize,
      message: 'Recipe not found'
    };
  }

  // Scale components
  const scaledComponents = scaleRecipeComponents(recipe, servingSize);

  // Calculate nutrition for each component
  const componentsWithNutrition = await Promise.all(
    scaledComponents.map(component => calculateComponentNutrition(component))
  );

  // Calculate total nutrition
  const totalNutrition = componentsWithNutrition.reduce((total, component) => {
    if (component.nutrition) {
      total.calories += component.nutrition.calories;
      total.protein += component.nutrition.protein;
      total.carbs += component.nutrition.carbs;
      total.fat += component.nutrition.fat;
      total.fiber += component.nutrition.fiber;
    }
    return total;
  }, {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0
  });

  // Count missing components
  const missingComponents = componentsWithNutrition.filter(c => c.nutritionSource === 'missing');

  return {
    found: true,
    recipeId: recipe._id,
    recipeName: recipe.name,
    servingSize,
    servingUnit: recipe.servingUnit,
    components: componentsWithNutrition,
    totalNutrition,
    verified: recipe.verified,
    source: recipe.source,
    missingComponents: missingComponents.length,
    confidence: missingComponents.length === 0 ? 1.0 : 0.8
  };
}

/**
 * Get LLM fallback for composite dish when recipe doesn't exist
 * This calls the LLM to estimate component breakdown
 * @param {string} dishName - Name of the composite dish
 * @param {number} servingSize - Number of servings
 * @param {string} servingUnit - Unit of serving (bowl, plate, etc.)
 * @returns {Object} LLM-estimated component breakdown
 */
async function getLLMFallbackForCompositeDish(dishName, servingSize, servingUnit) {
  // This will be implemented when we integrate with LLM in Phase 2.5
  // For now, return a structure indicating LLM fallback is needed
  return {
    found: false,
    recipeName: dishName,
    servingSize,
    servingUnit,
    needsLLMFallback: true,
    message: 'Recipe not in database - LLM fallback required'
  };
}

/**
 * Convert component grams to user-friendly display units
 * @param {Object} component - Component with grams
 * @returns {Object} Component with display quantity
 */
function convertToDisplayUnits(component) {
  const { category, grams, name } = component;

  let displayQuantity = { value: grams, unit: 'g' };

  // Category-based conversions
  switch (category) {
    case 'protein':
      // Estimate pieces based on typical weights
      if (name.toLowerCase().includes('chicken') || name.toLowerCase().includes('paneer')) {
        const piecesEstimate = Math.round(grams / 50); // Assume 50g per piece
        if (piecesEstimate > 0) {
          displayQuantity = { value: piecesEstimate, unit: 'pieces', grams };
        }
      }
      break;

    case 'fat':
      // Convert to tablespoons/teaspoons
      const ml = grams; // Rough approximation for oils
      if (ml < 10) {
        displayQuantity = { value: Math.round(ml / 5), unit: 'tsp', grams };
      } else {
        displayQuantity = { value: Math.round(ml / 15), unit: 'tbsp', grams };
      }
      break;

    case 'grain':
      // Convert to cups
      const cups = grams / 180; // Rough approximation for rice/grains
      if (cups >= 0.25) {
        displayQuantity = { value: Math.round(cups * 4) / 4, unit: 'cups', grams };
      }
      break;

    case 'dairy':
      // Convert to ml/cups
      const dairyMl = grams; // Approximation
      if (dairyMl >= 240) {
        displayQuantity = { value: Math.round(dairyMl / 240), unit: 'cups', grams };
      } else {
        displayQuantity = { value: dairyMl, unit: 'ml', grams };
      }
      break;

    default:
      // Keep grams for other categories
      break;
  }

  return {
    ...component,
    displayQuantity
  };
}

/**
 * Look up recipe with user-friendly display quantities
 */
async function lookupRecipeWithDisplayUnits(recipeName, servingSize = 1) {
  const result = await lookupRecipe(recipeName, servingSize);

  if (result.found && result.components) {
    result.components = result.components.map(component => convertToDisplayUnits(component));
  }

  return result;
}

module.exports = {
  findRecipe,
  lookupRecipe,
  lookupRecipeWithDisplayUnits,
  scaleRecipeComponents,
  calculateComponentNutrition,
  getLLMFallbackForCompositeDish,
  convertToDisplayUnits
};

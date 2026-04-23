const MealService = require('../services/mealService');
const Meal = require('../models/schemas/Meal');
const MealEditAudit = require('../models/schemas/MealEditAudit');
const parseBody = require('../utils/parseBody');
const mealFormatter = require('../utils/mealFormatter');
const AiService = require('../services/aiService');
const MealImpactService = require('../services/mealImpactService');
const { reportError } = require('../utils/sentryReporter');

/**
 * Helper function to create a snapshot of meal state for audit
 */
function createMealSnapshot(meal) {
  return {
    name: meal.name,
    totalNutrition: {
      calories: { llm: meal.totalNutrition?.calories?.llm, final: meal.totalNutrition?.calories?.final },
      protein: { llm: meal.totalNutrition?.protein?.llm, final: meal.totalNutrition?.protein?.final },
      carbs: { llm: meal.totalNutrition?.carbs?.llm, final: meal.totalNutrition?.carbs?.final },
      fat: { llm: meal.totalNutrition?.fat?.llm, final: meal.totalNutrition?.fat?.final }
    },
    items: meal.items.map(item => ({
      id: item.id,
      name: { llm: item.name?.llm, final: item.name?.final },
      displayQuantity: {
        llm: item.displayQuantity?.llm,
        final: item.displayQuantity?.final
      },
      measureQuantity: {
        llm: item.measureQuantity?.llm,
        final: item.measureQuantity?.final
      },
      nutrition: {
        calories: { llm: item.nutrition?.calories?.llm, final: item.nutrition?.calories?.final },
        protein: { llm: item.nutrition?.protein?.llm, final: item.nutrition?.protein?.final },
        carbs: { llm: item.nutrition?.carbs?.llm, final: item.nutrition?.carbs?.final },
        fat: { llm: item.nutrition?.fat?.llm, final: item.nutrition?.fat?.final }
      }
    }))
  };
}

function createMeal(req, res) {
  parseBody(req, async (err, mealData) => {
    if (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    try {
      const meal = await MealService.createMeal(req.user.userId, mealData);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(meal));
    } catch (error) {
      reportError(error, { req });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to create meal', details: error.message }));
    }
  });
}

async function getMeals(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    date: url.searchParams.get('date'),
    limit: url.searchParams.get('limit'),
    skip: url.searchParams.get('skip')
  };

  try {
    const meals = await MealService.getMeals(req.user.userId, query);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(meals));
  } catch (error) {
    reportError(error, { req });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch meals', details: error.message }));
  }
}

async function getMealById(req, res) {
  const mealId = req.url.split('/')[2]; // Extract ID from /meals/:id

  try {
    const meal = await MealService.getMealById(req.user.userId, mealId);
    if (!meal) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Meal not found' }));
      return;
    }
    
    // Format response according to new format
    const formattedResponse = mealFormatter.formatMealResponse(meal);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(formattedResponse));
  } catch (error) {
    reportError(error, { req });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch meal', details: error.message }));
  }
}

// Update meal endpoint
async function updateMeal(req, res) {
  parseBody(req, async (err, data) => {
    console.log('data' + JSON.stringify(data));
    if (err || !data.mealId || !data.itemId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mealId and itemId are required' }));
      return;
    }

    try {
      const { mealId, itemId, newQuantity, newMeasureQuantity, newItem } = data;
      const userId = req.user.userId;
      console.log('newQuantity: ' + newQuantity);
      console.log('newMeasureQuantity: ' + newMeasureQuantity);
      console.log('newItem: ' + newItem);
      console.log('mealId: ' + mealId);
      console.log('itemId: ' + itemId);
      
      // Get the meal and verify ownership
      const meal = await Meal.findOne({ _id: mealId, userId });
      if (!meal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Meal not found' }));
        return;
      }

      // Capture meal state BEFORE any changes for audit
      const mealSnapshotBefore = createMealSnapshot(meal);

      // Find the item to update
      const itemIndex = meal.items.findIndex(item => item.id === itemId);
      if (itemIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Item not found in meal' }));
        return;
      }

      const item = meal.items[itemIndex];
      console.log('newItem: ' + newItem);
      
      // Track changes for audit
      const changes = [];
      let editType = null;
      let llmInput = null;
      let llmOutput = null;
      
      // Check if nutrition fields are being updated directly
      const nutritionUpdate = data.nutrition || {};
      const hasNutritionUpdate = nutritionUpdate.calories !== undefined || 
                                 nutritionUpdate.protein !== undefined || 
                                 nutritionUpdate.carbs !== undefined || 
                                 nutritionUpdate.fat !== undefined;

      // Case 1a: DisplayQuantity update (newQuantity is non-null, newItem is null)
      if (newQuantity !== null && newQuantity !== undefined && !newItem && !(newMeasureQuantity !== null && newMeasureQuantity !== undefined)) {
        editType = 'QUANTITY_UPDATE';

        // Track quantity change
        changes.push({
          itemId: itemId,
          field: 'displayQuantity',
          previousValue: item.displayQuantity.final?.value || item.displayQuantity.llm?.value,
          newValue: newQuantity
        });

        // Determine old quantity: use final if it exists (subsequent update), otherwise use llm (first update)
        const oldQuantity = (item.displayQuantity.final?.value !== null && item.displayQuantity.final?.value !== undefined)
          ? item.displayQuantity.final.value
          : item.displayQuantity.llm.value;
        const ratio = newQuantity / oldQuantity;

        // Update final displayQuantity
        item.displayQuantity.final = {
          value: newQuantity,
          unit: item.displayQuantity.llm.unit
        };

        // Also update measureQuantity proportionally
        const oldMeasure = (item.measureQuantity?.final?.value !== null && item.measureQuantity?.final?.value !== undefined)
          ? item.measureQuantity.final.value
          : item.measureQuantity?.llm?.value;
        if (oldMeasure) {
          item.measureQuantity.final = {
            value: parseFloat((oldMeasure * ratio).toFixed(1)),
            unit: item.measureQuantity?.final?.unit || item.measureQuantity?.llm?.unit || 'g'
          };
        }

        // Update final nutrition proportionally (only if not being updated directly)
        if (!hasNutritionUpdate) {
          const baseCalories = (item.nutrition.calories.final !== null && item.nutrition.calories.final !== undefined)
            ? item.nutrition.calories.final
            : item.nutrition.calories.llm;
          const baseProtein = (item.nutrition.protein.final !== null && item.nutrition.protein.final !== undefined)
            ? item.nutrition.protein.final
            : item.nutrition.protein.llm;
          const baseCarbs = (item.nutrition.carbs.final !== null && item.nutrition.carbs.final !== undefined)
            ? item.nutrition.carbs.final
            : item.nutrition.carbs.llm;
          const baseFat = (item.nutrition.fat.final !== null && item.nutrition.fat.final !== undefined)
            ? item.nutrition.fat.final
            : item.nutrition.fat.llm;

          const newCalories = parseFloat((baseCalories * ratio).toFixed(2));
          const newProtein = parseFloat((baseProtein * ratio).toFixed(2));
          const newCarbs = parseFloat((baseCarbs * ratio).toFixed(2));
          const newFat = parseFloat((baseFat * ratio).toFixed(2));

          changes.push(
            { itemId, field: 'calories', previousValue: baseCalories, newValue: newCalories },
            { itemId, field: 'protein', previousValue: baseProtein, newValue: newProtein },
            { itemId, field: 'carbs', previousValue: baseCarbs, newValue: newCarbs },
            { itemId, field: 'fat', previousValue: baseFat, newValue: newFat }
          );

          item.nutrition.calories.final = newCalories;
          item.nutrition.protein.final = newProtein;
          item.nutrition.carbs.final = newCarbs;
          item.nutrition.fat.final = newFat;
        }
      }

      // Case 1b: MeasureQuantity update (newMeasureQuantity is non-null, newItem is null)
      if (newMeasureQuantity !== null && newMeasureQuantity !== undefined && !newItem) {
        editType = 'MEASURE_QUANTITY_UPDATE';

        const oldMeasure = (item.measureQuantity?.final?.value !== null && item.measureQuantity?.final?.value !== undefined)
          ? item.measureQuantity.final.value
          : item.measureQuantity?.llm?.value;

        if (oldMeasure) {
          const ratio = newMeasureQuantity / oldMeasure;

          changes.push({
            itemId: itemId,
            field: 'measureQuantity',
            previousValue: oldMeasure,
            newValue: newMeasureQuantity
          });

          // Update measureQuantity
          item.measureQuantity.final = {
            value: newMeasureQuantity,
            unit: item.measureQuantity?.final?.unit || item.measureQuantity?.llm?.unit || 'g'
          };

          // Also update displayQuantity proportionally
          const oldDisplay = (item.displayQuantity.final?.value !== null && item.displayQuantity.final?.value !== undefined)
            ? item.displayQuantity.final.value
            : item.displayQuantity.llm.value;
          item.displayQuantity.final = {
            value: parseFloat((oldDisplay * ratio).toFixed(2)),
            unit: item.displayQuantity.llm.unit
          };

          // Update nutrition proportionally
          if (!hasNutritionUpdate) {
            const baseCalories = (item.nutrition.calories.final !== null && item.nutrition.calories.final !== undefined)
              ? item.nutrition.calories.final
              : item.nutrition.calories.llm;
            const baseProtein = (item.nutrition.protein.final !== null && item.nutrition.protein.final !== undefined)
              ? item.nutrition.protein.final
              : item.nutrition.protein.llm;
            const baseCarbs = (item.nutrition.carbs.final !== null && item.nutrition.carbs.final !== undefined)
              ? item.nutrition.carbs.final
              : item.nutrition.carbs.llm;
            const baseFat = (item.nutrition.fat.final !== null && item.nutrition.fat.final !== undefined)
              ? item.nutrition.fat.final
              : item.nutrition.fat.llm;

            const newCalories = parseFloat((baseCalories * ratio).toFixed(2));
            const newProtein = parseFloat((baseProtein * ratio).toFixed(2));
            const newCarbs = parseFloat((baseCarbs * ratio).toFixed(2));
            const newFat = parseFloat((baseFat * ratio).toFixed(2));

            changes.push(
              { itemId, field: 'calories', previousValue: baseCalories, newValue: newCalories },
              { itemId, field: 'protein', previousValue: baseProtein, newValue: newProtein },
              { itemId, field: 'carbs', previousValue: baseCarbs, newValue: newCarbs },
              { itemId, field: 'fat', previousValue: baseFat, newValue: newFat }
            );

            item.nutrition.calories.final = newCalories;
            item.nutrition.protein.final = newProtein;
            item.nutrition.carbs.final = newCarbs;
            item.nutrition.fat.final = newFat;
          }
        }
      }

      // Case 1.5: Direct nutrition fields update
      if (hasNutritionUpdate) {
        editType = 'NUTRITION_UPDATE';
        
        // Update final nutrition values directly
        if (nutritionUpdate.calories !== undefined) {
          changes.push({ itemId, field: 'calories', previousValue: item.nutrition.calories.final, newValue: nutritionUpdate.calories });
          item.nutrition.calories.final = parseFloat(parseFloat(nutritionUpdate.calories || 0).toFixed(2));
        }
        if (nutritionUpdate.protein !== undefined) {
          changes.push({ itemId, field: 'protein', previousValue: item.nutrition.protein.final, newValue: nutritionUpdate.protein });
          item.nutrition.protein.final = parseFloat(parseFloat(nutritionUpdate.protein || 0).toFixed(2));
        }
        if (nutritionUpdate.carbs !== undefined) {
          changes.push({ itemId, field: 'carbs', previousValue: item.nutrition.carbs.final, newValue: nutritionUpdate.carbs });
          item.nutrition.carbs.final = parseFloat(parseFloat(nutritionUpdate.carbs || 0).toFixed(2));
        }
        if (nutritionUpdate.fat !== undefined) {
          changes.push({ itemId, field: 'fat', previousValue: item.nutrition.fat.final, newValue: nutritionUpdate.fat });
          item.nutrition.fat.final = parseFloat(parseFloat(nutritionUpdate.fat || 0).toFixed(2));
        }
      }

      // If quantity or nutrition was updated, recompute total nutrition
      const hasQuantityUpdate = (newQuantity !== null && newQuantity !== undefined && !newItem) ||
                                (newMeasureQuantity !== null && newMeasureQuantity !== undefined && !newItem);
      if (hasQuantityUpdate || hasNutritionUpdate) {
        // Recompute total nutrition using final values
        const updatedMeal = await recomputeTotalNutrition(meal);
        await updatedMeal.save();

        // Capture meal state AFTER changes for audit
        const mealSnapshotAfter = createMealSnapshot(updatedMeal);

        // Create audit entry (non-blocking)
        MealEditAudit.create({
          mealId: mealId,
          userId: userId,
          editType: editType,
          changes: changes,
          mealSnapshot: {
            before: mealSnapshotBefore,
            after: mealSnapshotAfter
          },
          llmInput: null, // No LLM call for quantity/nutrition updates
          llmOutput: null,
          status: 'success'
        }).catch(err => console.error('Failed to create audit entry:', err));

        // Format response according to new format
        const formattedResponse = mealFormatter.formatMealResponse(updatedMeal);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(formattedResponse));
        return;
      }

      // Case 2: Item name update (newItem is non-null)
      if (newItem !== null) {
        editType = 'ITEM_NAME_UPDATE';
        
        // Track name change
        changes.push({
          itemId: itemId,
          field: 'name',
          previousValue: item.name.final || item.name.llm,
          newValue: newItem
        });
        
        // Get AI nutrition for the new item and updated meal name
        const originalUnit = item.displayQuantity.llm.unit;
        const aiResult = await getNutritionForItem(newItem, meal.name, item.name.llm, originalUnit);
        
        // Store LLM input/output for audit
        if (aiResult.auditData) {
          llmInput = {
            requestPayload: { newItem, currentMealName: meal.name, previousItemName: item.name.llm, originalUnit },
            promptSent: aiResult.auditData.promptSent,
            provider: aiResult.auditData.provider,
            model: aiResult.auditData.model
          };
          llmOutput = {
            rawResponse: aiResult.auditData.rawResponse,
            parsedResponse: aiResult.auditData.parsedResponse,
            tokensUsed: aiResult.auditData.tokensUsed,
            latencyMs: aiResult.auditData.latencyMs
          };
        }
        
        // Determine the quantity value to use
        const quantityValue = newQuantity !== null && newQuantity !== undefined 
          ? newQuantity 
          : aiResult.quantity.value;
        const quantityUnit = aiResult.quantity.unit;
        
        // Update item name - use user-provided name, not AI suggestion
        item.name.final = newItem;

        
        // Update final displayQuantity if newQuantity is provided
        if (newQuantity !== null && newQuantity !== undefined) {
          changes.push({ itemId, field: 'displayQuantity', previousValue: item.displayQuantity.final?.value, newValue: newQuantity });
          item.displayQuantity.final = {
            value: newQuantity,
            unit: quantityUnit
          };
        }

        // Track nutrition changes from AI
        changes.push(
          { itemId, field: 'calories', previousValue: item.nutrition.calories.llm, newValue: aiResult.nutrition.calories },
          { itemId, field: 'protein', previousValue: item.nutrition.protein.llm, newValue: aiResult.nutrition.protein },
          { itemId, field: 'carbs', previousValue: item.nutrition.carbs.llm, newValue: aiResult.nutrition.carbs },
          { itemId, field: 'fat', previousValue: item.nutrition.fat.llm, newValue: aiResult.nutrition.fat }
        );

        // Update new item nutrition
        item.nutrition.calories.llm = aiResult.nutrition.calories;
        item.nutrition.protein.llm = aiResult.nutrition.protein;
        item.nutrition.carbs.llm = aiResult.nutrition.carbs;
        item.nutrition.fat.llm = aiResult.nutrition.fat;
        // Set final values as null because this is a new item
        item.nutrition.calories.final = null;
        item.nutrition.protein.final = null;
        item.nutrition.carbs.final = null;
        item.nutrition.fat.final = null;

        // Update overall meal name if provided by AI.
        // Sanitize via the shared helper so generic titles ("Indian meal",
        // "Lunch plate") produced by the edit LLM don't leak through.
        if (aiResult.updatedMealName && aiResult.updatedMealName !== meal.name) {
          const cleanName = AiService.sanitizeMealTitle(aiResult.updatedMealName, meal.items.map(i => ({
            name: (i.name && (i.name.final || i.name.llm)) || null
          })));
          if (cleanName !== meal.name) {
            changes.push({ itemId, field: 'mealName', previousValue: meal.name, newValue: cleanName });
            meal.name = cleanName;
          }
        }

        // Recompute total nutrition
        const updatedMeal = await recomputeTotalNutrition(meal);
        await updatedMeal.save();

        // Capture meal state AFTER changes for audit
        const mealSnapshotAfter = createMealSnapshot(updatedMeal);

        // Create audit entry (non-blocking)
        MealEditAudit.create({
          mealId: mealId,
          userId: userId,
          editType: editType,
          llmInput: llmInput,
          llmOutput: llmOutput,
          changes: changes,
          mealSnapshot: {
            before: mealSnapshotBefore,
            after: mealSnapshotAfter
          },
          status: aiResult.error ? 'failed' : 'success',
          errorMessage: aiResult.error || null
        }).catch(err => console.error('Failed to create audit entry:', err));

        // Format response according to new format
        const formattedResponse = mealFormatter.formatMealResponse(updatedMeal);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(formattedResponse));
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Either newQuantity, newItem, or nutrition fields must be provided' }));

    } catch (error) {
      reportError(error, { req });
      console.error('Error updating meal:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to update meal', details: error.message }));
    }
  });
}

async function deleteMeal(req, res) {
  const mealId = req.url.split('/')[2]; // Extract ID from /meals/:id

  try {
    const result = await MealService.deleteMeal(req.user.userId, mealId);
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Meal not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Meal deleted successfully' }));
  } catch (error) {
    reportError(error, { req });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to delete meal', details: error.message }));
  }
}

async function getDailySummary(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  if (!start || !end) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'start and end dates are required' }));
    return;
  }

  try {
    const summary = await MealService.getDailySummary(req.user.userId, start, end);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  } catch (error) {
    reportError(error, { req });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch daily summary', details: error.message }));
  }
}

async function getCalendarData(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const date = url.searchParams.get('date');

  if (!date) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'date parameter is required (YYYY-MM-DD format)' }));
    return;
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'date must be in YYYY-MM-DD format' }));
    return;
  }

  try {
    const calendarData = await MealService.getCalendarData(req.user.userId, date);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(calendarData));
  } catch (error) {
    reportError(error, { req });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch calendar data', details: error.message }));
  }
}

// Helper function to recompute total nutrition
async function recomputeTotalNutrition(meal) {
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  meal.items.forEach(item => {
    // Use final values if available (not null/undefined), otherwise fallback to llm values
    // Final values take priority and should be used in total nutrition calculation
    const calories = (item.nutrition.calories.final !== null && item.nutrition.calories.final !== undefined) 
      ? item.nutrition.calories.final 
      : item.nutrition.calories.llm;
    const protein = (item.nutrition.protein.final !== null && item.nutrition.protein.final !== undefined) 
      ? item.nutrition.protein.final 
      : item.nutrition.protein.llm;
    const carbs = (item.nutrition.carbs.final !== null && item.nutrition.carbs.final !== undefined) 
      ? item.nutrition.carbs.final 
      : item.nutrition.carbs.llm;
    const fat = (item.nutrition.fat.final !== null && item.nutrition.fat.final !== undefined) 
      ? item.nutrition.fat.final 
      : item.nutrition.fat.llm;

    totalCalories += parseFloat(calories || 0);
    totalProtein += parseFloat(protein || 0);
    totalCarbs += parseFloat(carbs || 0);
    totalFat += parseFloat(fat || 0);
  });

  // Update total nutrition with 2 decimal precision
  meal.totalNutrition.calories.final = parseFloat(totalCalories.toFixed(2));
  meal.totalNutrition.protein.final = parseFloat(totalProtein.toFixed(2));
  meal.totalNutrition.carbs.final = parseFloat(totalCarbs.toFixed(2));
  meal.totalNutrition.fat.final = parseFloat(totalFat.toFixed(2));

  return meal;
}

// Helper function to get nutrition for a new item via AI
// Returns both the parsed result and audit data
async function getNutritionForItem(newItemName, currentMealName, previousItemName, originalUnit) {
  const AiService = require('../services/aiService');

  try {
    // Use AI service (defaults to Gemini) - now returns { response, auditData }
    const result = await AiService.analyzeFoodItem(newItemName, currentMealName, previousItemName, originalUnit);
    const parsedResult = JSON.parse(result.response);
    console.log('parsedResult', JSON.stringify(parsedResult));
    
    return {
      name: parsedResult.name,
      quantity: parsedResult.quantity,
      nutrition: parsedResult.nutrition,
      updatedMealName: parsedResult.updatedMealName,
      // Include audit data for tracking
      auditData: {
        ...result.auditData,
        parsedResponse: parsedResult
      }
    };
  } catch (error) {
    reportError(error, { extra: { context: 'getNutritionForItem', itemName: newItemName } });
    console.error('Error getting AI nutrition:', error);
    // Return default values if AI fails
    return {
      name: newItemName,
      quantity: { value: 1, unit: 'serving' },
      nutrition: { calories: 100, protein: 5, carbs: 15, fat: 3 },
      updatedMealName: currentMealName, // Keep original name if AI fails
      auditData: null,
      error: error.message
    };
  }
}

function bulkEditItems(req, res) {
  const bulkEditStartTime = Date.now();
  console.log('📝 [BULK_EDIT] Starting bulk edit request');
  
  parseBody(req, async (err, data) => {
    if (err) {
      console.error('❌ [BULK_EDIT] Failed to parse request body:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    try {
      const { mealId, items } = data;
      const userId = req.user.userId;

      console.log('📝 [BULK_EDIT] Request data:', {
        mealId,
        userId,
        itemsCount: items?.length || 0,
        items: items?.map(item => ({
          itemId: item.itemId,
          hasNewItem: !!item.newItem,
          hasNewQuantity: item.newQuantity !== null && item.newQuantity !== undefined
        }))
      });

      console.log('📝 [BULK_EDIT] Request data object:' + JSON.stringify(data));

      if (!mealId || !items || !Array.isArray(items) || items.length === 0) {
        console.error('❌ [BULK_EDIT] Validation failed: missing mealId or items array');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mealId and items array are required' }));
        return;
      }

      // Fetch the meal
      console.log('📝 [BULK_EDIT] Fetching meal:', { mealId, userId });
      const meal = await Meal.findOne({ _id: mealId, userId, deletedAt: null });
      if (!meal) {
        console.error('❌ [BULK_EDIT] Meal not found:', { mealId, userId });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Meal not found' }));
        return;
      }

      console.log('✅ [BULK_EDIT] Meal found:', {
        mealId: meal._id,
        mealName: meal.name,
        currentItemsCount: meal.items?.length || 0,
        currentItems: meal.items?.map(item => ({
          id: item.id,
          name: item.name?.llm || item.name?.final,
          displayQuantity: item.displayQuantity?.llm?.value || item.displayQuantity?.final?.value
        }))
      });

      // Capture meal state BEFORE any changes for audit
      const mealSnapshotBefore = createMealSnapshot(meal);
      console.log('📝 [BULK_EDIT] Captured meal snapshot before changes');

      // TODO: Frontend workaround - Remove this flag when frontend correctly omits newItem for quantity-only updates
      // When true: If newItem equals old item name, treat as quantity-only update (skip LLM call)
      // When false: Normal behavior - newItem always triggers LLM call
      const TREAT_SAME_ITEM_AS_QUANTITY_ONLY = true;

      // Track changes for audit
      const changes = [];
      let llmInput = null;
      let llmOutput = null;

      // Prepare items for batch AI call
      const batchItems = [];
      const itemUpdates = new Map(); // Map itemId to update data
      let hasMainItemChange = false;
      let mainItemInfo = null;

      console.log('📝 [BULK_EDIT] Processing item updates, count:', items.length);

      // Process each item update request
      for (const itemUpdate of items) {
        const { itemId, newQuantity, newMeasureQuantity, newItem } = itemUpdate;

        if (!itemId) {
          console.error('❌ [BULK_EDIT] Missing itemId in update request:', itemUpdate);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Each item must have an itemId' }));
          return;
        }

        // Find the item in the meal
        const itemIndex = meal.items.findIndex(item => item.id === itemId);
        if (itemIndex === -1) {
          console.error('❌ [BULK_EDIT] Item not found in meal:', { itemId, mealId });
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Item with id ${itemId} not found in meal` }));
          return;
        }

        const item = meal.items[itemIndex];
        const currentItemName = item.name?.llm || item.name?.final || '';
        
        // Frontend workaround: Check if newItem is same as current item name
        let shouldTreatAsQuantityOnly = false;
        if (TREAT_SAME_ITEM_AS_QUANTITY_ONLY && newItem) {
          const normalizedNewItem = newItem.trim().toLowerCase();
          const normalizedCurrentName = currentItemName.trim().toLowerCase();
          shouldTreatAsQuantityOnly = normalizedNewItem === normalizedCurrentName;
          
          if (shouldTreatAsQuantityOnly) {
            console.log('⚠️ [BULK_EDIT] Frontend workaround: newItem matches current name, treating as quantity-only update:', {
              itemId,
              currentName: currentItemName,
              newItem,
              reason: 'Frontend sending same item name for quantity-only updates'
            });
          }
        }

        // Store the update data (keep newItem in map for consistency, but we'll skip AI call if it's same)
        itemUpdates.set(itemId, {
          itemIndex,
          newQuantity,
          newMeasureQuantity,
          newItem: shouldTreatAsQuantityOnly ? undefined : newItem, // Clear newItem if treating as quantity-only
          originalItem: item
        });

        console.log('📝 [BULK_EDIT] Processing item update:', {
          itemId,
          currentName: currentItemName,
          currentDisplayQuantity: item.displayQuantity?.llm?.value || item.displayQuantity?.final?.value,
          newItem,
          newQuantity,
          treatingAsQuantityOnly: shouldTreatAsQuantityOnly
        });

        // Only add to batch if newItem is provided AND it's actually different (name change)
        if (newItem && !shouldTreatAsQuantityOnly) {
          const isMainItem = isMainFoodItem(item.name.llm);
          
          batchItems.push({
            originalName: item.name.llm,
            newName: newItem,
            newQuantity: newQuantity !== null && newQuantity !== undefined ? newQuantity : item.displayQuantity.llm.value,
            unit: item.displayQuantity.llm.unit,
            isMainItem
          });

          console.log('📝 [BULK_EDIT] Added to batch AI call:', {
            originalName: item.name.llm,
            newName: newItem,
            isMainItem
          });

          if (isMainItem) {
            hasMainItemChange = true;
            mainItemInfo = {
              originalName: item.name.llm,
              newName: newItem
            };
            console.log('📝 [BULK_EDIT] Main item change detected:', mainItemInfo);
          }
        } else if (shouldTreatAsQuantityOnly) {
          console.log('📝 [BULK_EDIT] Skipping AI call - same item name detected (quantity-only update)');
        }
      }

      console.log('📝 [BULK_EDIT] Batch processing summary:', {
        totalItemsToUpdate: itemUpdates.size,
        itemsRequiringAI: batchItems.length,
        hasMainItemChange,
        batchItems: batchItems.map(bi => ({
          originalName: bi.originalName,
          newName: bi.newName,
          isMainItem: bi.isMainItem
        }))
      });

      // Make single AI call if there are any item name changes
      let aiResult = null;
      if (batchItems.length > 0) {
        console.log('🤖 [BULK_EDIT] Calling AI service for batch update:', {
          itemsCount: batchItems.length,
          currentMealName: meal.name,
          shouldUpdateMealName: hasMainItemChange,
          mainItemInfo
        });
        
        const aiCallStartTime = Date.now();
        aiResult = await AiService.batchUpdateFoodItems(
          batchItems,
          meal.name,
          hasMainItemChange,
          mainItemInfo
        );
        const aiCallDuration = Date.now() - aiCallStartTime;

        console.log('✅ [BULK_EDIT] AI service response received:', {
          durationMs: aiCallDuration,
          itemsReturned: aiResult?.items?.length || 0,
          mealNameChanged: aiResult?.mealNameChanged || false,
          newMealName: aiResult?.mealName,
          hasAuditData: !!aiResult?.auditData,
          tokensUsed: aiResult?.auditData?.tokensUsed,
          latencyMs: aiResult?.auditData?.latencyMs
        });

        // Store LLM input/output for audit
        if (aiResult.auditData) {
          llmInput = {
            requestPayload: { 
              items: batchItems, 
              currentMealName: meal.name, 
              shouldUpdateMealName: hasMainItemChange,
              mainItemInfo: mainItemInfo
            },
            promptSent: aiResult.auditData.promptSent,
            provider: aiResult.auditData.provider,
            model: aiResult.auditData.model
          };
          llmOutput = {
            rawResponse: aiResult.auditData.rawResponse,
            parsedResponse: aiResult.auditData.parsedResponse,
            tokensUsed: aiResult.auditData.tokensUsed,
            latencyMs: aiResult.auditData.latencyMs
          };
        }
      } else {
        console.log('📝 [BULK_EDIT] Skipping AI call - no item name changes, only quantity updates');
      }

      // Apply updates to each item and track changes
      console.log('📝 [BULK_EDIT] Applying updates to items, total:', itemUpdates.size);
      let aiItemIndex = 0;
      for (const [itemId, updateData] of itemUpdates) {
        const { itemIndex, newQuantity, newMeasureQuantity, newItem, originalItem } = updateData;
        const item = meal.items[itemIndex];

        if (newItem && aiResult) {
          // Case: Item name changed - use AI result
          const aiItem = aiResult.items[aiItemIndex];
          console.log('📝 [BULK_EDIT] Applying AI result to item:', {
            itemId,
            aiItemIndex,
            originalName: item.name.llm,
            newName: aiItem.name,
            aiNutrition: aiItem.nutrition
          });
          aiItemIndex++;

          // Track name change - use user-provided name
          changes.push({
            itemId: itemId,
            field: 'name',
            previousValue: item.name.final || item.name.llm,
            newValue: newItem
          });

          // Determine the quantity value to use
          const quantityValue = newQuantity !== null && newQuantity !== undefined 
            ? newQuantity 
            : aiItem.quantity.value;

          const quantityUnit = newQuantity !== null && newQuantity !== undefined
            ? item.displayQuantity.llm.unit
            : aiItem.quantity.unit;

          // Track quantity change if provided
          if (newQuantity !== null && newQuantity !== undefined) {
            changes.push({
              itemId: itemId,
              field: 'displayQuantity',
              previousValue: item.displayQuantity.final?.value || item.displayQuantity.llm?.value,
              newValue: newQuantity
            });
          }

          // Update item name - use user-provided name, not AI suggestion
          item.name.final = newItem;
          item.displayQuantity.final = {
            value: quantityValue,
            unit: quantityUnit
          };

          // Track nutrition changes from AI
          changes.push(
            { itemId, field: 'calories', previousValue: item.nutrition.calories.final || item.nutrition.calories.llm, newValue: aiItem.nutrition.calories },
            { itemId, field: 'protein', previousValue: item.nutrition.protein.final || item.nutrition.protein.llm, newValue: aiItem.nutrition.protein },
            { itemId, field: 'carbs', previousValue: item.nutrition.carbs.final || item.nutrition.carbs.llm, newValue: aiItem.nutrition.carbs },
            { itemId, field: 'fat', previousValue: item.nutrition.fat.final || item.nutrition.fat.llm, newValue: aiItem.nutrition.fat }
          );

          // Update nutrition from AI
          item.nutrition.calories.final = aiItem.nutrition.calories;
          item.nutrition.protein.final = aiItem.nutrition.protein;
          item.nutrition.carbs.final = aiItem.nutrition.carbs;
          item.nutrition.fat.final = aiItem.nutrition.fat;

        } else if (!newItem && (newQuantity !== null && newQuantity !== undefined) && !(newMeasureQuantity !== null && newMeasureQuantity !== undefined)) {
          // Case: Only displayQuantity changed - calculate proportionally
          const oldQuantity = (item.displayQuantity.final?.value !== null && item.displayQuantity.final?.value !== undefined)
            ? item.displayQuantity.final.value
            : item.displayQuantity.llm.value;
          const ratio = newQuantity / oldQuantity;

          console.log('📝 [BULK_EDIT] Applying displayQuantity-only update:', { itemId, oldQuantity, newQuantity, ratio });

          changes.push({ itemId, field: 'displayQuantity', previousValue: oldQuantity, newValue: newQuantity });

          item.displayQuantity.final = { value: newQuantity, unit: item.displayQuantity.llm.unit };

          // Also update measureQuantity proportionally
          const oldMeasure = (item.measureQuantity?.final?.value !== null && item.measureQuantity?.final?.value !== undefined)
            ? item.measureQuantity.final.value : item.measureQuantity?.llm?.value;
          if (oldMeasure) {
            item.measureQuantity.final = {
              value: parseFloat((oldMeasure * ratio).toFixed(1)),
              unit: item.measureQuantity?.final?.unit || item.measureQuantity?.llm?.unit || 'g'
            };
          }

          // Scale nutrition proportionally
          const baseCalories = (item.nutrition.calories.final !== null && item.nutrition.calories.final !== undefined) ? item.nutrition.calories.final : item.nutrition.calories.llm;
          const baseProtein = (item.nutrition.protein.final !== null && item.nutrition.protein.final !== undefined) ? item.nutrition.protein.final : item.nutrition.protein.llm;
          const baseCarbs = (item.nutrition.carbs.final !== null && item.nutrition.carbs.final !== undefined) ? item.nutrition.carbs.final : item.nutrition.carbs.llm;
          const baseFat = (item.nutrition.fat.final !== null && item.nutrition.fat.final !== undefined) ? item.nutrition.fat.final : item.nutrition.fat.llm;

          const newCalories = parseFloat((baseCalories * ratio).toFixed(2));
          const newProtein = parseFloat((baseProtein * ratio).toFixed(2));
          const newCarbs = parseFloat((baseCarbs * ratio).toFixed(2));
          const newFat = parseFloat((baseFat * ratio).toFixed(2));

          changes.push(
            { itemId, field: 'calories', previousValue: baseCalories, newValue: newCalories },
            { itemId, field: 'protein', previousValue: baseProtein, newValue: newProtein },
            { itemId, field: 'carbs', previousValue: baseCarbs, newValue: newCarbs },
            { itemId, field: 'fat', previousValue: baseFat, newValue: newFat }
          );

          item.nutrition.calories.final = newCalories;
          item.nutrition.protein.final = newProtein;
          item.nutrition.carbs.final = newCarbs;
          item.nutrition.fat.final = newFat;

        } else if (!newItem && newMeasureQuantity !== null && newMeasureQuantity !== undefined) {
          // Case: MeasureQuantity changed - calculate proportionally
          const oldMeasure = (item.measureQuantity?.final?.value !== null && item.measureQuantity?.final?.value !== undefined)
            ? item.measureQuantity.final.value : item.measureQuantity?.llm?.value;

          if (oldMeasure) {
            const ratio = newMeasureQuantity / oldMeasure;

            console.log('📝 [BULK_EDIT] Applying measureQuantity update:', { itemId, oldMeasure, newMeasureQuantity, ratio });

            changes.push({ itemId, field: 'measureQuantity', previousValue: oldMeasure, newValue: newMeasureQuantity });

            item.measureQuantity.final = {
              value: newMeasureQuantity,
              unit: item.measureQuantity?.final?.unit || item.measureQuantity?.llm?.unit || 'g'
            };

            // Also update displayQuantity proportionally
            const oldDisplay = (item.displayQuantity.final?.value !== null && item.displayQuantity.final?.value !== undefined)
              ? item.displayQuantity.final.value : item.displayQuantity.llm.value;
            item.displayQuantity.final = {
              value: parseFloat((oldDisplay * ratio).toFixed(2)),
              unit: item.displayQuantity.llm.unit
            };

            // Scale nutrition proportionally
            const baseCalories = (item.nutrition.calories.final !== null && item.nutrition.calories.final !== undefined) ? item.nutrition.calories.final : item.nutrition.calories.llm;
            const baseProtein = (item.nutrition.protein.final !== null && item.nutrition.protein.final !== undefined) ? item.nutrition.protein.final : item.nutrition.protein.llm;
            const baseCarbs = (item.nutrition.carbs.final !== null && item.nutrition.carbs.final !== undefined) ? item.nutrition.carbs.final : item.nutrition.carbs.llm;
            const baseFat = (item.nutrition.fat.final !== null && item.nutrition.fat.final !== undefined) ? item.nutrition.fat.final : item.nutrition.fat.llm;

            const newCalories = parseFloat((baseCalories * ratio).toFixed(2));
            const newProtein = parseFloat((baseProtein * ratio).toFixed(2));
            const newCarbs = parseFloat((baseCarbs * ratio).toFixed(2));
            const newFat = parseFloat((baseFat * ratio).toFixed(2));

            changes.push(
              { itemId, field: 'calories', previousValue: baseCalories, newValue: newCalories },
              { itemId, field: 'protein', previousValue: baseProtein, newValue: newProtein },
              { itemId, field: 'carbs', previousValue: baseCarbs, newValue: newCarbs },
              { itemId, field: 'fat', previousValue: baseFat, newValue: newFat }
            );

            item.nutrition.calories.final = newCalories;
            item.nutrition.protein.final = newProtein;
            item.nutrition.carbs.final = newCarbs;
            item.nutrition.fat.final = newFat;
          }
        }
      }

      // Update meal name if AI changed it
      if (aiResult && aiResult.mealNameChanged && aiResult.mealName !== meal.name) {
        console.log('📝 [BULK_EDIT] Updating meal name:', {
          previousName: meal.name,
          newName: aiResult.mealName
        });
        changes.push({
          // itemId omitted for meal-level changes
          field: 'mealName',
          previousValue: meal.name,
          newValue: aiResult.mealName
        });
        meal.name = aiResult.mealName;
      }

      // Recompute total nutrition
      console.log('📝 [BULK_EDIT] Recomputing total nutrition');
      const recomputeStartTime = Date.now();
      const updatedMeal = await recomputeTotalNutrition(meal);
      await updatedMeal.save();
      const recomputeDuration = Date.now() - recomputeStartTime;
      console.log('✅ [BULK_EDIT] Total nutrition recomputed and saved:', {
        durationMs: recomputeDuration,
        totalCalories: updatedMeal.totalNutrition?.calories,
        totalProtein: updatedMeal.totalNutrition?.protein
      });

      // Capture meal state AFTER changes for audit
      const mealSnapshotAfter = createMealSnapshot(updatedMeal);
      console.log('📝 [BULK_EDIT] Captured meal snapshot after changes');

      // Create audit entry (non-blocking)
      console.log('📝 [BULK_EDIT] Creating audit entry:', {
        changesCount: changes.length,
        hasLlmInput: !!llmInput,
        hasLlmOutput: !!llmOutput
      });
      MealEditAudit.create({
        mealId: mealId,
        userId: userId,
        editType: 'BULK_UPDATE',
        changes: changes,
        mealSnapshot: {
          before: mealSnapshotBefore,
          after: mealSnapshotAfter
        },
        llmInput: llmInput,
        llmOutput: llmOutput,
        status: 'success'
      }).catch(err => console.error('❌ [BULK_EDIT] Failed to create audit entry:', err));

      // Format response
      const totalDuration = Date.now() - bulkEditStartTime;
      console.log('✅ [BULK_EDIT] Bulk edit completed successfully:', {
        totalDurationMs: totalDuration,
        itemsUpdated: itemUpdates.size,
        changesCount: changes.length,
        mealId,
        userId
      });
      
      const formattedResponse = mealFormatter.formatMealResponse(updatedMeal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(formattedResponse));

    } catch (error) {
      reportError(error, { req });
      const totalDuration = Date.now() - bulkEditStartTime;
      console.error('❌ [BULK_EDIT] Error in bulkEditItems:', {
        error: error.message,
        stack: error.stack,
        durationMs: totalDuration,
        mealId: data?.mealId,
        userId: req.user?.userId
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to bulk edit items', details: error.message }));
    }
  });
}

// Helper function to determine if an item is a main food item
function isMainFoodItem(itemName) {
  const mainKeywords = [
    'chicken', 'paneer', 'fish', 'mutton', 'egg', 'tofu', 'dal', 'lentil',
    'rice', 'roti', 'naan', 'paratha', 'bread', 'pasta', 'noodles', 'biryani',
    'curry', 'sabzi', 'gravy', 'meat', 'beef', 'pork', 'lamb', 'prawn', 'shrimp'
  ];
  
  const lowerItemName = itemName.toLowerCase();
  return mainKeywords.some(keyword => lowerItemName.includes(keyword));
}

/**
 * Get audit history for a meal
 * GET /meals/:mealId/audit
 */
async function getMealAuditHistory(req, res) {
  try {
    const urlParts = req.url.split('/');
    const mealId = urlParts[2]; // Extract mealId from /meals/:mealId/audit
    const userId = req.user.userId;
    
    // Parse query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 50;
    const skip = parseInt(url.searchParams.get('skip')) || 0;
    const editType = url.searchParams.get('editType');

    // Verify the user owns the meal
    const meal = await Meal.findOne({ _id: mealId, userId });
    if (!meal) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Meal not found' }));
      return;
    }

    // Get audit history
    const auditHistory = await MealEditAudit.getAuditHistory(mealId, { limit, skip, editType });
    const totalCount = await MealEditAudit.countDocuments({ mealId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      mealId: mealId,
      mealName: meal.name,
      auditHistory: auditHistory,
      pagination: {
        limit,
        skip,
        total: totalCount,
        hasMore: skip + auditHistory.length < totalCount
      }
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error fetching meal audit history:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch audit history', details: error.message }));
  }
}

/**
 * Get a specific audit entry by ID
 * GET /meals/audit/:auditId
 */
async function getAuditEntry(req, res) {
  try {
    const urlParts = req.url.split('/');
    const auditId = urlParts[3]; // Extract auditId from /meals/audit/:auditId
    const userId = req.user.userId;

    const auditEntry = await MealEditAudit.findById(auditId).lean();
    
    if (!auditEntry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audit entry not found' }));
      return;
    }

    // Verify the user owns the meal
    if (auditEntry.userId.toString() !== userId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      auditEntry: auditEntry
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error fetching audit entry:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch audit entry', details: error.message }));
  }
}

/**
 * Get user's audit summary
 * GET /meals/audit/summary
 */
async function getUserAuditSummary(req, res) {
  try {
    const userId = req.user.userId;
    
    // Parse query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');

    if (!startDate || !endDate) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'start and end dates are required' }));
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const summary = await MealEditAudit.getUserAuditSummary(userId, start, end);

    // Get recent edits
    const recentEdits = await MealEditAudit.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('mealId editType createdAt llmOutput.latencyMs llmInput.provider')
      .lean();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      period: { start: startDate, end: endDate },
      summary: summary,
      recentEdits: recentEdits
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error fetching audit summary:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch audit summary', details: error.message }));
  }
}

/**
 * Add an item to a meal
 * POST /meals/:mealId/items
 */
async function addItemToMeal(req, res) {
  parseBody(req, async (err, data) => {
    if (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    try {
      const urlParts = req.url.split('/');
      const mealId = urlParts[2]; // Extract mealId from /meals/:mealId/items
      const userId = req.user.userId;

      // Validate required fields - only name is required
      if (!data.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name is required' }));
        return;
      }

      // Get the meal and verify ownership
      const meal = await Meal.findOne({ _id: mealId, userId, deletedAt: null });
      if (!meal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Meal not found' }));
        return;
      }

      // Capture meal state BEFORE changes for audit
      const mealSnapshotBefore = createMealSnapshot(meal);

      // Generate a unique ID for the new item
      const newItemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Track changes and LLM data for audit
      const changes = [];
      let llmInput = null;
      let llmOutput = null;
      let itemName = data.name;
      let displayQuantity = data.displayQuantity || data.quantity || { value: 1, unit: 'piece' };
      let nutrition = data.nutrition;
      let updatedMealName = meal.name;

      // If nutrition is not provided, call Gemini to get it
      if (!nutrition) {
        try {
          // Determine the unit to use for AI call
          const originalUnit = displayQuantity.unit || 'piece';

          // Call AI service to get nutrition information
          const aiResult = await getNutritionForItem(data.name, meal.name, null, originalUnit);

          // Use AI-provided nutrition and quantity if not provided
          nutrition = aiResult.nutrition;
          if (!data.displayQuantity && !data.quantity) {
            displayQuantity = aiResult.quantity;
          } else {
            // Use provided quantity but keep AI's unit if quantity unit not provided
            displayQuantity = {
              value: displayQuantity.value || aiResult.quantity.value,
              unit: displayQuantity.unit || aiResult.quantity.unit
            };
          }
          
          // Update item name if AI provided a better one
          itemName = aiResult.name || data.name;
          
          // Update meal name if AI suggests a better one
          if (aiResult.updatedMealName) {
            updatedMealName = aiResult.updatedMealName;
            changes.push({
              itemId: newItemId,
              field: 'mealName',
              previousValue: meal.name,
              newValue: updatedMealName
            });
          }

          // Store LLM input/output for audit
          if (aiResult.auditData) {
            llmInput = {
              requestPayload: {
                itemName: data.name,
                currentMealName: meal.name,
                displayQuantity: displayQuantity
              },
              promptSent: aiResult.auditData.promptSent,
              provider: aiResult.auditData.provider,
              model: aiResult.auditData.model
            };
            llmOutput = {
              rawResponse: aiResult.auditData.rawResponse,
              parsedResponse: aiResult.auditData.parsedResponse,
              tokensUsed: aiResult.auditData.tokensUsed,
              latencyMs: aiResult.auditData.latencyMs
            };
          }

          // Track nutrition changes from AI
          changes.push(
            { itemId: newItemId, field: 'calories', previousValue: null, newValue: nutrition.calories },
            { itemId: newItemId, field: 'protein', previousValue: null, newValue: nutrition.protein },
            { itemId: newItemId, field: 'carbs', previousValue: null, newValue: nutrition.carbs },
            { itemId: newItemId, field: 'fat', previousValue: null, newValue: nutrition.fat }
          );
        } catch (aiError) {
          reportError(aiError, { req, extra: { context: 'addItemToMeal_AI_nutrition', itemName: data.name } });
          console.error('Error getting AI nutrition:', aiError);
          // Fallback to default nutrition values if AI fails
          nutrition = {
            calories: 100,
            protein: 5,
            carbs: 15,
            fat: 3
          };
        }
      } else {
        // Nutrition was provided, track the change
        changes.push(
          { itemId: newItemId, field: 'calories', previousValue: null, newValue: nutrition.calories || 0 },
          { itemId: newItemId, field: 'protein', previousValue: null, newValue: nutrition.protein || 0 },
          { itemId: newItemId, field: 'carbs', previousValue: null, newValue: nutrition.carbs || 0 },
          { itemId: newItemId, field: 'fat', previousValue: null, newValue: nutrition.fat || 0 }
        );
      }

      // Track name change
      changes.push({
        itemId: newItemId,
        field: 'name',
        previousValue: null,
        newValue: itemName
      });

      // Create the new item
      const newItem = {
        id: newItemId,
        name: {
          llm: itemName,
          final: itemName
        },
        displayQuantity: {
          llm: {
            value: displayQuantity.value,
            unit: displayQuantity.unit
          },
          final: {
            value: displayQuantity.value,
            unit: displayQuantity.unit
          }
        },
        nutrition: {
          calories: {
            llm: nutrition.calories || 0,
            final: nutrition.calories || 0
          },
          protein: {
            llm: nutrition.protein || 0,
            final: nutrition.protein || 0
          },
          carbs: {
            llm: nutrition.carbs || 0,
            final: nutrition.carbs || 0
          },
          fat: {
            llm: nutrition.fat || 0,
            final: nutrition.fat || 0
          }
        },
        confidence: data.confidence || null
      };

      // Update meal name if AI suggested a change
      if (updatedMealName !== meal.name) {
        meal.name = updatedMealName;
      }

      // Add item to meal
      meal.items.push(newItem);

      // Recompute total nutrition
      const updatedMeal = await recomputeTotalNutrition(meal);
      await updatedMeal.save();

      // Capture meal state AFTER changes for audit
      const mealSnapshotAfter = createMealSnapshot(updatedMeal);

      // Create audit entry (non-blocking)
      MealEditAudit.create({
        mealId: mealId,
        userId: userId,
        editType: 'ITEM_ADD',
        changes: changes,
        mealSnapshot: {
          before: mealSnapshotBefore,
          after: mealSnapshotAfter
        },
        llmInput: llmInput,
        llmOutput: llmOutput,
        status: 'success'
      }).catch(err => console.error('Failed to create audit entry:', err));

      // Format response according to new format
      const formattedResponse = mealFormatter.formatMealResponse(updatedMeal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(formattedResponse));

    } catch (error) {
      reportError(error, { req });
      console.error('Error adding item to meal:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to add item to meal', details: error.message }));
    }
  });
}

/**
 * Delete an item from a meal
 * DELETE /meals/:mealId/items/:itemId
 */
async function deleteItemFromMeal(req, res) {
  try {
    const urlParts = req.url.split('/');
    const mealId = urlParts[2]; // Extract mealId from /meals/:mealId/items/:itemId
    const itemId = urlParts[4]; // Extract itemId from /meals/:mealId/items/:itemId
    const userId = req.user.userId;

    if (!itemId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'itemId is required' }));
      return;
    }

    // Get the meal and verify ownership
    const meal = await Meal.findOne({ _id: mealId, userId, deletedAt: null });
    if (!meal) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Meal not found' }));
      return;
    }

    // Capture meal state BEFORE changes for audit
    const mealSnapshotBefore = createMealSnapshot(meal);

    // Find the item to delete
    const itemIndex = meal.items.findIndex(item => item.id === itemId);
    if (itemIndex === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Item not found in meal' }));
      return;
    }

    const itemToDelete = meal.items[itemIndex];

    // Remove item from meal
    meal.items.splice(itemIndex, 1);

    // Recompute total nutrition
    const updatedMeal = await recomputeTotalNutrition(meal);
    await updatedMeal.save();

    // Capture meal state AFTER changes for audit
    const mealSnapshotAfter = createMealSnapshot(updatedMeal);

    // Create audit entry (non-blocking)
    MealEditAudit.create({
      mealId: mealId,
      userId: userId,
      editType: 'ITEM_DELETE',
      changes: [{
        itemId: itemId,
        field: 'name',
        previousValue: itemToDelete.name.final || itemToDelete.name.llm,
        newValue: null
      }],
      mealSnapshot: {
        before: mealSnapshotBefore,
        after: mealSnapshotAfter
      },
      llmInput: null,
      llmOutput: null,
      status: 'success'
    }).catch(err => console.error('Failed to create audit entry:', err));

    // Format response according to new format
    const formattedResponse = mealFormatter.formatMealResponse(updatedMeal);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(formattedResponse));

  } catch (error) {
    reportError(error, { req });
    console.error('Error deleting item from meal:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to delete item from meal', details: error.message }));
  }
}

// ─── Meal Suggestions & Clone ───

// Configurable defaults (can be overridden via query params)
const SUGGESTION_HOUR_WINDOW = 2;  // ±X hours around current time
const SUGGESTION_DAY_WINDOW  = 7;  // look back Y days

/**
 * GET /meals/suggestions?hourWindow=2&dayWindow=7
 *
 * Returns distinct past meals that were captured within ±hourWindow of
 * the current IST time-of-day, over the previous dayWindow days.
 * Excludes today and soft-deleted meals.
 */
async function getMealSuggestions(req, res) {
  try {
    const userId = req.user.userId;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const hourWindow = parseInt(url.searchParams.get('hourWindow')) || SUGGESTION_HOUR_WINDOW;
    const dayWindow  = parseInt(url.searchParams.get('dayWindow'))  || SUGGESTION_DAY_WINDOW;

    // Current IST hour & minute
    const now = new Date();
    const istParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(now);

    const currentHour   = parseInt(istParts.find(p => p.type === 'hour').value);
    const currentMinute = parseInt(istParts.find(p => p.type === 'minute').value);
    const currentMinuteOfDay = currentHour * 60 + currentMinute;

    // Time-of-day window in minutes
    const windowMinutes = hourWindow * 60;
    const windowStart   = currentMinuteOfDay - windowMinutes; // can be negative
    const windowEnd     = currentMinuteOfDay + windowMinutes; // can exceed 1440

    // Date boundaries: from (today - dayWindow days) to start of today (IST)
    const istYear  = parseInt(istParts.find(p => p.type === 'year').value);
    const istMonth = parseInt(istParts.find(p => p.type === 'month').value) - 1;
    const istDay   = parseInt(istParts.find(p => p.type === 'day').value);

    // Start of today IST in UTC
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const todayStartUTC = new Date(Date.UTC(istYear, istMonth, istDay) - istOffsetMs);

    // Start of the lookback window
    const lookbackStartUTC = new Date(todayStartUTC.getTime() - dayWindow * 24 * 60 * 60 * 1000);

    console.log(`📋 [SUGGESTIONS] userId=${userId}, hourWindow=±${hourWindow}h, dayWindow=${dayWindow}d`);
    console.log(`📋 [SUGGESTIONS] Current IST time: ${currentHour}:${String(currentMinute).padStart(2, '0')}`);
    console.log(`📋 [SUGGESTIONS] Time-of-day window: ${Math.floor(Math.max(0, windowStart) / 60)}:${String(Math.max(0, windowStart) % 60).padStart(2, '0')} – ${Math.floor(Math.min(1439, windowEnd) / 60)}:${String(Math.min(1439, windowEnd) % 60).padStart(2, '0')} IST`);
    console.log(`📋 [SUGGESTIONS] Date range: ${lookbackStartUTC.toISOString()} → ${todayStartUTC.toISOString()}`);

    // Fetch candidate meals from the date range (excluding today, excluding deleted)
    const candidates = await Meal.find({
      userId,
      capturedAt: { $gte: lookbackStartUTC, $lt: todayStartUTC },
      deletedAt: null
    }).sort({ capturedAt: -1 }).lean();

    console.log(`📋 [SUGGESTIONS] Found ${candidates.length} candidate meals in date range`);

    // Filter by IST time-of-day window
    const suggestions = candidates.filter(meal => {
      const mealISTParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date(meal.capturedAt));

      const mealHour   = parseInt(mealISTParts.find(p => p.type === 'hour').value);
      const mealMinute = parseInt(mealISTParts.find(p => p.type === 'minute').value);
      const mealMinuteOfDay = mealHour * 60 + mealMinute;

      // Handle wrap-around midnight (e.g., window 23:00–01:00)
      if (windowStart < 0) {
        return mealMinuteOfDay >= (windowStart + 1440) || mealMinuteOfDay <= windowEnd;
      }
      if (windowEnd >= 1440) {
        return mealMinuteOfDay >= windowStart || mealMinuteOfDay <= (windowEnd - 1440);
      }
      return mealMinuteOfDay >= windowStart && mealMinuteOfDay <= windowEnd;
    });

    console.log(`📋 [SUGGESTIONS] ${suggestions.length} meals match the time-of-day window`);

    // Format each suggestion using mealFormatter
    const formatted = suggestions.map(meal => {
      // mealFormatter expects a mongoose-like object; lean() returns plain object which works
      const response = mealFormatter.formatMealResponse(meal);
      // Add the date of the original meal for context
      response.originalDate = mealFormatter.formatTimestampInIST(meal.capturedAt);
      response.source = meal.source || 'llm';
      return response;
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      count: formatted.length,
      hourWindow,
      dayWindow,
      suggestions: formatted
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error getting meal suggestions:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to get meal suggestions', details: error.message }));
  }
}

/**
 * POST /meals/:mealId/clone
 *
 * Clones an existing meal as a new meal for today (IST).
 * Sets source='cloned' and clonedFrom=originalMealId so it can be
 * distinguished from LLM-analysed meals.
 */
async function cloneMeal(req, res) {
  try {
    const userId = req.user.userId;
    const basePath = req.url.split('?')[0];
    const pathParts = basePath.split('/');
    // /meals/:mealId/clone → ['', 'meals', mealId, 'clone']
    const mealId = pathParts[2];

    if (!mealId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mealId is required' }));
      return;
    }

    // Find the original meal
    const originalMeal = await Meal.findOne({ _id: mealId, userId, deletedAt: null });
    if (!originalMeal) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Meal not found' }));
      return;
    }

    const dateUtils = require('../utils/dateUtils');
    const nowIST = dateUtils.getCurrentDateTime();

    // Generate new unique IDs for each item
    const clonedItems = originalMeal.items.map((item, index) => ({
      id: `item_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`,
      name: {
        llm: item.name?.llm || null,
        final: item.name?.final || null
      },
      displayQuantity: {
        llm: item.displayQuantity?.llm ? {
          value: item.displayQuantity.llm.value,
          unit: item.displayQuantity.llm.unit
        } : undefined,
        final: item.displayQuantity?.final ? {
          value: item.displayQuantity.final.value,
          unit: item.displayQuantity.final.unit
        } : { value: null, unit: null }
      },
      measureQuantity: {
        llm: item.measureQuantity?.llm ? {
          value: item.measureQuantity.llm.value,
          unit: item.measureQuantity.llm.unit
        } : undefined,
        final: item.measureQuantity?.final ? {
          value: item.measureQuantity.final.value,
          unit: item.measureQuantity.final.unit
        } : { value: null, unit: null }
      },
      nutrition: {
        calories: { llm: item.nutrition?.calories?.llm || null, final: item.nutrition?.calories?.final || null },
        protein:  { llm: item.nutrition?.protein?.llm || null,  final: item.nutrition?.protein?.final || null },
        carbs:    { llm: item.nutrition?.carbs?.llm || null,    final: item.nutrition?.carbs?.final || null },
        fat:      { llm: item.nutrition?.fat?.llm || null,      final: item.nutrition?.fat?.final || null }
      },
      confidence: item.confidence || null
    }));

    // Create the cloned meal
    const clonedMeal = new Meal({
      userId,
      capturedAt: nowIST,
      photos: originalMeal.photos || [],
      llmVersion: originalMeal.llmVersion || null,
      llmModel: originalMeal.llmModel || null,
      name: originalMeal.name,
      totalNutrition: {
        calories: { llm: originalMeal.totalNutrition?.calories?.llm || null, final: originalMeal.totalNutrition?.calories?.final || null },
        protein:  { llm: originalMeal.totalNutrition?.protein?.llm || null,  final: originalMeal.totalNutrition?.protein?.final || null },
        carbs:    { llm: originalMeal.totalNutrition?.carbs?.llm || null,    final: originalMeal.totalNutrition?.carbs?.final || null },
        fat:      { llm: originalMeal.totalNutrition?.fat?.llm || null,      final: originalMeal.totalNutrition?.fat?.final || null }
      },
      items: clonedItems,
      notes: originalMeal.notes || '',
      userApproved: false,
      source: 'cloned',
      clonedFrom: originalMeal._id
    });

    const savedMeal = await clonedMeal.save();
    console.log(`📋 [CLONE] Meal ${mealId} cloned as ${savedMeal._id} for user ${userId}`);

    // Format response using standard formatter
    const formattedResponse = mealFormatter.formatMealResponse(savedMeal);
    formattedResponse.source = 'cloned';
    formattedResponse.clonedFrom = mealId;

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(formattedResponse));

  } catch (error) {
    reportError(error, { req });
    console.error('Error cloning meal:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to clone meal', details: error.message }));
  }
}

async function getMealImpact(req, res) {
  try {
    const userId = req.user.userId;
    const basePath = req.url.split('?')[0];
    const pathParts = basePath.split('/');
    // /meals/:mealId/impact -> ['', 'meals', mealId, 'impact']
    const mealId = pathParts[2];

    if (!mealId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mealId is required' }));
      return;
    }

    const meal = await MealService.getMealById(userId, mealId);
    if (!meal) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Meal not found' }));
      return;
    }

    const { satiety, glucoseImpact, smallSwaps, enrichment } = await MealImpactService.analyzeMealImpact(meal);

    // Fire-and-forget: save fiber/GI enrichment data to the meal document
    MealImpactService.saveEnrichmentData(meal, enrichment).catch(err => {
      console.error('⚠️ [MealImpact] Enrichment save error:', err.message);
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ satiety, glucoseImpact, smallSwaps }));
  } catch (error) {
    reportError(error, { req });
    console.error('Error generating meal impact:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to generate meal impact', details: error.message }));
  }
}

module.exports = {
  createMeal,
  getMeals,
  getMealById,
  updateMeal,
  bulkEditItems,
  deleteMeal,
  getDailySummary,
  getCalendarData,
  getMealAuditHistory,
  getAuditEntry,
  getUserAuditSummary,
  addItemToMeal,
  deleteItemFromMeal,
  getMealSuggestions,
  cloneMeal,
  getMealImpact
}; 
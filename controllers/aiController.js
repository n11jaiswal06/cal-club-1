const AiService = require('../services/aiService');
const parseBody = require('../utils/parseBody');
const mealFormatter = require('../utils/mealFormatter');
const dateUtils = require('../utils/dateUtils');
const { reportError } = require('../utils/sentryReporter');
const { isTestUser } = require('../config/testUsers');

function foodCalories(req, res) {
  parseBody(req, async (err, data) => {
    if (err || (!data.url && !data.hint)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Either image URL or hint (text description) is required in body as { "url": "..." } or { "hint": "..." } or both' }));
      return;
    }

    const provider = 'gemini' // hardcoding to gemini for now
    const additionalData = {  
      capturedAt: data.capturedAt ? new Date(data.capturedAt) : dateUtils.getCurrentDateTime(),
      width: data.width || null,
      height: data.height || null,
      notes: data.notes || ''
    };

    try {
      // Test users (env-based) use dual-prompt V2 flow; others use single-prompt
      const useV3 = isTestUser(req.user.userId);
      const result = useV3
        ? await AiService.analyzeFoodCaloriesV3(data.url || null, data.hint || null, provider, req.user.userId, additionalData)
        : await AiService.analyzeFoodCalories(data.url || null, data.hint || null, provider, req.user.userId, additionalData);
      
      // If a meal was saved, format it according to the new response format
      if (result.mealId) {
        const Meal = require('../models/schemas/Meal');
        const meal = await Meal.findById(result.mealId);
        if (meal) {
          const formattedResponse = mealFormatter.formatMealResponse(meal);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(formattedResponse));
          return;
        }
      }
      
      // Fallback to original response if no meal was saved
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      reportError(error, { req });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to analyze image', details: error.message }));
    }
  });
}

function foodCaloriesV2(req, res) {
  parseBody(req, async (err, data) => {
    if (err || (!data.url && !data.hint)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Either image URL or hint (text description) is required in body as { "url": "..." } or { "hint": "..." } or both' }));
      return;
    }

    const provider = 'gemini';
    const additionalData = {
      capturedAt: data.capturedAt ? new Date(data.capturedAt) : dateUtils.getCurrentDateTime(),
      width: data.width || null,
      height: data.height || null,
      notes: data.notes || ''
    };

    try {
      const result = await AiService.analyzeFoodCaloriesV2(data.url || null, data.hint || null, provider, req.user.userId, additionalData);

      // If a meal was saved, format it same as V1
      if (result.mealId) {
        const Meal = require('../models/schemas/Meal');
        const meal = await Meal.findById(result.mealId);
        if (meal) {
          const formattedResponse = mealFormatter.formatMealResponse(meal);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(formattedResponse));
          return;
        }
      }

      // Fallback to original response if no meal was saved
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      reportError(error, { req });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to analyze image (V2)', details: error.message }));
    }
  });
}

function foodCaloriesV3(req, res) {
  parseBody(req, async (err, data) => {
    if (err || (!data.url && !data.hint)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Either image URL or hint (text description) is required in body as { "url": "..." } or { "hint": "..." } or both' }));
      return;
    }

    const provider = 'gemini';
    const additionalData = {
      capturedAt: data.capturedAt ? new Date(data.capturedAt) : dateUtils.getCurrentDateInIST(),
      width: data.width || null,
      height: data.height || null,
      notes: data.notes || ''
    };

    try {
      const result = await AiService.analyzeFoodCaloriesV3(data.url || null, data.hint || null, provider, req.user.userId, additionalData);

      if (result.mealId) {
        const Meal = require('../models/schemas/Meal');
        const meal = await Meal.findById(result.mealId);
        if (meal) {
          const formattedResponse = mealFormatter.formatMealResponse(meal);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(formattedResponse));
          return;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      reportError(error, { req });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to analyze image (V3)', details: error.message }));
    }
  });
}

function foodCaloriesV4(req, res) {
  parseBody(req, async (err, data) => {
    if (err || (!data.url && !data.hint)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Either image URL or hint (text description) is required in body as { "url": "..." } or { "hint": "..." } or both' }));
      return;
    }

    const provider = 'gemini';
    const additionalData = {
      capturedAt: data.capturedAt ? new Date(data.capturedAt) : dateUtils.getCurrentDateTime(),
      width: data.width || null,
      height: data.height || null,
      notes: data.notes || ''
    };

    try {
      const result = await AiService.analyzeFoodCaloriesV4(data.url || null, data.hint || null, provider, req.user.userId, additionalData);

      // If a meal was saved, format it same as previous versions
      if (result.mealId) {
        const Meal = require('../models/schemas/Meal');
        const meal = await Meal.findById(result.mealId);
        if (meal) {
          const formattedResponse = mealFormatter.formatMealResponse(meal);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(formattedResponse));
          return;
        }
      }

      // Fallback to original response if no meal was saved
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      reportError(error, { req });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to analyze image (V4)', details: error.message }));
    }
  });
}

module.exports = { foodCalories, foodCaloriesV2, foodCaloriesV3, foodCaloriesV4 }; 
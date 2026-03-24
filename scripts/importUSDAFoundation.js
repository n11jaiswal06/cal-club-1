const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
require('dotenv').config();

const FoodItem = require('../models/schemas/FoodItem');

// USDA Nutrient IDs (standard across all datasets)
const NUTRIENT_IDS = {
  ENERGY: 1008,      // kcal
  PROTEIN: 1003,     // g
  CARBS: 1005,       // g (by difference)
  FAT: 1004,         // g
  FIBER: 1079        // g
};

function categorizeFood(name) {
  const nameLower = name.toLowerCase();

  if (nameLower.match(/chicken|beef|pork|lamb|turkey|fish|salmon|tuna|shrimp|egg|tofu/)) return 'protein';
  if (nameLower.match(/rice|bread|pasta|noodle|cereal|oat|wheat|flour|quinoa/)) return 'grain';
  if (nameLower.match(/oil|butter|ghee|cream|lard|margarine/)) return 'fat';
  if (nameLower.match(/tomato|potato|onion|carrot|broccoli|spinach|lettuce|pepper|cabbage/)) return 'vegetable';
  if (nameLower.match(/apple|banana|orange|grape|berry|mango|pineapple|melon/)) return 'fruit';
  if (nameLower.match(/milk|yogurt|cheese|paneer|curd/)) return 'dairy';
  if (nameLower.match(/almond|cashew|walnut|peanut|pistachio/)) return 'nuts';
  if (nameLower.match(/lentil|chickpea|bean|dal|pea/)) return 'legumes';
  if (nameLower.match(/sauce|gravy|ketchup|mayo|dressing/)) return 'sauce';
  if (nameLower.match(/juice|soda|coffee|tea|water|cola/)) return 'beverage';

  return 'other';
}

async function importFoundationFoods() {
  try {
    console.log('USDA Foundation Foods Import');
    console.log('============================\n');

    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/caltrack';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    const dataDir = path.join(__dirname, '../data/usda/FoodData_Central_foundation_food_csv_2024-10-31');

    // Step 1: Load food data
    console.log('Loading food.csv...');
    const foodCsv = fs.readFileSync(path.join(dataDir, 'food.csv'), 'utf-8');
    const foods = parse(foodCsv, { columns: true, skip_empty_lines: true });
    console.log(`✓ Loaded ${foods.length} foods\n`);

    // Step 2: Load nutrient data
    console.log('Loading food_nutrient.csv...');
    const nutrientCsv = fs.readFileSync(path.join(dataDir, 'food_nutrient.csv'), 'utf-8');
    const nutrients = parse(nutrientCsv, { columns: true, skip_empty_lines: true });
    console.log(`✓ Loaded ${nutrients.length} nutrient records\n`);

    // Step 3: Build nutrient map by fdc_id
    console.log('Building nutrient index...');
    const nutrientMap = new Map();

    for (const row of nutrients) {
      const fdcId = row.fdc_id;
      const nutrientId = parseInt(row.nutrient_id);
      const amount = parseFloat(row.amount) || 0;

      if (!nutrientMap.has(fdcId)) {
        nutrientMap.set(fdcId, {});
      }

      const foodNutrients = nutrientMap.get(fdcId);

      if (nutrientId === NUTRIENT_IDS.ENERGY) foodNutrients.calories = amount;
      else if (nutrientId === NUTRIENT_IDS.PROTEIN) foodNutrients.protein = amount;
      else if (nutrientId === NUTRIENT_IDS.CARBS) foodNutrients.carbs = amount;
      else if (nutrientId === NUTRIENT_IDS.FAT) foodNutrients.fat = amount;
      else if (nutrientId === NUTRIENT_IDS.FIBER) foodNutrients.fiber = amount;
    }
    console.log(`✓ Indexed nutrients for ${nutrientMap.size} foods\n`);

    // Step 4: Create FoodItems with joined data
    console.log('Creating food items...');
    const foodItems = [];
    let skipped = 0;

    for (const food of foods) {
      const fdcId = food.fdc_id;
      const description = food.description;

      if (!description) {
        skipped++;
        continue;
      }

      // Get nutrients for this food
      const nutrients = nutrientMap.get(fdcId) || {};

      // Only include if we have at least calories or protein
      if (!nutrients.calories && !nutrients.protein) {
        skipped++;
        continue;
      }

      foodItems.push({
        name: description,
        aliases: [],
        category: categorizeFood(description),
        dataSource: 'USDA',
        sourceId: fdcId,
        verified: true,
        caloriesPer100g: nutrients.calories || 0,
        proteinPer100g: nutrients.protein || 0,
        carbsPer100g: nutrients.carbs || 0,
        fatPer100g: nutrients.fat || 0,
        fiberPer100g: nutrients.fiber || 0,
        usageCount: 0
      });
    }

    console.log(`Prepared ${foodItems.length} food items (skipped ${skipped})\n`);

    // Step 5: Clear existing USDA data and bulk insert
    console.log('Clearing existing USDA data...');
    const deleteResult = await FoodItem.deleteMany({ dataSource: 'USDA' });
    console.log(`✓ Cleared ${deleteResult.deletedCount} existing entries\n`);

    console.log('Importing to MongoDB...');
    if (foodItems.length > 0) {
      await FoodItem.insertMany(foodItems, { ordered: false });
      console.log(`✓ Imported ${foodItems.length} foods\n`);
    }

    // Print summary
    const summary = await FoodItem.aggregate([
      { $match: { dataSource: 'USDA' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('Category breakdown:');
    summary.forEach(s => console.log(`  ${s._id}: ${s.count}`));

    console.log('\n✓ Import complete!');

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

if (require.main === module) {
  importFoundationFoods();
}

module.exports = { importFoundationFoods };

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const FoodItem = require('../models/schemas/FoodItem');

/**
 * Categorize food based on IFCT category codes
 */
function categorizeIFCTFood(category, name) {
  const nameLower = (name || '').toLowerCase();
  const categoryLower = (category || '').toLowerCase();

  // IFCT categories: cereals, pulses, vegetables, fruits, milk, meat, fish, etc.
  if (categoryLower.includes('cereal') || nameLower.match(/rice|wheat|roti|chapati|naan|bread|ragi/)) {
    return 'grain';
  }
  if (categoryLower.includes('pulse') || categoryLower.includes('legume') || nameLower.match(/dal|lentil|chickpea|rajma/)) {
    return 'legumes';
  }
  if (categoryLower.includes('vegetable') || nameLower.match(/potato|onion|tomato|spinach|methi|bhindi/)) {
    return 'vegetable';
  }
  if (categoryLower.includes('fruit') || nameLower.match(/mango|banana|apple|guava|papaya/)) {
    return 'fruit';
  }
  if (categoryLower.includes('milk') || categoryLower.includes('dairy') || nameLower.match(/milk|paneer|cheese|yogurt|curd|ghee/)) {
    return 'dairy';
  }
  if (categoryLower.includes('meat') || categoryLower.includes('poultry') || nameLower.match(/chicken|mutton|beef|lamb/)) {
    return 'protein';
  }
  if (categoryLower.includes('fish') || categoryLower.includes('seafood') || nameLower.match(/fish|prawn|crab/)) {
    return 'protein';
  }
  if (categoryLower.includes('egg') || nameLower.includes('egg')) {
    return 'protein';
  }
  if (categoryLower.includes('fat') || categoryLower.includes('oil') || nameLower.match(/oil|butter|ghee/)) {
    return 'fat';
  }
  if (categoryLower.includes('nut') || categoryLower.includes('seed') || nameLower.match(/cashew|almond|groundnut/)) {
    return 'nuts';
  }
  if (nameLower.match(/tea|coffee|juice/)) {
    return 'beverage';
  }

  return 'other';
}

/**
 * Get regional aliases for Indian foods
 */
function getRegionalAliases(name) {
  const aliases = [];

  // Common Hindi/regional variations
  const variations = {
    'rice': ['chawal', 'bhat'],
    'roti': ['chapati', 'phulka'],
    'lentil': ['dal', 'daal'],
    'potato': ['aloo', 'batata'],
    'onion': ['pyaz', 'kanda'],
    'tomato': ['tamatar'],
    'spinach': ['palak'],
    'milk': ['doodh'],
    'yogurt': ['curd', 'dahi'],
    'butter': ['makhan'],
    'ghee': ['clarified butter'],
    'paneer': ['cottage cheese', 'indian cheese'],
    'chicken': ['murgh', 'kozhi'],
    'mutton': ['lamb', 'gosht'],
    'fish': ['machli', 'meen']
  };

  const nameLower = name.toLowerCase();

  for (const [english, regional] of Object.entries(variations)) {
    if (nameLower.includes(english)) {
      aliases.push(...regional);
    }
    if (regional.some(r => nameLower.includes(r))) {
      aliases.push(english);
      aliases.push(...regional.filter(r => !nameLower.includes(r)));
    }
  }

  return [...new Set(aliases)]; // Remove duplicates
}

/**
 * Parse IFCT data and import to MongoDB
 */
async function importIFCT() {
  try {
    console.log('IFCT 2017 Indian Food Composition Database Import');
    console.log('=================================================\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/caltrack';
    console.log(`Connecting to MongoDB: ${mongoUri.replace(/\/\/.*@/, '//<credentials>@')}`);
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    // Try to load IFCT data from npm package
    let ifctData;
    try {
      const ifct = require('@nodef/ifct2017');
      console.log('✓ Loaded IFCT 2017 npm package\n');

      // The package exports a Map object with food codes as keys
      // We need to convert it to an array
      ifctData = Array.from(ifct.entries()).map(([code, food]) => ({
        code,
        ...food
      }));

      console.log(`Found ${ifctData.length} foods in IFCT database\n`);
    } catch (err) {
      console.error('✗ Failed to load @nodef/ifct2017 npm package');
      console.error('  Please install it first: npm install @nodef/ifct2017');
      console.error(`  Error: ${err.message}`);
      process.exit(1);
    }

    // Clear existing IFCT entries
    const deleteResult = await FoodItem.deleteMany({ dataSource: 'IFCT' });
    console.log(`Cleared ${deleteResult.deletedCount} existing IFCT entries\n`);

    // Process IFCT foods
    const foodItems = [];

    for (const food of ifctData) {
      // IFCT structure: { code, name, group, energy, protein, fat, carbohydrates, fiber, ... }
      const name = food.name || food.foodName;
      if (!name) continue;

      const aliases = getRegionalAliases(name);
      const category = categorizeIFCTFood(food.group || food.foodGroup, name);

      const foodItem = {
        name,
        aliases,
        category,
        dataSource: 'IFCT',
        sourceId: food.code || food.foodCode,
        verified: true,
        // IFCT nutrition values (per 100g)
        caloriesPer100g: parseFloat(food.energy || food.energyKcal) || 0,
        proteinPer100g: parseFloat(food.protein) || 0,
        carbsPer100g: parseFloat(food.carbohydrates || food.carbs) || 0,
        fatPer100g: parseFloat(food.fat || food.totalFat) || 0,
        fiberPer100g: parseFloat(food.fiber || food.dietaryFiber) || 0,
        usageCount: 0,
        llmModel: null,
        llmGeneratedAt: null
      };

      // Only add if we have at least calories
      if (foodItem.caloriesPer100g > 0 || foodItem.proteinPer100g > 0) {
        foodItems.push(foodItem);
      }
    }

    console.log(`Prepared ${foodItems.length} food items for import`);

    // Bulk insert to MongoDB
    if (foodItems.length > 0) {
      try {
        await FoodItem.insertMany(foodItems, { ordered: false });
        console.log(`✓ Successfully imported ${foodItems.length} IFCT items`);
      } catch (err) {
        if (err.code === 11000) {
          console.log(`✓ Imported IFCT items (some duplicates skipped)`);
        } else {
          throw err;
        }
      }
    }

    // Print summary
    const summary = await FoodItem.aggregate([
      { $match: { dataSource: 'IFCT' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('\nCategory breakdown:');
    summary.forEach(s => {
      console.log(`  ${s._id}: ${s.count}`);
    });

    // Sample of imported foods
    const samples = await FoodItem.find({ dataSource: 'IFCT' }).limit(10);
    console.log('\nSample imported foods:');
    samples.forEach(food => {
      console.log(`  ${food.name} (${food.category}) - ${food.aliases.length} aliases`);
      if (food.aliases.length > 0) {
        console.log(`    Aliases: ${food.aliases.join(', ')}`);
      }
    });

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  importIFCT();
}

module.exports = { importIFCT };

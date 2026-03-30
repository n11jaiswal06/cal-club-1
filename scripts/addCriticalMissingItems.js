const mongoose = require('mongoose');
require('dotenv').config();
const FoodItem = require('../models/schemas/FoodItem');

const criticalItems = [
  // Ghee (clarified butter) - CRITICAL for Indian cooking
  {
    name: "Ghee (clarified butter)",
    aliases: ["ghee", "clarified butter", "desi ghee", "cow ghee", "buffalo ghee"],
    category: "fat",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 876,
    proteinPer100g: 0,
    carbsPer100g: 0,
    fatPer100g: 99.5,
    fiberPer100g: 0
  },

  // White sauce (bechamel) - for international dishes
  {
    name: "White sauce (bechamel)",
    aliases: ["bechamel", "white sauce", "bechamel sauce", "cream sauce"],
    category: "sauce",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 130,
    proteinPer100g: 3.5,
    carbsPer100g: 8,
    fatPer100g: 9.5,
    fiberPer100g: 0.2
  },

  // Mint chutney
  {
    name: "Mint chutney (pudina)",
    aliases: ["mint chutney", "pudina chutney", "green mint chutney", "pudina"],
    category: "sauce",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 90,
    proteinPer100g: 2,
    carbsPer100g: 12,
    fatPer100g: 4,
    fiberPer100g: 3
  },

  // Tamarind chutney
  {
    name: "Tamarind chutney (imli)",
    aliases: ["tamarind chutney", "imli chutney", "sweet tamarind chutney", "khatti meethi chutney"],
    category: "sauce",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 180,
    proteinPer100g: 1,
    carbsPer100g: 45,
    fatPer100g: 0.5,
    fiberPer100g: 2
  },

  // Green chutney
  {
    name: "Green chutney (coriander)",
    aliases: ["green chutney", "coriander chutney", "cilantro chutney", "dhaniya chutney"],
    category: "sauce",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 95,
    proteinPer100g: 2.5,
    carbsPer100g: 10,
    fatPer100g: 5,
    fiberPer100g: 3
  },

  // Coconut chutney
  {
    name: "Coconut chutney (nariyal)",
    aliases: ["coconut chutney", "nariyal chutney", "thengai chutney", "south indian coconut chutney"],
    category: "sauce",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 150,
    proteinPer100g: 2,
    carbsPer100g: 8,
    fatPer100g: 13,
    fiberPer100g: 2.5
  },

  // Mayo (for international dishes)
  {
    name: "Mayonnaise (regular)",
    aliases: ["mayo", "mayonnaise", "egg mayo"],
    category: "sauce",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 680,
    proteinPer100g: 1.2,
    carbsPer100g: 2.7,
    fatPer100g: 75,
    fiberPer100g: 0
  },

  // Sour cream
  {
    name: "Sour cream",
    aliases: ["sour cream", "fresh cream", "dairy sour cream"],
    category: "dairy",
    dataSource: "MANUAL",
    verified: true,
    caloriesPer100g: 193,
    proteinPer100g: 2.4,
    carbsPer100g: 4.6,
    fatPer100g: 19,
    fiberPer100g: 0
  }
];

async function addCriticalItems() {
  try {
    console.log('Adding Critical Missing Items');
    console.log('============================\n');

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    let added = 0;
    let skipped = 0;

    for (const item of criticalItems) {
      const existing = await FoodItem.findOne({ name: item.name });

      if (existing) {
        console.log(`✗ SKIP: ${item.name} (already exists)`);
        skipped++;
      } else {
        await FoodItem.create(item);
        console.log(`✓ ADD:  ${item.name}`);
        added++;
      }
    }

    console.log(`\n✓ Complete: ${added} items added, ${skipped} skipped\n`);

    // Update aliases for existing items
    console.log('Updating aliases for existing items...');

    // Add "dahi" alias to yogurt/curd items
    await FoodItem.updateMany(
      { name: /yogurt|curd/i, aliases: { $nin: ['dahi'] } },
      { $addToSet: { aliases: 'dahi' } }
    );
    console.log('✓ Added "dahi" alias to yogurt/curd items');

    // Add "chapati" alias to roti items
    await FoodItem.updateMany(
      { name: /roti/i, aliases: { $nin: ['chapati'] } },
      { $addToSet: { aliases: 'chapati' } }
    );
    console.log('✓ Added "chapati" alias to roti items');

    // Final stats
    const totalSauces = await FoodItem.countDocuments({ category: 'sauce' });
    const totalFats = await FoodItem.countDocuments({ category: 'fat' });

    console.log(`\nFinal counts:`);
    console.log(`  Sauces: ${totalSauces}`);
    console.log(`  Fats: ${totalFats}`);

    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');

  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

addCriticalItems();

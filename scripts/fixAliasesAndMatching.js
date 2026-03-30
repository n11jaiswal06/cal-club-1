const mongoose = require('mongoose');
require('dotenv').config();
const FoodItem = require('../models/schemas/FoodItem');

async function fixAliases() {
  try {
    console.log('Fixing Aliases and Adding Missing Items');
    console.log('========================================\n');

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Add "dahi" alias to all yogurt/curd items
    const yogurtUpdate = await FoodItem.updateMany(
      { name: /yogurt|curd/i, aliases: { $nin: ['dahi'] } },
      { $addToSet: { aliases: { $each: ['dahi', 'dahi yogurt'] } } }
    );
    console.log(`✓ Added "dahi" alias to ${yogurtUpdate.modifiedCount} yogurt/curd items`);

    // Add "chawal" alias to rice items
    const riceUpdate = await FoodItem.updateMany(
      { name: /^rice/i, aliases: { $nin: ['chawal'] } },
      { $addToSet: { aliases: { $each: ['chawal', 'bhat'] } } }
    );
    console.log(`✓ Added "chawal" alias to ${riceUpdate.modifiedCount} rice items`);

    // Add "aloo" alias to potato items
    const potatoUpdate = await FoodItem.updateMany(
      { name: /potato/i, aliases: { $nin: ['aloo'] } },
      { $addToSet: { aliases: { $each: ['aloo', 'batata'] } } }
    );
    console.log(`✓ Added "aloo" alias to ${potatoUpdate.modifiedCount} potato items`);

    // Add specific fresh egg entry if it doesn't exist
    const freshEgg = await FoodItem.findOne({ name: /^Egg.*raw$/i });
    if (!freshEgg) {
      // Find USDA fresh egg
      const usdaEgg = await FoodItem.findOne({ name: /egg.*large.*raw/i, dataSource: 'USDA' });
      if (usdaEgg) {
        console.log(`✓ Found fresh egg: ${usdaEgg.name}`);
        // Add aliases
        await FoodItem.updateOne(
          { _id: usdaEgg._id },
          { $addToSet: { aliases: { $each: ['egg', 'fresh egg', 'raw egg', 'eggs'] } } }
        );
        console.log(`✓ Added aliases to fresh egg`);
      }
    }

    // Add olive oil if it doesn't exist
    const oliveOil = await FoodItem.findOne({ name: /olive oil/i });
    if (!oliveOil) {
      console.log('✗ Olive oil not found, searching USDA...');
      const usdaOlive = await FoodItem.findOne({ name: /oil.*olive/i });
      if (usdaOlive) {
        await FoodItem.updateOne(
          { _id: usdaOlive._id },
          { $addToSet: { aliases: { $each: ['olive oil', 'extra virgin olive oil'] } } }
        );
        console.log(`✓ Added aliases to ${usdaOlive.name}`);
      } else {
        // Create manually
        const newOliveOil = await FoodItem.create({
          name: 'Olive oil, extra virgin',
          aliases: ['olive oil', 'evoo', 'extra virgin olive oil'],
          category: 'fat',
          dataSource: 'MANUAL',
          verified: true,
          caloriesPer100g: 884,
          proteinPer100g: 0,
          carbsPer100g: 0,
          fatPer100g: 100,
          fiberPer100g: 0
        });
        console.log(`✓ Created olive oil entry`);
      }
    } else {
      console.log(`✓ Olive oil already exists: ${oliveOil.name}`);
    }

    console.log('\n✓ Alias fixes complete\n');

    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');

  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

fixAliases();

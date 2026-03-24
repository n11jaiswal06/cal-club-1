const mongoose = require('mongoose');
require('dotenv').config();

const Recipe = require('../models/schemas/Recipe');

/**
 * Starter recipes for composite dishes
 * Each recipe defines standard proportions per serving
 */
const starterRecipes = [
  // Indian Dishes
  {
    name: 'Butter Chicken',
    aliases: ['Murgh Makhani', 'Chicken Makhani'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Tomato gravy', category: 'sauce', gramsPerServing: 200 },
      { name: 'Butter', category: 'fat', gramsPerServing: 15 },
      { name: 'Cream', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Paneer Tikka Masala',
    aliases: ['Paneer Tikka', 'Paneer Masala'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'protein', gramsPerServing: 100 },
      { name: 'Tomato gravy', category: 'sauce', gramsPerServing: 150 },
      { name: 'Cream', category: 'dairy', gramsPerServing: 20 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Biryani',
    aliases: ['Biryani', 'Chicken Dum Biryani'],
    servingUnit: 'plate',
    components: [
      { name: 'Basmati rice', category: 'grain', gramsPerServing: 150 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 120 },
      { name: 'Oil', category: 'fat', gramsPerServing: 15 },
      { name: 'Yogurt', category: 'dairy', gramsPerServing: 30 },
      { name: 'Onion', category: 'vegetable', gramsPerServing: 50 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Dal Makhani',
    aliases: ['Makhani Dal', 'Black Lentil Dal'],
    servingUnit: 'bowl',
    components: [
      { name: 'Black lentils', category: 'legumes', gramsPerServing: 80 },
      { name: 'Butter', category: 'fat', gramsPerServing: 15 },
      { name: 'Cream', category: 'dairy', gramsPerServing: 25 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 50 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Palak Paneer',
    aliases: ['Spinach Paneer', 'Saag Paneer'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'protein', gramsPerServing: 100 },
      { name: 'Spinach', category: 'vegetable', gramsPerServing: 150 },
      { name: 'Cream', category: 'dairy', gramsPerServing: 20 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // Egg Dishes
  {
    name: 'One Egg Omelet',
    aliases: ['1 Egg Omelet', 'Single Egg Omelet'],
    servingUnit: 'piece',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Oil', category: 'fat', gramsPerServing: 5 },
      { name: 'Onion', category: 'vegetable', gramsPerServing: 15 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Two Egg Omelet',
    aliases: ['2 Egg Omelet', 'Double Egg Omelet'],
    servingUnit: 'piece',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 100 },
      { name: 'Oil', category: 'fat', gramsPerServing: 8 },
      { name: 'Onion', category: 'vegetable', gramsPerServing: 25 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 25 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Three Egg Omelet',
    aliases: ['3 Egg Omelet', 'Triple Egg Omelet'],
    servingUnit: 'piece',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 150 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 },
      { name: 'Onion', category: 'vegetable', gramsPerServing: 30 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Scrambled Eggs',
    aliases: ['Egg Bhurji', 'Anda Bhurji'],
    servingUnit: 'serving',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 100 },
      { name: 'Butter', category: 'fat', gramsPerServing: 10 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // Bowl Dishes
  {
    name: 'Burrito Bowl',
    aliases: ['Mexican Bowl', 'Chipotle Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 150 },
      { name: 'Black beans', category: 'legumes', gramsPerServing: 100 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 },
      { name: 'Sour cream', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Poke Bowl',
    aliases: ['Hawaiian Poke', 'Tuna Poke Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 150 },
      { name: 'Tuna', category: 'protein', gramsPerServing: 120 },
      { name: 'Avocado', category: 'fat', gramsPerServing: 50 },
      { name: 'Cucumber', category: 'vegetable', gramsPerServing: 50 },
      { name: 'Soy sauce', category: 'sauce', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Grain Bowl',
    aliases: ['Buddha Bowl', 'Healthy Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Quinoa', category: 'grain', gramsPerServing: 100 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'Broccoli', category: 'vegetable', gramsPerServing: 80 },
      { name: 'Sweet potato', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // Pasta & Noodles
  {
    name: 'Pasta with Chicken',
    aliases: ['Chicken Pasta', 'Pasta Alfredo with Chicken'],
    servingUnit: 'plate',
    components: [
      { name: 'Pasta', category: 'grain', gramsPerServing: 150 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'Alfredo sauce', category: 'sauce', gramsPerServing: 100 },
      { name: 'Parmesan cheese', category: 'dairy', gramsPerServing: 20 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Pad Thai',
    aliases: ['Thai Noodles', 'Pad Thai Noodles'],
    servingUnit: 'plate',
    components: [
      { name: 'Rice noodles', category: 'grain', gramsPerServing: 150 },
      { name: 'Shrimp', category: 'protein', gramsPerServing: 100 },
      { name: 'Peanuts', category: 'nuts', gramsPerServing: 30 },
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // Salads
  {
    name: 'Chicken Caesar Salad',
    aliases: ['Caesar Salad with Chicken', 'Grilled Chicken Salad'],
    servingUnit: 'bowl',
    components: [
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Grilled chicken', category: 'protein', gramsPerServing: 120 },
      { name: 'Caesar dressing', category: 'sauce', gramsPerServing: 40 },
      { name: 'Parmesan cheese', category: 'dairy', gramsPerServing: 20 },
      { name: 'Croutons', category: 'grain', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // Sandwiches
  {
    name: 'Tuna Sandwich',
    aliases: ['Tuna Salad Sandwich', 'Tuna Mayo Sandwich'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 60 },
      { name: 'Tuna', category: 'protein', gramsPerServing: 80 },
      { name: 'Mayonnaise', category: 'fat', gramsPerServing: 20 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 20 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Club Sandwich',
    aliases: ['Chicken Club Sandwich', 'Triple Decker Sandwich'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 90 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 80 },
      { name: 'Bacon', category: 'protein', gramsPerServing: 30 },
      { name: 'Mayonnaise', category: 'fat', gramsPerServing: 20 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 20 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // South Indian
  {
    name: 'Masala Dosa',
    aliases: ['Dosa with Potato Filling', 'Aloo Masala Dosa'],
    servingUnit: 'piece',
    components: [
      { name: 'Dosa batter', category: 'grain', gramsPerServing: 80 },
      { name: 'Potato filling', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Idli Sambhar',
    aliases: ['Idli with Sambhar', 'Steamed Rice Cakes with Lentil Soup'],
    servingUnit: 'serving',
    components: [
      { name: 'Idli', category: 'grain', gramsPerServing: 120 },
      { name: 'Sambhar', category: 'legumes', gramsPerServing: 150 },
      { name: 'Coconut chutney', category: 'sauce', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // Chinese
  {
    name: 'Fried Rice',
    aliases: ['Egg Fried Rice', 'Vegetable Fried Rice'],
    servingUnit: 'plate',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 180 },
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 80 },
      { name: 'Oil', category: 'fat', gramsPerServing: 15 },
      { name: 'Soy sauce', category: 'sauce', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  }
];

/**
 * Main import function
 */
async function main() {
  try {
    console.log('Creating Starter Recipes');
    console.log('========================\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/caltrack';
    console.log(`Connecting to MongoDB: ${mongoUri.replace(/\/\/.*@/, '//<credentials>@')}`);
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    // Clear existing manual recipes
    const deleteResult = await Recipe.deleteMany({ source: 'MANUAL' });
    console.log(`Cleared ${deleteResult.deletedCount} existing manual recipes\n`);

    // Insert starter recipes
    await Recipe.insertMany(starterRecipes);
    console.log(`✓ Created ${starterRecipes.length} starter recipes\n`);

    // Print summary
    console.log('Recipes created:');
    starterRecipes.forEach(recipe => {
      console.log(`  ${recipe.name} (${recipe.servingUnit}) - ${recipe.components.length} components`);
    });

    console.log('\n✓ Setup complete!');

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
  main();
}

module.exports = { main, starterRecipes };

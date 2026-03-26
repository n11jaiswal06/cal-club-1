const mongoose = require('mongoose');
require('dotenv').config();

const { matchFood } = require('../services/foodMatcher');
const { lookupRecipe } = require('../services/recipeLookupService');

/**
 * Test cases for semantic search
 * Each test should match with >80% confidence
 */
const semanticSearchTests = [
  // Basic foods
  { query: 'Milk', category: 'dairy', expected: /milk/i },
  { query: 'Chicken', category: 'protein', expected: /chicken/i },
  { query: 'Rice', category: 'grain', expected: /rice/i },
  { query: 'Roti', category: 'grain', expected: /roti|chapati/i },
  { query: 'Dal', category: 'legumes', expected: /dal|lentil/i },

  // Regional names (Hindi)
  { query: 'Dahi', category: 'dairy', expected: /yogurt|curd|dahi/i },
  { query: 'Chawal', category: 'grain', expected: /rice|chawal/i },
  { query: 'Aloo', category: 'vegetable', expected: /potato|aloo/i },

  // Gravies and sauces
  { query: 'Butter chicken gravy', category: 'sauce', expected: /butter chicken gravy/i },
  { query: 'Tikka masala gravy', category: 'sauce', expected: /tikka masala gravy/i },
  { query: 'White sauce', category: 'sauce', expected: /white sauce|bechamel/i },
  { query: 'Mint chutney', category: 'sauce', expected: /mint chutney/i },

  // Fats
  { query: 'Ghee', category: 'fat', expected: /ghee|clarified butter/i },
  { query: 'Olive oil', category: 'fat', expected: /olive oil/i },

  // Descriptive queries (test semantic search robustness)
  { query: 'Grilled chicken breast', category: 'protein', expected: /chicken/i },
  { query: 'Whole milk', category: 'dairy', expected: /milk/i },
  { query: 'Brown rice', category: 'grain', expected: /rice/i }
];

/**
 * Test cases for recipe lookup
 */
const recipeTests = [
  {
    name: 'Butter Chicken',
    expectedComponents: 2, // Chicken + Butter chicken gravy
    expectedMinCalories: 300, // Rough estimate for 1 bowl
    expectedMaxCalories: 600
  },
  {
    name: 'Chicken Biryani',
    expectedComponents: 4, // Rice + Chicken + Yogurt + Oil
    expectedMinCalories: 400,
    expectedMaxCalories: 700
  },
  {
    name: 'Dal Makhani',
    expectedComponents: 2, // Black lentils + Dal makhani gravy base
    expectedMinCalories: 200,
    expectedMaxCalories: 400
  },
  {
    name: 'Burrito Bowl',
    expectedComponents: 6, // Rice + Beans + Chicken + Cheese + Sour cream + Salsa
    expectedMinCalories: 450,
    expectedMaxCalories: 750
  },
  {
    name: 'Two Egg Omelet',
    expectedComponents: 2, // Egg + Oil
    expectedMinCalories: 150,
    expectedMaxCalories: 250
  },
  {
    name: 'Oatmeal Bowl',
    expectedComponents: 4, // Oats + Milk + Banana + Nuts
    expectedMinCalories: 250,
    expectedMaxCalories: 450
  }
];

async function testSemanticSearch() {
  console.log('\n=== SEMANTIC SEARCH TESTS ===\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of semanticSearchTests) {
    const result = await matchFood(test.query, test.category, 0.7);

    if (result && result.food) {
      const matchedName = result.food.name;
      const confidence = result.confidence;
      const matches = test.expected.test(matchedName);

      if (matches && confidence >= 0.7) {
        console.log(`✓ ${test.query} → ${matchedName} (${(confidence * 100).toFixed(0)}%)`);
        passed++;
        results.push({ test: test.query, passed: true, confidence });
      } else {
        console.log(`✗ ${test.query} → ${matchedName} (${(confidence * 100).toFixed(0)}%) - EXPECTED: ${test.expected}`);
        failed++;
        results.push({ test: test.query, passed: false, confidence });
      }
    } else {
      console.log(`✗ ${test.query} → NOT FOUND`);
      failed++;
      results.push({ test: test.query, passed: false, confidence: 0 });
    }
  }

  const passRate = (passed / semanticSearchTests.length) * 100;
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  console.log(`\n📊 Semantic Search Results:`);
  console.log(`   Passed: ${passed}/${semanticSearchTests.length} (${passRate.toFixed(1)}%)`);
  console.log(`   Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`   Target: >85% pass rate with >80% avg confidence`);

  if (passRate >= 85 && avgConfidence >= 0.80) {
    console.log(`   ✅ PASSED: Semantic search meets quality bar\n`);
  } else {
    console.log(`   ❌ FAILED: Semantic search below quality bar\n`);
  }

  return { passed, failed, passRate, avgConfidence };
}

async function testRecipeLookup() {
  console.log('\n=== RECIPE LOOKUP TESTS ===\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of recipeTests) {
    const result = await lookupRecipe(test.name, 1);

    if (result.found) {
      const calories = result.totalNutrition.calories;
      const componentCount = result.components.length;
      const missingComponents = result.missingComponents;

      const caloriesOk = calories >= test.expectedMinCalories && calories <= test.expectedMaxCalories;
      const componentsOk = componentCount === test.expectedComponents;
      const allResolved = missingComponents === 0;

      if (caloriesOk && componentsOk && allResolved) {
        console.log(`✓ ${test.name}:`);
        console.log(`     Components: ${componentCount}/${test.expectedComponents} ✓`);
        console.log(`     Calories: ${calories.toFixed(0)} (${test.expectedMinCalories}-${test.expectedMaxCalories}) ✓`);
        console.log(`     Missing: ${missingComponents} ✓`);
        passed++;
        results.push({ test: test.name, passed: true });
      } else {
        console.log(`✗ ${test.name}:`);
        console.log(`     Components: ${componentCount}/${test.expectedComponents} ${componentsOk ? '✓' : '✗'}`);
        console.log(`     Calories: ${calories.toFixed(0)} (${test.expectedMinCalories}-${test.expectedMaxCalories}) ${caloriesOk ? '✓' : '✗'}`);
        console.log(`     Missing: ${missingComponents} ${allResolved ? '✓' : '✗'}`);
        failed++;
        results.push({ test: test.name, passed: false });
      }
    } else {
      console.log(`✗ ${test.name} → RECIPE NOT FOUND`);
      failed++;
      results.push({ test: test.name, passed: false });
    }
  }

  const passRate = (passed / recipeTests.length) * 100;

  console.log(`\n📊 Recipe Lookup Results:`);
  console.log(`   Passed: ${passed}/${recipeTests.length} (${passRate.toFixed(1)}%)`);
  console.log(`   Target: >90% pass rate with 0 missing components`);

  if (passRate >= 90) {
    console.log(`   ✅ PASSED: Recipe lookup meets quality bar\n`);
  } else {
    console.log(`   ❌ FAILED: Recipe lookup below quality bar\n`);
  }

  return { passed, failed, passRate };
}

async function runTests() {
  try {
    console.log('🧪 Curated Database Test Suite');
    console.log('===============================');

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // Run tests
    const semanticResults = await testSemanticSearch();
    const recipeResults = await testRecipeLookup();

    // Overall results
    console.log('\n=== OVERALL RESULTS ===\n');

    const totalTests = semanticSearchTests.length + recipeTests.length;
    const totalPassed = semanticResults.passed + recipeResults.passed;
    const totalPassRate = (totalPassed / totalTests) * 100;

    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${totalPassed} (${totalPassRate.toFixed(1)}%)`);
    console.log(`Failed: ${semanticResults.failed + recipeResults.failed}`);

    console.log(`\nSemantic Search: ${semanticResults.passRate.toFixed(1)}% (avg conf: ${(semanticResults.avgConfidence * 100).toFixed(1)}%)`);
    console.log(`Recipe Lookup: ${recipeResults.passRate.toFixed(1)}%`);

    if (totalPassRate >= 85) {
      console.log(`\n✅ CURATED DATABASE QUALITY: PASSED\n`);
    } else {
      console.log(`\n❌ CURATED DATABASE QUALITY: FAILED (below 85% threshold)\n`);
    }

    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');

    process.exit(totalPassRate >= 85 ? 0 : 1);

  } catch (error) {
    console.error('✗ Test Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();

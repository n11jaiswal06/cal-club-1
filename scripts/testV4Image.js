/**
 * testV4Image.js
 *
 * Tests the full V4 pipeline directly (no server needed):
 *   Gemini vision → food identification → nutrition waterfall
 *
 * Usage: node Backend/scripts/testV4Image.js <imageUrl> [hint]
 */

const mongoose = require('mongoose');
require('dotenv').config();
const AiService = require('../services/aiService');

const MONGO_URI = process.env.MONGO_URI_NEW || process.env.MONGO_URI;
const imageUrl = process.argv[2];
const hint = process.argv[3] || null;

if (!imageUrl) {
  console.error('Usage: node Backend/scripts/testV4Image.js <imageUrl> [hint]');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB\n');

  console.log(`Image: ${imageUrl}`);
  if (hint) console.log(`Hint:  "${hint}"`);
  console.log('');

  const start = Date.now();
  const result = await AiService.analyzeFoodCaloriesV4(imageUrl, hint, 'gemini', null, {});
  const elapsed = Date.now() - start;

  console.log('\n═══════════════════════════════════════');
  console.log(`Meal: ${result.calories.mealName}`);
  console.log(`Time: ${elapsed}ms`);
  console.log('═══════════════════════════════════════\n');

  // Step 1 raw output (for density_class observability + portion debugging)
  if (result.quantityResult && Array.isArray(result.quantityResult.items)) {
    console.log('Step 1 (quantity analysis):');
    for (const item of result.quantityResult.items) {
      const dq = item.displayQuantity || {};
      const mq = item.measureQuantity || {};
      const cls = item.density_class || '—';
      const composite = item.composite ? ' [composite]' : '';
      console.log(`  ${item.name} — ${dq.value ?? '?'} ${dq.unit ?? ''} → ${mq.value ?? '?'}${mq.unit ?? ''}  density_class=${cls}${composite}`);
    }
    console.log('');
  }

  // Items
  console.log('Items:');
  for (const item of result.calories.items) {
    const n = item.nutrition;
    const source = item.nutritionSource || 'unknown';
    const match = item.matchedName ? ` → ${item.matchedName}` : '';
    const strategy = item.strategy ? ` (${item.strategy})` : '';

    if (n) {
      console.log(`  ${item.name} (${item.grams}g) — ${n.calories} cal | ${n.protein}g P | ${n.carbs}g C | ${n.fat}g F  [${source}${match}${strategy}]`);
    } else {
      console.log(`  ${item.name} (${item.grams}g) — ❌ no nutrition  [${source}] ${item.error || ''}`);
    }
  }

  // Totals
  const t = result.calories.totalNutrition;
  console.log(`\nTotal: ${t.calories} cal | ${t.protein}g P | ${t.carbs}g C | ${t.fat}g F`);

  // Coverage
  const c = result.coverage;
  console.log(`\nCoverage: ${c.fromDatabase} DB + ${c.fromLLM} LLM + ${c.errors} errors / ${c.total} total (${Math.round(c.fromDatabase / c.total * 100)}% from DB)`);

  // Source breakdown
  console.log('\nSource breakdown:', JSON.stringify(result.sourceBreakdown));

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

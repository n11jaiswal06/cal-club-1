// Read-only test: fetch meals with generic-looking titles and show
// what sanitizeMealTitle would produce. Stored meals predate the `role`
// field, so the fallback exercises the "no role — use full item list"
// branch (the graceful degradation path).
require('dotenv').config();
const mongoose = require('mongoose');
const AiService = require('../services/aiService');
const Meal = require('../models/schemas/Meal');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  // Meals whose name matches the generic-title pattern.
  const meals = await Meal.find({
    deletedAt: null,
    name: { $regex: AiService.GENERIC_TITLE_REGEX }
  })
    .sort({ createdAt: -1 })
    .limit(25)
    .select('name items createdAt')
    .lean();

  console.log(`Found ${meals.length} meals with generic titles (of all meals).\n`);
  console.log('BEFORE → AFTER (using items as-is; no role field on stored items)\n');
  console.log('─'.repeat(100));

  for (const m of meals) {
    // Stored items use { name: { llm, final } } shape; flatten for the helper.
    const flat = (m.items || []).map(i => ({
      name: (i.name && (i.name.final || i.name.llm)) || null
    }));
    const after = AiService.sanitizeMealTitle(m.name, flat);
    const itemNames = flat.map(i => i.name).filter(Boolean).join(', ');
    console.log(`  "${m.name}" → "${after}"`);
    console.log(`    items: ${itemNames || '(none)'}`);
    console.log();
  }

  // Sample a few non-generic meals to confirm they pass through unchanged.
  const good = await Meal.find({
    deletedAt: null,
    name: { $not: { $regex: AiService.GENERIC_TITLE_REGEX }, $ne: null }
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('name items')
    .lean();

  console.log('─'.repeat(100));
  console.log('\nPASSTHROUGH CHECK (titles that should NOT be rebuilt):\n');
  for (const m of good) {
    const flat = (m.items || []).map(i => ({
      name: (i.name && (i.name.final || i.name.llm)) || null
    }));
    const after = AiService.sanitizeMealTitle(m.name, flat);
    const ok = after === m.name.trim();
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${m.name}" → "${after}"`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

// End-to-end check for the image-scan prompt: pulls a real food photo URL
// from a recent meal in MongoDB and runs it through analyzeQuantityWithGeminiV4.
// Reports the returned mealName, per-item role tagging, and sanitized title.
require('dotenv').config();
const mongoose = require('mongoose');
const AiService = require('../services/aiService');
const Meal = require('../models/schemas/Meal');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // Find a recent multi-item meal with a photo URL so we exercise the
  // composite-detection + role-tagging path (not a single-item snack).
  const meal = await Meal.findOne({
    deletedAt: null,
    'photos.0.url': { $exists: true, $regex: /^https:/ },
    'items.3': { $exists: true }, // at least 4 items
  })
    .sort({ createdAt: -1 })
    .select('name photos items')
    .lean();

  if (!meal) {
    console.log('No suitable meal with photo found.');
    await mongoose.disconnect();
    return;
  }

  const imageUrl = meal.photos[0].url;
  const itemNames = (meal.items || [])
    .map(i => (i.name && (i.name.final || i.name.llm)) || null)
    .filter(Boolean)
    .join(', ');

  console.log('Source meal:');
  console.log(`  stored mealName: "${meal.name}"`);
  console.log(`  items: ${itemNames}`);
  console.log(`  imageUrl: ${imageUrl.slice(0, 80)}...`);
  console.log();
  console.log('Running updated scan prompt against the same photo...');
  console.log();

  const raw = await AiService.analyzeQuantityWithGeminiV4(imageUrl, null);
  const parsed = AiService.parseAIResult(raw.response);
  const sanitized = AiService.sanitizeMealTitle(parsed.mealName, parsed.items);

  console.log(`LLM mealName: "${parsed.mealName}"`);
  console.log(`Sanitized:    "${sanitized}"${sanitized !== parsed.mealName ? '  (REBUILT)' : ''}`);
  console.log('Items:');
  for (const item of parsed.items) {
    const role = item.role || '<missing>';
    const composite = item.composite ? ' [composite]' : '';
    console.log(`  - ${item.name}  [role=${role}]${composite}`);
  }
  console.log(`Tokens: in=${raw.tokens.input}, out=${raw.tokens.output}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

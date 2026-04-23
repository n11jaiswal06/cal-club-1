// End-to-end check: send real inputs through the updated Quick Add prompt
// and inspect the resulting mealName + per-item role tagging.
require('dotenv').config();
const AiService = require('../services/aiService');

const inputs = [
  'roti, chicken curry, onion, pickle',
  'salad greens, grilled chicken, mayo dressing',
  'chicken biryani, raita',
  'oats, banana, peanut butter, honey',
  'dal, rice, papad, pickle',
  '2 rotis with paneer butter masala and a bowl of raita',
  'protein shake with whey and banana',
  'sandwich with chicken, lettuce, tomato, mayo and cheese'
];

async function main() {
  for (const input of inputs) {
    console.log('─'.repeat(90));
    console.log(`INPUT: "${input}"`);
    try {
      const raw = await AiService.analyzeQuantityFromText(input);
      const parsed = AiService.parseAIResult(raw.response);
      const sanitized = AiService.sanitizeMealTitle(parsed.mealName, parsed.items);
      console.log(`LLM mealName: "${parsed.mealName}"`);
      console.log(`Sanitized:    "${sanitized}"${sanitized !== parsed.mealName ? '  (REBUILT)' : ''}`);
      console.log('Items:');
      for (const item of parsed.items) {
        const role = item.role || '<missing>';
        console.log(`  - ${item.name}  [role=${role}]`);
      }
      console.log(`Tokens: in=${raw.tokens.input}, out=${raw.tokens.output}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

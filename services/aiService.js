const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Meal = require('../models/schemas/Meal');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Sanitize user-provided text before embedding in LLM prompts.
 * Prevents prompt injection by stripping control characters, limiting length,
 * and removing sequences that could break out of quoted context.
 */
function sanitizeUserInput(text, maxLength = 200) {
  if (!text || typeof text !== 'string') return '';
  return text
    .slice(0, maxLength)
    .replace(/[\r\n\t]/g, ' ')       // strip newlines/tabs
    .replace(/["""]/g, "'")           // normalize quotes
    .replace(/```/g, '')              // strip markdown code fences
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
}

/**
 * Shared prompt block that drives meal-title quality and per-item role tagging.
 * Interpolated into both the quick-add and image-scan prompts — edit once, both
 * pipelines pick it up. See aiService.sanitizeMealTitle for the server-side
 * fallback that catches generic titles the LLM still produces.
 */
const MEAL_NAME_RULES_BLOCK = `MEAL NAME RULES (for the "mealName" field only):
Max 5 words. Never use generic labels like "Indian meal", "Lunch plate", "Healthy bowl", or any cuisine/mealtype name — always use actual food items. Build the name from items with role="main" only; ignore sides and condiments. If one main dominates, use just that ("Chicken Biryani"); otherwise join 1-2 mains with "&" ("Chicken Curry & Roti").

ROLE (per item):
• "main": proteins, grains, cooked vegetables, composite hero dishes.
• "side": accompaniments — raita, pickle, chutney, papad, small salads.
• "condiment": sauces, dressings, oils, mayo, ketchup, honey, jam, butter, ghee.

Examples:
roti + chicken curry + pickle → "Chicken Curry & Roti"
salad greens + grilled chicken + mayo dressing → "Grilled Chicken Salad"
chicken biryani + raita → "Chicken Biryani"`;

class AiService {
  static async fetchImageAsBase64(url) {
    // Handle data URIs directly
    if (url.startsWith('data:')) {
      const matches = url.match(/^data:image\/[a-z]+;base64,(.+)$/i);
      if (matches && matches[1]) {
        return matches[1];
      }
      throw new Error('Invalid data URI format');
    }

    // Validate URL to prevent SSRF
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'metadata.google.internal'];
    if (blockedHosts.includes(parsedUrl.hostname) || parsedUrl.hostname.startsWith('169.254.') || parsedUrl.hostname.startsWith('10.') || parsedUrl.hostname.startsWith('192.168.')) {
      throw new Error('URL points to a blocked internal address');
    }

    // Handle HTTPS URLs
    const https = require('https');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Image fetch timeout after 30 seconds'));
      }, 30000);

      https.get(url, { timeout: 30000 }, (resp) => {
        let data = [];
        resp.on('data', (chunk) => data.push(chunk));
        resp.on('end', () => {
          clearTimeout(timeout);
          const buffer = Buffer.concat(data);
          resolve(buffer.toString('base64'));
        });
        resp.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Catches generic LLM-generated meal titles that slipped past the prompt rules.
   * Matches standalone cuisine/mealtype labels like "Indian meal", "Lunch plate",
   * "Healthy bowl" — not item-specific names like "Chicken Biryani".
   */
  static GENERIC_TITLE_REGEX = /^\s*(indian|asian|italian|mexican|chinese|thai|japanese|korean|healthy|mixed|quick|balanced|light|simple|protein|veggie|vegan|vegetarian|lunch|dinner|breakfast|snack|brunch)?\s*(meal|lunch|dinner|breakfast|snack|food|dish|plate|bowl|combo|platter)\s*$/i;

  /**
   * Build a meal title from Step 1 items by taking the first 1-2 items tagged
   * role="main". Fallback path — only runs when the LLM produced a generic title.
   * Uses Step 1 items (before Step 2 decomposition) because role lives there.
   */
  static rebuildTitleFromItems(items) {
    if (!Array.isArray(items) || items.length === 0) return 'Meal';
    const mains = items.filter(i => i && i.role === 'main' && i.name);
    const pool = mains.length > 0 ? mains : items.filter(i => i && i.name);
    const names = pool.slice(0, 2).map(i => i.name);
    if (names.length === 0) return 'Meal';
    return names.length === 1 ? names[0] : names.join(' & ');
  }

  /**
   * Returns a trimmed title if the LLM produced something specific, otherwise
   * rebuilds from items[].role === 'main'.
   */
  static sanitizeMealTitle(rawTitle, items) {
    const trimmed = (rawTitle || '').trim();
    if (!trimmed || this.GENERIC_TITLE_REGEX.test(trimmed)) {
      return this.rebuildTitleFromItems(items);
    }
    return trimmed;
  }

  /**
   * Quick Add: text-only food parsing. Minimal prompt — just parse what the user typed.
   */
  static async analyzeQuantityFromText(hint) {
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [QUICK-ADD-STEP1] Using model: ${modelName} for text parsing`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1 }
    });

    const sanitizedHint = sanitizeUserInput(hint);

    const prompt = `Parse this food description into structured JSON. Output ONLY what the user stated — do not add, expand, or infer extra items.

Text: <user_input>${sanitizedHint}</user_input>

COMPOSITE: set true ONLY when two or more of these are mixed/cooked together inseparably:
* Protein + carb base: biryani, fried rice with chicken/egg, pasta with meat sauce, burrito, poke bowl
* Protein + gravy: chicken curry, paneer butter masala, fish curry, mutton korma
* Salad with protein + dressing: chicken salad, Caesar salad
NOT composite — even if they contain minor secondary ingredients:
* Single-ingredient dishes: dal, sambar, rasam, plain rice, raita, curd, chutney, soup
* Dishes where other ingredients are just seasoning/tadka/garnish: dal fry, jeera rice, cucumber raita
* Fried/baked single items: samosa, dosa, idli, roti, bread, pakora
* Beverages and supplements: lassi, coffee, smoothie, protein powder

GRAVY TYPE: for composite curry/gravy dishes, set gravyType to the most common preparation — "dry", "semi", or "gravy". null for non-curry composites (biryani, pasta, salads).

visibleComponents: always set to []. This field is only used for image-based analysis.

${MEAL_NAME_RULES_BLOCK}

QUANTITY & WEIGHT:
The user's description is the primary signal. If they specify a size or amount ("big bowl", "half a roti", "2 glasses"), use that exactly.
If no quantity stated, assume 1 standard serving.

displayQuantity: reflect the user's own words. If they said "big bowl", use "big bowl". If they said "2 rotis", use "2 rotis". NEVER use "serving" or "plate".

measureQuantity: convert to grams/ml using these references:
1 roti/chapati = 30g, 1 paratha = 60g, 1 puri = 25g, 1 samosa = 60g
1 idli = 40g, 1 dosa = 100g, 1 egg = 50g, 1 scoop protein = 30g, 1 slice bread = 30g

For volume-based items, set "density_class" and use that class's cells directly (do not multiply):
* medium_density (DEFAULT — liquids, curries, dal, soup, yogurt, raita, smoothie, biryani, rice/pasta dishes, cooked vegetables): small bowl = 150g, medium bowl = 250g, large bowl = 400g, 1 cup = 180g, 1 tbsp = 15g.
* snack_mix — namkeen, Madras mixture, sev, chivda, bhujia, chips, popcorn, trail mix: small bowl = 45g, medium bowl = 75g, large bowl = 120g, 1 cup = 72g.
* cereal_granola — granola, muesli: small bowl = 70g, medium bowl = 110g, large bowl = 180g, 1 cup = 110g.
* cereal_puffed — cornflakes, puffed rice/wheat, rice crispies: small bowl = 20g, medium bowl = 30g, large bowl = 50g, 1 cup = 30g.
* nuts_seeds — loose almonds, peanuts, cashews, mixed nuts, seeds. NOT nut bars or coated nuts: small bowl = 90g, medium bowl = 150g, large bowl = 240g, 1 cup = 145g.
* leafy_salad — mixed greens, lettuce, raw spinach, arugula: small bowl = 20g, medium bowl = 30g, large bowl = 50g, 1 cup = 30g.

Liquids: 1 glass = 250ml, 1 cup coffee/tea = 150ml
For branded/packaged items, use the product's standard weight.
MUST always have a numeric value — never null. Unit must be "g" for solids, "ml" for liquids. Never use "serving", "plate", "bowl", or any non-metric unit.

{
  "mealName": "Descriptive meal name",
  "items": [
    {
      "name": "Item name",
      "role": "main",
      "displayQuantity": { "value": 1, "unit": "cup" },
      "measureQuantity": { "value": 150, "unit": "g" },
      "density_class": "medium_density",
      "composite": false,
      "visibleComponents": [],
      "gravyType": null
    }
  ]
}

Return only valid JSON, no additional text.`;

    const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    const response = await result.response;
    const textResponse = response.text();
    const tokens = {
      input: result.response.usageMetadata?.promptTokenCount || null,
      output: result.response.usageMetadata?.candidatesTokenCount || null
    };

    console.log(`🤖 [QUICK-ADD-STEP1] Response received, length: ${textResponse?.length || 0}`);
    return { response: textResponse, tokens, provider: 'gemini', model: modelName };
  }

  /**
   * Enhanced Prompt 1 for V4: Adds itemType classification and category tagging
   */
  static async analyzeQuantityWithGeminiV4(imageUrl, hint) {
    // Quick Add: text-only, no image — use a minimal text-parsing prompt
    if (!imageUrl && hint) {
      return this.analyzeQuantityFromText(hint);
    }

    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI-V4-STEP1] Using model: ${modelName} for enhanced quantity analysis`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1 }
    });

    const sanitizedHint = hint ? sanitizeUserInput(hint) : null;

    const enhancedPrompt = `ROLE
Food identification and portion estimation specialist. Identify food items in a photo and estimate quantities. Do NOT calculate calories or macros.

INPUTS
1. Image: Meal photo in served state.
${sanitizedHint ? `2. User Hint: <user_input>${sanitizedHint}</user_input>` : ''}

${sanitizedHint ? `USER HINT PRIORITY
When a User Hint is provided, always prioritize it over visual evidence — even if the image appears to contradict it. The user knows what they ate.
Examples:
* User says "3 eggs" but image shows 2 visible → output 3 eggs.
* User says "oat milk latte" but image just shows a cup of coffee → output oat milk latte.
* User says "chicken biryani" but it visually looks like pulao → output chicken biryani.
` : ''}
ITEM IDENTIFICATION
Naming: Be specific when visually distinguishable (e.g., "jeera rice" not "rice", "sourdough bread" not "bread", "soba noodles" not "noodles"). Use general name when variant is unclear.

Composite dish detection:
WHY: Decomposition exists to surface protein in composed meals where the components have materially different macros (e.g., chicken vs. rice vs. ghee) AND the user benefits from seeing the split. If neither holds, decomposition adds noise and inflates calories. Default to atomic.

Set "composite": true ONLY when the dish has BOTH:
(a) a serving-sized protein portion — a piece, fillet, cube, scoop, or distinct mound of meat, fish, egg, paneer, or tofu (NOT fragments, scatter, or garnish), AND
(b) a separate base of carbs or greens — rice, noodles, bread, pasta, leafy greens.

Allowed composite patterns (this is the full list — anything outside it is atomic):
* Biryani-style mixed rice with meat or egg (chicken/mutton/prawn biryani, fried rice with chicken/egg)
* Plated meat/paneer/fish curry + rice or roti (chicken curry + rice, paneer butter masala + roti, fish curry + rice)
* Pasta with meat sauce (spaghetti bolognese, chicken alfredo)
* Salads with a protein portion (chicken caesar, grilled salmon salad, tuna salad)
* Grain or poke bowls with protein (poke bowl, burrito bowl, grain bowl)
* Wraps and burritos with composed filling (chicken burrito, shawarma wrap, kati roll)

ALWAYS atomic ("composite": false), regardless of visible heterogeneity:
* Snack-form / mixes: namkeen, Indian snack mixes (Madras mixture, chivda, bhujia, sev mixture), trail mix, Chex mix, granola, muesli, breakfast cereal, chips, crisps, crackers, popcorn
* Single-piece items: samosa, pakora, dosa, idli, vada, donut, muffin, cookie, brownie, cake slice, croissant, scone, pastry, roti, bread slice
* Fused / blended dishes: smoothie, juice, lassi, buttermilk, soup, sauce, dip, batter-based, dough-based
* Packaged / branded items: anything sold from a bag, box, or packet, or with a brand label — even if multiple textures or colors are visible. Label nutrition is more accurate than a per-component sum.
* Legume-led dishes: dal, sambar, rasam, chana masala, chickpea curry, rajma, hummus, chili, tofu scramble. These stay atomic even when the gravy looks meat-curry-like. If served alongside rice or bread, list the rice/bread as a separate atomic item — do NOT internally decompose the legume dish.
* Single food group dishes with seasoning only: jeera rice (rice + cumin), dal fry (lentils + tadka), cucumber raita (yogurt + garnish), curd, chutney, salan
* Items where "protein" is fragments, scatter, or garnish: peanuts in a snack mix, nuts on a salad, sesame on rice, bacon bits on soup, cheese sprinkle. Fragment-level protein never triggers decomposition.

Rule of thumb: if the dish is primarily ONE food group with spices/seasoning, OR if it's snack-form / single-piece / packaged / blended / legume-led, it is NOT composite — regardless of how many ingredients are visible.

For composite dishes only, add:
1. "visibleComponents" array — list what you can see or infer. Be specific about:
   * Type of protein (grilled chicken pieces, shredded chicken, paneer cubes, boiled egg)
   * Type of base (leafy greens, rice, noodles, bread)
   * Type of dressing/sauce (creamy white dressing, vinaigrette, mayo-based, curry gravy, tomato sauce)
   * Any other visible ingredients (cucumber, tomato, corn, beans, cheese, croutons, nuts)

2. "gravyType" — for curry/gravy-based composite dishes ONLY, classify as one of:
   * "dry" — NO liquid pooling on the plate or around the pieces. Meat/protein pieces are coated in dry masala but plate stays clean. (e.g., chicken bhuna, sukha chicken, dry fry, pepper chicken dry)
   * "semi" — SOME thick sauce visible between pieces but pieces are NOT submerged. Sauce clings to pieces but doesn't pool much. (e.g., kadhai paneer, chilli chicken)
   * "gravy" — pieces clearly SUBMERGED in liquid sauce. Sauce pools visibly in the bowl/plate. (e.g., butter chicken, chicken korma, rogan josh, dal makhani with paneer)
   * null — for non-curry composites (salads, biryani, pasta, wraps, bowls)
   When in doubt between dry and semi, look at the plate: if the plate is clean around the pieces → "dry". If sauce is visible between/around pieces → "semi".

For non-composite dishes, set "visibleComponents": [] and "gravyType": null.

Do not break down items served in separate vessels or clearly occupying distinct areas of the plate — list them independently without parentheses.

Packaged/branded items: Use brand and product name. Use package size as quantity (e.g., "Amul Greek Yogurt 100g cup", "Kind Protein Bar 1 bar"). Per the rules above, packaged items are ALWAYS "composite": false with "visibleComponents": [], even if multiple textures, colors, or pieces are visible in the bowl.

LIST EVERY VISIBLE FOOD ITEM. Scan the entire image systematically:
* Check all areas of the plate/bowl/table
* Include small items like condiments, garnishes, side items
* Include beverages if visible
* Include bread, rice, or other items in background or side plates
* Don't skip items just because they're small or partially visible

If no food is visible in the image (e.g., blurry, dark, empty plate, non-food photo), return { "items": [] }.

QUANTITY ESTIMATION
Size references:
* Standard dinner plate: ~26 cm diameter. Side/quarter plate: ~18 cm.
* Small bowl: ~150 ml. Medium bowl: ~250 ml. Large bowl: ~400 ml. Glass: ~250 ml.

Units by food type:
* Countable items (roti, bread slice, egg, taco, dumpling, idli, puri): count — 2 rotis, 3 slices
* Rice/grains/pasta: cups — 1 cup, 0.75 cup
* Egg dishes (omelette, scrambled, bhurji): estimate number of eggs first (1 egg = 50g). Output as "2 eggs", not "pieces" or generic grams.
* Soups/dal/curry/gravy/sauces: bowl size or tbsp — 1 small bowl, 3 tbsp
* Cooked vegetables: bowl size — 0.5 small bowl
* Protein (chicken, fish, paneer, tofu, meat): count + form — 3 boneless pieces, 2 bone-in pieces, 8 paneer cubes, 1 fillet, 2 whole eggs
* Beverages: glass or cup — 1 glass
* Fruits: count or cups — 1 banana, 0.5 cup grapes

Principles:
* Always count explicitly when items are individually distinguishable.
* For scoopable/pourable foods, estimate area coverage on plate and convert to cups or bowl size.
* If a bowl or plate is clearly not full, output a fractional quantity reflecting fill level (e.g., a half-full medium bowl is "0.5 medium bowl", not "1 medium bowl"). Only apply this when partial fill is visually obvious — do not invent fractions.
* When uncertain between two close quantities, choose the midpoint.

WEIGHT/VOLUME ESTIMATION

Set "density_class" on every item, then use the rule for that class.

* medium_density — DEFAULT for liquids, curries, dal, soup, yogurt, raita, oats cooked, sambar, rasam, smoothie, biryani, rice dishes, pasta dishes, cooked vegetables, and anything not listed below. Use these reference weights:
  - small bowl = 150g, medium bowl = 250g, large bowl = 400g, 1 cup = 180g, 1 tbsp = 15g.

Low-density classes (use the cells directly — do not multiply):
* snack_mix — namkeen, Madras mixture, sev, chivda, bhujia, Bombay mix, chips, popcorn, trail mix, puffed snacks. small bowl = 45g, medium bowl = 75g, large bowl = 120g, 1 cup = 72g.
* cereal_granola — granola, muesli, dense cereal clusters. small bowl = 70g, medium bowl = 110g, large bowl = 180g, 1 cup = 110g.
* cereal_puffed — cornflakes, puffed rice, puffed wheat, rice crispies, plain bran flakes. small bowl = 20g, medium bowl = 30g, large bowl = 50g, 1 cup = 30g.
* nuts_seeds — loose almonds, peanuts, cashews, mixed nuts, pumpkin seeds, sunflower seeds. NOT nut bars, NOT coated/sugared nuts (those are medium_density). small bowl = 90g, medium bowl = 150g, large bowl = 240g, 1 cup = 145g.
* leafy_salad — mixed greens, lettuce, raw spinach, arugula, leaf-only salads. small bowl = 20g, medium bowl = 30g, large bowl = 50g, 1 cup = 30g.

Dish-specific overrides (use these instead of the class rule when the dish matches):
* 1 cup cooked rice = 150g
* 1 cup cooked pasta = 140g
* 1 cup cooked vegetables = 150g
* 1 medium chicken breast (boneless) = 120g
* 1 medium egg = 50g
* 1 slice bread = 30g
* 1 roti/chapati = 30g
* 1 medium apple = 150g

When in doubt between two classes, prefer the lower-density one (under-estimating is less harmful than the current 2–4× over-estimate).

For bone-in items, estimate total weight including bone.

For composite dishes, estimate total weight of the entire dish as served.

MEASURE UNIT: Use "g" (grams) for solid foods. Use "ml" (milliliters) for beverages, liquid soups, juices, milk, lassi, buttermilk, smoothies, coffee, tea, and oils. Reference volumes for ml: 1 glass = 250ml, 1 cup = 240ml, 1 small cup (chai) = 150ml, 1 tbsp = 15ml.

PORTION SIZE CALIBRATION: Photos often make portions appear larger than they are. Apply these conservative estimates:
* Single protein serving: 80-120g (not 200-300g)
* Single rice/grain serving: 100-150g (not 300-500g)
* Vegetable side: 50-100g (not 200-400g)
* Gravy/sauce: 50-100g (not 200-300g)
* Full single-person meal: typically 250-400g total

When estimating, start from the lower end of typical ranges unless the portion clearly appears oversized.

${MEAL_NAME_RULES_BLOCK}

OUTPUT
Return ONLY raw JSON. No markdown, no explanation.

{
  "mealName": "Overall meal name",
  "items": [
    {
      "name": "Item name",
      "role": "main",
      "displayQuantity": { "value": 1, "unit": "cup" },
      "measureQuantity": { "value": 150, "unit": "g" },
      "density_class": "medium_density",
      "composite": false,
      "visibleComponents": [],
      "gravyType": null
    }
  ]
}

density_class: one of "medium_density", "snack_mix", "cereal_granola", "cereal_puffed", "nuts_seeds", "leafy_salad". See WEIGHT/VOLUME ESTIMATION above.
visibleComponents: only for composite items. List visible/inferable ingredients. Empty array for non-composite items.
gravyType: "dry", "semi", or "gravy" for curry-based composites. null for everything else.

displayQuantity: user-friendly quantity. MUST use one of these unit types:
* Countable items: "rotis", "slices", "eggs", "pieces", "idlis", "puris", "tacos", "dumplings"
* Volume: "cup", "small bowl", "medium bowl", "large bowl", "tbsp", "glass"
* Descriptive: "boneless pieces", "bone-in pieces", "cubes", "fillet"
NEVER use "serving" or "plate" as unit. Always pick a specific, meaningful unit from above.

measureQuantity: actual weight or volume for nutrition calculation.
* unit must be "g" for solids or "ml" for liquids/beverages.

EXAMPLE

{
  "mealName": "Chicken Biryani & Bhuna",
  "items": [
    { "name": "Chicken Biryani", "role": "main", "displayQuantity": { "value": 1, "unit": "medium bowl" }, "measureQuantity": { "value": 300, "unit": "g" }, "density_class": "medium_density", "composite": true, "visibleComponents": ["basmati rice", "bone-in chicken pieces", "fried onions", "ghee", "whole spices"], "gravyType": null },
    { "name": "Chicken Bhuna", "role": "main", "displayQuantity": { "value": 1, "unit": "small bowl" }, "measureQuantity": { "value": 200, "unit": "g" }, "density_class": "medium_density", "composite": true, "visibleComponents": ["bone-in chicken pieces", "thick dry masala coating", "onions"], "gravyType": "dry" },
    { "name": "Dal", "role": "main", "displayQuantity": { "value": 1, "unit": "small bowl" }, "measureQuantity": { "value": 150, "unit": "g" }, "density_class": "medium_density", "composite": false, "visibleComponents": [], "gravyType": null },
    { "name": "Roti", "role": "main", "displayQuantity": { "value": 2, "unit": "rotis" }, "measureQuantity": { "value": 60, "unit": "g" }, "density_class": "medium_density", "composite": false, "visibleComponents": [], "gravyType": null },
    { "name": "Buttermilk", "role": "side", "displayQuantity": { "value": 1, "unit": "glass" }, "measureQuantity": { "value": 250, "unit": "ml" }, "density_class": "medium_density", "composite": false, "visibleComponents": [], "gravyType": null }
  ]
}

Return only valid JSON, no additional text.`;

    const parts = [{ text: enhancedPrompt }];
    if (imageUrl) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: await this.fetchImageAsBase64(imageUrl) } });
    }

    const result = await model.generateContent(parts);
    const response = await result.response;
    const textResponse = response.text();
    const tokens = {
      input: result.response.usageMetadata?.promptTokenCount || null,
      output: result.response.usageMetadata?.candidatesTokenCount || null
    };

    return { response: textResponse, tokens, provider: 'gemini', model: modelName };
  }

  static async analyzeFoodCaloriesV4(imageUrl, hint, provider = 'gemini', userId = null, additionalData = {}) {
    try {
      const pipelineStart = Date.now();
      console.log(`🤖 [V4] ─── Starting V4 pipeline (DB-first with per-item waterfall) ───`);
      console.log(`🤖 [V4] Input: imageUrl=${imageUrl ? 'yes' : 'no'}, hint=${hint ? `"${hint.substring(0, 80)}"` : 'no'}`);

      // Idempotency short-circuit: if client provided pendingMealId and we've
      // already persisted an ACTIVE meal for (userId, pendingMealId), return
      // it without re-running Gemini. Soft-deleted meals are intentionally
      // excluded so a user who deletes a meal and retries with the same id
      // can re-analyze fresh.
      const pendingMealId = additionalData.pendingMealId || null;
      if (userId && pendingMealId) {
        const existing = await Meal.findOne({ userId, pendingMealId, deletedAt: null });
        if (existing) {
          console.log(`🤖 [V4] Idempotent hit — pendingMealId=${pendingMealId} already saved as ${existing._id}, skipping Gemini`);
          return {
            mealId: existing._id,
            provider,
            idempotent: true
          };
        }
      }

      // Step 1: Enhanced Prompt 1 - Meal identification + itemType classification
      const step1Start = Date.now();
      console.log(`🤖 [V4] Step 1: Enhanced Prompt 1 (with itemType classification)`);
      const quantityRaw = await this.analyzeQuantityWithGeminiV4(imageUrl, hint);
      const quantityParsed = this.parseAIResult(quantityRaw.response);

      // Sanitize the meal title before Step 2 decomposition strips role from composite items.
      const originalTitle = quantityParsed.mealName;
      quantityParsed.mealName = this.sanitizeMealTitle(originalTitle, quantityParsed.items);
      if (originalTitle !== quantityParsed.mealName) {
        console.log(`🤖 [V4] Meal title rebuilt from items: "${originalTitle}" → "${quantityParsed.mealName}"`);
      }

      const step1Ms = Date.now() - step1Start;
      console.log(`🤖 [V4] Step 1 complete — ${quantityParsed.items.length} items identified, mealName="${quantityParsed.mealName}" [${step1Ms}ms]`);

      quantityParsed.items.forEach((item, i) => {
        const composite = item.composite ? 'composite' : 'single';
        const measure = item.measureQuantity ? `${item.measureQuantity.value}${item.measureQuantity.unit}` : 'N/A';
        const display = item.displayQuantity ? `${item.displayQuantity.value} ${item.displayQuantity.unit}` : 'N/A';
        console.log(`🤖 [V4]   item[${i}]: "${item.name}" | ${composite} | measure=${measure} | display=${display}`);
      });

      // Step 2: Per-item nutrition lookup with waterfall (USDA → IFCT → LLM cache → LLM)
      const step2Start = Date.now();
      console.log(`🤖 [V4] Step 2: Per-item waterfall lookup (USDA → IFCT → cache → LLM)`);
      const NutritionLookupServiceV4 = require('./nutritionLookupServiceV4');
      const nutritionResult = await NutritionLookupServiceV4.calculateNutrition(quantityParsed.items);
      const step2Ms = Date.now() - step2Start;

      console.log(`🤖 [V4] Step 2 complete — ${nutritionResult.items.length} items processed [${step2Ms}ms]`);
      console.log(`🤖 [V4] Source breakdown: USDA=${nutritionResult.sourceBreakdown.usda}, IFCT=${nutritionResult.sourceBreakdown.ifct}, cached=${nutritionResult.sourceBreakdown.llm_cached}, fresh=${nutritionResult.sourceBreakdown.llm_fresh}, recipe=${nutritionResult.sourceBreakdown.recipe}`);

      nutritionResult.items.forEach((item, i) => {
        const source = item.nutritionSource || 'unknown';
        const cal = item.nutrition?.calories || 0;
        console.log(`🤖 [V4]   result[${i}]: "${item.name}" | source=${source} | cal=${cal}`);
      });

      // Collect all token usage
      const step2Tokens = nutritionResult.tokenUsage || { decomposition: { input: 0, output: 0 }, batchNutrition: { input: 0, output: 0 } };
      const allTokens = {
        step1: quantityRaw.tokens,
        decomposition: step2Tokens.decomposition,
        batchNutrition: step2Tokens.batchNutrition,
        total: {
          input: (quantityRaw.tokens.input || 0) + step2Tokens.decomposition.input + step2Tokens.batchNutrition.input,
          output: (quantityRaw.tokens.output || 0) + step2Tokens.decomposition.output + step2Tokens.batchNutrition.output
        }
      };

      // Save meal with enhanced tracking
      let savedMeal = null;
      if (userId) {
        try {
          const imageReference = imageUrl || (hint ? `text: ${hint}` : null);
          console.log(`🤖 [V4] Saving meal for userId=${userId} with source tracking`);
          savedMeal = await this.saveMealDataForV4(
            userId,
            imageReference,
            {
              mealName: quantityParsed.mealName,
              items: nutritionResult.items,
              totalNutrition: nutritionResult.totalNutrition
            },
            additionalData,
            allTokens
          );
          console.log(`🤖 [V4] Meal saved: mealId=${savedMeal?._id}`);
        } catch (saveErr) {
          console.error(`⚠️ [V4] Failed to save meal (non-fatal): ${saveErr.message}`);
          // Continue anyway - return results even if save failed
        }
      }

      const coverage = nutritionResult.coverage;
      const totalMs = Date.now() - pipelineStart;
      console.log(`🤖 [V4] Coverage: ${coverage.fromDatabase}/${coverage.total} from DB (${Math.round(coverage.fromDatabase / coverage.total * 100)}%)`);
      console.log(`🤖 [V4] Tokens: step1=${allTokens.step1.input}+${allTokens.step1.output} | decomp=${allTokens.decomposition.input}+${allTokens.decomposition.output} | batch=${allTokens.batchNutrition.input}+${allTokens.batchNutrition.output} | total=${allTokens.total.input}+${allTokens.total.output}`);
      console.log(`🤖 [V4] ─── V4 pipeline complete ─── [Total: ${totalMs}ms | Step1: ${step1Ms}ms | Step2: ${step2Ms}ms]`);

      return {
        calories: {
          mealName: quantityParsed.mealName,
          items: nutritionResult.items,
          totalNutrition: nutritionResult.totalNutrition
        },
        provider,
        mealId: savedMeal ? savedMeal._id : null,
        quantityResult: quantityParsed,
        sourceBreakdown: nutritionResult.sourceBreakdown,
        coverage: nutritionResult.coverage,
        tokens: allTokens
      };
    } catch (error) {
      console.error(`❌ [V4] Pipeline failed: ${error.message}`);
      throw new Error(`Failed to analyze food (V4): ${error.message}`);
    }
  }

  static async analyzeFoodItemWithOpenAI(itemName, currentMealName, previousItemName, originalUnit) {
    const startTime = Date.now();
    const modelName = 'gpt-4o';
    
    const systemPrompt = 'You are a nutrition expert. Provide nutrition information for food items and suggest updated meal names.';
    const userPrompt = `A user is updating a meal item. Please provide nutrition information for the new item and suggest an updated meal name.

Current meal name: "${currentMealName}"
Previous item name: "${previousItemName}"
New item name: "${itemName}"
Original quantity unit: "${originalUnit}"

Return JSON with this structure:
{
  "name": "${itemName}",
  "quantity": {
    "value": 1,
    "unit": "${originalUnit}"
  },
  "nutrition": {
    "calories": 150,
    "protein": 10,
    "carbs": 20,
    "fat": 5
  },
  "updatedMealName": "Updated meal name reflecting the change"
}

Guidelines:
1. Provide realistic nutrition values for a typical serving of ${itemName} using the unit "${originalUnit}"
2. For the updatedMealName, consider how replacing "${previousItemName}" with "${itemName}" would change the overall meal description
3. Keep the meal name concise but descriptive
4. If the change is minor, you can keep the same meal name
5. Focus on the most significant change in the meal
6. ALWAYS use the original unit "${originalUnit}" in the quantity field

Examples:
- If changing "White Rice" to "Brown Rice" in "Chicken and Rice Bowl" → "Chicken and Brown Rice Bowl"
- If changing "Apple" to "Banana" in "Fruit Salad" → "Fruit Salad with Banana"
- If changing "Chicken Breast" to "Salmon" in "Grilled Chicken Salad" → "Grilled Salmon Salad"

Return only valid JSON, no additional text.`;

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    
    const latencyMs = Date.now() - startTime;
    const responseText = completion.choices[0].message.content;
    
    // Return with audit data
    return {
      response: responseText,
      auditData: {
        provider: 'openai',
        model: modelName,
        promptSent: `[System]: ${systemPrompt}\n\n[User]: ${userPrompt}`,
        rawResponse: responseText,
        tokensUsed: {
          input: completion.usage?.prompt_tokens || null,
          output: completion.usage?.completion_tokens || null,
          total: completion.usage?.total_tokens || null
        },
        latencyMs
      }
    };
  }

  static async analyzeFoodItemWithGemini(itemName, currentMealName, previousItemName, originalUnit) {
    const startTime = Date.now();
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI] Using model: ${modelName} for item analysis`);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.1
      }
    });
    
    // Build prompt based on whether this is a new item or replacement
    const isNewItem = !previousItemName || previousItemName === 'null' || previousItemName === '';
    const prompt = isNewItem 
      ? `A user is adding a new item to a meal. Please provide nutrition information for the item and suggest an updated meal name if appropriate.

Current meal name: "${currentMealName}"
New item name (that is being added): "${itemName}"
Original quantity unit: "${originalUnit}"

Return JSON with this structure:
{
  "name": "${itemName}",
  "quantity": {
    "value": 1,
    "unit": "${originalUnit}"
  },
  "nutrition": {
    "calories": 150,
    "protein": 10,
    "carbs": 20,
    "fat": 5
  },
  "updatedMealName": "Updated meal name that includes the new item (if the meal name should change), otherwise keep the same meal name"
}

Guidelines:
1. Provide realistic nutrition values for a typical serving of ${itemName} using the unit "${originalUnit}"
2. For the updatedMealName, consider how adding "${itemName}" to "${currentMealName}" would change the overall meal description
3. Keep the meal name concise but descriptive
4. If adding the item doesn't significantly change the meal, you can keep the same meal name
5. ALWAYS use the original unit "${originalUnit}" in the quantity field

Examples:
- Adding "Brown Rice" to "Chicken Bowl" → "Chicken and Brown Rice Bowl"
- Adding "Banana" to "Fruit Salad" → "Fruit Salad with Banana"
- Adding "Salad" to "Grilled Chicken" → "Grilled Chicken Salad"

Return only valid JSON, no additional text.`
      : `A user is updating a meal item. Please provide nutrition information for the new item and suggest an updated meal name.

Current meal name: "${currentMealName}"
Previous item name (that is being replaced): "${previousItemName}"
New item name (that is being added): "${itemName}"
Original quantity unit: "${originalUnit}"

Return JSON with this structure:
{
  "name": "${itemName}",
  "quantity": {
    "value": 1,
    "unit": "${originalUnit}"
  },
  "nutrition": {
    "calories": 150,
    "protein": 10,
    "carbs": 20,
    "fat": 5
  },
  "updatedMealName": "Updated meal name reflecting the change, remove the previous item name and add the new item name appropriately (if needed)"
}

Guidelines:
1. Provide realistic nutrition values for a typical serving of ${itemName} using the unit "${originalUnit}"
2. For the updatedMealName, consider how replacing "${previousItemName}" with "${itemName}" would change the overall meal description
3. Keep the meal name concise but descriptive
4. If the change is minor, you can keep the same meal name
5. Focus on the most significant change in the meal
6. ALWAYS use the original unit "${originalUnit}" in the quantity field

Examples:
- If changing "White Rice" to "Brown Rice" in "Chicken and Rice Bowl" → "Chicken and Brown Rice Bowl"
- If changing "Apple" to "Banana" in "Fruit Salad" → "Fruit Salad with Banana"
- If changing "Chicken Breast" to "Salmon" in "Grilled Chicken Salad" → "Grilled Salmon Salad"

Return only valid JSON, no additional text.`;

    try {
      console.log(`🤖 [GEMINI] Sending item analysis request`);
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ]
      });
      
      const latencyMs = Date.now() - startTime;
      const responseText = result.response.text();
      console.log(`🤖 [GEMINI] Item analysis response received, length: ${responseText?.length || 0}`);
      
      if (!responseText || responseText.trim() === '') {
        console.error('❌ [GEMINI] Empty response received for item analysis');
        throw new Error('Empty response from Gemini API');
      }
      
      // Extract token usage from Gemini response
      const usageMetadata = result.response.usageMetadata;
      
      // Return with audit data
      return {
        response: responseText,
        auditData: {
          provider: 'gemini',
          model: modelName,
          promptSent: prompt,
          rawResponse: responseText,
          tokensUsed: {
            input: usageMetadata?.promptTokenCount || null,
            output: usageMetadata?.candidatesTokenCount || null,
            total: usageMetadata?.totalTokenCount || null
          },
          latencyMs
        }
      };
    } catch (error) {
      console.error('❌ [GEMINI] API Error for item analysis:', error.message);
      console.error('❌ [GEMINI] Full error:', error);
      throw error;
    }
  }

  static async analyzeFoodItem(itemName, currentMealName, previousItemName, originalUnit, provider = 'gemini') {
    try {
      let result;
      
      if (provider === 'gemini') {
        result = await this.analyzeFoodItemWithGemini(itemName, currentMealName, previousItemName, originalUnit);
      } else {
        result = await this.analyzeFoodItemWithOpenAI(itemName, currentMealName, previousItemName, originalUnit);
      }
      
      // Return both the response text and audit data
      return {
        response: result.response,
        auditData: result.auditData
      };
    } catch (error) {
      throw new Error(`Failed to analyze food item: ${error.message}`);
    }
  }

  static async saveMealDataForV4(userId, imageUrl, nutritionResult, additionalData = {}, tokens = {}) {
    try {
      const mealItems = nutritionResult.items.map((item, index) => {
        const nut = item.nutrition || {};
        const dq = item.displayQuantity || {};
        const mq = item.measureQuantity || {};
        const dqValue = dq.value || 1;
        const dqUnit = dq.unit || 'piece';
        const mqValue = item.grams || mq.value || null;
        const mqUnit = mq.unit || 'g';
        // Mirror llm → final at save time. Readers across the codebase already
        // fall back final → llm (see mealFormatter.formatItem), so this is
        // backwards-compatible. Populating final enables Meal.items[] to feed
        // the servingSizes refinement cron without the ~98% coverage gap that
        // the "final=null until user edits" convention caused.
        return {
          id: `item_${Date.now()}_${index}`,
          name: { llm: item.name, final: item.name },
          displayQuantity: {
            llm: { value: dqValue, unit: dqUnit },
            final: { value: dqValue, unit: dqUnit }
          },
          measureQuantity: {
            llm: { value: mqValue, unit: mqUnit },
            final: { value: mqValue, unit: mqUnit }
          },
          nutrition: {
            calories: { llm: nut.calories || 0, final: nut.calories || 0 },
            protein: { llm: nut.protein || 0, final: nut.protein || 0 },
            carbs: { llm: nut.carbs || 0, final: nut.carbs || 0 },
            fat: { llm: nut.fat || 0, final: nut.fat || 0 }
          },
          confidence: item.confidence || null,
          nutritionSource: item.nutritionSource || 'llm_fresh',
          foodItemId: item.foodItemId || null,
          recipeId: item.recipeId || null,
          dataSourcePriority: this.getDataSourcePriority(item.nutritionSource),
          parentDish: item.parentDish || null,
          componentType: item.componentType || null,
          proteinForm: item.proteinForm || null
        };
      });

      const photos = [];
      if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        photos.push({
          url: imageUrl,
          width: additionalData.width || null,
          height: additionalData.height || null
        });
      }

      const dateUtils = require('../utils/dateUtils');
      const mealData = {
        userId,
        capturedAt: additionalData.capturedAt ? new Date(additionalData.capturedAt) : dateUtils.getCurrentDateInIST(),
        photos,
        llmVersion: '4.0',
        llmModel: 'gemini-2.5-flash',
        name: nutritionResult.mealName,
        totalNutrition: {
          calories: { llm: nutritionResult.totalNutrition.calories, final: nutritionResult.totalNutrition.calories },
          protein: { llm: nutritionResult.totalNutrition.protein, final: nutritionResult.totalNutrition.protein },
          carbs: { llm: nutritionResult.totalNutrition.carbs, final: nutritionResult.totalNutrition.carbs },
          fat: { llm: nutritionResult.totalNutrition.fat, final: nutritionResult.totalNutrition.fat }
        },
        items: mealItems,
        notes: additionalData.notes || `AI Analysis (V4 DB-first): ${nutritionResult.mealName}`,
        userApproved: false,
        pendingMealId: additionalData.pendingMealId || null,
        tokens: {
          step1: { input: tokens.step1?.input || null, output: tokens.step1?.output || null },
          decomposition: { input: tokens.decomposition?.input || null, output: tokens.decomposition?.output || null },
          batchNutrition: { input: tokens.batchNutrition?.input || null, output: tokens.batchNutrition?.output || null },
          total: { input: tokens.total?.input || null, output: tokens.total?.output || null }
        }
      };

      const meal = new Meal(mealData);
      try {
        return await meal.save();
      } catch (err) {
        // Race: another concurrent analyze for the same (userId, pendingMealId)
        // won the insert between our findOne check and this save. The partial
        // unique index rejected us with E11000. Return the winning row so the
        // client sees a successful idempotent response instead of a 500.
        if (err && err.code === 11000 && mealData.pendingMealId && mealData.userId) {
          const winner = await Meal.findOne({
            userId: mealData.userId,
            pendingMealId: mealData.pendingMealId,
            deletedAt: null
          });
          if (winner) {
            console.log(`🤖 [V4] E11000 race recovered — returning winning mealId=${winner._id} for pendingMealId=${mealData.pendingMealId}`);
            return winner;
          }
        }
        throw err;
      }
    } catch (error) {
      console.error('Failed to save meal data (V4):', error);
      throw new Error(`Failed to save meal data (V4): ${error.message}`);
    }
  }

  static getDataSourcePriority(source) {
    const priorities = {
      'usda': 1,
      'ifct': 2,
      'llm_cached': 3,
      'llm_fresh': 4,
      'recipe': 1
    };
    return priorities[source] || 99;
  }

  static parseAIResult(aiResult) {
    try {
      // Clean markdown code blocks if present
      let cleanResult = aiResult;
      if (aiResult.includes('```json')) {
        cleanResult = aiResult.split('```json')[1].split('```')[0].trim();
      } else if (aiResult.includes('```')) {
        cleanResult = aiResult.split('```')[1].split('```')[0].trim();
      }
      
      console.log('🤖 [AI] Cleaned AI result for parsing:', JSON.stringify(cleanResult));
      
      // Try to parse as JSON first
      const parsed = JSON.parse(cleanResult);
      
      // Validate required fields
      if (!parsed.mealName || !parsed.items || !Array.isArray(parsed.items)) {
        throw new Error('Invalid JSON structure: missing mealName or items array');
      }
      
      return parsed;
    } catch (error) {
      console.error('Failed to parse AI result as JSON:', error);
      console.log('Raw AI result:', aiResult);
      
      // Fallback to old parsing method for backward compatibility
      const calories = this.extractCaloriesFromAIResult(aiResult);
      return {
        mealName: 'Unknown Meal',
        items: [{
          name: 'Unknown Item',
          displayQuantity: { value: 1, unit: 'piece' },
          measureQuantity: { value: 100, unit: 'g' },
          nutrition: {
            calories: calories || 0,
            protein: 0,
            carbs: 0,
            fat: 0
          },
          confidence: null
        }]
      };
    }
  }

  static calculateTotalNutrition(items) {
    return items.reduce((total, item) => {
      return {
        calories: parseFloat(((total.calories || 0) + (item.nutrition.calories || 0)).toFixed(2)),
        protein: parseFloat(((total.protein || 0) + (item.nutrition.protein || 0)).toFixed(2)),
        carbs: parseFloat(((total.carbs || 0) + (item.nutrition.carbs || 0)).toFixed(2)),
        fat: parseFloat(((total.fat || 0) + (item.nutrition.fat || 0)).toFixed(2))
      };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  static extractCaloriesFromAIResult(aiResult) {
    // Simple regex to extract calories from AI response
    // This can be enhanced based on your specific AI response format
    const calorieMatch = aiResult.match(/(\d+(?:\.\d+)?)\s*calories?/i);
    return calorieMatch ? parseFloat(calorieMatch[1]) : null;
  }

  static async batchUpdateFoodItems(items, currentMealName, shouldUpdateMealName, mainItemInfo) {
    const startTime = Date.now();
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI] Using model: ${modelName} for batch item update`);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.1
      }
    });

    const itemDescriptions = items.map((item, index) => 
      `${index + 1}. ${item.originalName} → ${item.newName} | ${item.newQuantity} ${item.unit} | Main: ${item.isMainItem ? 'Yes' : 'No'}`
    ).join('\n');

    const mealNameInstruction = shouldUpdateMealName
      ? `Update meal name (main changed: ${mainItemInfo.originalName} → ${mainItemInfo.newName})`
      : `Keep meal name: "${currentMealName}"`;

    const prompt = `You are a world-class nutritionist and an expert in identifying food items, especially from diverse cuisines like Indian meals.

Meal: "${currentMealName}"

Updated items:
${itemDescriptions}

Action: ${mealNameInstruction}

Return JSON with this structure:
{
  "items": [
    {
      "name": "item name",
      "quantity": {"value": 1, "unit": "unit"},
      "nutrition": {"calories": 150, "protein": 10, "carbs": 20, "fat": 5}
    }
  ],
  "mealName": "updated or unchanged meal name",
  "mealNameChanged": true/false
}

Guidelines:
• Provide nutrition for EXACT quantity specified
• Main items: proteins/primary carbs (paneer, chicken, rice, roti)
• Minor items: sides/condiments (raita, salad, chutney)
• Keep meal names concise (max 4-5 words). Use actual food items — never generic labels like "Indian meal", "Lunch plate", "Healthy bowl", or any cuisine/mealtype name. If one main dominates, use just that ("Chicken Biryani"); otherwise join 1-2 mains with "&" ("Chicken Curry & Roti").
• If main item changed: update meal name
• If only minor items changed: keep original name

Return only valid JSON, no additional text.`;

    try {
      console.log(`🤖 [GEMINI] Sending batch update request`);
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ]
      });
      
      const latencyMs = Date.now() - startTime;
      const responseText = result.response.text();
      console.log(`🤖 [GEMINI] Batch update response received, length: ${responseText?.length || 0}`);
      
      if (!responseText || responseText.trim() === '') {
        console.error('❌ [GEMINI] Empty response received for batch update');
        throw new Error('Empty response from Gemini API');
      }

      // Clean markdown code blocks if present
      let cleanResponse = responseText;
      const hadMarkdown = responseText.includes('```json') || responseText.includes('```');
      if (responseText.includes('```json')) {
        console.log('📝 [GEMINI] Detected markdown code block (```json), cleaning...');
        cleanResponse = responseText.split('```json')[1].split('```')[0].trim();
        console.log(`📝 [GEMINI] Cleaned response length: ${cleanResponse.length}, original: ${responseText.length}`);
      } else if (responseText.includes('```')) {
        console.log('📝 [GEMINI] Detected markdown code block (```), cleaning...');
        cleanResponse = responseText.split('```')[1].split('```')[0].trim();
        console.log(`📝 [GEMINI] Cleaned response length: ${cleanResponse.length}, original: ${responseText.length}`);
      } else {
        console.log('📝 [GEMINI] No markdown code blocks detected, using response as-is');
      }

      // Log first 200 chars of cleaned response for debugging
      console.log(`📝 [GEMINI] Cleaned response preview: ${cleanResponse.substring(0, 200)}${cleanResponse.length > 200 ? '...' : ''}`);

      // Parse JSON response
      let parsedResult;
      try {
        parsedResult = JSON.parse(cleanResponse);
        console.log('✅ [GEMINI] Successfully parsed JSON response:', {
          itemsCount: parsedResult?.items?.length || 0,
          mealName: parsedResult?.mealName,
          mealNameChanged: parsedResult?.mealNameChanged
        });
      } catch (parseError) {
        console.error('❌ [GEMINI] JSON parse error:', {
          error: parseError.message,
          hadMarkdown,
          responseLength: cleanResponse.length,
          responsePreview: cleanResponse.substring(0, 500)
        });
        throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
      }
      
      // Extract token usage from Gemini response
      const usageMetadata = result.response.usageMetadata;

      return {
        ...parsedResult,
        auditData: {
          provider: 'gemini',
          model: modelName,
          promptSent: prompt,
          rawResponse: responseText,
          parsedResponse: parsedResult,
          tokensUsed: {
            input: usageMetadata?.promptTokenCount || null,
            output: usageMetadata?.candidatesTokenCount || null,
            total: usageMetadata?.totalTokenCount || null
          },
          latencyMs
        }
      };
    } catch (error) {
      console.error('❌ [GEMINI] API Error for batch update:', error.message);
      console.error('❌ [GEMINI] Full error:', error);
      throw error;
    }
  }
}

module.exports = AiService; 
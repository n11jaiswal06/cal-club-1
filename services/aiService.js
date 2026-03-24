const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Meal = require('../models/schemas/Meal');
//test
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

class AiService {
  static async fetchImageAsBase64(url) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      https.get(url, (resp) => {
        let data = [];
        resp.on('data', (chunk) => data.push(chunk));
        resp.on('end', () => {
          const buffer = Buffer.concat(data);
          resolve(buffer.toString('base64'));
        });
      }).on('error', reject);
    });
  }

  static async analyzeFoodWithOpenAI(imageUrl, hint) {
    // Build prompt based on what's available
    let promptText = '';

    // Adjust prompt based on available inputs
    if (imageUrl && hint) {
      // IMAGE + TEXT CASE
      promptText = `### ROLE
You are an expert AI Nutritionist and Computer Vision Analyst. Your goal is to analyze food images with high precision to assist in dietary tracking.

### INPUT DATA
1. *Image:* Photo of a meal (served state).
2. *User Hint:* "${hint}"

### INSTRUCTIONS

1. *Visual Analysis & Scale Calibration:*
   * *Identify Anchors:* Scan the image for "intrinsic" reference objects to determine physical scale. Look for standard cutlery (forks ~20cm), glassware, or standard dinner plates (25-28cm). Use these to estimate the actual volume of the food.
   * *Texture Analysis:* Analyze surface texture and glossiness. High sheen indicates added oils/butters/glazes. You must account for these "hidden calories" in your macro estimation.

2. *Item Identification & Context Integration:*
   * *Identify All Items:* Segment the image and identify every distinct food item visible on the plate.
   * *Context Usage:* Use the *User Hint* to resolve specific ambiguities (e.g., "made with oat milk" vs "cow milk").
   * *Conflict Resolution:* If the User Hint contradicts strong visual evidence (e.g., User says "Salad" but image shows "Pizza"), *prioritize the Visual Evidence* for identification to prevent false tracking.

3. *Scientific Calculation (Cooked vs. Raw):*
   * *State Detection:* Assume items are in their *COOKED/SERVED* state unless obviously raw (like fruit).
   * *Database Matching:* Match estimated volumes to *Cooked* database values (e.g., "Steamed Rice", not "Raw Rice").
   * *Yield Logic:* If a cooked value is unavailable, estimate the raw weight by applying standard cooking yield factors (e.g., meat shrinks by ~25%, rice expands by ~3x) before calculating macros.

4. *Quantification (User-Friendly):*
   * Estimate portion sizes using volume-based, user-friendly terms.
   * Preferred Units: Cups, tablespoons, slices, pieces, "fist-sized", "palm-sized".
   * Avoid giving specific gram weights unless the user provided them, as visual weight estimation is prone to error.

### OUTPUT FORMAT
Return ONLY a raw JSON object with this exact structure:

{
  "mealName": "Overall meal name (e.g., 'Dal & Rice', 'Grilled Chicken Breast')",
  "items": [
    {
      "name": "Item Name (e.g., Grilled Chicken Breast)",
      "quantity": {
        "value": 1,
        "unit": "palm-sized piece/cups/slices/pieces/etc"
      },
      "nutrition": {
        "calories": 0,
        "protein": 0,
        "carbs": 0,
        "fat": 0
      },
      "confidence": 0.0-1.0
    }
  ]
}

Return only valid JSON, no additional text.`;
    } else if (hint && !imageUrl) {
      // TEXT ONLY CASE
      promptText = `### ROLE
You are an expert AI Nutritionist and Database Specialist. Your goal is to parse natural language food logs into structured nutritional data.

### INPUT DATA
User text string: "${hint}"

### INSTRUCTIONS

1. *Entity & Quantity Extraction:*
   * Parse the text to identify the *Food Item* and the *Quantity/Unit*.
   * Default Logic: If quantity is unspecified (e.g., "an apple"), assume *1 Standard Serving* (e.g., 1 Medium Apple).

2. *Brand vs. Generic Logic:*
   * *Explicit Brand:* If the user names a brand (e.g., "The Whole Truth," "MyProtein," "McDonald's"), you MUST prioritize searching your internal knowledge base for that specific brand's nutritional values.
     * Note on Scoops: Brand-specific scoops vary (e.g., one scoop might be 30g, another 45g). Use the specific brand's standard serving size.
   * *Generic:* If no brand is mentioned (e.g., "one apple," "boiled egg"), use standard USDA-equivalent averages for a *Medium* size.

3. *Macro Calculation:*
   * Calculate Calories, Protein, Carbs, and Fats based on the extracted quantity.
   * Sum up the total meal values.

### OUTPUT FORMAT
Return ONLY a raw JSON object with this exact structure:

{
  "mealName": "Overall meal name (e.g., 'The Whole Truth Protein Shake', 'Banana and Eggs')",
  "items": [
    {
      "name": "Item Name (e.g., The Whole Truth Protein - Chocolate)",
      "quantity": {
        "value": 1,
        "unit": "Scoop/piece/cup/serving/etc"
      },
      "nutrition": {
        "calories": 0,
        "protein": 0,
        "carbs": 0,
        "fat": 0
      },
      "confidence": 0.0-1.0
    }
  ]
}

Return only valid JSON, no additional text.`;
    } else {
      // IMAGE ONLY CASE (default)
      promptText = `### ROLE
You are an expert AI Nutritionist and Computer Vision Analyst. Your goal is to analyze food images with high precision to assist in dietary tracking.

### INPUT DATA
*Image:* Photo of a meal (served state).

### INSTRUCTIONS

1. *Visual Analysis & Scale Calibration:*
   * *Identify Anchors:* Scan the image for "intrinsic" reference objects to determine physical scale. Look for standard cutlery (forks ~20cm), glassware, or standard dinner plates (25-28cm). Use these to estimate the actual volume of the food.
   * *Texture Analysis:* Analyze surface texture and glossiness. High sheen indicates added oils/butters/glazes. You must account for these "hidden calories" in your macro estimation.

2. *Item Identification:*
   * *Identify All Items:* Segment the image and identify every distinct food item visible on the plate.

3. *Scientific Calculation (Cooked vs. Raw):*
   * *State Detection:* Assume items are in their *COOKED/SERVED* state unless obviously raw (like fruit).
   * *Database Matching:* Match estimated volumes to *Cooked* database values (e.g., "Steamed Rice", not "Raw Rice").
   * *Yield Logic:* If a cooked value is unavailable, estimate the raw weight by applying standard cooking yield factors (e.g., meat shrinks by ~25%, rice expands by ~3x) before calculating macros.

4. *Quantification (User-Friendly):*
   * Estimate portion sizes using volume-based, user-friendly terms.
   * Preferred Units: Cups, tablespoons, slices, pieces, "fist-sized", "palm-sized".
   * Avoid giving specific gram weights as visual weight estimation is prone to error.

### OUTPUT FORMAT
Return ONLY a raw JSON object with this exact structure:

{
  "mealName": "Overall meal name (e.g., 'Dal & Rice', 'Grilled Chicken Breast')",
  "items": [
    {
      "name": "Item Name (e.g., Grilled Chicken Breast)",
      "quantity": {
        "value": 1,
        "unit": "palm-sized piece/cups/slices/pieces/etc"
      },
      "nutrition": {
        "calories": 0,
        "protein": 0,
        "carbs": 0,
        "fat": 0
      },
      "confidence": 0.0-1.0
    }
  ]
}

Return only valid JSON, no additional text.`;
    }

    const content = [
      { 
        type: 'text', 
        text: promptText
      }
    ];

    // Add image if URL is provided
    if (imageUrl) {
      content.push({ type: 'image_url', image_url: { url: imageUrl } });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: imageUrl 
            ? 'You are a nutrition expert. Analyze food photos and return structured JSON data with detailed nutrition information.'
            : 'You are a nutrition expert. Analyze food descriptions and return structured JSON data with detailed nutrition information.'
        },
        {
          role: 'user',
          content: content
        }
      ],
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    
    return {
      response: completion.choices[0].message.content,
      tokens: {
        input: completion.usage?.prompt_tokens || null,
        output: completion.usage?.completion_tokens || null
      }
    };
  }

  static async analyzeFoodWithGemini(imageUrl, hint) {
    // Use gemini-2.5-flash as requested
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI] Using model: ${modelName}`);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.1
      }
    });
    
    // Build prompt based on what's available
    let prompt = '';
    const parts = [];

    if (imageUrl) {
      // IMAGE CASE (with or without hint - handled together)
      const inputDataSection = hint 
        ? `1. *Image:* Photo of a meal (served state).\n2. *User Hint (Optional):* Text provided by the user describing the meal: "${hint}"`
        : `1. *Image:* Photo of a meal (served state).`;

      prompt = `### ROLE
You are an expert AI Nutritionist and Computer Vision Analyst. Your goal is to analyze food images with high precision to assist in dietary tracking.

---

### INPUT DATA
${inputDataSection}

---

### STEP 1: ITEM IDENTIFICATION

#### 1.1 Visual Identification
- Segment the image and identify food items that are **calorically meaningful and user-editable**.
- **Be Specific:** Do not be generic in identifying items, as calorie values differ (e.g., "bread" vs "sourdough bread").

#### 1.2 Context Integration
- **Context Usage:** Use the *User Hint* (if provided) to resolve ambiguities (e.g., "made with oat milk" vs "cow milk").
- **Conflict Resolution:** If the User Hint contradicts strong visual evidence (e.g., user says "salad" but image shows "pizza"), **prioritize the User Hint** to prevent false tracking.

#### 1.3 Component Breakdown for Composite Dishes

**When to Apply:**
Apply only to **commonly named single dishes** where components are **cooked or mixed together** and users would reasonably want to edit components independently (e.g., biryani, curry with protein, pasta, noodle bowls).

**Format:**
List each component as a **separate top-level item** using: **\`Component (dish name)\`**

Example: \`Chicken (chicken biryani)\`, \`Rice (chicken biryani)\`

**When decomposing, output ONLY the components. Never list the parent dish as a separate item.**

**Key Components Only:**
Decompose **only primary caloric components**:
- Protein
- Base carb (rice, noodles, bread)
- Sauce / curry / gravy (if substantial)

Do **NOT** break dishes into ingredient-level elements such as onion, tomato, spices, masala, tempering, or cooking bases.

**Curry-Based Dishes:**
Represent curry dishes as:
- \`Protein (dish name)\`
- \`Curry/Gravy (dish name)\`

Curry/gravy includes oil, base, and sauce calories. Do NOT list curry ingredients separately.

❌ Do NOT output: \`Chicken (chicken curry)\`, \`Curry (chicken curry)\`, AND \`Chicken curry\` together.

**Minor Elements & Absorption Rule:**
Minor toppings, garnishes, condiments, or sprinkles (e.g., namkeen, fried onions, herbs) must **NOT** be listed separately. Calories from such elements must be **absorbed into the parent dish or component**.

**Exception:** Clearly countable protein sources (e.g., peanuts, paneer cubes, egg, meat pieces) must be listed separately even if mixed in.

**When NOT to Apply:**
If items are already visually and spatially distinct on the plate (e.g., rice, dal, roti served separately), list them as independent items **without parentheses**.

---

### STEP 2: QUANTITY ESTIMATION

#### 2.1 Scale Calibration
- **Identify Anchors:** Scan the image for intrinsic reference objects to determine physical scale. Look for standard cutlery (spoons ~14–16 cm), glassware, standard dinner plates (25–28 cm), or standard food item sizes.
- **Texture Analysis:** Analyze surface texture and glossiness. High sheen indicates added oils, butters, or glazes. Adjust the calorie density of the relevant parent dish or component accordingly. Do NOT list oils separately.

#### 2.2 Estimate Quantities
Using the scale references identified above, estimate the volume or count of each identified item.

#### 2.3 Quantity Display Formats

**Protein Sources ONLY** (meat, fish, paneer, tofu, eggs, clearly countable nuts):
- Use format: \`[count] [unit] ([grams])\`
- Examples: \`3 pieces (150 gms)\`, \`1 breast (180 gms)\`, \`8 cubes (100 gms)\`, \`2 tbsp peanuts (20 gms)\`

**Carbohydrates:**
- Use count or volume only (**NO grams**): \`1.5 cups\`, \`2 pieces\`, \`3 slices\`

**Vegetables:**
- Use count or volume only (**NO grams**): \`1 katori\`, \`6 florets\`, \`1/2 cup\`

**Sauces / Curries / Gravies:**
- Use volume only (**NO grams**): \`1 katori\`, \`3 tbsp\`

**Absolute Rules:**
- Do NOT display grams for any non-protein item.
- Do NOT use vague size descriptors (palm-sized, fist-sized, etc.).
- All quantities must be concrete, measurable, and user-editable.

---

### STEP 3: MACRO CALCULATION

- **State Detection:** Assume items are in their *COOKED/SERVED* state unless obviously raw (like fruit).
- **Database Matching:** Match estimated volumes to *Cooked* database values (e.g., "Steamed Rice", not "Raw Rice").
- **Yield Logic:** If a cooked value is unavailable, estimate the raw weight by applying standard cooking yield factors (e.g., meat shrinks by ~25%, rice expands by ~3×) before calculating macros.

---

### OUTPUT FORMAT
Return ONLY a raw JSON object with this exact structure:

{
  "mealName": "Overall meal name (e.g., 'Dal & Rice', 'Chicken Biryani')",
  "items": [
    {
      "name": "Item Name (e.g., Grilled Chicken Breast)",
      "quantity": {
        "value": 1,
        "unit": "breast (180 gms)/cups/pieces/katori/etc"
      },
      "nutrition": {
        "calories": 250.5,
        "protein": 25.0,
        "carbs": 15.0,
        "fat": 10.5
      },
      "confidence": 0.0-1.0
    }
  ]
}

**CRITICAL NUTRITION CALCULATION REQUIREMENTS:**
- You MUST calculate and provide ACTUAL nutrition values (not zeros) for EVERY item based on:
  * The specific food item identified (be precise: "chicken breast" vs "chicken thigh")
  * The estimated quantity/portion size from your visual analysis
  * Standard nutritional databases (USDA, Indian food composition tables)
  * Cooking method and preparation state (cooked vs raw)
  * Account for added oils, butter, or cooking fats in your calculations
- Calculate values based on the quantity provided (e.g., if quantity is "3 pieces (150 gms)", calculate nutrition for 150g of that item)
- Do NOT return 0 for nutrition values - every food item has nutritional content
- Round values to 1 decimal place for precision
- The example values above (250.5 calories, 25.0 protein, etc.) are just format examples - you must calculate REAL values for each actual item

Return only valid JSON, no additional text.`;
      parts.push({ text: prompt });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: await this.fetchImageAsBase64(imageUrl) } });
    } else if (hint && !imageUrl) {
      // TEXT ONLY CASE
      prompt = `### ROLE
You are an expert AI Nutritionist and Database Specialist. Your goal is to parse natural language food logs into structured nutritional data.

### INPUT DATA
User text string: "${hint}"

### INSTRUCTIONS

1. *Entity & Quantity Extraction:*
   * Parse the text to identify the *Food Item* and the *Quantity/Unit*.
   * Default Logic: If quantity is unspecified (e.g., "an apple"), assume *1 Standard Serving* (e.g., 1 Medium Apple).

2. *Brand vs. Generic Logic:*
   * *Explicit Brand:* If the user names a brand (e.g., "The Whole Truth," "MyProtein," "McDonald's"), you MUST prioritize searching your internal knowledge base for that specific brand's nutritional values.
     * Note on Scoops: Brand-specific scoops vary (e.g., one scoop might be 30g, another 45g). Use the specific brand's standard serving size.
   * *Generic:* If no brand is mentioned (e.g., "one apple," "boiled egg"), use standard USDA-equivalent averages for a *Medium* size.

3. *Macro Calculation:*
   * Calculate Calories, Protein, Carbs, and Fats based on the extracted quantity.
   * Sum up the total meal values.

### OUTPUT FORMAT
Return ONLY a raw JSON object with this exact structure:

{
  "mealName": "Overall meal name (e.g., 'The Whole Truth Protein Shake', 'Banana and Eggs')",
  "items": [
    {
      "name": "Item Name (e.g., The Whole Truth Protein - Chocolate)",
      "quantity": {
        "value": 1,
        "unit": "Scoop/piece/cup/serving/etc"
      },
      "nutrition": {
        "calories": 0,
        "protein": 0,
        "carbs": 0,
        "fat": 0
      },
      "confidence": 0.0-1.0
    }
  ]
}

Return only valid JSON, no additional text.`;
      parts.push({ text: prompt });
    }
    
    try {
      console.log(`🤖 [GEMINI] Sending request with ${parts.length} parts`);
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: parts
          }
        ]
      });
      
      const responseText = result.response.text();
      console.log(`🤖 [GEMINI] Response received, length: ${responseText?.length || 0}`);
      console.log(`🤖 [GEMINI] Raw response preview: ${JSON.stringify(responseText)}`);
      
      if (!responseText || responseText.trim() === '') {
        console.error('❌ [GEMINI] Empty response received');
        throw new Error('Empty response from Gemini API');
      }
      
      // Extract token usage from Gemini response
      const usageMetadata = result.response.usageMetadata;
      
      return {
        response: responseText,
        tokens: {
          input: usageMetadata?.promptTokenCount || null,
          output: usageMetadata?.candidatesTokenCount || null
        }
      };
    } catch (error) {
      console.error('❌ [GEMINI] API Error:', error.message);
      console.error('❌ [GEMINI] Full error:', error);
      throw error;
    }
  }

  // ─── V2: Two-step analysis (Quantity → Calories) ───

  /**
   * STEP 1: Identify food items and estimate quantities (NO nutrition).
   * Works for image, image+hint, and text-only inputs.
   */
  static async analyzeQuantityWithGemini(imageUrl, hint) {
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI-V2-STEP1] Using model: ${modelName} for quantity analysis`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1 }
    });

    let prompt = '';
    const parts = [];

    if (imageUrl) {
      // IMAGE CASE (with or without hint)
      console.log(`🤖 [GEMINI-V2-STEP1] Mode: IMAGE${hint ? '+HINT' : ''} | hint: ${hint || '(none)'}`);
      const hintSection = hint
        ? `2. User Hint (optional): "${hint}"`
        : '';

      prompt = `ROLE
Food identification and portion estimation specialist. Identify food items in a photo and estimate quantities. Do NOT calculate calories or macros.

INPUTS
1. Image: Meal photo in served state.
${hintSection}

USER HINT PRIORITY
When a User Hint is provided, always prioritize it over visual evidence — even if the image appears to contradict it. The user knows what they ate.
Examples:
* User says "3 eggs" but image shows 2 visible → output 3 eggs.
* User says "oat milk latte" but image just shows a cup of coffee → output oat milk latte.
* User says "chicken biryani" but it visually looks like pulao → output chicken biryani.

DIETARY PREFERENCE
Use dietary preference only as a tiebreaker when visual evidence is ambiguous and no User Hint is provided (e.g., chicken vs paneer in a curry). Never override clear visual evidence or User Hint.

ITEM IDENTIFICATION
Naming: Be specific when visually distinguishable (e.g., "jeera rice" not "rice", "sourdough bread" not "bread", "soba noodles" not "noodles"). Use general name when variant is unclear.

Composite dish breakdown — apply ONLY when components are cooked/mixed together or served in the same vessel/poured together on plate (e.g., biryani, pasta with sauce, curry with protein, burrito, poke bowl, noodle bowls):
* Format: Component (parent dish name) — e.g., Chicken (chicken biryani), Rice (chicken biryani)
* Decompose into: Protein + Base carb (rice, noodles, bread) + Sauce/curry/gravy.
* Sauce/gravy/curry is ONE component (includes oil, base, spices within it).
* Curry-based dishes: split into Protein (dish name) + Gravy (dish name). E.g., Chicken (chicken curry), Gravy (chicken curry).
* Never list parent dish alongside its components. Do NOT output: "Chicken biryani", "Chicken (chicken biryani)", and "Rice (chicken biryani)" together.
* Absorb garnishes and toppings into nearest component.

Do not break down items served in separate vessels or clearly occupying distinct areas of the plate — list them independently without parentheses.

Packaged/branded items: Use brand and product name. Use package size as quantity (e.g., "Amul Greek Yogurt 100g cup", "Kind Protein Bar 1 bar").

If no food is visible in the image (e.g., blurry, dark, empty plate, non-food photo), return { "mealName": "No food detected", "items": [] }.

QUANTITY ESTIMATION
Size references:
* Standard dinner plate: ~26 cm. Side/quarter plate: ~18 cm.
* Small bowl: ~150 ml. Medium bowl: ~250 ml. Large bowl: ~400 ml. Glass: ~250 ml.

Units by food type:
* Countable items (roti, bread slice, egg, taco, dumpling, idli, puri): count → 2 rotis, 3 slices
* Rice/grains/pasta: cups → 1 cup, 0.75 cup
* Soups/dal/curry/gravy/sauces: bowl size or tbsp → 1 small bowl, 3 tbsp
* Cooked vegetables: bowl size → 0.5 small bowl
* Protein (chicken, fish, paneer, tofu, meat): count + form → 3 boneless pieces, 2 bone-in pieces, 8 paneer cubes, 1 fillet, 2 whole eggs
* Beverages: glass or cup → 1 glass
* Fruits: count or cups → 1 banana, 0.5 cup grapes

Principles:
* Always count explicitly when items are individually distinguishable.
* For scoopable/pourable foods, estimate area coverage on plate and convert to cups or bowl size.
* When uncertain between two close quantities, choose the midpoint.

Gram estimation:
* For each item, also estimate total visible weight in grams based on portion size in the image.
* For volume-based items: 1 cup = 180g, small bowl = 150g, medium bowl = 250g, large bowl = 400g, 1 glass = 250ml, 1 tbsp = 15g.
* For bone-in items, estimate total weight including bone.
* For composite dish components, estimate grams of that component only — not the full dish. Especially for gravy/sauce, exclude solid pieces already listed separately.

OUTPUT
Return ONLY raw JSON. No markdown, no explanation.

{
  "mealName": "Overall meal name (e.g., 'Dal & Rice', 'Chicken Biryani')",
  "items": [
    {
      "name": "Item Name",
      "quantity": {
        "value": 1,
        "unit": "cups/pieces/small bowl/boneless pieces/etc"
      },
      "quantityAlternate": {
        "value": 0,
        "unit": "grams"
      },
      "confidence": 0.0-1.0
    }
  ]
}

EXAMPLE

{
  "mealName": "Dal Rice with Roti & Aloo Gobi",
  "items": [
    { "name": "Steamed rice", "quantity": { "value": 1, "unit": "cup" }, "quantityAlternate": { "value": 180, "unit": "grams" }, "confidence": 0.9 },
    { "name": "Dal", "quantity": { "value": 1, "unit": "small bowl" }, "quantityAlternate": { "value": 150, "unit": "grams" }, "confidence": 0.85 },
    { "name": "Roti", "quantity": { "value": 2, "unit": "rotis" }, "quantityAlternate": { "value": 70, "unit": "grams" }, "confidence": 0.9 },
    { "name": "Aloo gobi", "quantity": { "value": 0.5, "unit": "small bowl" }, "quantityAlternate": { "value": 75, "unit": "grams" }, "confidence": 0.8 }
  ]
}

**IMPORTANT:** Do NOT include any nutrition/calorie fields. Only identify items and estimate quantities (both in display unit and grams).

Return only valid JSON, no additional text.`;
      parts.push({ text: prompt });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: await this.fetchImageAsBase64(imageUrl) } });

    } else if (hint && !imageUrl) {
      // TEXT ONLY CASE — single-shot prompt that returns full nutrition
      console.log(`🤖 [GEMINI-V2-STEP1] Mode: TEXT-ONLY (single-shot) | hint: "${hint}"`);
      prompt = `ROLE
Nutrition calculator. Parse natural language food logs into structured nutritional data with macros.

INPUT
User text string: "${hint}"

PARSING
* Extract food item and quantity/unit from the text.
* If quantity is unspecified (e.g., "an apple"), assume 1 standard serving (e.g., 1 medium apple).

BRAND VS GENERIC
* Explicit brand (e.g., "The Whole Truth", "MyProtein", "McDonald's"): use that brand's specific nutritional values and standard serving size. Brand-specific scoops vary (e.g., 30g vs 45g) — use the correct one.
* Generic (e.g., "one apple", "boiled egg"): use standard USDA-equivalent averages for a medium size.

COMPOSITE DISH BREAKDOWN
Apply when the user mentions a commonly named dish where components are cooked/mixed together (e.g., biryani, curry with protein, pasta with sauce, burrito, noodle bowls):
* Format: Component (parent dish name) — e.g., Chicken (chicken biryani), Rice (chicken biryani)
* Decompose into: Protein + Base carb (rice, noodles, bread) + Sauce/curry/gravy.
* Sauce/gravy/curry is ONE component (includes oil, base, spices within it).
* Curry-based dishes: split into Protein (dish name) + Gravy (dish name). E.g., Chicken (chicken curry), Gravy (chicken curry).
* Never list parent dish alongside its components. Do NOT output: "Chicken biryani", "Chicken (chicken biryani)", and "Rice (chicken biryani)" together.
* Use standard serving sizes for each component when the user doesn't specify quantity.

Do not break down items the user lists separately (e.g., "rice and dal") — list them independently without parentheses.

MACRO CALCULATION
* Calculate grams, calories, protein, carbs, and fat for each item based on the extracted quantity.
* Use cooked/served state values.
* Round calories to nearest integer, protein/carbs/fat to 1 decimal.

OUTPUT
Return ONLY raw JSON. No markdown, no explanation.

{
  "mealName": "Overall meal name",
  "items": [
    {
      "name": "Item name",
      "quantity": {
        "value": 1,
        "unit": "Scoop/piece/cup/serving/etc"
      },
      "quantityAlternate": {
        "value": 0,
        "unit": "grams"
      },
      "nutrition": {
        "calories": 0,
        "protein": 0.0,
        "carbs": 0.0,
        "fat": 0.0
      },
      "type": "brand or generic",
      "confidence": 0.0-1.0
    }
  ]
}

EXAMPLE

Input: "2 rotis, 1 bowl dal, chicken curry"

{
  "mealName": "Roti, Dal & Chicken Curry",
  "items": [
    { "name": "Roti", "quantity": { "value": 2, "unit": "rotis" }, "quantityAlternate": { "value": 70, "unit": "grams" }, "nutrition": { "calories": 220, "protein": 6.4, "carbs": 36.0, "fat": 5.6 }, "type": "generic", "confidence": 0.9 },
    { "name": "Dal", "quantity": { "value": 1, "unit": "small bowl" }, "quantityAlternate": { "value": 150, "unit": "grams" }, "nutrition": { "calories": 135, "protein": 7.5, "carbs": 18.0, "fat": 3.8 }, "type": "generic", "confidence": 0.9 },
    { "name": "Chicken (chicken curry)", "quantity": { "value": 3, "unit": "boneless pieces" }, "quantityAlternate": { "value": 90, "unit": "grams" }, "nutrition": { "calories": 165, "protein": 23.4, "carbs": 0.0, "fat": 7.2 }, "type": "generic", "confidence": 0.85 },
    { "name": "Gravy (chicken curry)", "quantity": { "value": 1, "unit": "small bowl" }, "quantityAlternate": { "value": 120, "unit": "grams" }, "nutrition": { "calories": 156, "protein": 2.4, "carbs": 6.0, "fat": 13.2 }, "type": "generic", "confidence": 0.85 }
  ]
}

Return only valid JSON, no additional text.`;
      parts.push({ text: prompt });
    }

    try {
      console.log(`🤖 [GEMINI-V2-STEP1] Sending quantity analysis request with ${parts.length} parts`);
      const result = await model.generateContent({
        contents: [{ role: 'user', parts }]
      });

      const responseText = result.response.text();
      console.log(`🤖 [GEMINI-V2-STEP1] Response received, length: ${responseText?.length || 0}`);
      console.log(`🤖 [GEMINI-V2-STEP1] Raw response preview: ${responseText?.substring(0, 500)}`);

      if (!responseText || responseText.trim() === '') {
        console.error('❌ [GEMINI-V2-STEP1] Empty response received');
        throw new Error('Empty response from Gemini API (quantity step)');
      }

      const usageMetadata = result.response.usageMetadata;
      console.log(`🤖 [GEMINI-V2-STEP1] Tokens — input: ${usageMetadata?.promptTokenCount || 'N/A'}, output: ${usageMetadata?.candidatesTokenCount || 'N/A'}`);
      return {
        response: responseText,
        prompt,
        tokens: {
          input: usageMetadata?.promptTokenCount || null,
          output: usageMetadata?.candidatesTokenCount || null
        }
      };
    } catch (error) {
      console.error('❌ [GEMINI-V2-STEP1] API Error:', error.message);
      console.error('❌ [GEMINI-V2-STEP1] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      throw error;
    }
  }

  /**
   * Enhanced Prompt 1 for V4: Adds itemType classification and category tagging
   */
  static async analyzeQuantityWithGeminiV4(imageUrl, hint) {
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI-V4-STEP1] Using model: ${modelName} for enhanced quantity analysis`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1 }
    });

    const enhancedPrompt = `ROLE
Food identification and portion estimation specialist with classification capabilities.

INPUTS
1. Image: Meal photo in served state.
${hint ? `2. User Hint: "${hint}"` : ''}

CLASSIFICATION REQUIREMENTS
For each item, classify as:
1. **itemType**: "composite_dish" or "single_item"
   - composite_dish: User might eat components separately (butter chicken, biryani, omelet)
   - single_item: Consumed as whole unit (dal makhani, pizza, rice)

2. **category**: protein, grain, fat, vegetable, fruit, sauce, beverage, dairy, nuts, legumes, other

COMPOSITE DISH HANDLING
For composite_dish items:
- Estimate serving size (0.5, 1, 1.5, 2 servings)
- DO NOT estimate component quantities (recipe database will handle this)
- Provide serving unit (bowl, plate, cup, piece)

For single_item:
- Provide category
- Estimate display quantity (5 pieces, 2 cups, 1 tbsp)
- Estimate grams

QUANTITY ESTIMATION
Same as existing rules: use cups, pieces, bowl sizes, etc.
Gram estimation required for all items.

OUTPUT
Return ONLY raw JSON. No markdown, no explanation.

{
  "mealName": "Overall meal name",
  "items": [
    {
      "name": "Item name",
      "itemType": "composite_dish" | "single_item",
      "category": "protein|grain|fat|vegetable|fruit|sauce|beverage|dairy|nuts|legumes|other",

      // For composite_dish:
      "servingSize": 1.5,
      "servingUnit": "bowl",

      // For single_item:
      "quantity": { "value": 5, "unit": "pieces" },
      "quantityAlternate": { "value": 250, "unit": "grams" },
      "pieceWeight": 50,  // For proteins: 1 piece = Xg

      "confidence": 0.9
    }
  ]
}

EXAMPLES

Composite dish:
{
  "name": "Butter Chicken",
  "itemType": "composite_dish",
  "category": "protein",
  "servingSize": 1,
  "servingUnit": "bowl",
  "confidence": 0.9
}

Simple item:
{
  "name": "Rice",
  "itemType": "single_item",
  "category": "grain",
  "quantity": { "value": 1, "unit": "cup" },
  "quantityAlternate": { "value": 180, "unit": "grams" },
  "confidence": 0.9
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

  /**
   * STEP 2: Given identified items with quantities, calculate nutrition / calories.
   * @param {Object} quantityResult - Parsed JSON from step 1 (mealName, items[{name, quantity, confidence}])
   */
  static async analyzeCaloriesFromQuantityWithGemini(quantityResult) {
    const modelName = 'gemini-2.5-flash';
    console.log(`🤖 [GEMINI-V2-STEP2] Using model: ${modelName} for calorie calculation`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1 }
    });

    const itemsList = quantityResult.items.map((item, i) => {
      const grams = item.quantityAlternate?.value || 0;
      return `${i + 1}. ${item.name} — ${item.quantity.value} ${item.quantity.unit} (${grams}g)`;
    }).join('\n');

    console.log(`🤖 [GEMINI-V2-STEP2] Items for calorie calc (${quantityResult.items.length}):\n${itemsList}`);

    const prompt = `ROLE
Nutrition calculator. Given identified food items with quantities and gram estimates, calculate macros (calories, protein, carbs, fat) per item and for the total meal.

INPUT
Meal Name: "${quantityResult.mealName}"

Items (with quantities and grams):
${itemsList}

CALCULATION STEPS

1. Classify each item: Items with parentheses in the name (e.g., "Chicken (butter chicken)") are composite dish components. Items without parentheses are standalone.

2. Look up per-100g macros for each item in its cooked/served state. Use the item name and form descriptor to select the correct nutritional profile:
   * Bone-in items: use per-100g values that account for bone weight (lower protein/calorie density than boneless).
   * Gravy/sauce components: use per-100g values for that specific gravy/sauce including its typical cooking oil, spices, and base ingredients.
   * All other items: use standard cooked/served per-100g values.

3. Calculate per item: macros = (grams / 100) x per-100g macros. Round calories to nearest integer, protein/carbs/fat to 1 decimal.

4. Sum all items for meal total.

OUTPUT
Return ONLY raw JSON. No markdown, no explanation.

{
  "mealName": "${quantityResult.mealName}",
  "items": [
    {
      "name": "Item Name (exactly as provided in input)",
      "quantity": {
        "value": 1,
        "unit": "unit as provided in input"
      },
      "quantityAlternate": {
        "value": 0,
        "unit": "grams"
      },
      "nutrition": {
        "calories": 0,
        "protein": 0.0,
        "carbs": 0.0,
        "fat": 0.0
      },
      "confidence": 0.0-1.0
    }
  ],
  "total": {
    "calories": 0,
    "protein": 0.0,
    "carbs": 0.0,
    "fat": 0.0
  }
}

**CRITICAL REQUIREMENTS:**
- You MUST keep item names, quantities, and grams EXACTLY as provided in the input. Do NOT rename or re-estimate.
- You MUST calculate and provide ACTUAL nutrition values (not zeros) for EVERY item using the grams and per-100g macros.
- Round calories to nearest integer, protein/carbs/fat to 1 decimal place.
- Do NOT return 0 for nutrition values — every food item has nutritional content.
- The number of items in the output MUST match the number of items in the input.
- Include the total meal macros in the "total" field.

Return only valid JSON, no additional text.`;

    try {
      console.log(`🤖 [GEMINI-V2-STEP2] Sending calorie calculation request`);
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });

      const responseText = result.response.text();
      console.log(`🤖 [GEMINI-V2-STEP2] Response received, length: ${responseText?.length || 0}`);
      console.log(`🤖 [GEMINI-V2-STEP2] Raw response preview: ${responseText?.substring(0, 500)}`);

      if (!responseText || responseText.trim() === '') {
        console.error('❌ [GEMINI-V2-STEP2] Empty response received');
        throw new Error('Empty response from Gemini API (calorie step)');
      }

      const usageMetadata = result.response.usageMetadata;
      console.log(`🤖 [GEMINI-V2-STEP2] Tokens — input: ${usageMetadata?.promptTokenCount || 'N/A'}, output: ${usageMetadata?.candidatesTokenCount || 'N/A'}`);
      return {
        response: responseText,
        prompt,
        tokens: {
          input: usageMetadata?.promptTokenCount || null,
          output: usageMetadata?.candidatesTokenCount || null
        }
      };
    } catch (error) {
      console.error('❌ [GEMINI-V2-STEP2] API Error:', error.message);
      console.error('❌ [GEMINI-V2-STEP2] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      throw error;
    }
  }

  /**
   * V2 entry point: chains analyzeQuantity → analyzeCalories, then saves meal.
   * Drop-in replacement for analyzeFoodCalories with same saving behaviour.
   */
  static async analyzeFoodCaloriesV2(imageUrl, hint, provider = 'gemini', userId = null, additionalData = {}) {
    try {
      const llmModel = 'gemini-2.5-flash';
      const isTextOnly = !imageUrl && hint;

      console.log(`🤖 [V2] ─── Starting V2 pipeline ───`);
      console.log(`🤖 [V2] Input: imageUrl=${imageUrl ? 'yes' : 'no'}, hint=${hint ? `"${hint.substring(0, 80)}"` : 'no'}, isTextOnly=${isTextOnly}`);

      // ── Step 1: Identify items + quantities (text-only returns full nutrition) ──
      console.log(`🤖 [V2] Starting Step 1: ${isTextOnly ? 'Text-only (single-shot)' : 'Quantity'} analysis`);
      const quantityRaw = await this.analyzeQuantityWithGemini(imageUrl, hint);
      const quantityParsed = this.parseAIResult(quantityRaw.response);
      console.log(`🤖 [V2] Step 1 complete — ${quantityParsed.items.length} items identified, mealName="${quantityParsed.mealName}"`);

      // Log each item with quantityAlternate for debugging
      quantityParsed.items.forEach((item, i) => {
        const altG = item.quantityAlternate?.value || 'N/A';
        const hasNutrition = item.nutrition ? `cal=${item.nutrition.calories}` : 'no nutrition';
        console.log(`🤖 [V2]   item[${i}]: "${item.name}" | qty=${item.quantity.value} ${item.quantity.unit} | grams=${altG} | ${hasNutrition}`);
      });

      let caloriesResult;
      let tokens;
      let caloriesRaw = null;

      if (isTextOnly) {
        // Text-only prompt already returns full nutrition — skip Step 2
        console.log('🤖 [V2] Text-only: skipping Step 2 (nutrition included in Step 1)');
        caloriesResult = quantityRaw.response;
        tokens = quantityRaw.tokens;
      } else {
        // ── Step 2: Calculate calories from quantities (image flow) ──
        console.log('🤖 [V2] Starting Step 2: Calorie calculation');
        caloriesRaw = await this.analyzeCaloriesFromQuantityWithGemini(quantityParsed);
        caloriesResult = caloriesRaw.response;
        console.log('🤖 [V2] Step 2 complete');

        tokens = {
          input: (quantityRaw.tokens.input || 0) + (caloriesRaw.tokens.input || 0),
          output: (quantityRaw.tokens.output || 0) + (caloriesRaw.tokens.output || 0)
        };
      }

      console.log(`🤖 [V2] Total tokens — input: ${tokens.input || 'N/A'}, output: ${tokens.output || 'N/A'}`);

      // ── Save meal ──
      let savedMeal = null;
      if (userId) {
        const imageReference = imageUrl || (hint ? `text: ${hint}` : null);
        console.log(`🤖 [V2] Saving meal for userId=${userId}`);
        savedMeal = await this.saveMealData(userId, imageReference, caloriesResult, provider, llmModel, additionalData, tokens);
        console.log(`🤖 [V2] Meal saved: mealId=${savedMeal?._id}`);
      }

      console.log(`🤖 [V2] ─── V2 pipeline complete ───`);
      return {
        calories: caloriesResult,
        provider,
        mealId: savedMeal ? savedMeal._id : null,
        quantityResult: quantityParsed,
        steps: {
          step1_tokens: quantityRaw.tokens,
          step2_tokens: caloriesRaw ? caloriesRaw.tokens : null
        }
      };
    } catch (error) {
      console.error(`❌ [V2] Pipeline failed: ${error.message}`);
      throw new Error(`Failed to analyze food (V2): ${error.message}`);
    }
  }

  /**
   * V3 entry point: Step 1 (quantity) + Step 2 (DB lookup, all-or-nothing).
   * Tries DB for all items first. If any item misses, falls back to a single
   * LLM call for ALL items (no per-item LLM calls).
   */
  static async analyzeFoodCaloriesV3(imageUrl, hint, provider = 'gemini', userId = null, additionalData = {}) {
    try {
      const llmModel = 'gemini-2.5-flash';
      const isTextOnly = !imageUrl && hint;

      console.log(`🤖 [V3] ─── Starting V3 pipeline ───`);
      console.log(`🤖 [V3] Input: imageUrl=${imageUrl ? 'yes' : 'no'}, hint=${hint ? `"${hint.substring(0, 80)}"` : 'no'}`);

      // Step 1: Identify items + quantities
      console.log(`🤖 [V3] Starting Step 1: ${isTextOnly ? 'Text-only (single-shot)' : 'Quantity'} analysis`);
      const quantityRaw = await this.analyzeQuantityWithGemini(imageUrl, hint);
      const quantityParsed = this.parseAIResult(quantityRaw.response);
      console.log(`🤖 [V3] Step 1 complete — ${quantityParsed.items.length} items identified, mealName="${quantityParsed.mealName}"`);

      quantityParsed.items.forEach((item, i) => {
        const altG = item.quantityAlternate?.value || 'N/A';
        const hasNutrition = item.nutrition ? `cal=${item.nutrition.calories}` : 'no nutrition';
        console.log(`🤖 [V3]   item[${i}]: "${item.name}" | qty=${item.quantity.value} ${item.quantity.unit} | grams=${altG} | ${hasNutrition}`);
      });

      let nutritionResult;
      let totalTokens = { ...quantityRaw.tokens };
      let nutritionSource = 'db';

      if (isTextOnly && quantityParsed.items.length > 0 && quantityParsed.items[0].nutrition) {
        // Text-only prompt already returned full nutrition — use directly
        console.log('🤖 [V3] Text-only: using nutrition from Step 1 (single-shot)');
        nutritionSource = 'llm';
        nutritionResult = {
          mealName: quantityParsed.mealName,
          items: quantityParsed.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            quantityAlternate: item.quantityAlternate,
            nutrition: item.nutrition,
            grams: item.quantityAlternate?.value || null,
            nutritionSource: 'llm_fallback',
            parentDish: null, componentType: null, proteinForm: null
          }))
        };
      } else {
        // Step 2a: Try DB lookup for ALL items (no LLM)
        console.log('🤖 [V3] Starting Step 2: Nutrition DB lookup (all-or-nothing)');
        const NutritionLookupService = require('./nutritionLookupService');
        const dbResult = await NutritionLookupService.calculateNutrition(quantityParsed);

        if (dbResult.allFromDb) {
          console.log(`🤖 [V3] Step 2 complete — ALL ${dbResult.items.length} items resolved from DB`);
          nutritionResult = dbResult;

          dbResult.items.forEach((item, i) => {
            console.log(`🤖 [V3]   result[${i}]: "${item.name}" | source=db | grams=${item.grams || 'N/A'} | cal=${item.nutrition?.calories || 0}`);
          });
        } else {
          // Step 2b: DB missed some items — single LLM call for ALL items
          console.log(`🤖 [V3] DB missed ${dbResult.missedItems.length} items: ${JSON.stringify(dbResult.missedItems)}`);
          console.log('🤖 [V3] Falling back to single LLM call for ALL items');
          nutritionSource = 'llm';

          const llmRaw = await this.analyzeCaloriesFromQuantityWithGemini(quantityParsed);
          const llmParsed = this.parseAIResult(llmRaw.response);
          console.log(`🤖 [V3] LLM fallback complete — ${llmParsed.items.length} items`);

          totalTokens = {
            input: (quantityRaw.tokens.input || 0) + (llmRaw.tokens.input || 0),
            output: (quantityRaw.tokens.output || 0) + (llmRaw.tokens.output || 0)
          };

          nutritionResult = {
            mealName: llmParsed.mealName || quantityParsed.mealName,
            items: llmParsed.items.map(item => ({
              name: item.name,
              quantity: item.quantity,
              quantityAlternate: item.quantityAlternate,
              nutrition: item.nutrition,
              grams: item.quantityAlternate?.value || null,
              nutritionSource: 'llm_fallback',
              parentDish: null, componentType: null, proteinForm: null
            }))
          };

          nutritionResult.items.forEach((item, i) => {
            console.log(`🤖 [V3]   result[${i}]: "${item.name}" | source=llm | grams=${item.grams || 'N/A'} | cal=${item.nutrition?.calories || 0}`);
          });
        }
      }

      let savedMeal = null;
      if (userId) {
        const imageReference = imageUrl || (hint ? `text: ${hint}` : null);
        console.log(`🤖 [V3] Saving meal for userId=${userId} | nutritionSource=${nutritionSource}`);
        savedMeal = await this.saveMealDataForV3(userId, imageReference, nutritionResult, additionalData, totalTokens);
        console.log(`🤖 [V3] Meal saved: mealId=${savedMeal?._id}`);
      }

      console.log(`🤖 [V3] ─── V3 pipeline complete (source=${nutritionSource}) ───`);
      return {
        calories: nutritionResult,
        provider,
        mealId: savedMeal ? savedMeal._id : null,
        quantityResult: quantityParsed,
        nutritionSource,
        steps: { step1_tokens: quantityRaw.tokens }
      };
    } catch (error) {
      console.error(`❌ [V3] Pipeline failed: ${error.message}`);
      throw new Error(`Failed to analyze food (V3): ${error.message}`);
    }
  }

  static async analyzeFoodCaloriesV4(imageUrl, hint, provider = 'gemini', userId = null, additionalData = {}) {
    try {
      const llmModel = 'gemini-2.5-flash';
      const isTextOnly = !imageUrl && hint;

      console.log(`🤖 [V4] ─── Starting V4 pipeline (DB-first with per-item waterfall) ───`);
      console.log(`🤖 [V4] Input: imageUrl=${imageUrl ? 'yes' : 'no'}, hint=${hint ? `"${hint.substring(0, 80)}"` : 'no'}`);

      // Step 1: Enhanced Prompt 1 - Meal identification + itemType classification
      console.log(`🤖 [V4] Step 1: Enhanced Prompt 1 (with itemType classification)`);
      const quantityRaw = await this.analyzeQuantityWithGeminiV4(imageUrl, hint);
      const quantityParsed = this.parseAIResult(quantityRaw.response);
      console.log(`🤖 [V4] Step 1 complete — ${quantityParsed.items.length} items identified, mealName="${quantityParsed.mealName}"`);

      quantityParsed.items.forEach((item, i) => {
        const itemType = item.itemType || 'single_item';
        const category = item.category || 'unknown';
        const grams = item.grams || item.quantityAlternate?.value || 'N/A';
        console.log(`🤖 [V4]   item[${i}]: "${item.name}" | type=${itemType} | category=${category} | grams=${grams}`);
      });

      // Step 2: Per-item nutrition lookup with waterfall (USDA → IFCT → LLM cache → LLM)
      console.log(`🤖 [V4] Step 2: Per-item waterfall lookup (USDA → IFCT → cache → LLM)`);
      const NutritionLookupServiceV4 = require('./nutritionLookupServiceV4');
      const nutritionResult = await NutritionLookupServiceV4.calculateNutrition(quantityParsed.items, llmModel);

      console.log(`🤖 [V4] Step 2 complete — ${nutritionResult.items.length} items processed`);
      console.log(`🤖 [V4] Source breakdown: USDA=${nutritionResult.sourceBreakdown.usda}, IFCT=${nutritionResult.sourceBreakdown.ifct}, cached=${nutritionResult.sourceBreakdown.llm_cached}, fresh=${nutritionResult.sourceBreakdown.llm_fresh}, recipe=${nutritionResult.sourceBreakdown.recipe}`);

      nutritionResult.items.forEach((item, i) => {
        const source = item.nutritionSource || 'unknown';
        const cal = item.nutrition?.calories || 0;
        console.log(`🤖 [V4]   result[${i}]: "${item.name}" | source=${source} | cal=${cal}`);
      });

      // Save meal with enhanced tracking
      let savedMeal = null;
      if (userId) {
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
          quantityRaw.tokens
        );
        console.log(`🤖 [V4] Meal saved: mealId=${savedMeal?._id}`);
      }

      const coverage = nutritionResult.coverage;
      console.log(`🤖 [V4] Coverage: ${coverage.fromDatabase}/${coverage.total} from DB (${Math.round(coverage.fromDatabase / coverage.total * 100)}%)`);
      console.log(`🤖 [V4] ─── V4 pipeline complete ───`);

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
        steps: { step1_tokens: quantityRaw.tokens }
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

  static async analyzeFoodCalories(imageUrl, hint, provider = 'gemini', userId = null, additionalData = {}) {
    try {
      let result;
      let llmModel;
      let tokens = { input: null, output: null };
      
      if (provider === 'openai') {
        result = await this.analyzeFoodWithOpenAI(imageUrl, hint);
        llmModel = 'gpt-4o';
        tokens = result.tokens || { input: null, output: null };
        result = result.response; // Extract response text
      } else {
        result = await this.analyzeFoodWithGemini(imageUrl, hint);
        llmModel = 'gemini-2.5-flash';
        tokens = result.tokens || { input: null, output: null };
        result = result.response; // Extract response text
      }
      
      // Save meal data to database if userId is provided
      let savedMeal = null;
      console.log('userId', userId);
      if (userId) {
        // Use imageUrl if available, otherwise use hint as a reference
        const imageReference = imageUrl || (hint ? `text: ${hint}` : null);
        savedMeal = await this.saveMealData(userId, imageReference, result, provider, llmModel, additionalData, tokens);
      }
      
      return { 
        calories: result, 
        provider,
        mealId: savedMeal ? savedMeal._id : null
      };
    } catch (error) {
      throw new Error(`Failed to analyze food: ${error.message}`);
    }
  }

  static async saveMealData(userId, imageUrl, aiResult, provider, llmModel, additionalData = {}, tokens = { input: null, output: null }) {
    try {
      // Parse structured JSON response from AI
      const parsedResult = this.parseAIResult(aiResult);
      
      // Calculate total nutrition from items
      const totalNutrition = this.calculateTotalNutrition(parsedResult.items);
      
      // Convert items to meal schema format
      const mealItems = parsedResult.items.map((item, index) => ({
        id: `item_${Date.now()}_${index}`,
        name: {
          llm: item.name,
          final: null
        },
        quantity: {
          llm: {
            value: item.quantity.value,
            unit: item.quantity.unit,
            normalized: {
              value: item.quantity.value,
              unit: item.quantity.unit
            }
          },
          final: {
            value: null,
            unit: null
          }
        },
        quantityAlternate: {
          llm: {
            value: item.quantityAlternate?.value || null,
            unit: item.quantityAlternate?.unit || 'grams'
          },
          final: { value: null, unit: null }
        },
        nutrition: {
          calories: { llm: item.nutrition.calories, final: null },
          protein: { llm: item.nutrition.protein, final: null },
          carbs: { llm: item.nutrition.carbs, final: null },
          fat: { llm: item.nutrition.fat, final: null }
        },
        confidence: item.confidence || null
      }));
      
      // Handle photos array - only include if imageUrl is a valid URL
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
        capturedAt: additionalData.capturedAt ? new Date(additionalData.capturedAt) : dateUtils.getCurrentDateTime(),
        photos: photos,
        llmVersion: '1.0',
        llmModel,
        name: parsedResult.mealName,
        totalNutrition: {
          calories: { llm: totalNutrition.calories, final: null },
          protein: { llm: totalNutrition.protein, final: null },
          carbs: { llm: totalNutrition.carbs, final: null },
          fat: { llm: totalNutrition.fat, final: null }
        },
        items: mealItems,
        notes: additionalData.notes || `AI Analysis: ${parsedResult.mealName}`,
        userApproved: false,
        inputTokens: tokens.input,
        outputTokens: tokens.output
      };

      const meal = new Meal(mealData);
      return await meal.save();
    } catch (error) {
      console.error('Failed to save meal data:', error);
      throw new Error(`Failed to save meal data: ${error.message}`);
    }
  }

  static async saveMealDataForV3(userId, imageUrl, nutritionResult, additionalData = {}, tokens = { input: null, output: null }) {
    try {
      const totalNutrition = this.calculateTotalNutrition(nutritionResult.items);

      const mealItems = nutritionResult.items.map((item, index) => {
        const isDb = item.nutritionSource === 'db';
        const nut = item.nutrition || {};
        return {
          id: `item_${Date.now()}_${index}`,
          name: { llm: item.name, final: null },
          quantity: {
            llm: {
              value: item.quantity?.value ?? 1,
              unit: item.quantity?.unit || 'serving',
              normalized: { value: item.quantity?.value ?? 1, unit: item.quantity?.unit || 'serving' }
            },
            final: null
          },
          quantityAlternate: {
            llm: {
              value: item.quantityAlternate?.value || item.grams || null,
              unit: 'grams'
            },
            final: { value: null, unit: null }
          },
          nutrition: {
            calories: { llm: nut.calories || 0, final: isDb ? nut.calories : null },
            protein: { llm: nut.protein || 0, final: isDb ? nut.protein : null },
            carbs: { llm: nut.carbs || 0, final: isDb ? nut.carbs : null },
            fat: { llm: nut.fat || 0, final: isDb ? nut.fat : null }
          },
          confidence: null,
          nutritionSource: item.nutritionSource || 'llm_fallback',
          grams: item.grams ?? null,
          parentDish: item.parentDish ?? null,
          componentType: item.componentType ?? null,
          proteinForm: item.proteinForm ?? null
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
        llmVersion: '3.0',
        llmModel: 'gemini-2.5-flash',
        name: nutritionResult.mealName,
        totalNutrition: {
          calories: { llm: totalNutrition.calories, final: totalNutrition.calories },
          protein: { llm: totalNutrition.protein, final: totalNutrition.protein },
          carbs: { llm: totalNutrition.carbs, final: totalNutrition.carbs },
          fat: { llm: totalNutrition.fat, final: totalNutrition.fat }
        },
        items: mealItems,
        notes: additionalData.notes || `AI Analysis (V3): ${nutritionResult.mealName}`,
        userApproved: false,
        inputTokens: tokens.input,
        outputTokens: tokens.output
      };

      const meal = new Meal(mealData);
      return await meal.save();
    } catch (error) {
      console.error('Failed to save meal data (V3):', error);
      throw new Error(`Failed to save meal data (V3): ${error.message}`);
    }
  }

  static async saveMealDataForV4(userId, imageUrl, nutritionResult, additionalData = {}, tokens = { input: null, output: null }) {
    try {
      const mealItems = nutritionResult.items.map((item, index) => {
        const nut = item.nutrition || {};
        return {
          id: `item_${Date.now()}_${index}`,
          name: { llm: item.name, final: null },
          quantity: {
            llm: {
              value: item.quantity?.value || item.servingSize || 1,
              unit: item.quantity?.unit || item.servingUnit || 'serving'
            },
            final: null
          },
          quantityAlternate: {
            llm: {
              value: item.grams || item.quantityAlternate?.value || null,
              unit: 'grams'
            },
            final: { value: null, unit: null }
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
          grams: item.grams || null
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
        inputTokens: tokens.input,
        outputTokens: tokens.output
      };

      const meal = new Meal(mealData);
      return await meal.save();
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
          quantity: { value: 1, unit: 'serving' },
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
• Keep meal names concise (max 4-5 words)
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
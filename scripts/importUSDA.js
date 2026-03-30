const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { parse } = require('csv-parse/sync');
require('dotenv').config();

const FoodItem = require('../models/schemas/FoodItem');

// USDA FoodData Central URLs
const FOUNDATION_FOODS_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2024-10-31.zip';
const SR_LEGACY_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2021-10-28.zip';

// Download timeout (30 minutes for large files)
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000;

/**
 * Download file from URL
 */
async function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    https.get(url, { timeout: DOWNLOAD_TIMEOUT }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, destination).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        fs.unlinkSync(destination);
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlinkSync(destination);
      reject(err);
    });
  });
}

/**
 * Extract ZIP file
 */
async function extractZip(zipPath, extractTo) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractTo, true);
}

/**
 * Categorize food based on name/description
 */
function categorizeFood(name) {
  const nameLower = name.toLowerCase();

  if (nameLower.match(/chicken|beef|pork|lamb|turkey|fish|salmon|tuna|shrimp|egg|tofu/)) {
    return 'protein';
  }
  if (nameLower.match(/rice|bread|pasta|noodle|cereal|oat|wheat|flour|quinoa/)) {
    return 'grain';
  }
  if (nameLower.match(/oil|butter|ghee|cream|lard|margarine/)) {
    return 'fat';
  }
  if (nameLower.match(/tomato|potato|onion|carrot|broccoli|spinach|lettuce|pepper|cabbage/)) {
    return 'vegetable';
  }
  if (nameLower.match(/apple|banana|orange|grape|berry|mango|pineapple|melon/)) {
    return 'fruit';
  }
  if (nameLower.match(/milk|yogurt|cheese|paneer|curd/)) {
    return 'dairy';
  }
  if (nameLower.match(/almond|cashew|walnut|peanut|pistachio/)) {
    return 'nuts';
  }
  if (nameLower.match(/lentil|chickpea|bean|dal|pea/)) {
    return 'legumes';
  }
  if (nameLower.match(/sauce|gravy|ketchup|mayo|dressing|chutney/)) {
    return 'sauce';
  }
  if (nameLower.match(/juice|soda|coffee|tea|water|cola/)) {
    return 'beverage';
  }

  return 'other';
}

/**
 * Filter relevant foods
 * Prioritize: common foods, restaurant items, whole foods
 * Exclude: obscure foods, duplicates, non-food items
 */
function isRelevantFood(row) {
  const name = row.description || row.name || '';
  const nameLower = name.toLowerCase();

  // Exclude non-food items
  if (nameLower.includes('supplement') ||
      nameLower.includes('formula') ||
      nameLower.includes('baby food') ||
      nameLower.includes('infant') ||
      nameLower.match(/^usda commodity/)) {
    return false;
  }

  // Exclude very specific branded items (keep generic ones)
  if (nameLower.match(/\b(brand|trademark|proprietary)\b/)) {
    return false;
  }

  // Keep common foods and whole foods
  return true;
}

/**
 * Parse USDA CSV and import to MongoDB
 */
async function parseAndImportUSDA(csvPath, datasetName) {
  console.log(`Parsing ${datasetName} from ${csvPath}...`);

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`Found ${records.length} records in ${datasetName}`);

  const foodItems = [];
  let filtered = 0;

  for (const row of records) {
    // Check if this is a food.csv or nutrient.csv
    // Foundation Foods structure: fdc_id, data_type, description, food_category_id
    // SR Legacy structure: fdc_id, data_type, description, ndb_number

    if (!isRelevantFood(row)) {
      filtered++;
      continue;
    }

    const name = (row.description || row.name || '').trim();
    if (!name) continue;

    // Map USDA fields to our schema
    const foodItem = {
      name,
      aliases: [],
      category: categorizeFood(name),
      dataSource: 'USDA',
      sourceId: row.fdc_id || row.ndb_number,
      verified: true,
      // Nutrition values (these will come from nutrients CSV join)
      // For now, set defaults - we'll need a second pass to join nutrients
      caloriesPer100g: parseFloat(row.energy_kcal) || 0,
      proteinPer100g: parseFloat(row.protein_g) || 0,
      carbsPer100g: parseFloat(row.carbohydrate_g) || 0,
      fatPer100g: parseFloat(row.total_lipid_fat_g) || 0,
      fiberPer100g: parseFloat(row.fiber_total_dietary_g) || 0,
      usageCount: 0,
      llmModel: null,
      llmGeneratedAt: null
    };

    // Only add if we have at least calories
    if (foodItem.caloriesPer100g > 0 || foodItem.proteinPer100g > 0) {
      foodItems.push(foodItem);
    }
  }

  console.log(`Filtered out ${filtered} non-relevant items`);
  console.log(`Prepared ${foodItems.length} food items for import`);

  // Bulk insert to MongoDB
  if (foodItems.length > 0) {
    try {
      await FoodItem.insertMany(foodItems, { ordered: false });
      console.log(`✓ Successfully imported ${foodItems.length} items from ${datasetName}`);
    } catch (err) {
      if (err.code === 11000) {
        console.log(`✓ Imported ${datasetName} (some duplicates skipped)`);
      } else {
        throw err;
      }
    }
  }

  return foodItems.length;
}

/**
 * Main import function
 */
async function main() {
  try {
    console.log('USDA FoodData Central Import');
    console.log('============================\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/caltrack';
    console.log(`Connecting to MongoDB: ${mongoUri.replace(/\/\/.*@/, '//<credentials>@')}`);
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    // Create data directory
    const dataDir = path.join(__dirname, '../data/usda');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log('Note: This script expects USDA CSV files to be manually downloaded and placed in Backend/data/usda/');
    console.log('Download URLs:');
    console.log('  Foundation Foods: https://fdc.nal.usda.gov/download-datasets/');
    console.log('  SR Legacy: https://fdc.nal.usda.gov/download-datasets/');
    console.log('\nLooking for CSV files in:', dataDir);

    // Look for CSV files
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));

    if (files.length === 0) {
      console.error('\n✗ No CSV files found. Please download and extract USDA CSV files first.');
      console.error('  Place extracted CSV files in: Backend/data/usda/');
      process.exit(1);
    }

    console.log(`\nFound ${files.length} CSV files:`);
    files.forEach(f => console.log(`  - ${f}`));
    console.log('');

    // Clear existing USDA entries
    const deleteResult = await FoodItem.deleteMany({ dataSource: 'USDA' });
    console.log(`Cleared ${deleteResult.deletedCount} existing USDA entries\n`);

    // Import each CSV file
    let totalImported = 0;
    for (const file of files) {
      const csvPath = path.join(dataDir, file);
      const count = await parseAndImportUSDA(csvPath, file);
      totalImported += count;
    }

    console.log(`\n✓ Import complete! Total items: ${totalImported}`);

    // Print summary
    const summary = await FoodItem.aggregate([
      { $match: { dataSource: 'USDA' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('\nCategory breakdown:');
    summary.forEach(s => {
      console.log(`  ${s._id}: ${s.count}`);
    });

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

module.exports = { main };

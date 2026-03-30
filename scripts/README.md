# Data Import Scripts

ETL scripts for importing nutrition data from USDA FoodData Central and IFCT 2017 databases.

## Prerequisites

```bash
# Install required dependencies
npm install @nodef/ifct2017 adm-zip csv-parse dotenv
```

## USDA Import

### Download Data

1. Visit [USDA FoodData Central Downloads](https://fdc.nal.usda.gov/download-datasets/)
2. Download these datasets:
   - **Foundation Foods** (CSV format, ~29MB)
   - **SR Legacy** (CSV format, ~54MB)
3. Extract the ZIP files
4. Copy the extracted CSV files to `Backend/data/usda/`

### Run Import

```bash
node Backend/scripts/importUSDA.js
```

The script will:
- Connect to MongoDB
- Clear existing USDA entries
- Parse CSV files from `Backend/data/usda/`
- Filter relevant foods (excludes supplements, baby food, etc.)
- Categorize foods automatically
- Bulk insert to `food_items` collection
- Print category summary

**Expected output:** ~50,000 food items imported

## IFCT Import

### Prerequisites

The IFCT 2017 data is available via npm package (already installed).

### Run Import

```bash
node Backend/scripts/importIFCT.js
```

The script will:
- Connect to MongoDB
- Load IFCT 2017 data from `@nodef/ifct2017` package
- Clear existing IFCT entries
- Generate regional aliases (Hindi, Tamil, Telugu)
- Categorize Indian foods
- Bulk insert to `food_items` collection
- Print category summary and sample foods

**Expected output:** 542 Indian food items imported

## Verification

After running both imports, verify the data:

```javascript
// In MongoDB shell or using Mongoose
db.food_items.countDocuments({ dataSource: 'USDA' })
db.food_items.countDocuments({ dataSource: 'IFCT' })

// Check categories
db.food_items.aggregate([
  { $group: { _id: '$dataSource', count: { $sum: 1 } } }
])

// Sample foods
db.food_items.find({ dataSource: 'IFCT' }).limit(5)
```

## Troubleshooting

### MongoDB Connection Error

Ensure your `.env` file has the correct `MONGODB_URI`:

```env
MONGODB_URI=mongodb://localhost:27017/caltrack
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/caltrack
```

### USDA CSV Not Found

Make sure CSV files are in the correct location:
```
Backend/
  data/
    usda/
      food.csv
      nutrient.csv
      (other CSV files)
```

### IFCT Package Not Found

Install the npm package:
```bash
npm install @nodef/ifct2017
```

## Re-importing

To re-import data (e.g., for USDA updates), simply run the scripts again. They will:
1. Delete all existing entries for that data source
2. Re-import fresh data

USDA updates their data bi-annually (April and October).

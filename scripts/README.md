# Data Import Scripts

ETL scripts for importing nutrition data from USDA FoodData Central and IFCT 2017 databases.

---

## Question identity (CAL-30)

Canonical onboarding questions are now identified by a content-derived
`slug` (e.g. `goal_type`, `rate_loss`) rather than by raw Mongo `_id` hex
or by `sequence` number. This solves the failure mode where fresh deploys
/ CI in-memory Mongo / DR restores mint different `_id`s and silently
drop pinned questions from the chain.

### Backfill an existing DB

Run once per environment after deploying the schema change:

```bash
node Backend/scripts/backfill_question_slugs.js          # dry-run
node Backend/scripts/backfill_question_slugs.js --apply  # persist
```

Idempotent. The script finds canonical questions by content fingerprint
(NOT by `_id`) and refuses to overwrite an existing slug or to guess
when multiple docs match a fingerprint.

### Lookup ladder for new migrations

When a migration needs to identify a canonical question, follow this
order — each rung is a fallback if the previous one returns nothing:

1. **`Question.findOne({ slug, isActive: true })`** — primary identity.
2. **`Question.findById(PINNED_ID)`** — only if the question still has a
   hardcoded `_id` pin in production code (e.g. CAL-9's bloc pin). Drop
   this rung once the pin is retired.
3. **`Question.findOne({ sequence })`** + content-shape guard — historical
   fallback for envs that ran the seed but not yet the slug backfill.
4. **Pure content fingerprint** — last-ditch single-match check.
5. **Fail loud** — `throw` rather than upsert into a wrong row.

### Upsert pattern

Always upsert by `slug` and include both `slug` and `sequence` in `$set`:

```js
{
  filter: { slug: 'rate_loss' },
  update: {
    $set: {
      slug: 'rate_loss',     // ← stable identity
      sequence: 13.3,        // ← FE chain ordering
      text: '…',
      type: 'SELECT',
      // …other fields
    },
  },
  upsert: true,
}
```

### Pre-flight guard

If your migration upserts by slug and the DB already has rows that were
seeded under the legacy `sequence`-keyed filter, the slug filter would
not match and would create duplicates. Add a pre-flight check that
detects `findOne({ slug })` is null while `findOne({ sequence })` is not,
and abort with a runbook line pointing at `backfill_question_slugs.js`.
See `assertSlugBackfillRun()` in `migrate_onboarding_cal18.js` for the
reference implementation.

### Migrations still on the legacy pattern

These migrations pre-mint stable `_id`s in-script, so they don't exhibit
CAL-30's failure mode and were deliberately left on the legacy lookup.
Retrofit opportunistically when next touched:

- `migrate_onboarding_cal24.js`
- `migrate_onboarding_cal35.js`
- `migrate_onboarding_cal35_section_d.js`

---

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

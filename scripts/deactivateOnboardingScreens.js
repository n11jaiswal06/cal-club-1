const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

// Onboarding screens removed per product decision:
// - seq=1:  "Calorie tracking\nmade easy."       (NO_INPUT intro)
// - seq=2:  "Before we begin, what\nshould we
//            call you?"                          (NAME_INPUT — name now sourced from Firebase token)
// - seq=3:  "Hi, {name}! Let's get to know you
//            first"                              (NO_INPUT greeting)
// - seq=19: "Enter Referral Code\n(Optional)"    (REFERRAL_INPUT — not used server-side)
const TARGET_IDS = [
  '6908fe66896ccf24778c9072',
  '6908fe66896ccf24778c9073',
  '6908fe66896ccf24778c9074',
  '6908fe66896ccf24778c9084',
];

async function deactivate() {
  const mongoUri = process.env.MONGO_URI_NEW || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI_NEW (or MONGO_URI) must be set in environment.');
  }
  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB\n');

  try {
    for (const id of TARGET_IDS) {
      const q = await Question.findById(id).select('_id text isActive sequence type').lean();

      if (!q) {
        console.log(`⚠️  No question found with _id=${id}`);
        continue;
      }

      const label = `${q._id}  seq=${q.sequence}  type=${q.type}  ${JSON.stringify(q.text)}`;

      if (q.isActive === false) {
        console.log(`•  Already inactive — ${label}`);
        continue;
      }

      await Question.updateOne({ _id: q._id }, { $set: { isActive: false } });
      console.log(`✓  Deactivated    ${label}`);
    }

    const remaining = await Question.countDocuments({ isActive: true });
    console.log(`\n✓ Done. ${remaining} active onboarding questions remaining.`);
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

deactivate();

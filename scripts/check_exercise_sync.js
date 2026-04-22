#!/usr/bin/env node
/**
 * Asserts that data/exerciseDatabase.js (backend) and lib/data/exercise_data.dart
 * (frontend, fetched live from GitHub main) agree on every exercise's
 * (id, name, category, icon, met_low, met_moderate, met_high, sort_order).
 *
 * Runs in CI on every backend PR that touches exerciseDatabase.js. Fails the
 * build on drift, printing a diff so the author knows exactly which fields
 * to reconcile.
 *
 * Usage: node scripts/check_exercise_sync.js
 *
 * Env overrides (for local/test use):
 *   FRONTEND_EXERCISE_URL  — URL of the frontend file (default: GitHub main)
 *   FRONTEND_EXERCISE_PATH — local file path instead of network fetch
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_FRONTEND_URL =
  'https://raw.githubusercontent.com/n11jaiswal06/cal-club/main/lib/data/exercise_data.dart';

const REQUIRED_FIELDS = ['name', 'category', 'icon', 'met_low', 'met_moderate', 'met_high', 'sort_order'];

function loadBackend() {
  const { exercises } = require(path.join(__dirname, '..', 'data', 'exerciseDatabase.js'));
  const out = {};
  for (const [id, ex] of Object.entries(exercises)) {
    out[id] = {
      name: ex.name,
      category: ex.category,
      icon: ex.icon,
      met_low: ex.met_low,
      met_moderate: ex.met_moderate,
      met_high: ex.met_high,
      sort_order: ex.sort_order,
    };
  }
  return out;
}

async function fetchFrontendSource() {
  if (process.env.FRONTEND_EXERCISE_PATH) {
    return fs.readFileSync(process.env.FRONTEND_EXERCISE_PATH, 'utf8');
  }
  const url = process.env.FRONTEND_EXERCISE_URL || DEFAULT_FRONTEND_URL;
  const res = await fetch(url);
  // During initial rollout, the frontend file may not exist on main yet.
  // Allow the check to pass with a warning so the backend can ship first.
  // Once the frontend PR lands, the file exists and subsequent checks
  // gate on real drift.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch frontend source: ${res.status} ${res.statusText} (${url})`);
  return res.text();
}

// Parses one Exercise(...) constructor call in the .dart file.
// Order-independent for named args. Handles both ints (3) and floats (3.5).
function parseDartExercise(line) {
  const extract = (field) => {
    const m = line.match(new RegExp(`${field}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|([0-9.]+))`));
    if (!m) return undefined;
    return m[1] ?? m[2] ?? Number(m[3]);
  };
  return {
    id: extract('id'),
    name: extract('name'),
    category: extract('category'),
    icon: extract('icon'),
    met_low: extract('metLow'),
    met_moderate: extract('metModerate'),
    met_high: extract('metHigh'),
    sort_order: extract('sortOrder'),
  };
}

function parseFrontend(source) {
  const out = {};
  const lines = source.split('\n');
  for (const line of lines) {
    if (!/Exercise\s*\(/.test(line)) continue;
    const ex = parseDartExercise(line);
    if (ex.id == null) continue;
    const { id, ...rest } = ex;
    out[id] = rest;
  }
  return out;
}

function diff(backend, frontend) {
  const diffs = [];
  const allIds = new Set([...Object.keys(backend), ...Object.keys(frontend)]);
  for (const id of [...allIds].sort()) {
    const b = backend[id];
    const f = frontend[id];
    if (!b) { diffs.push(`+ ${id}: missing on backend (present on frontend)`); continue; }
    if (!f) { diffs.push(`- ${id}: missing on frontend (present on backend)`); continue; }
    for (const field of REQUIRED_FIELDS) {
      if (b[field] !== f[field]) {
        diffs.push(`~ ${id}.${field}: backend=${JSON.stringify(b[field])} frontend=${JSON.stringify(f[field])}`);
      }
    }
  }
  return diffs;
}

(async () => {
  const backend = loadBackend();
  const frontendSource = await fetchFrontendSource();
  if (frontendSource === null) {
    console.log(`Backend exercises: ${Object.keys(backend).length}`);
    console.warn('⚠️  Frontend file not found on main yet — skipping drift check.');
    console.warn('   This is expected during the initial rollout of the exercise list.');
    console.warn('   Once lib/data/exercise_data.dart lands on frontend main, subsequent');
    console.warn('   PRs will gate on real drift.');
    process.exit(0);
  }
  const frontend = parseFrontend(frontendSource);

  const backendCount = Object.keys(backend).length;
  const frontendCount = Object.keys(frontend).length;
  console.log(`Backend exercises: ${backendCount}`);
  console.log(`Frontend exercises: ${frontendCount}`);

  const diffs = diff(backend, frontend);
  if (diffs.length === 0) {
    console.log('✅ Exercise lists are in sync.');
    process.exit(0);
  }

  console.error(`❌ Exercise list drift detected (${diffs.length} difference${diffs.length === 1 ? '' : 's'}):`);
  for (const d of diffs) console.error('  ' + d);
  console.error('\nFix: update whichever side is stale so both agree on every exercise.');
  console.error('Backend file:  data/exerciseDatabase.js');
  console.error('Frontend file: lib/data/exercise_data.dart (in n11jaiswal06/cal-club)');
  process.exit(1);
})().catch((e) => {
  console.error('check_exercise_sync failed:', e.message);
  process.exit(2);
});

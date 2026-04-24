const FoodItem = require('../models/schemas/FoodItem');
const vectorSearchService = require('../services/vectorSearchService');
const { reportError } = require('../utils/sentryReporter');

const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 8;
const SEMANTIC_FALLBACK_THRESHOLD = 5;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify how a food matched the query so we can rank:
 *   1 name_prefix        "rot" → "Roti"
 *   2 name_word_prefix   "yogurt" → "Skyr yogurt dip" (query starts a word in the name)
 *   3 alias_prefix       "rot" → "Chapati" (alias "roti")
 *   4 name_contains      "rot" → "Parotta"
 *   5 alias_contains     "rot" → food whose alias includes "...rot..."
 *   6 semantic           vector similarity (no substring match)
 *
 * Rationale for name_word_prefix above alias_prefix: when the query word
 * literally appears in a food's name (as a standalone word), that's a
 * stronger signal than a synonym match via aliases. "yogurt" should surface
 * "Skyr yogurt dip" ahead of Indian items whose aliases include "yogurt" as
 * a translation for "dahi".
 */
function classifyMatch(food, queryLower) {
  const nameLower = (food.name || '').toLowerCase();
  const aliases = (food.aliases || []).map(a => String(a).toLowerCase());

  if (nameLower.startsWith(queryLower)) return { tier: 1, label: 'name_prefix' };

  const nameWords = nameLower.split(/[\s,()\-]+/).filter(Boolean);
  if (nameWords.slice(1).some(w => w.startsWith(queryLower))) {
    return { tier: 2, label: 'name_word_prefix' };
  }

  if (aliases.some(a => a.startsWith(queryLower))) return { tier: 3, label: 'alias_prefix' };
  if (nameLower.includes(queryLower)) return { tier: 4, label: 'name_contains' };
  if (aliases.some(a => a.includes(queryLower))) return { tier: 5, label: 'alias_contains' };
  return { tier: 6, label: 'semantic' };
}

function projectFood(food, matchLabel) {
  return {
    foodItemId: food._id,
    name: food.name,
    category: food.category,
    servingSizes: food.servingSizes || [],
    caloriesPer100g: food.caloriesPer100g,
    proteinPer100g: food.proteinPer100g,
    carbsPer100g: food.carbsPer100g,
    fatPer100g: food.fatPer100g,
    fiberPer100g: food.fiberPer100g || 0,
    usageCount: food.usageCount || 0,
    match: matchLabel
  };
}

async function searchFoods(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = (url.searchParams.get('q') || '').trim();

    if (q.length < MIN_QUERY_LENGTH) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [], query: q }));
      return true;
    }

    if (q.length > MAX_QUERY_LENGTH) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `Query too long (max ${MAX_QUERY_LENGTH} characters).`
      }));
      return true;
    }

    const queryLower = q.toLowerCase();
    const escaped = escapeRegex(queryLower);
    const substringRegex = new RegExp(escaped, 'i');

    const dbResults = await FoodItem.find({
      $or: [
        { name: substringRegex },
        { aliases: substringRegex }
      ]
    })
      .sort({ usageCount: -1 })
      .lean();

    const seen = new Set();
    const classified = [];
    for (const food of dbResults) {
      const id = String(food._id);
      if (seen.has(id)) continue;
      seen.add(id);
      const { tier, label } = classifyMatch(food, queryLower);
      classified.push({ food, tier, label, confidence: null });
    }

    // Semantic fallback only when substring match didn't give us enough candidates.
    // Vector search is ~100-200ms so we skip it on the fast path.
    if (classified.length < SEMANTIC_FALLBACK_THRESHOLD) {
      try {
        const semanticHits = await vectorSearchService.semanticSearch(q, null, MAX_RESULTS);
        const newIds = semanticHits
          .map(h => h.food?._id)
          .filter(id => id && !seen.has(String(id)));

        if (newIds.length > 0) {
          // Re-fetch to pick up servingSizes (not in vectorSearchService's projection).
          const fullDocs = await FoodItem.find({ _id: { $in: newIds } }).lean();
          const byId = new Map(fullDocs.map(d => [String(d._id), d]));
          for (const hit of semanticHits) {
            const id = String(hit.food?._id || '');
            if (!id || seen.has(id)) continue;
            const full = byId.get(id);
            if (!full) continue;
            seen.add(id);
            classified.push({
              food: full,
              tier: 6,
              label: 'semantic',
              confidence: hit.confidence || 0
            });
          }
        }
      } catch (err) {
        // Semantic is supplementary — log and continue with substring results.
        console.warn(`[foods/search] semantic fallback failed for "${q}": ${err.message}`);
      }
    }

    // Tier ascending, then: semantic tier by vector confidence desc,
    // substring tiers by usageCount desc.
    classified.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 6) return (b.confidence || 0) - (a.confidence || 0);
      return (b.food.usageCount || 0) - (a.food.usageCount || 0);
    });

    const results = classified
      .slice(0, MAX_RESULTS)
      .map(c => projectFood(c.food, c.label));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results, query: q }));
    return true;
  } catch (err) {
    reportError(err, { req });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Search failed', details: err.message }));
    return true;
  }
}

module.exports = { searchFoods };

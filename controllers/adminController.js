const FoodItem = require('../models/schemas/FoodItem');
const parseBody = require('../utils/parseBody');

/**
 * GET /admin/api/food-items
 * List food items with filters, search, pagination, sorting.
 * Query params: page, limit, search, dataSource, reviewed, verified, category, sort
 */
async function listFoodItems(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit')) || 50));
    const search = url.searchParams.get('search');
    const dataSource = url.searchParams.get('dataSource');
    const reviewed = url.searchParams.get('reviewed');
    const verified = url.searchParams.get('verified');
    const category = url.searchParams.get('category');
    const sort = url.searchParams.get('sort') || '-createdAt';

    const filter = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { aliases: { $regex: escaped, $options: 'i' } }
      ];
    }
    if (dataSource) filter.dataSource = dataSource;
    if (reviewed === 'true') filter.reviewed = true;
    if (reviewed === 'false') filter.reviewed = false;
    if (verified === 'true') filter.verified = true;
    if (verified === 'false') filter.verified = false;
    if (category) filter.category = category;

    // Build sort object from string like "-createdAt" or "name"
    const sortObj = {};
    if (sort.startsWith('-')) {
      sortObj[sort.slice(1)] = -1;
    } else {
      sortObj[sort] = 1;
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      FoodItem.find(filter)
        .select('-embedding')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
      FoodItem.countDocuments(filter)
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }));
  } catch (err) {
    console.error('Admin listFoodItems error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch food items' }));
  }
}

/**
 * GET /admin/api/food-items/:id
 */
async function getFoodItem(req, res, id) {
  try {
    const item = await FoodItem.findById(id).select('-embedding').lean();
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Food item not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(item));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch food item' }));
  }
}

/**
 * PATCH /admin/api/food-items/:id
 * Partial update of any FoodItem field.
 */
async function updateFoodItem(req, res, id) {
  parseBody(req, async (err, body) => {
    if (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    try {
      // Whitelist of editable fields
      const allowedFields = [
        'name', 'aliases', 'category', 'itemType', 'dataSource',
        'caloriesPer100g', 'proteinPer100g', 'carbsPer100g', 'fatPer100g', 'fiberPer100g',
        'verified', 'reviewed'
      ];

      const update = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          update[field] = body[field];
        }
      }

      if (Object.keys(update).length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No valid fields to update' }));
        return;
      }

      const item = await FoodItem.findByIdAndUpdate(id, update, { new: true, runValidators: true })
        .select('-embedding')
        .lean();

      if (!item) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Food item not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item));
    } catch (updateErr) {
      console.error('Admin updateFoodItem error:', updateErr);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to update food item' }));
    }
  });
}

/**
 * DELETE /admin/api/food-items/:id
 */
async function deleteFoodItem(req, res, id) {
  try {
    const item = await FoodItem.findByIdAndDelete(id);
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Food item not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to delete food item' }));
  }
}

/**
 * POST /admin/api/food-items/:id/reviewed
 */
async function markReviewed(req, res, id) {
  try {
    const item = await FoodItem.findByIdAndUpdate(id, { reviewed: true }, { new: true })
      .select('-embedding')
      .lean();
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Food item not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(item));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to mark as reviewed' }));
  }
}

/**
 * POST /admin/api/food-items/bulk-review
 * Body: { ids: [id1, id2, ...] }
 */
async function bulkReview(req, res) {
  parseBody(req, async (err, body) => {
    if (err || !body.ids || !Array.isArray(body.ids)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid body, expected { ids: [...] }' }));
      return;
    }

    try {
      const result = await FoodItem.updateMany(
        { _id: { $in: body.ids } },
        { reviewed: true }
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ modifiedCount: result.modifiedCount }));
    } catch (bulkErr) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to bulk review' }));
    }
  });
}

/**
 * POST /admin/api/food-items/bulk-delete
 * Body: { ids: [id1, id2, ...] }
 */
async function bulkDelete(req, res) {
  parseBody(req, async (err, body) => {
    if (err || !body.ids || !Array.isArray(body.ids)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid body, expected { ids: [...] }' }));
      return;
    }

    try {
      const result = await FoodItem.deleteMany({ _id: { $in: body.ids } });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deletedCount: result.deletedCount }));
    } catch (bulkErr) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to bulk delete' }));
    }
  });
}

/**
 * GET /admin/api/stats
 * Dashboard counts: total, unreviewed, by source, by category.
 */
async function getStats(req, res) {
  try {
    const [total, unreviewed, bySource, byCategory] = await Promise.all([
      FoodItem.countDocuments(),
      FoodItem.countDocuments({ reviewed: false }),
      FoodItem.aggregate([
        { $group: { _id: '$dataSource', count: { $sum: 1 } } }
      ]),
      FoodItem.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ])
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total,
      unreviewed,
      bySource: Object.fromEntries(bySource.map(s => [s._id, s.count])),
      byCategory: Object.fromEntries(byCategory.map(c => [c._id, c.count]))
    }));
  } catch (err) {
    console.error('Admin getStats error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch stats' }));
  }
}

module.exports = {
  listFoodItems,
  getFoodItem,
  updateFoodItem,
  deleteFoodItem,
  markReviewed,
  bulkReview,
  bulkDelete,
  getStats
};

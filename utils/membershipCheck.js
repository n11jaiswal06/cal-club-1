/**
 * Cached membership check utility.
 *
 * Checks BOTH RevenueCat AND local Membership DB, granting access if
 * EITHER source says the user is active.  This handles the edge case
 * where a Razorpay payment was saved locally but the RC promotional
 * grant failed (RC is reachable but has no entitlement).
 *
 * Results are cached for 5 minutes.  The cache is invalidated instantly
 * by webhooks (Razorpay + RevenueCat) when subscription status changes,
 * so the long TTL doesn't cause staleness.
 */

const RevenueCatService = require('../services/revenuecatService');
const { PREMIUM_ENTITLEMENT_ID } = require('../config/revenuecat');

// In-memory cache: userId -> { result, expiry }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (webhooks call invalidateCache on change)

/**
 * @param {string} userId
 * @returns {Promise<{hasAccess: boolean, isPremium: boolean, isInTrial: boolean, expiresDate: string|null, productIdentifier: string|null, willRenew: boolean}>}
 */
async function checkMembership(userId) {
  if (!userId) {
    return { hasAccess: false, isPremium: false, isInTrial: false, expiresDate: null, productIdentifier: null, willRenew: true };
  }

  const key = String(userId);

  // Return cached value if fresh
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.result;
  }

  // Query both sources in parallel
  const [rcResult, localResult] = await Promise.all([
    checkRevenueCat(key),
    checkLocalDB(key)
  ]);

  // Union: grant access if EITHER source says active.
  // Prefer RC's richer data (trial info, product) when RC says active;
  // otherwise fall back to local data.
  let result;

  if (rcResult.active) {
    // RC is the primary source -- use its data
    result = {
      hasAccess: true,
      isPremium: true,
      isInTrial: rcResult.isInTrial,
      expiresDate: rcResult.expiresDate,
      productIdentifier: rcResult.productIdentifier,
      willRenew: rcResult.willRenew
    };
  } else if (localResult.hasAccess) {
    // RC says no, but local DB says yes (e.g. RC grant failed after Razorpay payment)
    console.log(`ℹ️ [MEMBERSHIP] RC has no entitlement but local DB has active membership for ${key} -- granting access`);
    result = {
      hasAccess: true,
      isPremium: true,
      isInTrial: false, // local DB doesn't track trial vs paid
      expiresDate: localResult.expiresDate,
      productIdentifier: null,
      willRenew: localResult.willRenew
    };
  } else {
    // Neither source has access. Default willRenew: true is the
    // safe value since the client only renders cancellation copy
    // when the user actually has access.
    result = {
      hasAccess: false,
      isPremium: false,
      isInTrial: false,
      expiresDate: null,
      productIdentifier: null,
      willRenew: true
    };
  }

  cache.set(key, { result, expiry: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Check RevenueCat for active entitlement.
 * Returns a safe default on error (does not throw).
 */
async function checkRevenueCat(userId) {
  try {
    return await RevenueCatService.hasActiveEntitlement(userId, PREMIUM_ENTITLEMENT_ID);
  } catch (error) {
    console.error(`⚠️ [MEMBERSHIP] RevenueCat API error for ${userId}:`, error.message);
    return { active: false, isInTrial: false, expiresDate: null, productIdentifier: null, willRenew: true };
  }
}

/**
 * Check local Membership collection.
 * Returns a safe default on error (does not throw).
 *
 * `willRenew` is sourced from the linked Subscription's
 * `autoRenewing` field (set at purchase time and updated by
 * Apple / Google / Razorpay webhooks). Defaults to `true` if the
 * Subscription record can't be loaded.
 */
async function checkLocalDB(userId) {
  try {
    const Membership = require('../models/schemas/Membership');
    const Subscription = require('../models/schemas/Subscription');
    const now = new Date();

    const membership = await Membership.findOne({
      userId,
      end: { $gt: now },
      status: { $in: ['purchased', 'active'] }
    }).sort({ end: -1 }).lean();

    if (!membership) {
      return { hasAccess: false, expiresDate: null, willRenew: true };
    }

    const subscription = await Subscription
      .findById(membership.subscriptionId)
      .lean();
    // `autoRenewing` is the schema field that mirrors RC's
    // `unsubscribe_detected_at` (inverted). Default true on missing
    // record so the client renders the safe "renews" copy.
    const willRenew = subscription?.autoRenewing ?? true;

    return {
      hasAccess: true,
      expiresDate: membership.end.toISOString(),
      willRenew
    };
  } catch (dbError) {
    console.error(`⚠️ [MEMBERSHIP] Local DB error for ${userId}:`, dbError.message);
    return { hasAccess: false, expiresDate: null, willRenew: true };
  }
}

/**
 * Invalidate cache for a user (call after webhook updates).
 * @param {string} userId
 */
function invalidateCache(userId) {
  cache.delete(String(userId));
}

module.exports = {
  checkMembership,
  invalidateCache
};

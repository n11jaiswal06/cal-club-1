/**
 * RevenueCat REST API service (V1).
 *
 * Uses the V1 /subscribers endpoint which returns entitlements for
 * all platforms (mobile + web + promotional).
 */

const {
  REVENUECAT_API_KEY,
  REVENUECAT_BASE_URL,
  PREMIUM_ENTITLEMENT_ID
} = require('../config/revenuecat');

class RevenueCatService {
  /**
   * Fetch full subscriber info from RevenueCat.
   * @param {string} appUserId - Your internal userId (must match the app_user_id set in client SDK)
   * @returns {Promise<Object>} - Raw subscriber object from RC
   */
  static async getSubscriberInfo(appUserId) {
    const url = `${REVENUECAT_BASE_URL}/subscribers/${encodeURIComponent(String(appUserId))}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${REVENUECAT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RevenueCat API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.subscriber;
  }

  /**
   * Check whether a user has an active entitlement.
   * @param {string} appUserId
   * @param {string} [entitlementId] - defaults to PREMIUM_ENTITLEMENT_ID
   * @returns {Promise<{active: boolean, isInTrial: boolean, expiresDate: string|null, productIdentifier: string|null, willRenew: boolean}>}
   */
  static async hasActiveEntitlement(appUserId, entitlementId = PREMIUM_ENTITLEMENT_ID) {
    try {
      const subscriber = await this.getSubscriberInfo(appUserId);
      return RevenueCatService._parseEntitlement(subscriber, entitlementId);
    } catch (error) {
      console.error(`❌ [REVENUECAT] Error checking entitlement for ${appUserId}:`, error.message);
      throw error;
    }
  }

  /**
   * Pure parser for the RevenueCat V1 subscriber payload. Extracted
   * from [hasActiveEntitlement] so the entitlement / willRenew logic
   * can be unit-tested without mocking fetch.
   *
   * `willRenew` is sourced from `subscriber.subscriptions[productId]
   * .unsubscribe_detected_at` — RC sets this timestamp the moment it
   * detects a cancellation in the upstream store (App Store / Play),
   * regardless of whether expiresDate has passed yet. Default `true`
   * when no matching subscription record is present (e.g. promotional
   * grants made via [grantEntitlement]).
   *
   * @param {Object|null|undefined} subscriber - `data.subscriber` from RC V1
   * @param {string} entitlementId
   * @returns {{active: boolean, isInTrial: boolean, expiresDate: string|null, productIdentifier: string|null, willRenew: boolean}}
   */
  static _parseEntitlement(subscriber, entitlementId) {
    const entitlement = subscriber?.entitlements?.[entitlementId];

    if (!entitlement) {
      return { active: false, isInTrial: false, expiresDate: null, productIdentifier: null, willRenew: true };
    }

    const expiresDate = entitlement.expires_date;
    const now = new Date();

    // An entitlement with no expires_date is lifetime / non-expiring
    const isActive = !expiresDate || new Date(expiresDate) > now;
    const isInTrial = entitlement.period_type === 'trial';
    const productIdentifier = entitlement.product_identifier || null;

    const subscription = productIdentifier
      ? subscriber?.subscriptions?.[productIdentifier]
      : null;
    const willRenew = !subscription?.unsubscribe_detected_at;

    return {
      active: isActive,
      isInTrial: isActive ? isInTrial : false,
      expiresDate: expiresDate || null,
      productIdentifier,
      willRenew
    };
  }

  /**
   * Grant a promotional entitlement (used for Razorpay UPI purchases).
   * @param {string} appUserId
   * @param {number} durationDays - how many days to grant
   * @param {string} [entitlementId] - defaults to PREMIUM_ENTITLEMENT_ID
   * @returns {Promise<Object>} - Updated subscriber info
   */
  static async grantEntitlement(appUserId, durationDays, entitlementId = PREMIUM_ENTITLEMENT_ID) {
    // Map days to RC duration keywords
    let duration;
    if (durationDays <= 3) duration = 'three_day';
    else if (durationDays <= 7) duration = 'weekly';
    else if (durationDays <= 31) duration = 'monthly';
    else if (durationDays <= 62) duration = 'two_month';
    else if (durationDays <= 93) duration = 'three_month';
    else if (durationDays <= 186) duration = 'six_month';
    else if (durationDays <= 366) duration = 'yearly';
    else duration = 'lifetime';

    const url = `${REVENUECAT_BASE_URL}/subscribers/${encodeURIComponent(String(appUserId))}/entitlements/${encodeURIComponent(entitlementId)}/promotional`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REVENUECAT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ duration })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RevenueCat grant entitlement error ${res.status}: ${body}`);
    }

    const data = await res.json();
    console.log(`✅ [REVENUECAT] Granted ${duration} '${entitlementId}' to ${appUserId}`);
    return data.subscriber;
  }

  /**
   * Revoke all promotional entitlements for a user.
   * @param {string} appUserId
   * @param {string} [entitlementId] - defaults to PREMIUM_ENTITLEMENT_ID
   * @returns {Promise<Object>}
   */
  static async revokeEntitlement(appUserId, entitlementId = PREMIUM_ENTITLEMENT_ID) {
    const url = `${REVENUECAT_BASE_URL}/subscribers/${encodeURIComponent(String(appUserId))}/entitlements/${encodeURIComponent(entitlementId)}/revoke_promotionals`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REVENUECAT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RevenueCat revoke entitlement error ${res.status}: ${body}`);
    }

    const data = await res.json();
    console.log(`✅ [REVENUECAT] Revoked promotional '${entitlementId}' from ${appUserId}`);
    return data.subscriber;
  }
}

module.exports = RevenueCatService;

// Pure-function tests for RevenueCatService._parseEntitlement —
// extracted from hasActiveEntitlement so the entitlement / willRenew
// logic can be exercised without mocking fetch. CAL-7 / CAL-12
// regression guards: willRenew must reflect the upstream cancellation
// state (RC sets `unsubscribe_detected_at` the moment the user taps
// Cancel in the App Store / Play sheet), so the client can swap to
// the "ends on …, won't renew" copy without waiting for expiresDate
// to pass.

const RevenueCatService = require('../services/revenuecatService');

const ENTITLEMENT_ID = 'premium';

const futureIso = () =>
  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const pastIso = () =>
  new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe('RevenueCatService._parseEntitlement', () => {
  test('no entitlement → inactive, willRenew defaults true (safe copy)', () => {
    const result = RevenueCatService._parseEntitlement(
      { entitlements: {}, subscriptions: {} },
      ENTITLEMENT_ID,
    );
    expect(result).toEqual({
      active: false,
      isInTrial: false,
      expiresDate: null,
      productIdentifier: null,
      willRenew: true,
    });
  });

  test('null subscriber payload → inactive, willRenew true', () => {
    const result = RevenueCatService._parseEntitlement(null, ENTITLEMENT_ID);
    expect(result.active).toBe(false);
    expect(result.willRenew).toBe(true);
  });

  test('active entitlement, subscription not cancelled → active + willRenew true', () => {
    const subscriber = {
      entitlements: {
        [ENTITLEMENT_ID]: {
          expires_date: futureIso(),
          period_type: 'normal',
          product_identifier: '1_month_pro',
        },
      },
      subscriptions: {
        '1_month_pro': {
          expires_date: futureIso(),
          unsubscribe_detected_at: null,
        },
      },
    };
    const result = RevenueCatService._parseEntitlement(
      subscriber,
      ENTITLEMENT_ID,
    );
    expect(result.active).toBe(true);
    expect(result.willRenew).toBe(true);
    expect(result.isInTrial).toBe(false);
    expect(result.productIdentifier).toBe('1_month_pro');
  });

  test('CAL-12: active + unsubscribe_detected_at present → willRenew false (cancellation pending)', () => {
    const subscriber = {
      entitlements: {
        [ENTITLEMENT_ID]: {
          expires_date: futureIso(),
          period_type: 'normal',
          product_identifier: '1_month_pro',
        },
      },
      subscriptions: {
        '1_month_pro': {
          expires_date: futureIso(),
          unsubscribe_detected_at: pastIso(),
        },
      },
    };
    const result = RevenueCatService._parseEntitlement(
      subscriber,
      ENTITLEMENT_ID,
    );
    expect(result.active).toBe(true);
    expect(result.willRenew).toBe(false);
  });

  test('trial period_type → isInTrial true; willRenew unaffected by trial', () => {
    const subscriber = {
      entitlements: {
        [ENTITLEMENT_ID]: {
          expires_date: futureIso(),
          period_type: 'trial',
          product_identifier: '1_month_pro',
        },
      },
      subscriptions: {
        '1_month_pro': {
          expires_date: futureIso(),
          unsubscribe_detected_at: null,
        },
      },
    };
    const result = RevenueCatService._parseEntitlement(
      subscriber,
      ENTITLEMENT_ID,
    );
    expect(result.active).toBe(true);
    expect(result.isInTrial).toBe(true);
    expect(result.willRenew).toBe(true);
  });

  test('promotional grant (no underlying subscription record) → willRenew defaults true', () => {
    const subscriber = {
      entitlements: {
        [ENTITLEMENT_ID]: {
          expires_date: futureIso(),
          period_type: 'normal',
          product_identifier: 'promo_grant',
        },
      },
      // No `subscriptions['promo_grant']` — common for RC promotional
      // entitlements (e.g. Razorpay-paid users) where there is no
      // underlying store subscription record.
      subscriptions: {},
    };
    const result = RevenueCatService._parseEntitlement(
      subscriber,
      ENTITLEMENT_ID,
    );
    expect(result.active).toBe(true);
    expect(result.willRenew).toBe(true);
  });

  test('expired entitlement → inactive, isInTrial scrubbed to false', () => {
    const subscriber = {
      entitlements: {
        [ENTITLEMENT_ID]: {
          expires_date: pastIso(),
          period_type: 'trial',
          product_identifier: '1_month_pro',
        },
      },
      subscriptions: {},
    };
    const result = RevenueCatService._parseEntitlement(
      subscriber,
      ENTITLEMENT_ID,
    );
    expect(result.active).toBe(false);
    expect(result.isInTrial).toBe(false);
  });

  test('lifetime entitlement (no expires_date) → active, willRenew true', () => {
    const subscriber = {
      entitlements: {
        [ENTITLEMENT_ID]: {
          expires_date: null,
          period_type: 'normal',
          product_identifier: 'lifetime_unlock',
        },
      },
      subscriptions: {},
    };
    const result = RevenueCatService._parseEntitlement(
      subscriber,
      ENTITLEMENT_ID,
    );
    expect(result.active).toBe(true);
    expect(result.expiresDate).toBe(null);
    expect(result.willRenew).toBe(true);
  });
});

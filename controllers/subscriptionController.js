const Subscription = require('../models/schemas/Subscription');
const Plan = require('../models/schemas/Plan');
const Membership = require('../models/schemas/Membership');
const paymentService = require('../services/paymentService');
const googlePlayService = require('../services/googlePlayService');
const { GooglePlayService } = require('../services/googlePlayService');
const appleStoreService = require('../services/appleStoreService');
const { AppleStoreService } = require('../services/appleStoreService');
const parseBody = require('../utils/parseBody');
const { reportError } = require('../utils/sentryReporter');

async function createSubscription(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    const { external_plan_id } = body;
    const userId = req.user.userId;

    if (!external_plan_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'external_plan_id is required' }));
      return;
    }

    // Create subscription in Razorpay with 7-day trial
    const razorpaySubscription = await paymentService.createSubscription(
      external_plan_id, // Use the external_plan_id from request
      null, // No customer ID for now
      {
        totalCount: 1,
        quantity: 1,
        customerNotify: true,
        trialDays: 7, // 7-day trial period
        trialAmount: 0 // Free trial
      }
    );

    // Log the Razorpay subscription response
    console.log('Razorpay subscription created:', JSON.stringify(razorpaySubscription, null, 2));

    // Save subscription to database
    const subscription = new Subscription({
      userId: userId,
      provider: 'RAZORPAY',
      external_subscription_id: razorpaySubscription.id,
      external_plan_id: external_plan_id,
      status: razorpaySubscription.status
    });

    await subscription.save();

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Subscription created successfully',
      external_subscription_id: subscription.external_subscription_id,
      subscription: {
        id: subscription._id,
        external_subscription_id: subscription.external_subscription_id,
        external_plan_id: subscription.external_plan_id,
        status: subscription.status,
        razorpay_subscription: razorpaySubscription
      }
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error creating subscription:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to create subscription',
      details: error.message 
    }));
  }
}

async function getSubscription(req, res) {
  try {
    const userId = req.user.userId;
    
    const subscription = await Subscription.findOne({ userId })
      .sort({ createdAt: -1 });

    if (!subscription) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No subscription found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      subscription: subscription
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error fetching subscription:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to fetch subscription',
      details: error.message 
    }));
  }
}

async function getActivePlans(req, res) {
  try {
    const plans = await Plan.find({ isActive: true })
      .sort({ createdAt: -1 });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      plans: plans,
      count: plans.length
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error fetching active plans:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to fetch active plans',
      details: error.message 
    }));
  }
}

async function cancelMembership(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const { membershipId } = body;
    const userId = req.user.userId;

    if (!membershipId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'membershipId is required' }));
      return;
    }

    // Find and update membership
    const membership = await Membership.findOneAndUpdate(
      { _id: membershipId, userId: userId },
      { status: 'cancelled' },
      { new: true }
    );

    if (!membership) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Membership not found or access denied' }));
      return;
    }

    // Also cancel the associated subscription in Razorpay and database
    const subscription = await Subscription.findOne({
      _id: membership.subscriptionId,
      userId: userId
    });

    if (subscription && subscription.external_subscription_id) {
      try {
        // Cancel subscription in Razorpay
        await paymentService.cancelSubscription(subscription.external_subscription_id);
        console.log('✅ Razorpay subscription cancelled:', subscription.external_subscription_id);
      } catch (error) {
        reportError(error, { req });
        console.error('❌ Error cancelling Razorpay subscription:', error);
        // Continue with database update even if Razorpay cancellation fails
      }
    }

    // Update subscription status in database
    await Subscription.findOneAndUpdate(
      { _id: membership.subscriptionId, userId: userId },
      { status: 'cancelled' }
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Membership cancelled successfully',
      membership: {
        id: membership._id,
        status: membership.status,
        start: membership.start,
        end: membership.end,
        cancelledAt: new Date()
      }
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error cancelling membership:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to cancel membership',
      details: error.message 
    }));
  }
}

async function getSubscriptionById(req, res) {
  try {
    const subscriptionId = req.url.split('/')[2]; // Extract ID from URL
    const userId = req.user.userId;

    if (!subscriptionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Subscription ID is required' }));
      return;
    }

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      userId: userId
    });

    if (!subscription) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Subscription not found or access denied' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      subscription: {
        id: subscription._id,
        external_subscription_id: subscription.external_subscription_id,
        external_plan_id: subscription.external_plan_id,
        status: subscription.status,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt
      }
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error fetching subscription:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to fetch subscription',
      details: error.message 
    }));
  }
}

/**
 * Verify and link a Google Play subscription purchase
 * Called by the Android app after a successful purchase
 * 
 * POST /subscriptions/google-play/verify
 * Body: { productId: string, purchaseToken: string }
 */
async function verifyGooglePlayPurchase(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const { productId, purchaseToken } = body;
    const userId = req.user.userId;

    console.log('🔍 [GOOGLE_PLAY_VERIFY] Verifying purchase');
    console.log('   User ID:', userId);
    console.log('   Product ID:', productId);
    console.log('   Purchase Token:', purchaseToken?.substring(0, 30) + '...');

    // Validate required fields
    if (!productId || !purchaseToken) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'productId and purchaseToken are required' 
      }));
      return;
    }

    // Check if subscription already exists (idempotency)
    const existingSubscription = await Subscription.findOne({
      provider: 'GOOGLE_PLAY',
      external_subscription_id: purchaseToken
    });

    if (existingSubscription) {
      console.log('⚠️ [GOOGLE_PLAY_VERIFY] Subscription already exists:', existingSubscription._id);
      
      // Verify the subscription still belongs to this user
      if (existingSubscription.userId.toString() !== userId) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Purchase token already linked to another user' 
        }));
        return;
      }

      // Return existing subscription
      const membership = await Membership.findOne({ 
        subscriptionId: existingSubscription._id 
      }).sort({ createdAt: -1 });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Subscription already verified',
        subscription: {
          id: existingSubscription._id,
          provider: existingSubscription.provider,
          external_subscription_id: existingSubscription.external_subscription_id,
          external_order_id: existingSubscription.external_order_id,
          status: existingSubscription.status,
          currentPeriodStart: existingSubscription.currentPeriodStart,
          currentPeriodEnd: existingSubscription.currentPeriodEnd,
          autoRenewing: existingSubscription.autoRenewing
        },
        membership: membership ? {
          id: membership._id,
          start: membership.start,
          end: membership.end,
          status: membership.status
        } : null
      }));
      return;
    }

    // Verify purchase with Google Play API
    let purchaseData;
    try {
      purchaseData = await googlePlayService.verifySubscription(productId, purchaseToken);
    } catch (error) {
      reportError(error, { req });
      console.error('❌ [GOOGLE_PLAY_VERIFY] Verification failed:', error.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Purchase verification failed',
        details: error.message 
      }));
      return;
    }

    console.log('✅ [GOOGLE_PLAY_VERIFY] Purchase verified with Google');
    console.log('   Order ID:', purchaseData.orderId);
    console.log('   Payment State:', purchaseData.paymentState);
    console.log('   Expiry:', new Date(parseInt(purchaseData.expiryTimeMillis)));

    // Find the plan by Google Play product ID
    let plan = await Plan.findOne({ googleplay_product_id: productId, isActive: true });
    
    if (!plan) {
      // Fallback: try to find by external_plan_id (if same ID used)
      plan = await Plan.findOne({ external_plan_id: productId, isActive: true });
    }

    if (!plan) {
      console.error('❌ [GOOGLE_PLAY_VERIFY] No plan found for product:', productId);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'No matching plan found for this product',
        productId: productId 
      }));
      return;
    }

    console.log('✅ [GOOGLE_PLAY_VERIFY] Found matching plan:', plan.title);

    // Map Google Play status
    const status = GooglePlayService.mapSubscriptionStatus(purchaseData);

    // Create subscription record
    const subscription = new Subscription({
      userId: userId,
      provider: 'GOOGLE_PLAY',
      external_subscription_id: purchaseToken,
      external_plan_id: productId,
      external_order_id: purchaseData.orderId,
      status: status,
      currentPeriodStart: new Date(parseInt(purchaseData.startTimeMillis)),
      currentPeriodEnd: new Date(parseInt(purchaseData.expiryTimeMillis)),
      autoRenewing: purchaseData.autoRenewing || false,
      acknowledged: purchaseData.acknowledgementState === 1
    });

    await subscription.save();
    console.log('✅ [GOOGLE_PLAY_VERIFY] Subscription created:', subscription._id);

    // Create membership
    const startDate = new Date(parseInt(purchaseData.startTimeMillis));
    const endDate = new Date(parseInt(purchaseData.expiryTimeMillis));
    // Round end date to EOD
    endDate.setHours(23, 59, 59, 999);

    const membership = new Membership({
      userId: userId,
      subscriptionId: subscription._id,
      planId: plan._id,
      start: startDate,
      end: endDate,
      status: 'purchased'
    });

    await membership.save();
    console.log('✅ [GOOGLE_PLAY_VERIFY] Membership created:', membership._id);

    // Acknowledge purchase if not already acknowledged (CRITICAL!)
    if (purchaseData.acknowledgementState !== 1) {
      try {
        await googlePlayService.acknowledgeSubscription(productId, purchaseToken);
        subscription.acknowledged = true;
        await subscription.save();
        console.log('✅ [GOOGLE_PLAY_VERIFY] Purchase acknowledged');
      } catch (ackError) {
        reportError(ackError, { req, extra: { context: 'google_play_acknowledge' } });
        console.error('⚠️ [GOOGLE_PLAY_VERIFY] Failed to acknowledge:', ackError.message);
        // Don't fail the request, but log for retry
      }
    }

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Google Play purchase verified and subscription created',
      subscription: {
        id: subscription._id,
        provider: subscription.provider,
        external_subscription_id: subscription.external_subscription_id,
        external_order_id: subscription.external_order_id,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        autoRenewing: subscription.autoRenewing,
        acknowledged: subscription.acknowledged
      },
      membership: {
        id: membership._id,
        planId: plan._id,
        planTitle: plan.title,
        start: membership.start,
        end: membership.end,
        status: membership.status
      }
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('❌ [GOOGLE_PLAY_VERIFY] Error:', error.message);
    console.error('Stack:', error.stack);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to verify Google Play purchase',
      details: error.message 
    }));
  }
}

/**
 * Get subscription status from Google Play
 * Useful for checking current state without modifying local data
 * 
 * POST /subscriptions/google-play/status
 * Body: { productId: string, purchaseToken: string }
 */
async function getGooglePlaySubscriptionStatus(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const { productId, purchaseToken } = body;

    if (!productId || !purchaseToken) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'productId and purchaseToken are required' 
      }));
      return;
    }

    const purchaseData = await googlePlayService.verifySubscription(productId, purchaseToken);
    const status = GooglePlayService.mapSubscriptionStatus(purchaseData);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      googlePlayData: {
        orderId: purchaseData.orderId,
        startTime: new Date(parseInt(purchaseData.startTimeMillis)),
        expiryTime: new Date(parseInt(purchaseData.expiryTimeMillis)),
        autoRenewing: purchaseData.autoRenewing,
        paymentState: purchaseData.paymentState,
        cancelReason: purchaseData.cancelReason,
        acknowledged: purchaseData.acknowledgementState === 1
      },
      mappedStatus: status
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error getting Google Play status:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to get Google Play subscription status',
      details: error.message 
    }));
  }
}

/**
 * Verify and link an Apple App Store subscription purchase
 * Called by the iOS app after a successful purchase
 * 
 * POST /subscriptions/apple/verify
 * Body: { 
 *   receiptData: string (base64 encoded receipt),
 *   productId: string,
 *   transactionId?: string,
 *   originalTransactionId?: string
 * }
 */
async function verifyApplePurchase(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const { receiptData, productId, transactionId, originalTransactionId } = body;
    const userId = req.user.userId;

    console.log('🍎 [APPLE_VERIFY] Verifying purchase');
    console.log('   User ID:', userId);
    console.log('   Product ID:', productId);
    console.log('   Transaction ID:', transactionId || 'N/A');
    console.log('   Original Transaction ID:', originalTransactionId || 'N/A');

    // Validate required fields
    if (!receiptData) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'receiptData is required' 
      }));
      return;
    }

    // Verify receipt with Apple
    let receiptResponse;
    try {
      receiptResponse = await appleStoreService.verifyReceipt(receiptData);
    } catch (error) {
      reportError(error, { req });
      console.error('❌ [APPLE_VERIFY] Receipt verification failed:', error.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Receipt verification failed',
        details: error.message 
      }));
      return;
    }

    console.log('✅ [APPLE_VERIFY] Receipt verified with Apple');
    console.log('   Environment:', receiptResponse.environment);

    // Extract subscription info from receipt
    const subscriptionInfo = appleStoreService.extractSubscriptionInfo(receiptResponse, productId);

    if (!subscriptionInfo) {
      console.error('❌ [APPLE_VERIFY] No subscription found in receipt');
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'No subscription found in receipt',
        productId: productId 
      }));
      return;
    }

    console.log('✅ [APPLE_VERIFY] Subscription info extracted');
    console.log('   Original Transaction ID:', subscriptionInfo.originalTransactionId);
    console.log('   Product ID:', subscriptionInfo.productId);
    console.log('   Expires:', subscriptionInfo.expiresDate);

    // Use originalTransactionId as the unique identifier
    const appleOriginalTransactionId = subscriptionInfo.originalTransactionId;

    // Check if subscription already exists (idempotency)
    const existingSubscription = await Subscription.findOne({
      provider: 'APPLE',
      external_subscription_id: appleOriginalTransactionId
    });

    if (existingSubscription) {
      console.log('⚠️ [APPLE_VERIFY] Subscription already exists:', existingSubscription._id);
      
      // Verify the subscription still belongs to this user
      if (existingSubscription.userId.toString() !== userId) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Transaction already linked to another user' 
        }));
        return;
      }

      // Update subscription with latest info
      existingSubscription.currentPeriodStart = subscriptionInfo.purchaseDate;
      existingSubscription.currentPeriodEnd = subscriptionInfo.expiresDate;
      existingSubscription.autoRenewing = subscriptionInfo.autoRenewStatus;
      existingSubscription.status = AppleStoreService.mapSubscriptionStatus(subscriptionInfo);
      await existingSubscription.save();

      // Return existing subscription
      const membership = await Membership.findOne({ 
        subscriptionId: existingSubscription._id 
      }).sort({ createdAt: -1 });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Subscription already verified',
        subscription: {
          id: existingSubscription._id,
          provider: existingSubscription.provider,
          external_subscription_id: existingSubscription.external_subscription_id,
          external_order_id: existingSubscription.external_order_id,
          status: existingSubscription.status,
          currentPeriodStart: existingSubscription.currentPeriodStart,
          currentPeriodEnd: existingSubscription.currentPeriodEnd,
          autoRenewing: existingSubscription.autoRenewing
        },
        membership: membership ? {
          id: membership._id,
          start: membership.start,
          end: membership.end,
          status: membership.status
        } : null,
        environment: receiptResponse.environment
      }));
      return;
    }

    // Find the plan by App Store product ID
    let plan = await Plan.findOne({ appstore_product_id: subscriptionInfo.productId, isActive: true });
    
    if (!plan) {
      // Fallback: try to find by external_plan_id (if same ID used)
      plan = await Plan.findOne({ external_plan_id: subscriptionInfo.productId, isActive: true });
    }

    if (!plan) {
      console.error('❌ [APPLE_VERIFY] No plan found for product:', subscriptionInfo.productId);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'No matching plan found for this product',
        productId: subscriptionInfo.productId 
      }));
      return;
    }

    console.log('✅ [APPLE_VERIFY] Found matching plan:', plan.title);

    // Map Apple subscription status
    const status = AppleStoreService.mapSubscriptionStatus(subscriptionInfo);

    // Create subscription record
    const subscription = new Subscription({
      userId: userId,
      provider: 'APPLE',
      external_subscription_id: appleOriginalTransactionId,
      external_plan_id: subscriptionInfo.productId,
      external_order_id: subscriptionInfo.webOrderLineItemId || subscriptionInfo.transactionId,
      status: status,
      currentPeriodStart: subscriptionInfo.purchaseDate,
      currentPeriodEnd: subscriptionInfo.expiresDate,
      autoRenewing: subscriptionInfo.autoRenewStatus,
      acknowledged: true // Apple doesn't require acknowledgment like Google Play
    });

    await subscription.save();
    console.log('✅ [APPLE_VERIFY] Subscription created:', subscription._id);

    // Create membership
    const startDate = new Date(subscriptionInfo.purchaseDate);
    const endDate = new Date(subscriptionInfo.expiresDate);
    // Round end date to EOD
    endDate.setHours(23, 59, 59, 999);

    const membership = new Membership({
      userId: userId,
      subscriptionId: subscription._id,
      planId: plan._id,
      start: startDate,
      end: endDate,
      status: 'purchased'
    });

    await membership.save();
    console.log('✅ [APPLE_VERIFY] Membership created:', membership._id);

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Apple purchase verified and subscription created',
      subscription: {
        id: subscription._id,
        provider: subscription.provider,
        external_subscription_id: subscription.external_subscription_id,
        external_order_id: subscription.external_order_id,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        autoRenewing: subscription.autoRenewing
      },
      membership: {
        id: membership._id,
        planId: plan._id,
        planTitle: plan.title,
        start: membership.start,
        end: membership.end,
        status: membership.status
      },
      environment: receiptResponse.environment,
      subscriptionInfo: {
        isInTrial: subscriptionInfo.isInTrial,
        isInIntroOffer: subscriptionInfo.isInIntroOffer,
        originalPurchaseDate: subscriptionInfo.originalPurchaseDate
      }
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('❌ [APPLE_VERIFY] Error:', error.message);
    console.error('Stack:', error.stack);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to verify Apple purchase',
      details: error.message 
    }));
  }
}

/**
 * Get subscription status from Apple
 * Useful for checking current state without modifying local data
 * 
 * POST /subscriptions/apple/status
 * Body: { receiptData: string }
 */
async function getAppleSubscriptionStatus(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const { receiptData, productId } = body;

    if (!receiptData) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'receiptData is required' 
      }));
      return;
    }

    const receiptResponse = await appleStoreService.verifyReceipt(receiptData);
    const subscriptionInfo = appleStoreService.extractSubscriptionInfo(receiptResponse, productId);
    const status = AppleStoreService.mapSubscriptionStatus(subscriptionInfo);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      environment: receiptResponse.environment,
      appleData: subscriptionInfo ? {
        originalTransactionId: subscriptionInfo.originalTransactionId,
        productId: subscriptionInfo.productId,
        purchaseDate: subscriptionInfo.purchaseDate,
        expiresDate: subscriptionInfo.expiresDate,
        isExpired: subscriptionInfo.isExpired,
        isInTrial: subscriptionInfo.isInTrial,
        isInIntroOffer: subscriptionInfo.isInIntroOffer,
        autoRenewStatus: subscriptionInfo.autoRenewStatus,
        gracePeriodExpiresDate: subscriptionInfo.gracePeriodExpiresDate
      } : null,
      mappedStatus: status
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error getting Apple subscription status:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to get Apple subscription status',
      details: error.message 
    }));
  }
}

/**
 * Restore Apple purchases
 * Called when user reinstalls app or switches devices
 * 
 * POST /subscriptions/apple/restore
 * Body: { receiptData: string }
 */
async function restoreApplePurchases(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const { receiptData } = body;
    const userId = req.user.userId;

    console.log('🍎 [APPLE_RESTORE] Restoring purchases for user:', userId);

    if (!receiptData) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'receiptData is required' 
      }));
      return;
    }

    // Verify receipt with Apple
    let receiptResponse;
    try {
      receiptResponse = await appleStoreService.verifyReceipt(receiptData);
    } catch (error) {
      reportError(error, { req });
      console.error('❌ [APPLE_RESTORE] Receipt verification failed:', error.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Receipt verification failed',
        details: error.message 
      }));
      return;
    }

    const latestReceiptInfo = receiptResponse.latest_receipt_info || [];
    const restoredSubscriptions = [];

    // Process each subscription in the receipt
    for (const transaction of latestReceiptInfo) {
      const originalTransactionId = transaction.original_transaction_id;
      
      // Check if subscription exists
      let subscription = await Subscription.findOne({
        provider: 'APPLE',
        external_subscription_id: originalTransactionId
      });

      if (subscription) {
        // Update existing subscription to link to this user if not already linked
        if (!subscription.userId || subscription.userId.toString() !== userId) {
          console.log(`🔗 [APPLE_RESTORE] Linking subscription ${subscription._id} to user ${userId}`);
          subscription.userId = userId;
        }

        // Update subscription details
        subscription.currentPeriodEnd = new Date(parseInt(transaction.expires_date_ms));
        subscription.status = parseInt(transaction.expires_date_ms) > Date.now() ? 'active' : 'expired';
        await subscription.save();

        restoredSubscriptions.push({
          id: subscription._id,
          productId: transaction.product_id,
          status: subscription.status,
          expiresDate: subscription.currentPeriodEnd
        });
      } else {
        // Create new subscription for restored purchase
        const subscriptionInfo = appleStoreService.extractSubscriptionInfo(receiptResponse, transaction.product_id);
        
        if (subscriptionInfo && !subscriptionInfo.isExpired) {
          // Find the plan
          let plan = await Plan.findOne({ appstore_product_id: transaction.product_id, isActive: true });
          if (!plan) {
            plan = await Plan.findOne({ external_plan_id: transaction.product_id, isActive: true });
          }

          if (plan) {
            const newSubscription = new Subscription({
              userId: userId,
              provider: 'APPLE',
              external_subscription_id: originalTransactionId,
              external_plan_id: transaction.product_id,
              external_order_id: transaction.web_order_line_item_id || transaction.transaction_id,
              status: 'active',
              currentPeriodStart: new Date(parseInt(transaction.purchase_date_ms)),
              currentPeriodEnd: new Date(parseInt(transaction.expires_date_ms)),
              autoRenewing: true,
              acknowledged: true
            });
            await newSubscription.save();

            // Create membership
            const membership = new Membership({
              userId: userId,
              subscriptionId: newSubscription._id,
              planId: plan._id,
              start: newSubscription.currentPeriodStart,
              end: newSubscription.currentPeriodEnd,
              status: 'purchased'
            });
            await membership.save();

            restoredSubscriptions.push({
              id: newSubscription._id,
              productId: transaction.product_id,
              status: newSubscription.status,
              expiresDate: newSubscription.currentPeriodEnd,
              isNew: true
            });

            console.log(`✅ [APPLE_RESTORE] Created new subscription: ${newSubscription._id}`);
          }
        }
      }
    }

    console.log(`✅ [APPLE_RESTORE] Restored ${restoredSubscriptions.length} subscriptions`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: `Restored ${restoredSubscriptions.length} subscription(s)`,
      restoredSubscriptions,
      environment: receiptResponse.environment
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('❌ [APPLE_RESTORE] Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to restore Apple purchases',
      details: error.message 
    }));
  }
}

/**
 * GET /subscriptions/status
 * Returns unified subscription status from RevenueCat (or local fallback).
 * The client can call this to know whether to show paywall or not.
 */
async function getSubscriptionStatus(req, res) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    const { checkMembership } = require('../utils/membershipCheck');
    const membership = await checkMembership(userId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      membership: {
        hasAccess: membership.hasAccess,
        isPremium: membership.isPremium,
        isInTrial: membership.isInTrial,
        expiresDate: membership.expiresDate,
        productIdentifier: membership.productIdentifier,
        willRenew: membership.willRenew
      }
    }));
  } catch (error) {
    reportError(error, { req });
    console.error('❌ [SUBSCRIPTION_STATUS] Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get subscription status',
      details: error.message
    }));
  }
}

module.exports = {
  createSubscription,
  getSubscription,
  getSubscriptionById,
  getActivePlans,
  cancelMembership,
  verifyGooglePlayPurchase,
  getGooglePlaySubscriptionStatus,
  verifyApplePurchase,
  getAppleSubscriptionStatus,
  restoreApplePurchases,
  getSubscriptionStatus
};

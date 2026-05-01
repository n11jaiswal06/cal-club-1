const jwt = require('jsonwebtoken');
const {
  findUserByPhone,
  createUser,
  storeOtp,
  fetchOtp,
  deleteOtp,
  storeAuthToken,
  updateUser
} = require('../models/user');
const FirebaseAuthService = require('./firebaseAuthService');
const parseBody = require('../utils/parseBody');

const JWT_SECRET = process.env.JWT_SECRET;

// Twilio Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Fast2SMS Configuration
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;
const FAST2SMS_SENDER_ID = process.env.FAST2SMS_SENDER_ID;
const FAST2SMS_MESSAGE_ID = process.env.FAST2SMS_MESSAGE_ID;
const FAST2SMS_ENTITY_ID = process.env.FAST2SMS_ENTITY_ID;
const FAST2SMS_DLT_TEMPLATE_ID = process.env.FAST2SMS_DLT_TEMPLATE_ID;

// Initialize Twilio client only if credentials are available
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// SMS Provider Types
const SMS_PROVIDERS = {
  TWILIO: 'twilio',
  FAST2SMS_QUICK: 'fast2sms-quicksms',
  FAST2SMS_OTP: 'fast2sms-otp',        // Fast2SMS OTP-specific route
  FAST2SMS_DLT: 'fast2sms-dlt'
};

class AuthService {
  static generateOtp(phone) {
    // Extract last 6 digits from phone number
    const cleanPhone = phone.replace(/\D/g, ''); // Remove all non-digits
    return cleanPhone.slice(-6); // Get last 6 digits
  }

  /**
   * Format phone number to 10 digits (for Fast2SMS - India only)
   * @param {string} phone - Phone number with or without country code
   * @returns {string} 10-digit phone number
   */
  static formatPhoneForFast2SMS(phone) {
    // Remove all non-digits
    const cleanPhone = phone.replace(/\D/g, '');
    // Return last 10 digits (removes country code if present)
    return cleanPhone.slice(-10);
  }

  /**
   * Send OTP via Twilio
   */
  static async sendOtpViaTwilio(phone, otp) {
    if (!twilioClient) {
      throw new Error('Twilio is not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.');
    }

    if (!TWILIO_PHONE_NUMBER) {
      throw new Error('TWILIO_PHONE_NUMBER environment variable is not set.');
    }

    try {
      const message = await twilioClient.messages.create({
        body: `Your OTP is ${otp}`,
        from: TWILIO_PHONE_NUMBER,
        to: phone
      });
      console.log(`✅ OTP sent via Twilio. SID: ${message.sid}`);
      return { provider: 'twilio', messageId: message.sid };
    } catch (error) {
      console.error('❌ Twilio SMS error:', error.message);
      throw new Error(`Failed to send SMS via Twilio: ${error.message}`);
    }
  }

  /**
   * Send OTP via Fast2SMS Quick SMS API (route: 'q')
   * No DLT registration needed, but higher cost (~₹5 per SMS)
   * API Docs: https://docs.fast2sms.com/reference/quick-sms
   */
  static async sendOtpViaFast2SMSQuick(phone, otp) {
    if (!FAST2SMS_API_KEY) {
      throw new Error('Fast2SMS is not configured. Please set FAST2SMS_API_KEY environment variable.');
    }

    const formattedPhone = this.formatPhoneForFast2SMS(phone);
    const message = `Your OTP is ${otp}. Valid for 15 minutes. Do not share with anyone.`;

    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': FAST2SMS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          route: 'q', // Quick SMS route
          message: message,
          language: 'english',
          flash: 0,
          numbers: formattedPhone
        })
      });

      const data = await response.json();
      
      if (!response.ok || data.return === false) {
        console.error('❌ Fast2SMS Quick SMS error:', data);
        throw new Error(data.message || 'Failed to send SMS via Fast2SMS');
      }

      console.log(`✅ OTP sent via Fast2SMS Quick SMS. Request ID: ${data.request_id}`);
      return { provider: 'fast2sms-quicksms', requestId: data.request_id };
    } catch (error) {
      console.error('❌ Fast2SMS Quick SMS error:', error.message);
      throw new Error(`Failed to send SMS via Fast2SMS Quick: ${error.message}`);
    }
  }

  /**
   * Send OTP via Fast2SMS OTP API (route: 'otp')
   * Optimized specifically for OTP messages
   * Lower cost than Quick SMS, no DLT registration needed
   * API Docs: https://docs.fast2sms.com/reference/quick-sms
   */
  static async sendOtpViaFast2SMSOTP(phone, otp) {
    if (!FAST2SMS_API_KEY) {
      throw new Error('Fast2SMS is not configured. Please set FAST2SMS_API_KEY environment variable.');
    }

    const formattedPhone = this.formatPhoneForFast2SMS(phone);
    const message = `Your OTP is ${otp}. Valid for 15 minutes. Do not share with anyone.`;

    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': FAST2SMS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          route: 'otp', // OTP-specific route (optimized for OTP messages)
          message: message,
          language: 'english',
          flash: 0,
          numbers: formattedPhone
        })
      });

      const data = await response.json();
      
      if (!response.ok || data.return === false) {
        console.error('❌ Fast2SMS OTP API error:', data);
        throw new Error(data.message || 'Failed to send OTP via Fast2SMS');
      }

      console.log(`✅ OTP sent via Fast2SMS OTP API. Request ID: ${data.request_id}`);
      return { provider: 'fast2sms-otp', requestId: data.request_id };
    } catch (error) {
      console.error('❌ Fast2SMS OTP API error:', error.message);
      throw new Error(`Failed to send OTP via Fast2SMS: ${error.message}`);
    }
  }

  /**
   * Send OTP via Fast2SMS DLT SMS API
   * Requires DLT registration with TRAI for India
   * API Docs: https://docs.fast2sms.com/reference/authorization
   */
  static async sendOtpViaFast2SMSDLT(phone, otp) {
    if (!FAST2SMS_API_KEY) {
      throw new Error('Fast2SMS is not configured. Please set FAST2SMS_API_KEY environment variable.');
    }

    if (!FAST2SMS_SENDER_ID || !FAST2SMS_DLT_TEMPLATE_ID) {
      throw new Error('Fast2SMS DLT is not fully configured. Please set FAST2SMS_SENDER_ID and FAST2SMS_DLT_TEMPLATE_ID environment variables.');
    }

    const formattedPhone = this.formatPhoneForFast2SMS(phone);
    
    // DLT template message - must match your registered DLT template exactly
    // Example template: "Your OTP is {#var#}. Valid for 15 minutes. Do not share with anyone. - CalClub"
    const message = `Your OTP is ${otp}. Valid for 15 minutes. Do not share with anyone. - Cal Club`;

    try {
      const requestBody = {
        route: 'dlt',
        sender_id: FAST2SMS_SENDER_ID,
        message: FAST2SMS_MESSAGE_ID, // Message ID from DLT registration
        variables_values: otp, // Variable to substitute in template
        flash: 0,
        numbers: formattedPhone
      };

      // Add entity ID if provided
      if (FAST2SMS_ENTITY_ID) {
        requestBody.entity_id = FAST2SMS_ENTITY_ID;
      }

      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': FAST2SMS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      
      if (!response.ok || data.return === false) {
        console.error('❌ Fast2SMS DLT SMS error:', data);
        throw new Error(data.message || 'Failed to send DLT SMS via Fast2SMS');
      }

      console.log(`✅ OTP sent via Fast2SMS DLT SMS. Request ID: ${data.request_id}`);
      return { provider: 'fast2sms-dlt', requestId: data.request_id };
    } catch (error) {
      console.error('❌ Fast2SMS DLT SMS error:', error.message);
      throw new Error(`Failed to send SMS via Fast2SMS DLT: ${error.message}`);
    }
  }

  /**
   * Send OTP via SMS using specified provider
   * @param {string} phone - Phone number
   * @param {string} otp - OTP to send
   * @param {string} provider - SMS provider: 'twilio', 'fast2sms-otp', 'fast2sms-quicksms', 'fast2sms-dlt'
   */
  static async sendOtpViaSms(phone, otp, provider = SMS_PROVIDERS.FAST2SMS_OTP) {
    console.log(`📱 Sending OTP via provider: ${provider}`);
    
    switch (provider) {
      case SMS_PROVIDERS.TWILIO:
        return await this.sendOtpViaTwilio(phone, otp);
      
      case SMS_PROVIDERS.FAST2SMS_DLT:
        return await this.sendOtpViaFast2SMSDLT(phone, otp);
      
      case SMS_PROVIDERS.FAST2SMS_QUICK:
        return await this.sendOtpViaFast2SMSQuick(phone, otp);
      
      case SMS_PROVIDERS.FAST2SMS_OTP:
      default:
        // Default to Fast2SMS OTP API (optimized for OTP messages)
        return await this.sendOtpViaFast2SMSOTP(phone, otp);
    }
  }

  /**
   * Request OTP with specified SMS provider
   * @param {string} phone - Phone number
   * @param {string} provider - SMS provider (default: 'fast2sms-otp')
   */
  static async requestOtp(phone, provider = SMS_PROVIDERS.FAST2SMS_OTP) {
    const otp = this.generateOtp(phone);
    
    // Check if user exists to link OTP
    let user = await findUserByPhone(phone);
    const userId = user ? user._id : null;
    
    // Store OTP
    await storeOtp(phone, otp, userId);
    
    // Send SMS via specified provider
    const smsResult = await this.sendOtpViaSms(phone, otp, provider);

    return { 
      message: 'OTP sent via SMS and stored', 
      phone, 
      otp,
      provider: smsResult.provider
    };
  }

  static async verifyOtp(phone, otp) {
    const storedOtp = await fetchOtp(phone);
    
    if (!storedOtp || storedOtp !== otp) {
      throw new Error('Invalid OTP');
    }

    // Check if user exists and is active
    let user = await findUserByPhone(phone);
    
    // If user doesn't exist, create a new one
    if (!user) {
      user = await createUser({ phone });
    } else {
      // If user exists but is inactive, reactivate them
      if (!user.isActive) {
        const { updateUser } = require('../models/user');
        user = await updateUser(user._id, { isActive: true });
      }
    }

    // Delete OTP after successful verification
    await deleteOtp(phone);

    // Generate and store auth token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '14d' });
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    await storeAuthToken(user._id, token, expiresAt);

    return {
      message: 'OTP verified successfully',
      token,
      userId: user._id.toString()
    };
  }

  static async verifyFirebaseToken(idToken) {
    // Verify Firebase ID token
    const firebaseData = await FirebaseAuthService.verifyIdToken(idToken);
    const { firebaseUid, phone, email, name } = firebaseData;

    // Try to find an existing user by:
    // 1) phone (for phone auth),
    // 2) firebaseUid (for any provider),
    // 3) email (for Google / Apple sign-in).
    let user = null;
    if (phone) {
      user = await findUserByPhone(phone);
    }
    if (!user && firebaseUid) {
      const User = require('../models/schemas/User');
      user = await User.findOne({ firebaseUid, isActive: true });
    }
    if (!user && email) {
      const User = require('../models/schemas/User');
      user = await User.findOne({ email: email.toLowerCase(), isActive: true });
    }

    if (!user) {
      const newUserData = {
        lastLoginAt: new Date(),
        firebaseUid
      };
      if (phone) newUserData.phone = phone;
      if (email) newUserData.email = email.toLowerCase();
      if (name) newUserData.name = name;
      user = await createUser(newUserData);
    } else {
      const updateData = { lastLoginAt: new Date() };

      if (!user.isActive) {
        updateData.isActive = true;
      }
      if (!user.firebaseUid && firebaseUid) {
        updateData.firebaseUid = firebaseUid;
      }
      if (!user.email && email) {
        updateData.email = email.toLowerCase();
      }
      if (!user.phone && phone) {
        updateData.phone = phone;
      }
      if (!user.name && name) {
        updateData.name = name;
      }

      user = await updateUser(user._id, updateData);
    }

    // Generate and store auth token (same as OTP flow)
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '14d' });
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    await storeAuthToken(user._id, token, expiresAt);

    // CAL-21: include goals so a fresh login already has the dynamic-vs-
    // static display variant info — saves a separate GET /users/profile
    // roundtrip on cold start.
    return {
      message: 'Firebase token verified successfully',
      token,
      userId: user._id.toString(),
      goals: user.goals
    };
  }
}

module.exports = AuthService; 
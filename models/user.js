const User = require('./schemas/User');
const UserOtp = require('./schemas/UserOtp');
const UserAuthToken = require('./schemas/UserAuthToken');

// User operations
async function findUserByPhone(phone) {
  return User.findOne({ phone, isActive: true });
}

async function findUserById(userId) {
  return User.findById(userId);
}

async function createUser(userData) {
  const user = new User(userData);
  return user.save();
}

async function updateUser(userId, updateData) {
  return User.findByIdAndUpdate(userId, updateData, { new: true });
}

async function deactivateUserByPhone(phone) {
  return User.findOneAndUpdate(
    { phone, isActive: true },
    { isActive: false },
    { new: true }
  );
}

/**
 * Deactivate a user and free the OAuth identity fields so a fresh sign-in
 * with the same Google / Apple / Firebase identity creates a new record
 * instead of colliding on the `firebaseUid` sparse-unique index.
 */
async function deactivateUserById(userId) {
  return User.findOneAndUpdate(
    { _id: userId, isActive: true },
    {
      $set: { isActive: false },
      $unset: { firebaseUid: '' },
    },
    { new: true }
  );
}

// OTP operations (still use phone for OTP)
async function storeOtp(phone, otp, userId = null) {
  return UserOtp.findOneAndUpdate(
    { phone },
    { phone, otp, userId },
    { upsert: true, new: true }
  );
}

//otp
async function fetchOtp(phone) {
  const otpDoc = await UserOtp.findOne({ phone });
  return otpDoc ? otpDoc.otp : null;
}

async function deleteOtp(phone) {
  return UserOtp.deleteOne({ phone });
}

async function incrementOtpAttempts(phone) {
  return UserOtp.findOneAndUpdate(
    { phone },
    { $inc: { attempts: 1 } },
    { new: true }
  );
}

       // Auth token operations (use userId)
       async function storeAuthToken(userId, token, expiresAt) {
         return UserAuthToken.findOneAndUpdate(
           { userId },
           { userId, token, expiresAt },
           { upsert: true, new: true }
         );
       }

async function fetchAuthToken(userId) {
  const tokenDoc = await UserAuthToken.findOne({ userId });
  return tokenDoc ? tokenDoc.token : null;
}

async function deleteAuthToken(userId) {
  return UserAuthToken.deleteOne({ userId });
}

async function revokeAuthToken(userId) {
  return UserAuthToken.findOneAndUpdate(
    { userId },
    { isRevoked: true },
    { new: true }
  );
}

module.exports = {
  findUserByPhone,
  findUserById,
  createUser,
  updateUser,
  deactivateUserByPhone,
  deactivateUserById,
  storeOtp,
  fetchOtp,
  deleteOtp,
  incrementOtpAttempts,
  storeAuthToken,
  fetchAuthToken,
  deleteAuthToken,
  revokeAuthToken
}; 
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let firebaseApp = null;

function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (!projectId || !privateKey || !clientEmail) {
    throw new Error('Firebase credentials are not configured. Please set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL environment variables.');
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey,
        clientEmail
      })
    });
    console.log('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    throw new Error(`Failed to initialize Firebase: ${error.message}`);
  }
}

class FirebaseAuthService {
  static async verifyIdToken(idToken) {
    try {
      // Initialize Firebase if not already done
      if (!firebaseApp) {
        initializeFirebase();
      }

      // Verify the ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      // Extract identifiers
      const firebaseUid = decodedToken.uid;
      const phoneNumber = decodedToken.phone_number;
      const email = decodedToken.email || null;
      const rawName = typeof decodedToken.name === 'string' ? decodedToken.name.trim() : '';
      const name = rawName || null;

      return {
        firebaseUid,
        phone: phoneNumber || null,
        email,
        name,
        decodedToken
      };
    } catch (error) {
      console.error('Error verifying Firebase ID token:', error);
      if (error.code === 'auth/id-token-expired') {
        throw new Error('Firebase token has expired');
      } else if (error.code === 'auth/argument-error') {
        throw new Error('Invalid Firebase token format');
      } else if (error.code === 'auth/id-token-revoked') {
        throw new Error('Firebase token has been revoked');
      }
      throw new Error(`Failed to verify Firebase token: ${error.message}`);
    }
  }
}

// Initialize Firebase on module load
try {
  initializeFirebase();
} catch (error) {
  console.warn('Firebase initialization deferred due to error: ', error.message);
}

module.exports = FirebaseAuthService;


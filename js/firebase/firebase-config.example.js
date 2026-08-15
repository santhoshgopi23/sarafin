/**
 * firebase-config.example.js
 *
 * PHASE 12 SCAFFOLD — not wired into the app yet.
 *
 * This app cannot ship with a working Firebase backend out of the box:
 * Firestore/Auth require a real Firebase *project* (a cloud resource with
 * billing/security rules tied to one Google account), and there is no safe
 * way to generate one on your behalf or embed working credentials in code
 * that ships to every user. You'll need to create your own (it's free on
 * the Spark plan for an app this size) and drop the config in here.
 *
 * Steps:
 *   1. Go to https://console.firebase.google.com → Add project.
 *   2. Build > Authentication → get started → enable "Email/Password".
 *   3. Build > Firestore Database → create database → start in
 *      **production mode** → pick a region.
 *   4. Project settings (gear icon) > General > Your apps > Web (</>) icon
 *      → register the app → copy the `firebaseConfig` object it shows you.
 *   5. Paste those values below, rename this file to `firebase-config.js`,
 *      and include it + the Firebase SDK script tags (see firebase-sync.js
 *      header comment) in the pages that need cloud sync.
 *   6. In Firestore, set security rules so each user can only read/write
 *      their own documents, e.g.:
 *
 *      rules_version = '2';
 *      service cloud.firestore {
 *        match /databases/{database}/documents {
 *          match /users/{userId}/{document=**} {
 *            allow read, write: if request.auth != null && request.auth.uid == userId;
 *          }
 *        }
 *      }
 */

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

window.firebaseConfig = firebaseConfig;

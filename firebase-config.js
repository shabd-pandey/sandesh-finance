// ============================================================
// firebase-config.js — Sandesh Finance
// Firebase App Initialization
// ============================================================
//
// HOW TO GET YOUR CONFIG:
//   1. Go to https://console.firebase.google.com
//   2. Create a project named "sandesh-finance" (or similar)
//   3. Click "Add app" → Web (</>)
//   4. Copy the firebaseConfig object below and replace it
//   5. Enable these services in the Firebase Console:
//        • Authentication  → Sign-in method → Email/Password + Google
//        • Firestore       → Create database → Start in production mode
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Import the functions you need from the SDKs you need

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCRQcn7I7n5fOXMx51IRTX7Z0TseqcOuEU",
  authDomain: "sandesh-finance.firebaseapp.com",
  projectId: "sandesh-finance",
  storageBucket: "sandesh-finance.firebasestorage.app",
  messagingSenderId: "439912834085",
  appId: "1:439912834085:web:b645b1799b4d4959ea4bcc"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Auth instance — used by auth.js
export const auth     = getAuth(app);

// Google provider — used by loginWithGoogle()
export const googleProvider = new GoogleAuthProvider();

// Firestore instance — will be used in Step 2 (data migration)
export const db       = getFirestore(app);

// ============================================================
// FIRESTORE DATA STRUCTURE (for reference — Step 2)
// ============================================================
//
//  users/{uid}/
//    ├── investors/{investorId}   — investor documents
//    ├── borrowers/{borrowerId}   — borrower documents
//    ├── loans/{loanId}           — loan documents
//    └── meta/appData             — totalCommissionEarned, delays, etc.
//
// Each document mirrors the current appData object shape exactly,
// so the migration in Step 2 will be a straight read → write swap.
// ============================================================

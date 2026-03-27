# Sandesh Finance — Quick Start

## 1. Fill in Firebase config (REQUIRED before anything else)
Open `firebase-config.js` and replace all 6 `"YOUR_..."` values
with the real values from your Firebase Console:
  → console.firebase.google.com → Project Settings → Your apps → Web

## 2. Fill in your project ID
Open `.firebaserc` and replace `"YOUR_PROJECT_ID"` with your actual project ID
(e.g. `"sandesh-finance-a1b2c"`)

## 3. Install Firebase CLI (once, if not already installed)
```
npm install -g firebase-tools
firebase login
```

## 4. Install Cloud Function dependencies
```
cd functions
npm install
cd ..
```

## 5. Test locally (optional but recommended)
```
firebase emulators:start
```
Open http://localhost:5000 in your browser.

## 6. Deploy everything
```
firebase deploy
```

Your app is live at: https://YOUR_PROJECT_ID.web.app

---

## File Map
```
sandesh-finance/
├── index.html            ← Main loan dashboard
├── login.html            ← Sign in / Sign up
├── style.css             ← All styles
├── firebase-config.js    ← ⚠ FILL THIS IN FIRST
├── auth.js               ← Firebase Authentication
├── firestore.js          ← Firestore CRUD functions
├── notifications.js      ← Notification bell system
├── script.js             ← Main app logic
├── firebase.json         ← Firebase project config
├── firestore.rules       ← Security rules
├── firestore.indexes.json← Composite indexes
├── .firebaserc           ← ⚠ FILL IN YOUR PROJECT ID
├── README.md             ← This file
└── functions/
    ├── index.js          ← Cloud Functions (daily scheduler)
    ├── package.json      ← Node dependencies
    └── index.test.js     ← Unit tests
```

## Two things you MUST fill in before deploying:
1. `firebase-config.js` — your 6 Firebase config values
2. `.firebaserc`        — your Firebase project ID

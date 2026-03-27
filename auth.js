// ============================================================
// auth.js — Sandesh Finance
// All Firebase Authentication functions
// ============================================================
//
// USAGE IN script.js / other files:
//   import { signUp, login, loginWithGoogle, logout, getCurrentUser, onAuthChange } from './auth.js';
//
// ── Make sure firebase-config.js is configured first ────────

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { auth, googleProvider } from "./firebase-config.js";

// ============================================================
// signUp(email, password)
// Creates a new user with email + password.
// Returns the Firebase UserCredential on success.
// Throws a typed FirebaseError on failure (see error codes below).
// ============================================================
export async function signUp(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log("✅ Signed up:", user.email);
        return userCredential;
    } catch (error) {
        console.error("❌ signUp error:", error.code, error.message);
        throw error; // re-throw so the UI can handle it
    }
}

// ============================================================
// login(email, password)
// Signs in an existing user with email + password.
// Returns the Firebase UserCredential on success.
// ============================================================
export async function login(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log("✅ Logged in:", user.email);
        return userCredential;
    } catch (error) {
        console.error("❌ login error:", error.code, error.message);
        throw error;
    }
}

// ============================================================
// loginWithGoogle()
// Opens a Google sign-in popup.
// Works for both new users (auto-creates account) and existing.
// Returns the Firebase UserCredential on success.
// ============================================================
export async function loginWithGoogle() {
    try {
        const userCredential = await signInWithPopup(auth, googleProvider);
        const user = userCredential.user;
        console.log("✅ Google sign-in:", user.displayName, user.email);
        return userCredential;
    } catch (error) {
        // Ignore popup-closed-by-user — that's normal UX, not an error
        if (error.code === "auth/popup-closed-by-user") return null;
        console.error("❌ loginWithGoogle error:", error.code, error.message);
        throw error;
    }
}

// ============================================================
// logout()
// Signs out the currently authenticated user.
// After this, onAuthStateChanged fires with user = null,
// which will redirect back to login.html automatically.
// ============================================================
export async function logout() {
    try {
        await signOut(auth);
        console.log("✅ Logged out");
    } catch (error) {
        console.error("❌ logout error:", error.code, error.message);
        throw error;
    }
}

// ============================================================
// getCurrentUser()
// Returns the currently signed-in Firebase User object,
// or null if no user is logged in.
//
// ⚠️  IMPORTANT: Auth state is async. Do NOT call this at
//     module-load time and expect a user.
//     Use onAuthChange() (below) for reliable auth-gating.
// ============================================================
export function getCurrentUser() {
    return auth.currentUser;
}

// ============================================================
// onAuthChange(callback)
// Subscribes to auth state changes.
// callback(user) is called:
//   • immediately with the current user (or null)
//   • whenever the user logs in or out
//
// Returns the unsubscribe function (call it to stop listening).
//
// EXAMPLE — Auth-guard in script.js:
//
//   import { onAuthChange } from './auth.js';
//
//   onAuthChange((user) => {
//       if (!user) {
//           window.location.href = 'login.html'; // not logged in
//       } else {
//           loadData(user.uid); // load this user's Firestore data
//       }
//   });
//
// ============================================================
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

// ============================================================
// AUTH ERROR CODE REFERENCE
// Use these in catch blocks to show friendly messages in the UI
// ============================================================
export function getFriendlyAuthError(errorCode) {
    const messages = {
        "auth/email-already-in-use":    "This email is already registered. Please log in.",
        "auth/invalid-email":           "Invalid email address format.",
        "auth/weak-password":           "Password must be at least 6 characters.",
        "auth/user-not-found":          "No account found with this email.",
        "auth/wrong-password":          "Incorrect password. Please try again.",
        "auth/too-many-requests":       "Too many failed attempts. Please try again later.",
        "auth/network-request-failed":  "Network error. Check your internet connection.",
        "auth/user-disabled":           "This account has been disabled.",
        "auth/invalid-credential":      "Invalid credentials. Please check your email and password.",
    };
    return messages[errorCode] || "Something went wrong. Please try again.";
}

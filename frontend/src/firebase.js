import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// Standard, official Firebase project configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "stranger-meet-33687.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const analytics = typeof window !== 'undefined' && firebaseConfig.measurementId ? getAnalytics(app) : null;

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export const logInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
      console.log("[AUTH] Popup closed or redirected.");
      return null;
    }
    console.error("[AUTH ERROR]", err.code, err.message);
    throw err;
  }
};

export const logOut = () => signOut(auth);
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCD_W4-fsA-SptZO0HIMjRTEZj5mrPBFYI",
  authDomain: "stranger-meet-33687.firebaseapp.com",
  projectId: "stranger-meet-33687",
  storageBucket: "stranger-meet-33687.firebasestorage.app",
  messagingSenderId: "455934686305",
  appId: "1:455934686305:web:454ac4aa15228da8712620",
  measurementId: "G-R0709FBQBM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

export const logInWithGoogle = () => signInWithPopup(auth, provider);
export const logOut = () => signOut(auth);
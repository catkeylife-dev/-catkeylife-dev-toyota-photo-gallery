import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCaRddFY4ZY9EX_raPTH58RDgfADliRCV0",
  authDomain: "anh-xe-thd.firebaseapp.com",
  projectId: "anh-xe-thd",
  storageBucket: "anh-xe-thd.firebasestorage.app",
  messagingSenderId: "768715428229",
  appId: "1:768715428229:web:d32be2a77e3f9e1ca274ec"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "asia-southeast1");


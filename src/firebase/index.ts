'use client';

import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { firebaseConfig } from './config';

export function initializeFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // P0 FIX: Initialize App Check for Production Abuse Protection
  if (typeof window !== 'undefined') {
    // Note: RECAPTCHA_SITE_KEY should be set in environment variables
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true
      });
    } catch (e) {
      console.warn("App Check failed to initialize. Ensure your environment is configured correctly.");
    }
  }

  return { app, auth, db };
}

export * from './provider';
export * from './auth/use-user';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './errors';
export * from './error-emitter';
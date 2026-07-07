import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

export interface ClientErrorLogInput {
  source: string;
  stage: string;
  message?: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

/**
 * Safely logs a client-side error to the 'client_error_logs' Firestore collection.
 * This function will NEVER throw an error or crash the app.
 */
export async function logClientError(input: ClientErrorLogInput): Promise<void> {
  try {
    const currentUser = auth.currentUser;
    
    // Fallback viewport values
    let viewportWidth = 0;
    let viewportHeight = 0;
    let devicePixelRatio = 1;
    
    if (typeof window !== 'undefined') {
      viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      devicePixelRatio = window.devicePixelRatio || 1;
    }

    const logData: Record<string, any> = {
      createdAt: serverTimestamp(),
      source: input.source || 'unknown',
      stage: input.stage || 'unknown',
      message: input.message || 'No error message provided',
      stack: input.stack || 'No stack trace available',
      extra: input.extra || {},
      
      // Device and browser information
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      platform: typeof navigator !== 'undefined' ? (navigator.platform || (navigator as any).userAgentData?.platform || 'unknown') : 'unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
      vendor: typeof navigator !== 'undefined' ? navigator.vendor : 'unknown',
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
        devicePixelRatio: devicePixelRatio
      }
    };

    // Include authenticated user details if present
    if (currentUser) {
      logData.uid = currentUser.uid;
      logData.email = currentUser.email || '';
    }

    // Write to Firestore collection 'client_error_logs'
    const logsCollection = collection(db, 'client_error_logs');
    await addDoc(logsCollection, logData);
  } catch (logErr) {
    // Fail silently in terms of UI crash, but print to console
    console.error('[logClientError] Critical: Failed to write error log to Firestore:', logErr);
  }
}

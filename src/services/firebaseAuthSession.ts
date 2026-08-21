/**
 * Shared Firebase Auth session for WB-M.
 * One app instance backs Auth, RTDB listeners, and callable Bearer tokens.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
  User,
} from 'firebase/auth';
import { Database, getDatabase } from 'firebase/database';
import { beginLoginTransition } from './wbmSessionFence';

const firebaseConfig = {
  apiKey: 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI',
  authDomain: 'wellbuilt-sync.firebaseapp.com',
  databaseURL: 'https://wellbuilt-sync-default-rtdb.firebaseio.com',
  projectId: 'wellbuilt-sync',
};

export class AuthSessionError extends Error {
  constructor(public readonly reason: 'missing' | 'expired' | 'revoked' | 'refresh_failed') {
    super(reason);
    this.name = 'AuthSessionError';
  }
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let database: Database | null = null;
let authReady: Promise<User | null> | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    const existing = getApps().find((a) => a.options.projectId === firebaseConfig.projectId);
    app = existing || initializeApp(firebaseConfig);
  }
  if (app.options.projectId !== firebaseConfig.projectId) {
    throw new Error('firebase_app_project_mismatch');
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  try {
    // RN persistence so cold start restores the same user the listener uses.
    const { getReactNativePersistence } = require('firebase/auth') as {
      getReactNativePersistence?: (s: typeof AsyncStorage) => unknown;
    };
    auth = initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence
        ? (getReactNativePersistence(AsyncStorage) as never)
        : undefined,
    });
  } catch {
    auth = getAuth(firebaseApp);
  }
  return auth;
}

export function getFirebaseDatabase(): Database {
  if (!database) database = getDatabase(getFirebaseApp());
  return database;
}

export function waitForAuthUser(): Promise<User | null> {
  if (authReady) return authReady;
  const a = getFirebaseAuth();
  authReady = new Promise((resolve) => {
    const unsub = onAuthStateChanged(a, (user) => {
      unsub();
      resolve(user);
    });
  });
  return authReady;
}

export async function persistCustomTokenSession(customToken: string): Promise<{
  idToken: string;
  refreshToken: string;
}> {
  return beginLoginTransition(async () => {
    const cred = await signInWithCustomToken(getFirebaseAuth(), customToken);
    const idToken = await cred.user.getIdToken();
    await SecureStore.setItemAsync('wb_auth_uid', cred.user.uid);
    return { idToken, refreshToken: cred.user.refreshToken || '' };
  });
}

export async function clearAuthSession(): Promise<void> {
  try {
    await signOut(getFirebaseAuth());
  } catch {
    /* ignore */
  }
  await SecureStore.deleteItemAsync('wb_auth_uid');
}

export async function getValidIdToken(): Promise<string> {
  await waitForAuthUser();
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new AuthSessionError('missing');
  try {
    return await user.getIdToken(/* forceRefresh */ false);
  } catch {
    try {
      return await user.getIdToken(true);
    } catch {
      throw new AuthSessionError('revoked');
    }
  }
}

export async function forceRefreshIdToken(): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new AuthSessionError('missing');
  return user.getIdToken(true);
}

export async function authorizedCallable<T>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const idToken = await getValidIdToken();
  const resp = await fetch(`https://us-central1-wellbuilt-sync.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    throw new Error(body?.error?.message || `Callable ${name} failed (${resp.status})`);
  }
  return body.result as T;
}

export async function verifySessionOnServer(): Promise<{
  driverId: string;
  companyId: string;
  active: true;
}> {
  return authorizedCallable('verifyDriverSession', {});
}

export function subscribeAuthRevocation(onRevoked: () => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => {
    if (!user) onRevoked();
  });
}

/** Fires when a Firebase user is present (login, SSO, cold restore). */
export function subscribeAuthReady(onReady: () => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => {
    if (user) onReady();
  });
}

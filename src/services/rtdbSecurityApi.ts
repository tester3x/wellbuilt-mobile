import { getFunctions, httpsCallable } from 'firebase/functions';
import { initializeApp, getApps } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI',
  databaseURL: 'https://wellbuilt-sync-default-rtdb.firebaseio.com',
  projectId: 'wellbuilt-sync',
};

function getApp() {
  return getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
}

export type RegistrationStatus = 'pending' | 'approved' | 'rejected' | 'none';

export async function checkDriverRegistrationStatus(
  passcodeHash: string,
): Promise<Exclude<RegistrationStatus, 'none'>> {
  const fn = httpsCallable<{ passcodeHash: string }, { status: 'pending' | 'approved' | 'rejected' }>(
    getFunctions(getApp()),
    'checkDriverRegistrationStatus',
  );
  const result = await fn({ passcodeHash });
  return result.data.status;
}

type FieldDriverAdminAction =
  | 'listPending'
  | 'listApproved'
  | 'approve'
  | 'reject'
  | 'listProduction'
  | 'listSystemLogs';

export async function callFieldDriverAdmin<T>(
  passcodeHash: string,
  action: FieldDriverAdminAction,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const fn = httpsCallable<
    { passcodeHash: string; action: FieldDriverAdminAction; payload?: Record<string, unknown> },
    T
  >(getFunctions(getApp()), 'fieldDriverAdmin');
  const result = await fn({ passcodeHash, action, payload });
  return result.data;
}
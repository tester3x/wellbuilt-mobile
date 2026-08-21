// src/contexts/FirebaseStatusContext.tsx
// Global Firebase status context - provides offline state to entire app

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  checkFirebaseConnectivity,
  getFirebaseStatus,
  onFirebaseStatusChange,
  startFirebaseStatusMonitor,
  stopFirebaseStatusMonitor,
  refreshFirebaseStatus,
} from '../services/firebaseStatus';
import type { ConnectionKind } from '../services/connectionDiagnosis';

interface FirebaseStatusContextValue {
  isOnline: boolean;
  reason?: string;
  kind: ConnectionKind;
  code?: string;
  checkNow: () => Promise<boolean>;
}

const FirebaseStatusContext = createContext<FirebaseStatusContextValue>({
  isOnline: true,
  reason: undefined,
  kind: 'ok',
  checkNow: async () => true,
});

export function useFirebaseStatus() {
  return useContext(FirebaseStatusContext);
}

interface Props {
  children: React.ReactNode;
}

export function FirebaseStatusProvider({ children }: Props) {
  const [isOnline, setIsOnline] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [kind, setKind] = useState<ConnectionKind>('ok');
  const [code, setCode] = useState<string | undefined>();

  useEffect(() => {
    // Start monitoring
    startFirebaseStatusMonitor();

    // Subscribe to status changes
    const unsubscribe = onFirebaseStatusChange((online, statusReason, statusKind) => {
      console.log(`[FirebaseStatusContext] Status changed: online=${online}, kind=${statusKind}, reason=${statusReason}`);
      setIsOnline(online);
      setKind(statusKind || (online ? 'ok' : 'unreachable'));
      setCode(getFirebaseStatus().code);
      const authish = statusKind === 'auth_session' || statusKind === 'permission';
      setReason(online && !authish ? undefined : statusReason);
    });

    // Initial check
    checkFirebaseConnectivity();

    return () => {
      unsubscribe();
      stopFirebaseStatusMonitor();
    };
  }, []);

  const checkNow = useCallback(async () => {
    const result = await refreshFirebaseStatus();
    console.log(`[FirebaseStatusContext] Manual check result: ${result}`);
    // Force state update even if same value (in case listener didn't fire)
    const st = getFirebaseStatus();
    setIsOnline(result);
    setKind(st.kind);
    setCode(st.code);
    const authish = st.kind === 'auth_session' || st.kind === 'permission';
    setReason(result && !authish ? undefined : st.reason);
    return result;
  }, []);

  return (
    <FirebaseStatusContext.Provider value={{ isOnline, reason, kind, code, checkNow }}>
      {children}
    </FirebaseStatusContext.Provider>
  );
}

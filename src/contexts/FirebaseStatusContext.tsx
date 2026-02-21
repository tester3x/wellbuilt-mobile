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

interface FirebaseStatusContextValue {
  isOnline: boolean;
  reason?: string;
  checkNow: () => Promise<boolean>;
}

const FirebaseStatusContext = createContext<FirebaseStatusContextValue>({
  isOnline: true,
  reason: undefined,
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

  useEffect(() => {
    // Start monitoring
    startFirebaseStatusMonitor();

    // Subscribe to status changes
    const unsubscribe = onFirebaseStatusChange((online, statusReason) => {
      console.log(`[FirebaseStatusContext] Status changed: online=${online}, reason=${statusReason}`);
      setIsOnline(online);
      setReason(online ? undefined : statusReason);  // Clear reason when online
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
    setIsOnline(result);
    if (result) {
      setReason(undefined);
    }
    return result;
  }, []);

  return (
    <FirebaseStatusContext.Provider value={{ isOnline, reason, checkNow }}>
      {children}
    </FirebaseStatusContext.Provider>
  );
}

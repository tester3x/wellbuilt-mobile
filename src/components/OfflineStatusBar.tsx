// src/components/OfflineStatusBar.tsx
// Sync confirmation only — no persistent offline banner.
// Shows an alert when queued packets are successfully sent after reconnection.
// The "saved locally" alerts in record.tsx handle the queuing notification.

import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { onFlushComplete, type FlushResult } from '../services/packetQueue';

/**
 * Invisible component that listens for queue flush completion
 * and shows a confirmation alert to the driver.
 * No banner — drivers in dead zones don't need a constant reminder.
 */
export function SyncConfirmation() {
  useEffect(() => {
    const unsub = onFlushComplete((result: FlushResult) => {
      const wells = result.wellNames.join(', ');
      const lines: string[] = [];
      lines.push(`${result.sent} pull${result.sent > 1 ? 's' : ''} sent`);
      if (wells) lines.push(`Wells: ${wells}`);
      if (result.failed > 0) lines.push(`${result.failed} still pending`);
      Alert.alert('Back Online — Pulls Synced', lines.join('\n'));
    });
    return unsub;
  }, []);

  return null; // No visible UI — just the listener
}

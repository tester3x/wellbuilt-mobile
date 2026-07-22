// app/sync-status.tsx
// Sync Status screen (GS3): truthful per-packet delivery visibility.
// Lists every locally queued packet and every submitted/rejected pull with
// status, attempts, and the last error or exact server rejection reason.
// Failed/rejected evidence is never removed here. Manual retry exists ONLY
// for locally queued transport failures and reuses the same stable
// packetId; server-rejected packets have no retry.

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DeliveryItem,
  getDeliveryItems,
  reconcileSubmittedPulls,
} from '../src/services/deliveryStatus';
import { retryPacketNow } from '../src/services/packetQueue';

const STATUS_META: Record<DeliveryItem['status'], { label: string; color: string }> = {
  pending_sync: { label: 'Waiting to send', color: '#3b82f6' },
  submitted: { label: 'Submitted — awaiting server', color: '#eab308' },
  sync_failed: { label: 'Send failing — will keep retrying', color: '#ef4444' },
  rejected: { label: 'Rejected by server', color: '#ef4444' },
};

export default function SyncStatusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async (reconcile: boolean) => {
    try {
      if (reconcile) await reconcileSubmittedPulls();
    } catch {
      // offline — show local truth anyway
    }
    setItems(await getDeliveryItems());
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const onRetry = useCallback(async (item: DeliveryItem) => {
    if (!item.queueId || retryingId) return;
    setRetryingId(item.queueId);
    try {
      await retryPacketNow(item.queueId);
      await load(true);
    } finally {
      setRetryingId(null);
    }
  }, [load, retryingId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sync Status</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {items.length === 0 && (
          <Text style={styles.empty}>All pulls are confirmed synced. Nothing needs attention.</Text>
        )}
        {items.map((item) => {
          const meta = STATUS_META[item.status];
          return (
            <View key={item.queueId ?? item.packetId ?? item.dateTime} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.well}>{item.wellName}{item.type === 'edit' ? ' (edit)' : ''}</Text>
                <Text style={[styles.status, { color: meta.color }]}>{meta.label}</Text>
              </View>
              <Text style={styles.line}>
                {item.dateTime || 'Unknown time'}
                {item.bblsTaken !== null ? `  ·  ${item.bblsTaken} BBL` : ''}
              </Text>
              {item.attempts > 0 && (
                <Text style={styles.line}>
                  Attempts: {item.attempts}
                  {item.lastAttemptAt ? `  ·  last try ${new Date(item.lastAttemptAt).toLocaleString()}` : ''}
                </Text>
              )}
              {item.lastError && <Text style={styles.error}>{item.lastError}</Text>}
              {item.packetId && <Text style={styles.packetId}>{item.packetId}</Text>}
              {item.canRetry && (
                <TouchableOpacity
                  style={[styles.retryBtn, retryingId !== null && styles.retryBtnDisabled]}
                  disabled={retryingId !== null}
                  onPress={() => onRetry(item)}
                >
                  <Text style={styles.retryText}>
                    {retryingId === item.queueId ? 'Retrying…' : 'Retry now'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05060B' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 64 },
  backText: { color: '#3b82f6', fontSize: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { color: '#8b93a7', textAlign: 'center', marginTop: 48, fontSize: 15 },
  card: {
    backgroundColor: '#10131c',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e2433',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  well: { color: '#fff', fontSize: 16, fontWeight: '700' },
  status: { fontSize: 13, fontWeight: '600' },
  line: { color: '#aeb6c8', fontSize: 13, marginTop: 2 },
  error: { color: '#f87171', fontSize: 13, marginTop: 6 },
  packetId: { color: '#5a6378', fontSize: 11, marginTop: 6, fontFamily: 'monospace' },
  retryBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#1c2a3a',
    borderColor: '#3b82f6',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  retryBtnDisabled: { opacity: 0.5 },
  retryText: { color: '#93c5fd', fontSize: 14, fontWeight: '600' },
});

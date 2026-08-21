// app/sync-status.tsx
// Sync Status screen (GS3): truthful per-packet delivery visibility.
// Lists every locally queued packet and every submitted/rejected pull with
// status, attempts, and the last error or exact server rejection reason.
// Failed/rejected evidence is never removed here. Manual retry exists ONLY
// for locally queued transport failures and reuses the same stable
// packetId; server-rejected packets have no retry.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  DeliveryFilter,
  DeliveryItem,
  getDeliveryItems,
  onReconcileResult,
  reconcileSubmittedPulls,
  recoverStuckSubmission,
  selectDeliveryItems,
} from '../src/services/deliveryStatus';
import { onEditDeliveryResult, processEditOperations } from '../src/services/editDelivery';
import { retryPacketNow } from '../src/services/packetQueue';
import { formatAppDateTime } from '../src/i18n/format';

const STATUS_COLORS: Record<DeliveryItem['status'], string> = {
  pending_sync: '#3b82f6',
  submitted: '#eab308',
  sync_failed: '#ef4444',
  rejected: '#ef4444',
  edit_pending: '#3b82f6',
  edit_submitted: '#eab308',
  edit_failed: '#ef4444',
  edit_rejected: '#ef4444',
  edit_blocked: '#ef4444',
};

export default function SyncStatusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: DeliveryFilter =
    params.filter === 'attention' || params.filter === 'pending' ? params.filter : 'all';
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async (reconcile: boolean) => {
    try {
      if (reconcile) {
        await reconcileSubmittedPulls();
        await processEditOperations();
      }
    } catch {
      // offline / auth — show local truth anyway
    }
    try {
      setItems(await getDeliveryItems());
    } catch {
      // storage hiccup — keep the last known list rather than flash empty
    }
  }, []);

  // Freshness contract (field-test fix: a pull kept showing "Submitted —
  // awaiting server" after it was already processed):
  //  - reconcile IMMEDIATELY on mount/focus;
  //  - while the screen is visible AND submitted entries remain, run a
  //    bounded short poll (the service's overlap guard prevents stacking);
  //  - rows update the moment any reconcile pass settles an outcome
  //    (processed confirmation always wins over stale local state);
  //  - every timer/listener is cleaned up on blur/unmount, and the poll
  //    self-stops once nothing is awaiting the server.
  const itemsRef = useRef<DeliveryItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const POLL_WHILE_VISIBLE_MS = 5000;
  useFocusEffect(
    useCallback(() => {
      load(true); // immediate pass on focus/mount
      const unsubReconcile = onReconcileResult(() => {
        getDeliveryItems().then(setItems).catch(() => {});
      });
      const unsubEdits = onEditDeliveryResult(() => {
        getDeliveryItems().then(setItems).catch(() => {});
      });
      const timer = setInterval(() => {
        const awaiting = itemsRef.current.some(
          (i) => i.status === 'submitted' || i.status === 'edit_submitted',
        );
        if (awaiting) load(true);
      }, POLL_WHILE_VISIBLE_MS);
      return () => { unsubReconcile(); unsubEdits(); clearInterval(timer); };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const onAction = useCallback(async (item: DeliveryItem) => {
    if (!item.action || retryingId) return;
    const key = item.queueId ?? item.packetId ?? '';
    setRetryingId(key);
    try {
      if (item.action === 'retry' && item.queueId) {
        await retryPacketNow(item.queueId);
      } else if (item.action === 'recover' && item.packetId) {
        // Safe same-ID recovery: checks processed → rejected → incoming
        // before any resubmission; never duplicates an in-flight packet.
        await recoverStuckSubmission(item.packetId);
      } else if (item.action === 'retryEdit') {
        await processEditOperations();
      }
      await load(true);
    } finally {
      setRetryingId(null);
    }
  }, [load, retryingId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('syncStatus.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {(() => {
          const visible = selectDeliveryItems(items, filter);
          if (visible.length === 0) {
            const emptyKey = filter === 'attention'
              ? 'syncStatus.emptyAttention'
              : filter === 'pending'
                ? 'syncStatus.emptyPending'
                : 'syncStatus.emptyFull';
            return <Text style={styles.empty}>{t(emptyKey)}</Text>;
          }
          return visible.map((item) => {
          const color = STATUS_COLORS[item.status];
          const statusKey = `syncStatus.${item.status}` as const;
          const actionKey =
            item.action === 'retry'
              ? 'syncStatus.retry'
              : item.action === 'recover'
                ? 'syncStatus.recover'
                : item.action === 'retryEdit'
                  ? 'syncStatus.retryEdit'
                  : null;
          return (
            <View key={`${item.type}_${item.queueId ?? item.packetId ?? item.dateTime}`} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.well} numberOfLines={2}>
                  {item.wellName}
                  {item.type === 'edit' ? ` (${t('history.edit')})` : ''}
                </Text>
                <Text style={[styles.status, { color }]} numberOfLines={2}>
                  {t(statusKey)}
                </Text>
              </View>
              {item.needsAttention && (
                <Text style={styles.attentionTag}>⚠ {t('syncStatus.needsAttention')}</Text>
              )}
              <Text style={styles.line}>
                {item.dateTime || '—'}
                {item.bblsTaken !== null ? `  ·  ${item.bblsTaken} ${t('units.bbl').toUpperCase()}` : ''}
              </Text>
              {item.attempts > 0 && (
                <Text style={styles.line}>
                  {item.attempts}
                  {item.lastAttemptAt ? `  ·  ${formatAppDateTime(item.lastAttemptAt)}` : ''}
                </Text>
              )}
              {item.lastError && <Text style={styles.error}>{item.lastError}</Text>}
              {item.packetId && <Text style={styles.packetId}>{item.packetId}</Text>}
              {item.action && actionKey && (
                <TouchableOpacity
                  style={[styles.retryBtn, retryingId !== null && styles.retryBtnDisabled]}
                  disabled={retryingId !== null}
                  onPress={() => onAction(item)}
                >
                  <Text style={styles.retryText}>
                    {retryingId === (item.queueId ?? item.packetId)
                      ? t('syncStatus.working')
                      : t(actionKey)}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
          });
        })()}
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
  attentionTag: { color: '#ef4444', fontSize: 12.5, fontWeight: '700', marginBottom: 4 },
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

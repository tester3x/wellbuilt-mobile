/**
 * Route Me — WB-M Phase 1 (visual-only pilot).
 *
 * A dedicated driver-scoped All Wells page. It renders the SHARED, server-computed
 * routing result (fetchRouteMe → getDriverRouteMe, self scope). WB-M copies NO routing
 * math and reads NO global pool. Phase 1 is visual-only:
 *   - checkboxes render for UX evaluation but CANNOT submit or persist assignments;
 *   - the DDJD control is visible but DISABLED with honest pilot copy;
 *   - no dispatch/DDJD write happens here.
 * Until the shared endpoint is deployed, the page fails closed with an honest notice.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hp, spacing, wp } from '../src/ui/layout';
import {
  fetchRouteMe,
  ddjdButtonState,
  isSelectableForDdjd,
  type RouteMeResult,
  type RouteMeWell,
} from '../src/services/routeMe';

const PRIORITY_COLOR: Record<RouteMeWell['priorityState'], string> = {
  'pull-now': '#DC2626',
  approaching: '#D97706',
  verify: '#B45309',
  down: '#4B5563',
  'no-gain': '#6B7280',
};

export default function RouteMeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [result, setResult] = useState<RouteMeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Phase 1: checkbox selection is LOCAL ONLY — it never submits or persists.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const r = await fetchRouteMe();
    setResult(r);
    // Drop selections for wells no longer selectable.
    setChecked((prev) => {
      const next = new Set<string>();
      for (const w of r.wells) if (prev.has(w.wellName) && isSelectableForDdjd(w)) next.add(w.wellName);
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => { await load(); if (alive) setLoading(false); })();
    return () => { alive = false; };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const toggle = useCallback((well: RouteMeWell) => {
    if (!isSelectableForDdjd(well)) return; // muted/assigned wells are not selectable
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(well.wellName)) next.delete(well.wellName); else next.add(well.wellName);
      return next;
    });
  }, []);

  const caps = result?.capabilities;
  const ddjd = caps ? ddjdButtonState(caps, checked.size) : null;

  const renderItem = ({ item }: { item: RouteMeWell }) => {
    const selectable = isSelectableForDdjd(item);
    const isChecked = checked.has(item.wellName);
    return (
      <View style={[styles.row, item.muted && styles.rowMuted]}>
        <TouchableOpacity
          onPress={() => toggle(item)}
          disabled={!selectable}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isChecked, disabled: !selectable }}
          style={[styles.checkbox, isChecked && styles.checkboxChecked, !selectable && styles.checkboxDisabled]}
        >
          {isChecked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </TouchableOpacity>
        <View style={styles.rowMain}>
          <Text style={styles.wellName} numberOfLines={1}>{item.wellName}</Text>
          <Text style={styles.wellMeta} numberOfLines={1}>
            {item.levelDisplay} · {item.timeTillPull} · {item.recommendedDisposal}
          </Text>
          {item.assignmentState === 'assigned_other' && (
            <Text style={styles.assignedOther}>Assigned · {item.assignee || 'another driver'}</Text>
          )}
          {(item.assignmentState === 'assigned_self' || item.assignmentState === 'in_ddjd') && (
            <Text style={styles.alreadyLoaded}>Already loaded</Text>
          )}
        </View>
        <View style={[styles.priorityPill, { backgroundColor: PRIORITY_COLOR[item.priorityState] }]}>
          <Text style={styles.priorityText}>{item.priorityState.replace('-', ' ')}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ {t('common.back', { defaultValue: 'Back' })}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('nav.routeMe', { defaultValue: 'Route Me' })}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#C4A574" /></View>
      ) : !caps?.canViewRouteMe ? (
        <View style={styles.center}>
          <Text style={styles.unavailable}>
            {result?.unavailableReason || 'Route Me is not available for your account.'}
          </Text>
        </View>
      ) : result && result.wells.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.unavailable}>No wells are assigned to you.</Text>
        </View>
      ) : (
        <FlatList
          data={result?.wells ?? []}
          keyExtractor={(w) => `${w.companyId}:${w.wellId || w.wellName}`}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C4A574" />}
          contentContainerStyle={{ paddingBottom: spacing.xl * 3 }}
        />
      )}

      {/* Sticky DDJD action — Phase 1: visible but DISABLED (visual-only pilot). */}
      {caps?.canViewRouteMe && ddjd && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <TouchableOpacity disabled style={[styles.ddjdBtn, styles.ddjdBtnDisabled]} accessibilityState={{ disabled: true }}>
            <Text style={styles.ddjdBtnText}>{ddjd.label}</Text>
          </TouchableOpacity>
          <Text style={styles.ddjdReason}>{ddjd.reason}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#1F2937',
  },
  backBtn: { minWidth: wp('16%') },
  backText: { color: '#C4A574', fontSize: Math.round(hp('1.9%')) },
  title: { color: '#F9FAFB', fontSize: Math.round(hp('2.2%')), fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  unavailable: { color: '#9CA3AF', fontSize: Math.round(hp('1.8%')), textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#1F2937',
  },
  rowMuted: { opacity: 0.5 },
  checkbox: {
    width: 24, height: 24, borderRadius: 5, borderWidth: 2, borderColor: '#C4A574',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#C4A574' },
  checkboxDisabled: { borderColor: '#4B5563' },
  checkboxMark: { color: '#1F2937', fontWeight: '900', fontSize: 15 },
  rowMain: { flex: 1, minWidth: 0 },
  wellName: { color: '#F9FAFB', fontSize: Math.round(hp('1.9%')), fontWeight: '600' },
  wellMeta: { color: '#9CA3AF', fontSize: Math.round(hp('1.4%')), marginTop: 2 },
  assignedOther: { color: '#93C5FD', fontSize: Math.round(hp('1.3%')), marginTop: 2 },
  alreadyLoaded: { color: '#6EE7B7', fontSize: Math.round(hp('1.3%')), marginTop: 2 },
  priorityPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 5 },
  priorityText: { color: '#F9FAFB', fontSize: Math.round(hp('1.2%')), fontWeight: '700' },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#111827', borderTopWidth: 1, borderTopColor: '#1F2937',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, alignItems: 'center',
  },
  ddjdBtn: { width: '100%', borderRadius: 8, paddingVertical: spacing.md, alignItems: 'center' },
  ddjdBtnDisabled: { backgroundColor: '#374151' },
  ddjdBtnText: { color: '#9CA3AF', fontSize: Math.round(hp('1.9%')), fontWeight: '700' },
  ddjdReason: { color: '#9CA3AF', fontSize: Math.round(hp('1.4%')), marginTop: spacing.xs, textAlign: 'center' },
});

/**
 * Route Me — WB-M Day Planning Surface.
 *
 * Provides a governed day-planning interface using Summary candidate well calculations:
 * 1. Shows driver-scoped authorized wells with Summary's current/projected level,
 *    barrels available, and ready-time calculations alongside existing DDJD cards.
 * 2. Pinned active or paused jobs at top; distinguishes already-built jobs from unbuilt wells.
 * 3. Driver can plan/adjust remaining order; SW and PW jobs coexist.
 * 4. Preserves split-ticket monotonic sequence invariant (earlier split leg must close before next begins).
 * 5. Governed Build Job creates pending DDJD card directly (createWbmDriverDispatch / createDriverDispatchIfAbsent),
 *    bypassing drawers, preventing duplicate cards, and giving explicit success/failure feedback.
 * 6. Preserves Summary (app/summary.tsx) as its own standalone screen.
 * 7. Strictly respects server-scoped driver authority (scopedWellsForDisplay).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
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
  loadWellConfig,
  fetchDriverRouteAssignment,
  scopedWellsForDisplay,
  type WellConfigMap,
} from '../src/services/wellConfig';
import {
  getLevelSnapshot,
  loadLevelSnapshots,
} from '../src/services/wellHistory';
import {
  fetchRouteMe,
  buildRouteMeDayPlanFromSummary,
  reorderPlannedJobs,
  createWbmDriverDispatch,
  STORAGE_KEY_DRIVER_DISPATCHES,
  type RouteMePlannedJob,
} from '../src/services/routeMe';

type PlanTab = 'all' | 'planned' | 'candidates';

export default function RouteMeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<PlanTab>('all');
  const [pinnedJobs, setPinnedJobs] = useState<RouteMePlannedJob[]>([]);
  const [pendingJobs, setPendingJobs] = useState<RouteMePlannedJob[]>([]);
  const [candidateWells, setCandidateWells] = useState<RouteMePlannedJob[]>([]);
  const [buildingWell, setBuildingWell] = useState<string | null>(null);
  const [serverDisposalMap, setServerDisposalMap] = useState<Record<string, string>>({});
  const [eligibleDisposals, setEligibleDisposals] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      // 1. Authoritative driver-scoped configuration
      const config = await loadWellConfig();
      const assignment = await fetchDriverRouteAssignment();
      const scopedConfig: WellConfigMap = scopedWellsForDisplay(config || {}, assignment);

      // 2. Level snapshots
      await loadLevelSnapshots();
      const snapshotEntries = await Promise.all(
        Object.keys(scopedConfig).map(async (name) => [name, await getLevelSnapshot(name)] as const),
      );
      const snapshots = new Map(snapshotEntries);

      // 3. Existing local and server DDJD dispatches
      const rawDispatches = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
      const existingDispatches = rawDispatches ? JSON.parse(rawDispatches) : [];

      // 4. Server-computed drop-off / route suggestions if available
      try {
        const srv = await fetchRouteMe();
        if (srv && srv.wells) {
          const map: Record<string, string> = {};
          const eligibleList: string[] = [];
          for (const w of srv.wells) {
            if (w.recommendedDisposal && w.recommendedDisposal !== 'No verified drop-off') {
              map[w.wellName] = w.recommendedDisposal;
              if (!eligibleList.includes(w.recommendedDisposal)) {
                eligibleList.push(w.recommendedDisposal);
              }
            }
          }
          setServerDisposalMap(map);
          setEligibleDisposals(eligibleList);
        }
      } catch {
        // Non-fatal if server route service is not ready
      }

      // 5. Build Day Plan using Summary calculations
      const plan = buildRouteMeDayPlanFromSummary({
        wellConfig: scopedConfig,
        snapshots,
        existingDispatches,
      });

      setPinnedJobs(plan.pinnedJobs);
      setPendingJobs(plan.pendingJobs);
      setCandidateWells(plan.candidateWells);
    } catch (err) {
      console.error('[RouteMe] Failed to load day plan:', err);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Governed reordering enforcing split-ticket sequencing invariant
  const handleMovePending = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const result = reorderPlannedJobs(pendingJobs, index, targetIndex);
    if (!result.ok) {
      const msg =
        result.error === 'split_ticket_sequence_violation: earlier split leg must close before next begins'
          ? 'Split-ticket rule: earlier split leg must close before next begins.'
          : (result.error || 'Cannot reorder.');
      Alert.alert('Reorder Blocked', msg);
      return;
    }

    setPendingJobs(result.reordered);

    // Persist reordered pending jobs
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
      if (raw) {
        const all: any[] = JSON.parse(raw);
        const pinned = all.filter(
          (d: any) => d.status === 'active' || d.status === 'paused' || d.status === 'in_progress',
        );
        const other = all.filter(
          (d: any) =>
            d.status === 'completed' || d.status === 'cancelled' || d.status === 'closed' || d.status === 'declined',
        );
        const pendingMap = new Map(all.map((d: any) => [d.id || d.dispatchId, d]));
        const nextPending = result.reordered
          .map((item) => pendingMap.get(item.id) || pendingMap.get(item.dispatchId))
          .filter(Boolean);
        await AsyncStorage.setItem(
          STORAGE_KEY_DRIVER_DISPATCHES,
          JSON.stringify([...pinned, ...nextPending, ...other]),
        );
      }
    } catch (err) {
      console.warn('[RouteMe] Failed to persist reordered dispatches:', err);
    }
  };

  // Governed Build Job creation: bypasses drawers, status 'pending', prevents duplicates
  const executeBuild = async (item: RouteMePlannedJob, disposal?: string) => {
    setBuildingWell(item.wellName);
    try {
      const res = await createWbmDriverDispatch({
        wellName: item.wellName,
        operator: item.operator,
        jobType: item.jobType,
        disposal,
        eligibleDisposals,
      });

      if (!res.ok) {
        if (res.error === 'duplicate_card_exists') {
          Alert.alert('Card Already Exists', `A job card for "${item.wellName}" is already built or active.`);
        } else if (res.error?.includes('disposal_required')) {
          Alert.alert('Drop-off Required', 'Produced water jobs require a verified eligible SWD drop-off.');
        } else if (res.error === 'disposal_not_eligible') {
          Alert.alert('Ineligible Drop-off', 'Selected drop-off is not on the verified eligible list.');
        } else if (res.error?.includes('offline_unavailable')) {
          Alert.alert(
            'Network Required',
            'Network connection is required to create a governed DDJD card. Please connect to a network and try again.',
          );
        } else {
          Alert.alert('Build Failed', `Could not build job card: ${res.error}`);
        }
        return;
      }

      if (res.status === 'already_exists') {
        Alert.alert('Card Already Exists', `A job card for "${item.wellName}" is already registered on the server.`);
      } else {
        Alert.alert('Job Card Created', `Created pending DDJD card for "${item.wellName}". Added to planned queue.`);
      }
      await load();
    } catch (err) {
      Alert.alert('Error', `Failed to build job card: ${err}`);
    } finally {
      setBuildingWell(null);
    }
  };

  const handleBuildJob = async (item: RouteMePlannedJob) => {
    const isPw = (item.jobType || 'pw').toLowerCase() === 'pw';
    const verifiedDropOff = serverDisposalMap[item.wellName] || item.disposal;

    if (isPw && (!verifiedDropOff || verifiedDropOff === 'No verified drop-off')) {
      if (eligibleDisposals.length > 0) {
        Alert.alert(
          'Select Verified Drop-off',
          `Produced water requires a verified SWD. Choose destination for "${item.wellName}":`,
          [
            ...eligibleDisposals.slice(0, 3).map((d) => ({
              text: d,
              onPress: () => executeBuild(item, d),
            })),
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      } else {
        Alert.alert(
          'No Verified Drop-off',
          `Cannot build job card for "${item.wellName}". Produced water jobs require a verified eligible SWD drop-off.`,
        );
        return;
      }
    }

    await executeBuild(item, verifiedDropOff);
  };

  const renderPinnedItem = (item: RouteMePlannedJob) => (
    <View key={item.id} style={styles.cardPinned}>
      <View style={styles.cardHeaderRow}>
        <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgePaused]}>
          <Text style={styles.badgeText}>
            {item.status === 'active' ? 'ACTIVE JOB' : 'PAUSED JOB'}
          </Text>
        </View>
        <Text style={styles.pinnedLabel}>PINNED AT TOP</Text>
      </View>
      <Text style={styles.cardTitle}>{item.wellName}</Text>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>
          Level: {item.currentLevelDisplay || '—'} · {item.bblsAvailable ?? 0} bbls avail
        </Text>
        <Text style={styles.jobTypeBadge}>{(item.jobType || 'PW').toUpperCase()}</Text>
      </View>
      {item.disposal ? (
        <Text style={styles.disposalText}>Drop-off: {item.disposal}</Text>
      ) : (
        <Text style={styles.disposalNone}>Drop-off: Not assigned</Text>
      )}
    </View>
  );

  const renderPendingItem = (item: RouteMePlannedJob, index: number) => (
    <View key={item.id} style={styles.cardPending}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.indexCircle}>
          <Text style={styles.indexCircleText}>{index + 1}</Text>
        </View>
        <Text style={styles.cardTitle}>{item.wellName}</Text>
        <View style={styles.reorderButtons}>
          <TouchableOpacity
            onPress={() => handleMovePending(index, 'up')}
            disabled={index === 0}
            style={[styles.arrowBtn, index === 0 && styles.arrowBtnDisabled]}
          >
            <Text style={[styles.arrowText, index === 0 && styles.arrowTextDisabled]}>▲</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleMovePending(index, 'down')}
            disabled={index === pendingJobs.length - 1}
            style={[styles.arrowBtn, index === pendingJobs.length - 1 && styles.arrowBtnDisabled]}
          >
            <Text style={[styles.arrowText, index === pendingJobs.length - 1 && styles.arrowTextDisabled]}>▼</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>
          Level: {item.currentLevelDisplay || '—'} · {item.readyTimeDisplay || 'Ready'}
        </Text>
        <View style={styles.badgeRow}>
          <Text style={styles.jobTypeBadge}>{(item.jobType || 'PW').toUpperCase()}</Text>
        </View>
      </View>
      {item.splitGroupId && (
        <Text style={styles.splitText}>
          Split Job: Part {item.splitSequence || 1} of {item.splitTotal || 2}
        </Text>
      )}
      {item.disposal ? (
        <Text style={styles.disposalText}>Drop-off: {item.disposal}</Text>
      ) : (
        <Text style={styles.disposalNone}>Drop-off: Verified SWD required</Text>
      )}
    </View>
  );

  const renderCandidateItem = (item: RouteMePlannedJob) => {
    const isBuilding = buildingWell === item.wellName;
    const verifiedDropOff = serverDisposalMap[item.wellName] || item.disposal;

    return (
      <View key={item.id} style={styles.cardCandidate}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.candidateInfo}>
            <Text style={styles.cardTitle}>{item.wellName}</Text>
            {item.operator ? <Text style={styles.operatorText}>{item.operator}</Text> : null}
          </View>
          {item.isCardBuilt ? (
            <View style={styles.badgeBuilt}>
              <Text style={styles.badgeBuiltText}>CARD IN QUEUE</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => handleBuildJob(item)}
              disabled={isBuilding}
              style={[styles.buildBtn, isBuilding && styles.buildBtnDisabled]}
            >
              {isBuilding ? (
                <ActivityIndicator size="small" color="#1F2937" />
              ) : (
                <Text style={styles.buildBtnText}>Build Job</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.candidateMetricsRow}>
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Current</Text>
            <Text style={styles.metricValue}>{item.currentLevelDisplay || '—'}</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Ready Level</Text>
            <Text style={styles.metricValue}>{item.readyLevelDisplay || '—'}</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Avail Bbls</Text>
            <Text style={styles.metricValue}>{item.bblsAvailable ?? 0}</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Ready Time</Text>
            <Text style={[styles.metricValue, item.isReady && styles.metricReady]}>
              {item.readyTimeDisplay || '—'}
            </Text>
          </View>
        </View>
        <Text style={styles.candidateDropOff}>
          Drop-off: {verifiedDropOff ? `✓ ${verifiedDropOff}` : 'Choose on build (no verified drop-off)'}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ {t('common.back', { defaultValue: 'Back' })}</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>{t('nav.routeMe', { defaultValue: 'Route Me' })}</Text>
          <Text style={styles.subtitle}>Day Planning & DDJD Order</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          onPress={() => setActiveTab('all')}
          style={[styles.tabItem, activeTab === 'all' && styles.tabItemActive]}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('planned')}
          style={[styles.tabItem, activeTab === 'planned' && styles.tabItemActive]}
        >
          <Text style={[styles.tabText, activeTab === 'planned' && styles.tabTextActive]}>
            Planned ({pendingJobs.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('candidates')}
          style={[styles.tabItem, activeTab === 'candidates' && styles.tabItemActive]}
        >
          <Text style={[styles.tabText, activeTab === 'candidates' && styles.tabTextActive]}>
            Candidates ({candidateWells.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#C4A574" size="large" />
          <Text style={styles.loadingText}>Loading day plan from Summary...</Text>
        </View>
      ) : (
        <FlatList
          data={[1]}
          keyExtractor={() => 'route_me_plan'}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C4A574" />}
          contentContainerStyle={{ paddingBottom: spacing.xl * 3 + Math.max(insets.bottom, 16) }}
          renderItem={() => (
            <View style={styles.content}>
              {/* Pinned Active/Paused Jobs */}
              {(activeTab === 'all' || activeTab === 'planned') && pinnedJobs.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>Active & Paused Jobs (Pinned)</Text>
                  {pinnedJobs.map(renderPinnedItem)}
                </View>
              )}

              {/* Planned DDJD Pending Queue */}
              {(activeTab === 'all' || activeTab === 'planned') && (
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>Planned Job Order ({pendingJobs.length})</Text>
                  {pendingJobs.length === 0 ? (
                    <Text style={styles.emptySectionText}>
                      No pending jobs planned yet. Build a job from Candidate Wells below.
                    </Text>
                  ) : (
                    pendingJobs.map((item, idx) => renderPendingItem(item, idx))
                  )}
                </View>
              )}

              {/* Candidate Wells from Summary */}
              {(activeTab === 'all' || activeTab === 'candidates') && (
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>Candidate Wells ({candidateWells.length})</Text>
                  {candidateWells.length === 0 ? (
                    <Text style={styles.emptySectionText}>No candidate wells authorized for your route.</Text>
                  ) : (
                    candidateWells.map(renderCandidateItem)
                  )}
                </View>
              )}
            </View>
          )}
        />
      )}

      {/* Governed Bottom Footer clearing insets */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + spacing.md }]}>
        <TouchableOpacity onPress={() => router.push('/summary')} style={styles.summaryNavBtn}>
          <Text style={styles.summaryNavBtnText}>View Full Well Summary</Text>
        </TouchableOpacity>
        <Text style={styles.ddjdReason}>Governed Day Planning · Split-ticket invariant enforced</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  headerTitleBlock: { alignItems: 'center' },
  backBtn: { minWidth: wp('16%') },
  backText: { color: '#C4A574', fontSize: Math.round(hp('1.9%')) },
  title: { color: '#F9FAFB', fontSize: Math.round(hp('2.1%')), fontWeight: '700' },
  subtitle: { color: '#9CA3AF', fontSize: Math.round(hp('1.3%')), marginTop: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    padding: 4,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: 8,
  },
  tabItem: {
    flex: 1,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabItemActive: { backgroundColor: '#334155' },
  tabText: { color: '#94A3B8', fontSize: Math.round(hp('1.5%')), fontWeight: '600' },
  tabTextActive: { color: '#F8FAFC', fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { color: '#9CA3AF', marginTop: spacing.md, fontSize: Math.round(hp('1.6%')) },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  section: { marginBottom: spacing.lg },
  sectionHeader: {
    color: '#E2E8F0',
    fontSize: Math.round(hp('1.8%')),
    fontWeight: '700',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptySectionText: {
    color: '#64748B',
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  cardPinned: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  cardPending: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: '#C4A574',
  },
  cardCandidate: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: '#475569',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeActive: { backgroundColor: '#065F46' },
  badgePaused: { backgroundColor: '#78350F' },
  badgeText: { color: '#ECFDF5', fontSize: Math.round(hp('1.2%')), fontWeight: '800' },
  pinnedLabel: { color: '#10B981', fontSize: Math.round(hp('1.2%')), fontWeight: '700' },
  cardTitle: { color: '#F9FAFB', fontSize: Math.round(hp('1.9%')), fontWeight: '700', flex: 1 },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  cardMeta: { color: '#94A3B8', fontSize: Math.round(hp('1.4%')) },
  badgeRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  badgeOffline: {
    backgroundColor: '#78350F',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeOfflineText: {
    color: '#FDE68A',
    fontSize: Math.round(hp('1.1%')),
    fontWeight: '800',
  },
  jobTypeBadge: {
    color: '#C4A574',
    fontSize: Math.round(hp('1.3%')),
    fontWeight: '700',
    backgroundColor: '#292524',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  disposalText: { color: '#6EE7B7', fontSize: Math.round(hp('1.3%')), marginTop: 4 },
  disposalNone: { color: '#9CA3AF', fontSize: Math.round(hp('1.3%')), marginTop: 4, fontStyle: 'italic' },
  splitText: { color: '#FBBF24', fontSize: Math.round(hp('1.3%')), marginTop: 2, fontWeight: '600' },
  indexCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  indexCircleText: { color: '#C4A574', fontWeight: '800', fontSize: Math.round(hp('1.4%')) },
  reorderButtons: { flexDirection: 'row', gap: 4 },
  arrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: { opacity: 0.3 },
  arrowText: { color: '#C4A574', fontSize: 14, fontWeight: '900' },
  arrowTextDisabled: { color: '#64748B' },
  candidateInfo: { flex: 1 },
  operatorText: { color: '#64748B', fontSize: Math.round(hp('1.3%')) },
  badgeBuilt: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
  },
  badgeBuiltText: { color: '#94A3B8', fontSize: Math.round(hp('1.2%')), fontWeight: '700' },
  buildBtn: {
    backgroundColor: '#C4A574',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  buildBtnDisabled: { opacity: 0.6 },
  buildBtnText: { color: '#1F2937', fontWeight: '800', fontSize: Math.round(hp('1.4%')) },
  candidateMetricsRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  metricCol: { flex: 1 },
  metricLabel: { color: '#64748B', fontSize: Math.round(hp('1.1%')), textTransform: 'uppercase' },
  metricValue: { color: '#F1F5F9', fontSize: Math.round(hp('1.5%')), fontWeight: '600', marginTop: 1 },
  metricReady: { color: '#34D399', fontWeight: '700' },
  candidateDropOff: { color: '#94A3B8', fontSize: Math.round(hp('1.2%')), marginTop: 6 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  summaryNavBtn: {
    width: '100%',
    borderRadius: 8,
    paddingVertical: spacing.sm,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  summaryNavBtnText: { color: '#F8FAFC', fontSize: Math.round(hp('1.6%')), fontWeight: '700' },
  ddjdReason: { color: '#9CA3AF', fontSize: Math.round(hp('1.3%')), marginTop: spacing.xs, textAlign: 'center' },
});

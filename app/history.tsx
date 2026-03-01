// app/history.tsx
// Shows history of pull packets sent by driver
// Swipe left to edit, tap to expand details
// Enhanced with filtering, stats, and driver tracking

import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Swipeable,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DateFilter,
  getAllTimeStats,
  getFilteredHistoryByDay,
  getThisMonthStats,
  getThisWeekStats,
  getTodayStats,
  getTopWells,
  getUniqueWells,
  getWellStats,
  PullHistoryEntry,
} from "../src/services/pullHistory";
import { getBblPerFootSync, getAllWellNames, loadWellConfig } from "../src/services/wellConfig";
import { isCurrentUserViewer } from "../src/services/driverAuth";
import { hp, spacing, wp } from "../src/ui/layout";

// Format level for display
// Always floor - matches packet level sent to VBA for consistent display
const formatLevel = (feet: number): string => {
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (inches === 0) return `${ft}'`;
  return `${ft}'${inches}"`;
};

// Format full datetime for detail view
const formatFullDateTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

// Calculate bottom level after pull using well config
const getBottomLevel = (wellName: string, topLevel: number, bblsTaken: number): number => {
  const bblPerFoot = getBblPerFootSync(wellName);
  return Math.max(topLevel - (bblsTaken / bblPerFoot), 0);
};

interface HistoryEntryProps {
  entry: PullHistoryEntry;
  onEdit: (entry: PullHistoryEntry) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  t: (key: string) => string;
}

function HistoryEntryCard({ entry, onEdit, isExpanded, onToggleExpand, t }: HistoryEntryProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-100, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <TouchableOpacity
        style={styles.editAction}
        onPress={() => {
          swipeableRef.current?.close();
          onEdit(entry);
        }}
      >
        <Animated.Text style={[styles.editActionText, { transform: [{ scale }] }]}>
          {t('history.edit')}
        </Animated.Text>
      </TouchableOpacity>
    );
  };

  const handleSwipeOpen = (direction: 'left' | 'right') => {
    if (direction === 'left') {
      setTimeout(() => {
        swipeableRef.current?.close();
        onEdit(entry);
      }, 200);
    }
  };

  const bottomLevel = getBottomLevel(entry.wellName, entry.tankLevelFeet, entry.bblsTaken);

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeOpen}
      rightThreshold={40}
      overshootRight={false}
    >
      <TouchableOpacity
        style={[
          styles.entryCard,
          entry.wellDown && styles.entryCardDown,
          entry.status === 'edited' && styles.entryCardEdited,
        ]}
        onPress={onToggleExpand}
        activeOpacity={0.7}
      >
        <View style={styles.entryMain}>
          <View style={styles.entryLeft}>
            <Text style={styles.entryWellName}>{entry.wellName}</Text>
            <Text style={styles.entryTime}>
              {entry.dateTime}
              {entry.status === 'edited' && (
                <Text style={styles.editedBadge}> {t('history.edited')}</Text>
              )}
            </Text>
          </View>
          <View style={styles.entryRight}>
            {entry.wellDown ? (
              <Text style={styles.entryDown}>{t('summary.down')}</Text>
            ) : (
              <>
                <Text style={styles.entryLevel}>
                  {formatLevel(entry.tankLevelFeet)}
                </Text>
                {entry.bblsTaken > 0 && (
                  <Text style={styles.entryBbls}>
                    {entry.bblsTaken} bbl
                  </Text>
                )}
              </>
            )}
            <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
          </View>
        </View>

        {isExpanded && (
          <View style={styles.entryDetail}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('history.topLevel')}</Text>
              <Text style={styles.detailValue}>{formatLevel(entry.tankLevelFeet)}</Text>
            </View>
            {!entry.wellDown && entry.bblsTaken > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('history.bottomLevel')}</Text>
                <Text style={styles.detailValue}>{formatLevel(bottomLevel)}</Text>
              </View>
            )}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('history.bblsTaken')}</Text>
              <Text style={styles.detailValue}>{entry.bblsTaken}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('history.wellStatus')}</Text>
              <Text style={[styles.detailValue, entry.wellDown && styles.detailValueDown]}>
                {entry.wellDown ? t('summary.down') : t('history.running')}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('history.sentAt')}</Text>
              <Text style={styles.detailValue}>{formatFullDateTime(entry.sentAt)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('history.packetId')}</Text>
              <Text style={styles.detailValueSmall}>{entry.packetId || entry.id}</Text>
            </View>

            <TouchableOpacity
              style={styles.editButton}
              onPress={() => onEdit(entry)}
            >
              <Text style={styles.editButtonText}>{t('history.editThisPull')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    </Swipeable>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // Filter state
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [wellFilter, setWellFilter] = useState<string>('all');
  const [showWellPicker, setShowWellPicker] = useState(false);

  // Data state
  const [historyByDay, setHistoryByDay] = useState<{ date: string; pulls: PullHistoryEntry[] }[]>([]);
  const [todayStats, setTodayStats] = useState({ pulls: 0, bbls: 0 });
  const [weekStats, setWeekStats] = useState({ pulls: 0, bbls: 0 });
  const [monthStats, setMonthStats] = useState({ pulls: 0, bbls: 0 });
  const [allTimeStats, setAllTimeStats] = useState({ pulls: 0, bbls: 0 });
  const [topWells, setTopWells] = useState<{ wellName: string; pulls: number; bbls: number; avgBbls: number }[]>([]);
  const [topWellsPage, setTopWellsPage] = useState(0); // For pagination (3 wells per page)
  const [uniqueWells, setUniqueWells] = useState<string[]>([]);
  const [selectedWellStats, setSelectedWellStats] = useState<{
    pulls: number; bbls: number; avgBbls: number; avgLevel: number;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allConfigWells, setAllConfigWells] = useState<string[]>([]);
  const [showAllWellsPicker, setShowAllWellsPicker] = useState(false);
  const [wellSearchText, setWellSearchText] = useState('');
  const [isViewer, setIsViewer] = useState(false);

  const loadHistory = useCallback(async () => {
    await loadWellConfig();

    // Load filtered history
    const grouped = await getFilteredHistoryByDay(dateFilter, wellFilter === 'all' ? undefined : wellFilter);
    setHistoryByDay(grouped);

    // Load stats for all 4 time periods
    const today = await getTodayStats();
    setTodayStats(today);

    const week = await getThisWeekStats();
    setWeekStats(week);

    const month = await getThisMonthStats();
    setMonthStats(month);

    const allTime = await getAllTimeStats();
    setAllTimeStats(allTime);

    // Load all top wells (not limited to 5) for pagination
    const top = await getTopWells(100, 'pulls');
    setTopWells(top);

    const wells = await getUniqueWells();
    setUniqueWells(wells);

    // Load all well names from config (for "View Any Well" feature)
    const configWells = await getAllWellNames();
    setAllConfigWells(configWells);

    // Load well-specific stats if filtered
    if (wellFilter !== 'all') {
      const wellStats = await getWellStats(wellFilter);
      setSelectedWellStats(wellStats);
    } else {
      setSelectedWellStats(null);
    }
  }, [dateFilter, wellFilter]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
      setExpandedId(null);
      // Check if user is viewer
      isCurrentUserViewer().then(setIsViewer);
    }, [loadHistory])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadHistory();
    setIsRefreshing(false);
  };

  const handleEdit = (entry: PullHistoryEntry) => {
    const fullPacketId = entry.packetId || entry.id;
    router.push({
      pathname: '/record',
      params: {
        wellName: entry.wellName,
        editMode: 'true',
        editId: fullPacketId,
        editDateTime: entry.dateTime,
        editLevel: String(entry.tankLevelFeet),
        editBbls: String(entry.bblsTaken),
        editWellDown: String(entry.wellDown),
        editPacketTimestamp: entry.packetTimestamp,
      },
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  // Calculate filtered totals
  const filteredTotals = historyByDay.reduce(
    (acc, day) => {
      acc.pulls += day.pulls.length;
      acc.bbls += day.pulls.reduce((sum, p) => sum + p.bblsTaken, 0);
      return acc;
    },
    { pulls: 0, bbls: 0 }
  );

  return (
    <GestureHandlerRootView style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('history.title')}</Text>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>{'⚙'}</Text>
        </TouchableOpacity>
      </View>

      {/* Stats Section - 4 compact tappable stat cards in 1 row */}
      <View style={styles.statsSection}>
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={[styles.statsCard, dateFilter === 'today' && styles.statsCardActive]}
            onPress={() => setDateFilter(dateFilter === 'today' ? 'all' : 'today')}
            activeOpacity={0.7}
          >
            <Text style={styles.statsCardTitle}>{t('history.today')}</Text>
            <Text style={[styles.statValueLarge, dateFilter === 'today' && styles.statValueActive]}>{todayStats.pulls}</Text>
            <Text style={[styles.statValueSmall, dateFilter === 'today' && styles.statValueActive]}>{todayStats.bbls.toLocaleString()}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statsCard, dateFilter === 'week' && styles.statsCardActive]}
            onPress={() => setDateFilter(dateFilter === 'week' ? 'all' : 'week')}
            activeOpacity={0.7}
          >
            <Text style={styles.statsCardTitle}>{t('historyExtra.week')}</Text>
            <Text style={[styles.statValueLarge, dateFilter === 'week' && styles.statValueActive]}>{weekStats.pulls}</Text>
            <Text style={[styles.statValueSmall, dateFilter === 'week' && styles.statValueActive]}>{weekStats.bbls.toLocaleString()}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statsCard, styles.statsCardGreen, dateFilter === 'month' && styles.statsCardActiveGreen]}
            onPress={() => setDateFilter(dateFilter === 'month' ? 'all' : 'month')}
            activeOpacity={0.7}
          >
            <Text style={styles.statsCardTitle}>{t('historyExtra.month')}</Text>
            <Text style={[styles.statValueLarge, styles.statValueGreen, dateFilter === 'month' && styles.statValueActive]}>{monthStats.pulls}</Text>
            <Text style={[styles.statValueSmall, styles.statValueGreen, dateFilter === 'month' && styles.statValueActive]}>{monthStats.bbls.toLocaleString()}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statsCard, styles.statsCardAmber, dateFilter === 'all' && styles.statsCardActiveAmber]}
            onPress={() => setDateFilter('all')}
            activeOpacity={0.7}
          >
            <Text style={styles.statsCardTitle}>{t('historyExtra.all')}</Text>
            <Text style={[styles.statValueLarge, styles.statValueAmber, dateFilter === 'all' && styles.statValueActive]}>{allTimeStats.pulls}</Text>
            <Text style={[styles.statValueSmall, styles.statValueAmber, dateFilter === 'all' && styles.statValueActive]}>{allTimeStats.bbls.toLocaleString()}</Text>
          </TouchableOpacity>
        </View>

        {/* Well Filter - moved below stats */}
        <TouchableOpacity
          style={styles.wellFilterButton}
          onPress={() => setShowWellPicker(true)}
        >
          <Text style={styles.wellFilterLabel}>{t('historyExtra.wellFilter')}</Text>
          <Text style={styles.wellFilterValue} numberOfLines={1}>
            {wellFilter === 'all' ? t('historyExtra.allWells') : wellFilter}
          </Text>
          <Text style={styles.wellFilterArrow}>▼</Text>
        </TouchableOpacity>

        {/* Top Wells - Paginated 3 at a time with swipe */}
        {topWells.length > 0 && wellFilter === 'all' && (
          <View style={styles.topWellsSection}>
            <View style={styles.topWellsHeader}>
              <Text style={styles.sectionTitle}>{t('history.yourWells')}</Text>
              {topWells.length > 3 && (
                <Text style={styles.topWellsPageIndicator}>
                  {topWellsPage * 3 + 1}-{Math.min((topWellsPage + 1) * 3, topWells.length)} {t('historyExtra.of')} {topWells.length}
                </Text>
              )}
            </View>
            <View style={styles.topWellsContainer}>
              {/* Left Arrow */}
              {topWellsPage > 0 && (
                <TouchableOpacity
                  style={styles.topWellsArrow}
                  onPress={() => setTopWellsPage(p => Math.max(0, p - 1))}
                >
                  <Text style={styles.topWellsArrowText}>{'<'}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.topWellsRow}>
                {topWells.slice(topWellsPage * 3, topWellsPage * 3 + 3).map((well, index) => {
                  const rank = topWellsPage * 3 + index + 1;
                  return (
                    <TouchableOpacity
                      key={well.wellName}
                      style={styles.topWellChip}
                      onPress={() => setWellFilter(well.wellName)}
                    >
                      <Text style={styles.topWellRank}>#{rank}</Text>
                      <Text style={styles.topWellName} numberOfLines={1}>{well.wellName}</Text>
                      <Text style={styles.topWellStats}>{well.pulls} {t('history.pulls')}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* Right Arrow */}
              {(topWellsPage + 1) * 3 < topWells.length && (
                <TouchableOpacity
                  style={styles.topWellsArrow}
                  onPress={() => setTopWellsPage(p => p + 1)}
                >
                  <Text style={styles.topWellsArrowText}>{'>'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Well-specific stats when filtered */}
        {selectedWellStats && wellFilter !== 'all' && (
          <View style={styles.wellStatsCard}>
            <View style={styles.wellStatsTitleRow}>
              <Text style={styles.wellStatsTitle}>{wellFilter}</Text>
              <TouchableOpacity
                style={styles.clearWellButton}
                onPress={() => setWellFilter('all')}
              >
                <Text style={styles.clearWellButtonText}>X</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.wellStatsRow}>
              <View style={styles.wellStatItem}>
                <Text style={styles.wellStatValue}>{selectedWellStats.pulls}</Text>
                <Text style={styles.wellStatLabel}>{t('history.pulls')}</Text>
              </View>
              <View style={styles.wellStatDivider} />
              <View style={styles.wellStatItem}>
                <Text style={styles.wellStatValue}>{selectedWellStats.bbls.toLocaleString()}</Text>
                <Text style={styles.wellStatLabel}>{t('history.bbls')}</Text>
              </View>
              <View style={styles.wellStatDivider} />
              <View style={styles.wellStatItem}>
                <Text style={styles.wellStatValue}>{selectedWellStats.avgBbls}</Text>
                <Text style={styles.wellStatLabel}>{t('history.avgBbl')}</Text>
              </View>
              <View style={styles.wellStatDivider} />
              <View style={styles.wellStatItem}>
                <Text style={styles.wellStatValue}>{formatLevel(selectedWellStats.avgLevel)}</Text>
                <Text style={styles.wellStatLabel}>{t('history.avgLevel')}</Text>
              </View>
            </View>
            {/* View WellBuilt Data button */}
            <TouchableOpacity
              style={styles.viewExcelButton}
              onPress={() => router.push({ pathname: '/well-data', params: { wellName: wellFilter } })}
            >
              <Text style={styles.viewExcelButtonText}>{t('history.viewWellBuiltData')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* View Any Well Button - at bottom of button cluster */}
        {wellFilter === 'all' && (
          <TouchableOpacity
            style={styles.viewAnyWellButton}
            onPress={() => {
              setWellSearchText('');
              setShowAllWellsPicker(true);
            }}
          >
            <Text style={styles.viewAnyWellButtonText}>{t('history.viewAnyWellData')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filtered Results Summary */}
      <View style={styles.resultsSummary}>
        <Text style={styles.resultsSummaryText}>
          {filteredTotals.pulls} pulls • {filteredTotals.bbls.toLocaleString()} BBLs
        </Text>
        {(dateFilter !== 'all' || wellFilter !== 'all') && (
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={() => {
              setDateFilter('all');
              setWellFilter('all');
            }}
          >
            <Text style={styles.clearFiltersText}>{t('history.clearFilters')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Swipe hint */}
      <Text style={styles.swipeHint}>{t('history.swipeHint')}</Text>

      {/* History List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#60A5FA"
            colors={["#60A5FA"]}
          />
        }
      >
        {historyByDay.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {isViewer ? 'Your Pull History' : t('history.noPulls')}
            </Text>
            <Text style={styles.emptySubtext}>
              {dateFilter !== 'all' || wellFilter !== 'all'
                ? 'Try adjusting your filters'
                : isViewer
                  ? 'This screen shows your personal pull history.\nAs a viewer, use "View Any Well\'s Data" above\nto see well pull history.'
                  : t('history.noPullsSubtext')}
            </Text>
          </View>
        ) : (
          historyByDay.map((day) => {
            const dayTotal = {
              pulls: day.pulls.length,
              bbls: day.pulls.reduce((sum, p) => sum + p.bblsTaken, 0),
            };

            return (
              <View key={day.date} style={styles.daySection}>
                <View style={styles.dayHeaderRow}>
                  <Text style={styles.dayHeader}>{day.date}</Text>
                  <View style={styles.dayTotals}>
                    <Text style={styles.dayTotalText}>{dayTotal.pulls} pulls</Text>
                    <Text style={styles.dayTotalDot}>•</Text>
                    <Text style={styles.dayTotalText}>{dayTotal.bbls.toLocaleString()} bbl</Text>
                  </View>
                </View>

                {day.pulls.map((entry) => (
                  <HistoryEntryCard
                    key={entry.id}
                    entry={entry}
                    onEdit={handleEdit}
                    isExpanded={expandedId === entry.id}
                    onToggleExpand={() => toggleExpand(entry.id)}
                    t={t}
                  />
                ))}
              </View>
            );
          })
        )}

        {historyByDay.length > 0 && (
          <Text style={styles.footerNote}>
            {t('history.footerNote')}
          </Text>
        )}
      </ScrollView>

      {/* Well Picker Modal */}
      <Modal
        visible={showWellPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWellPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowWellPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('historyExtra.selectWell')}</Text>
            <ScrollView style={styles.modalScroll}>
              <TouchableOpacity
                style={[styles.modalOption, wellFilter === 'all' && styles.modalOptionActive]}
                onPress={() => {
                  setWellFilter('all');
                  setShowWellPicker(false);
                }}
              >
                <Text style={[styles.modalOptionText, wellFilter === 'all' && styles.modalOptionTextActive]}>{t('historyExtra.allWells')}</Text>
              </TouchableOpacity>
              {uniqueWells.map((well) => (
                <TouchableOpacity
                  key={well}
                  style={[styles.modalOption, wellFilter === well && styles.modalOptionActive]}
                  onPress={() => {
                    setWellFilter(well);
                    setShowWellPicker(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, wellFilter === well && styles.modalOptionTextActive]}>
                    {well}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowWellPicker(false)}
            >
              <Text style={styles.modalCloseText}>{t('historyExtra.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* All Wells Picker Modal - for viewing any well's data */}
      <Modal
        visible={showAllWellsPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAllWellsPicker(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.modalOverlayTouchable}
            activeOpacity={1}
            onPress={() => setShowAllWellsPicker(false)}
          >
            <View style={styles.allWellsModalContent} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle}>{t('historyExtra.viewWellData')}</Text>
              <Text style={styles.allWellsSubtitle}>{t('historyExtra.viewWellDataSubtitle')}</Text>

              {/* Search Input */}
              <View style={styles.searchInputContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder={t('historyExtra.searchWells')}
                  placeholderTextColor="#6B7280"
                  value={wellSearchText}
                  onChangeText={setWellSearchText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {wellSearchText.length > 0 && (
                  <TouchableOpacity
                    style={styles.clearSearchButton}
                    onPress={() => setWellSearchText('')}
                  >
                    <Text style={styles.clearSearchText}>X</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView style={styles.allWellsScroll} keyboardShouldPersistTaps="handled">
                {allConfigWells
                  .filter(well =>
                    wellSearchText.length === 0 ||
                    well.toLowerCase().includes(wellSearchText.toLowerCase())
                  )
                  .map((well) => (
                    <TouchableOpacity
                      key={well}
                      style={styles.allWellsOption}
                      onPress={() => {
                        setShowAllWellsPicker(false);
                        router.push({ pathname: '/well-data', params: { wellName: well } });
                      }}
                    >
                      <Text style={styles.allWellsOptionText}>{well}</Text>
                      <Text style={styles.allWellsArrow}>{'>'}</Text>
                    </TouchableOpacity>
                  ))}
                {allConfigWells.filter(well =>
                  wellSearchText.length === 0 ||
                  well.toLowerCase().includes(wellSearchText.toLowerCase())
                ).length === 0 && (
                  <Text style={styles.noWellsFound}>{t('historyExtra.noWellsFound')}</Text>
                )}
              </ScrollView>

              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowAllWellsPicker(false)}
              >
                <Text style={styles.modalCloseText}>{t('historyExtra.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060B",
    // paddingTop is applied dynamically via insets.top
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: wp("5%"),
    marginBottom: spacing.sm,
  },
  backButton: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: hp("2.4%"),
    color: "#9CA3AF",
  },
  headerTitle: {
    fontSize: hp("2.4%"),
    color: "#F9FAFB",
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
  },
  settingsButton: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
  },
  settingsIcon: {
    fontSize: hp("2.4%"),
    color: "#9CA3AF",
  },
  // Stats Section - compact 4-in-a-row design
  statsSection: {
    paddingHorizontal: wp("4%"),
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    gap: 6,
  },
  statsCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: hp("0.8%"),
    paddingVertical: spacing.xs,
    paddingHorizontal: 4,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#1F2937",
  },
  statsCardActive: {
    borderColor: "#2563EB",
    backgroundColor: "#1E3A5F",
  },
  statsCardGreen: {
    borderColor: "#065F46",
    backgroundColor: "#0D1F17",
  },
  statsCardActiveGreen: {
    borderColor: "#10B981",
    backgroundColor: "#064E3B",
  },
  statsCardAmber: {
    borderColor: "#78350F",
    backgroundColor: "#1C1608",
  },
  statsCardActiveAmber: {
    borderColor: "#F59E0B",
    backgroundColor: "#451A03",
  },
  statsCardTitle: {
    fontSize: hp("1.1%"),
    fontWeight: "600",
    color: "#6B7280",
    marginBottom: 1,
  },
  statValueLarge: {
    fontSize: hp("2%"),
    fontWeight: "700",
    color: "#60A5FA",
    lineHeight: hp("2.4%"),
  },
  statValueSmall: {
    fontSize: hp("1.2%"),
    fontWeight: "500",
    color: "#60A5FA",
  },
  statValueMedium: {
    fontSize: hp("1.6%"),
    fontWeight: "600",
    color: "#60A5FA",
    marginTop: 2,
  },
  statValueGreen: {
    color: "#10B981",
  },
  statValueAmber: {
    color: "#F59E0B",
  },
  statValueActive: {
    color: "#FFFFFF",
  },
  statLabel: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
  },
  // Top Wells
  topWellsSection: {
    marginTop: spacing.sm,
  },
  topWellsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: hp("1.3%"),
    fontWeight: "600",
    color: "#6B7280",
  },
  topWellsPageIndicator: {
    fontSize: hp("1.1%"),
    color: "#4B5563",
  },
  topWellsContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  topWellsArrow: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  topWellsArrowText: {
    fontSize: hp("2%"),
    color: "#60A5FA",
    fontWeight: "700",
  },
  topWellsRow: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
  },
  topWellChip: {
    flex: 1,
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.xs,
    alignItems: "center",
  },
  topWellRank: {
    fontSize: hp("1%"),
    color: "#F59E0B",
    fontWeight: "700",
  },
  topWellName: {
    fontSize: hp("1.2%"),
    color: "#E5E7EB",
    fontWeight: "500",
    marginTop: 2,
  },
  topWellStats: {
    fontSize: hp("1%"),
    color: "#6B7280",
    marginTop: 2,
  },
  // Well Stats Card
  wellStatsCard: {
    backgroundColor: "#1E3A5F",
    borderRadius: hp("1%"),
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: "#2563EB",
  },
  wellStatsTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  wellStatsTitle: {
    fontSize: hp("1.6%"),
    fontWeight: "700",
    color: "#60A5FA",
    flex: 1,
    textAlign: "center",
  },
  clearWellButton: {
    width: hp("2.5%"),
    height: hp("2.5%"),
    borderRadius: hp("1.25%"),
    backgroundColor: "#374151",
    justifyContent: "center",
    alignItems: "center",
  },
  clearWellButtonText: {
    fontSize: hp("1.2%"),
    fontWeight: "700",
    color: "#9CA3AF",
  },
  wellStatsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  wellStatItem: {
    flex: 1,
    alignItems: "center",
  },
  wellStatValue: {
    fontSize: hp("1.8%"),
    fontWeight: "700",
    color: "#F9FAFB",
  },
  wellStatLabel: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    marginTop: 2,
  },
  wellStatDivider: {
    width: 1,
    height: hp("3%"),
    backgroundColor: "#374151",
  },
  viewExcelButton: {
    backgroundColor: "#10B981",
    borderRadius: hp("0.6%"),
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  viewExcelButtonText: {
    color: "#FFFFFF",
    fontSize: hp("1.4%"),
    fontWeight: "600",
  },
  // Well Filter Button (moved below stats cards)
  wellFilterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.6%"),
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  wellFilterLabel: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    marginRight: spacing.xs,
  },
  wellFilterValue: {
    flex: 1,
    fontSize: hp("1.3%"),
    color: "#E5E7EB",
    fontWeight: "500",
  },
  wellFilterArrow: {
    fontSize: hp("1%"),
    color: "#6B7280",
  },
  // Results Summary
  resultsSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: wp("5%"),
    marginBottom: spacing.xs,
  },
  resultsSummaryText: {
    fontSize: hp("1.3%"),
    color: "#9CA3AF",
  },
  clearFiltersButton: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  clearFiltersText: {
    fontSize: hp("1.2%"),
    color: "#60A5FA",
  },
  swipeHint: {
    fontSize: hp("1.2%"),
    color: "#4B5563",
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: wp("5%"),
    paddingBottom: hp("5%"),
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: hp("10%"),
  },
  emptyText: {
    fontSize: hp("2%"),
    color: "#9CA3AF",
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: hp("1.6%"),
    color: "#6B7280",
    textAlign: "center",
  },
  daySection: {
    marginBottom: spacing.md,
  },
  dayHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dayHeader: {
    fontSize: hp("1.5%"),
    fontWeight: "600",
    color: "#9CA3AF",
  },
  dayTotals: {
    flexDirection: "row",
    alignItems: "center",
  },
  dayTotalText: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
  },
  dayTotalDot: {
    fontSize: hp("1.2%"),
    color: "#4B5563",
    marginHorizontal: spacing.xs,
  },
  entryCard: {
    backgroundColor: "#111827",
    borderRadius: hp("1%"),
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: "#1F2937",
    overflow: "hidden",
  },
  entryCardDown: {
    borderColor: "#7F1D1D",
    backgroundColor: "#1F1111",
  },
  entryCardEdited: {
    borderColor: "#92400E",
  },
  entryMain: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.sm,
  },
  entryLeft: {
    flex: 1,
  },
  entryWellName: {
    fontSize: hp("1.6%"),
    fontWeight: "600",
    color: "#F9FAFB",
  },
  entryTime: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    marginTop: 2,
  },
  editedBadge: {
    color: "#F59E0B",
    fontStyle: "italic",
  },
  entryRight: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
  },
  entryLevel: {
    fontSize: hp("1.6%"),
    fontWeight: "600",
    color: "#60A5FA",
  },
  entryBbls: {
    fontSize: hp("1.3%"),
    color: "#10B981",
    marginRight: spacing.xs,
  },
  entryDown: {
    fontSize: hp("1.5%"),
    fontWeight: "700",
    color: "#EF4444",
    marginRight: spacing.xs,
  },
  expandIcon: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    marginLeft: spacing.xs,
  },
  entryDetail: {
    backgroundColor: "#0D1117",
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
    padding: spacing.sm,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  detailLabel: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
  },
  detailValue: {
    fontSize: hp("1.3%"),
    color: "#E5E7EB",
    fontWeight: "500",
  },
  detailValueSmall: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    fontFamily: "monospace",
  },
  detailValueDown: {
    color: "#EF4444",
  },
  editButton: {
    backgroundColor: "#2563EB",
    borderRadius: hp("0.8%"),
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  editButtonText: {
    color: "#FFFFFF",
    fontSize: hp("1.5%"),
    fontWeight: "600",
  },
  editAction: {
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
    width: 80,
    marginBottom: spacing.xs,
    borderRadius: hp("1%"),
  },
  editActionText: {
    color: "#FFFFFF",
    fontSize: hp("1.5%"),
    fontWeight: "600",
  },
  footerNote: {
    textAlign: "center",
    fontSize: hp("1.2%"),
    color: "#4B5563",
    marginTop: spacing.md,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modalOverlayTouchable: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#111827",
    borderTopLeftRadius: hp("2%"),
    borderTopRightRadius: hp("2%"),
    paddingTop: spacing.md,
    maxHeight: hp("60%"),
  },
  modalTitle: {
    fontSize: hp("1.8%"),
    fontWeight: "700",
    color: "#F9FAFB",
    textAlign: "center",
    marginBottom: spacing.md,
  },
  modalScroll: {
    maxHeight: hp("40%"),
  },
  modalOption: {
    paddingVertical: spacing.md,
    paddingHorizontal: wp("5%"),
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  modalOptionActive: {
    backgroundColor: "#1E3A5F",
  },
  modalOptionText: {
    fontSize: hp("1.6%"),
    color: "#E5E7EB",
  },
  modalOptionTextActive: {
    color: "#60A5FA",
    fontWeight: "600",
  },
  modalCloseButton: {
    paddingVertical: spacing.md,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
  },
  modalCloseText: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
  },
  // View Any Well Button
  viewAnyWellButton: {
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#374151",
  },
  viewAnyWellButtonText: {
    color: "#60A5FA",
    fontSize: hp("1.4%"),
    fontWeight: "600",
  },
  // All Wells Modal
  allWellsModalContent: {
    backgroundColor: "#111827",
    borderTopLeftRadius: hp("2%"),
    borderTopRightRadius: hp("2%"),
    paddingTop: spacing.md,
    maxHeight: hp("75%"),
  },
  allWellsSubtitle: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    textAlign: "center",
    marginBottom: spacing.md,
    paddingHorizontal: wp("5%"),
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: wp("5%"),
    marginBottom: spacing.md,
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontSize: hp("1.5%"),
    color: "#F9FAFB",
  },
  clearSearchButton: {
    padding: spacing.xs,
  },
  clearSearchText: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    fontWeight: "700",
  },
  allWellsScroll: {
    maxHeight: hp("50%"),
  },
  allWellsOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: wp("5%"),
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  allWellsOptionText: {
    fontSize: hp("1.6%"),
    color: "#E5E7EB",
  },
  allWellsArrow: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
  noWellsFound: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
});

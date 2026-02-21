// app/performance-detail.tsx
// Single Well Performance Detail - Shows individual pull accuracy
// Reads directly from Firebase cache - instant load

import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getPerformanceData,
  getWellPerformance,
  WellPerformance,
} from "../src/services/firebase";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hp, spacing, wp } from "../src/ui/layout";

// Date range filter options
type DateRangeOption = "30d" | "90d" | "1y" | "all" | "custom";

const DATE_RANGE_OPTIONS: { key: DateRangeOption; label: string }[] = [
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

// Calculate from date based on range option
const getFromDate = (option: DateRangeOption): Date | undefined => {
  if (option === "all") return undefined;
  const now = new Date();
  switch (option) {
    case "30d":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    case "90d":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
    case "1y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    default:
      return undefined;
  }
};

// Storage key for selected wells (same as settings.tsx)
const STORAGE_KEY_SELECTED_WELLS = "wellbuilt_selected_wells";

// Get color based on accuracy percentage
// 100% = perfect, deviation in either direction is worse
const getAccuracyColor = (accuracy: number): string => {
  const deviation = Math.abs(100 - accuracy);
  if (deviation <= 5) return "#10B981"; // Green: within 5% of actual
  if (deviation <= 10) return "#F59E0B"; // Amber: within 10% of actual
  return "#EF4444"; // Red: more than 10% off
};

// Get trend icon and color
const getTrendDisplay = (trend: string): { icon: string; color: string; label: string } => {
  switch (trend) {
    case "improving":
      return { icon: "↑", color: "#10B981", label: "Improving" };
    case "declining":
      return { icon: "↓", color: "#EF4444", label: "Declining" };
    default:
      return { icon: "→", color: "#6B7280", label: "Stable" };
  }
};

// Format date for display (yyyy-mm-dd -> m/d/yy)
// Parse as LOCAL time to avoid timezone shift (UTC midnight -> previous day in local tz)
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "-";
  try {
    // Parse yyyy-mm-dd as local time, not UTC
    const [year, month, day] = dateStr.split('-').map(Number);
    return `${month}/${day}/${year.toString().slice(-2)}`;
  } catch {
    return dateStr;
  }
};

// Convert inches to feet'inches" format for display
// Uses Math.floor for inches to match VBA's Int() behavior
const inchesToFeetInches = (inches: number): string => {
  const feet = Math.floor(inches / 12);
  const remainingInches = Math.floor(inches % 12);
  return `${feet}'${remainingInches}"`;
};

export default function PerformanceDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    wellName: string;
    filterContext?: string; // "myroutes" or "all" - determines which wells appear in dropdown
  }>();
  const wellName = params.wellName || "Unknown";

  // Use filterContext from navigation to determine dropdown filtering
  // Default to "myroutes" if not specified
  const useMyRoutesFilter = params.filterContext !== "all";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wellData, setWellData] = useState<WellPerformance | null>(null);

  // Ref for scrolling to specific rows
  const sectionListRef = useRef<SectionList>(null);
  const tableCardYRef = useRef<number>(0); // Track Y position of table for sticky header
  const ROW_HEIGHT = 36; // Approximate row height in pixels

  // Well picker state
  const [availableWells, setAvailableWells] = useState<string[]>([]);
  const [currentWellName, setCurrentWellName] = useState(wellName);
  const [showWellPicker, setShowWellPicker] = useState(false);

  // My Routes filter state - initialized based on how user navigated here
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set());
  const [selectedWellsLoaded, setSelectedWellsLoaded] = useState(false);
  const [showMyRoutesOnly, setShowMyRoutesOnly] = useState(useMyRoutesFilter);

  // Date range state (local to this screen)
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("90d");

  // Sorting state for table columns
  type SortColumn = "date" | "predicted" | "actual" | "accuracy";
  type SortDirection = "asc" | "desc";
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc"); // newest first by default
  const [customFromDate, setCustomFromDate] = useState<Date>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d;
  });
  const [customToDate, setCustomToDate] = useState<Date>(new Date());
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  // Load selected wells from settings
  const loadSelectedWells = useCallback(async () => {
    try {
      const savedSelections = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_WELLS);
      console.log("[PerformanceDetail] Loaded selected wells:", savedSelections);
      if (savedSelections) {
        const wells: string[] = JSON.parse(savedSelections);
        console.log("[PerformanceDetail] Parsed wells count:", wells.length);
        setSelectedWells(new Set(wells));
      } else {
        console.log("[PerformanceDetail] No saved selections found");
      }
      setSelectedWellsLoaded(true);
    } catch (err) {
      console.error("[PerformanceDetail] Error loading selected wells:", err);
    }
  }, []);

  // Load available wells from performance data (filtered by My Routes)
  const loadAvailableWells = useCallback(async () => {
    // If filtering by My Routes, wait until selectedWells are loaded
    if (showMyRoutesOnly && !selectedWellsLoaded) {
      console.log("[PerformanceDetail] Waiting for selectedWells to load...");
      return;
    }

    try {
      // Determine date range
      let fromDate: Date | undefined;
      let toDate: Date | undefined;
      if (dateRangeOption === "custom") {
        fromDate = customFromDate;
        toDate = customToDate;
      } else {
        fromDate = getFromDate(dateRangeOption);
        toDate = undefined;
      }

      // Get all performance data
      const response = await getPerformanceData(fromDate, toDate);
      if (response.status === "success" && response.wells) {
        // Filter to selected wells if showMyRoutesOnly, otherwise show all
        const wells = showMyRoutesOnly
          ? response.wells.filter(w => selectedWells.has(w.wellName)).map(w => w.wellName)
          : response.wells.map(w => w.wellName);
        // Sort alphabetically
        wells.sort((a, b) => a.localeCompare(b));
        setAvailableWells(wells);
        console.log("[PerformanceDetail] Available wells:", {
          filterContext: params.filterContext,
          showMyRoutesOnly,
          selectedWellsLoaded,
          selectedWellsCount: selectedWells.size,
          totalWells: response.wells.length,
          filteredCount: wells.length,
        });
      }
    } catch (err) {
      console.error("[PerformanceDetail] Error loading wells:", err);
    }
  }, [dateRangeOption, customFromDate, customToDate, showMyRoutesOnly, selectedWells, selectedWellsLoaded]);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      // Determine date range
      let fromDate: Date | undefined;
      let toDate: Date | undefined;
      if (dateRangeOption === "custom") {
        fromDate = customFromDate;
        toDate = customToDate;
      } else {
        fromDate = getFromDate(dateRangeOption);
        toDate = undefined;
      }

      console.log("[PerformanceDetail] Reading:", currentWellName, { fromDate, toDate });
      const data = await getWellPerformance(currentWellName, fromDate, toDate);

      if (!data) {
        setError(`No data found for ${currentWellName}`);
        return;
      }

      setWellData(data);
    } catch (err) {
      console.error("[PerformanceDetail] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    }
  }, [currentWellName, dateRangeOption, customFromDate, customToDate]);

  // Initial load of selected wells
  useEffect(() => {
    loadSelectedWells();
  }, [loadSelectedWells]);

  // Fetch data when filters change
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchData(), loadAvailableWells()]).finally(() => setLoading(false));
  }, [fetchData, loadAvailableWells]);

  // Handle well selection from picker
  const handleWellSelect = (newWellName: string) => {
    setShowWellPicker(false);
    if (newWellName !== currentWellName) {
      setCurrentWellName(newWellName);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), loadAvailableWells()]);
    setRefreshing(false);
  };

  // Handle date range option change
  const handleDateRangeChange = (option: DateRangeOption) => {
    setDateRangeOption(option);
    // Data will refresh automatically via useEffect
  };

  // Format date for display
  const formatDateShort = (date: Date): string => {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear().toString().slice(-2)}`;
  };

  // Calculate stats from data
  const stats = wellData ? {
    pulls: wellData.filteredPulls,
    avgAccuracy: wellData.avgAccuracy,
    bestAccuracy: wellData.bestAccuracy,
    worstAccuracy: wellData.worstAccuracy,
    trend: wellData.trend,
    firstDate: wellData.firstDate,
    lastDate: wellData.lastDate,
    // Distribution uses deviation from 100% - both over and under predictions count the same
    // 95% and 105% both have 5% deviation, so both are "green" (within 5%)
    greenPulls: wellData.rows?.filter(r => Math.abs(100 - r.accuracy) <= 5).length || 0,
    yellowPulls: wellData.rows?.filter(r => Math.abs(100 - r.accuracy) > 5 && Math.abs(100 - r.accuracy) <= 10).length || 0,
    redPulls: wellData.rows?.filter(r => Math.abs(100 - r.accuracy) > 10).length || 0,
  } : null;

  // Handle column header tap to sort
  const handleSortChange = (column: SortColumn) => {
    if (sortColumn === column) {
      // Same column - toggle direction
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      // New column - set default direction
      setSortColumn(column);
      // Default: date desc, others asc
      setSortDirection(column === "date" ? "desc" : "asc");
    }
  };

  // Get sort arrow for a column (only shows on active sort column)
  const getSortArrow = (column: SortColumn): string => {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  // Sort rows based on current sort state
  const rawRows = wellData?.rows || [];
  const rows = [...rawRows].sort((a, b) => {
    let comparison = 0;
    switch (sortColumn) {
      case "date":
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
        break;
      case "predicted":
        comparison = a.predictedInches - b.predictedInches;
        break;
      case "actual":
        comparison = a.actualInches - b.actualInches;
        break;
      case "accuracy":
        comparison = a.accuracy - b.accuracy;
        break;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  // Find best (smallest deviation) and worst (largest deviation) accuracy values
  // Best = closest to 100%, Worst = farthest from 100%
  // Both over-predictions (105%) and under-predictions (95%) are treated equally
  const deviations = rows.map(r => Math.abs(100 - r.accuracy));
  const smallestDeviation = rows.length > 0 ? Math.min(...deviations) : -1;
  const largestDeviation = rows.length > 0 ? Math.max(...deviations) : -1;

  // Sets of indices for all rows matching best/worst deviation (supports ties)
  const bestRowIndices = new Set(
    rows.map((r, idx) => Math.abs(100 - r.accuracy) === smallestDeviation ? idx : -1).filter(idx => idx >= 0)
  );
  const worstRowIndices = new Set(
    rows.map((r, idx) => Math.abs(100 - r.accuracy) === largestDeviation ? idx : -1).filter(idx => idx >= 0)
  );

  // First best/worst index for scroll-to functionality
  const bestRowIndex = bestRowIndices.size > 0 ? Math.min(...bestRowIndices) : -1;
  const worstRowIndex = worstRowIndices.size > 0 ? Math.min(...worstRowIndices) : -1;

  // Scroll to a specific row in the table
  // SectionList uses scrollToLocation with sectionIndex and itemIndex
  // Section 1 is the table (section 0 is overview stats)
  const scrollToRow = (rowIndex: number) => {
    if (rowIndex < 0 || !sectionListRef.current) return;
    try {
      sectionListRef.current.scrollToLocation({
        sectionIndex: 1, // Table section
        itemIndex: rowIndex,
        animated: true,
        viewOffset: ROW_HEIGHT, // Offset to show a bit of context above
      });
    } catch (e) {
      console.log('[Performance] scrollToLocation error:', e);
    }
  };

  const trendDisplay = stats ? getTrendDisplay(stats.trend) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"←"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => setShowWellPicker(true)}
          activeOpacity={0.7}
        >
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {currentWellName}
            </Text>
            <Text style={styles.dropdownIcon}>▼</Text>
          </View>
          <Text style={styles.headerSubtitle}>Tap to switch wells</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/settings")} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* My Routes / All Wells - Navigate to list view */}
      <View style={styles.controlsRow}>
        <View style={styles.filterToggle}>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => router.push({ pathname: "/performance", params: { filter: "myroutes" } })}
          >
            <Text style={styles.filterButtonText}>
              My Routes
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => router.push({ pathname: "/performance", params: { filter: "all" } })}
          >
            <Text style={styles.filterButtonText}>
              All Wells
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Date Range Filter */}
      <View style={styles.dateRangeSection}>
        <View style={styles.dateRangeButtons}>
          {DATE_RANGE_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.dateRangeButton,
                dateRangeOption === option.key && styles.dateRangeButtonActive,
              ]}
              onPress={() => handleDateRangeChange(option.key)}
            >
              <Text
                style={[
                  styles.dateRangeButtonText,
                  dateRangeOption === option.key && styles.dateRangeButtonTextActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[
              styles.dateRangeButton,
              styles.customDateButton,
              dateRangeOption === "custom" && styles.dateRangeButtonActive,
            ]}
            onPress={() => handleDateRangeChange("custom")}
          >
            <Text
              style={[
                styles.dateRangeButtonText,
                dateRangeOption === "custom" && styles.dateRangeButtonTextActive,
              ]}
            >
              Custom
            </Text>
          </TouchableOpacity>
        </View>

      </View>

      {/* Date Picker Modals */}
      {showFromPicker && (
        Platform.OS === "ios" ? (
          <Modal transparent animationType="slide" visible={showFromPicker}>
            <View style={styles.datePickerModalOverlay}>
              <View style={styles.datePickerModal}>
                <View style={styles.datePickerHeader}>
                  <TouchableOpacity onPress={() => setShowFromPicker(false)}>
                    <Text style={styles.datePickerDone}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={customFromDate}
                  mode="date"
                  display="spinner"
                  onChange={(_, date) => date && setCustomFromDate(date)}
                  maximumDate={customToDate}
                  textColor="#FFFFFF"
                />
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={customFromDate}
            mode="date"
            display="default"
            onChange={(_, date) => {
              setShowFromPicker(false);
              if (date) setCustomFromDate(date);
            }}
            maximumDate={customToDate}
          />
        )
      )}

      {showToPicker && (
        Platform.OS === "ios" ? (
          <Modal transparent animationType="slide" visible={showToPicker}>
            <View style={styles.datePickerModalOverlay}>
              <View style={styles.datePickerModal}>
                <View style={styles.datePickerHeader}>
                  <TouchableOpacity onPress={() => setShowToPicker(false)}>
                    <Text style={styles.datePickerDone}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={customToDate}
                  mode="date"
                  display="spinner"
                  onChange={(_, date) => date && setCustomToDate(date)}
                  minimumDate={customFromDate}
                  maximumDate={new Date()}
                  textColor="#FFFFFF"
                />
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={customToDate}
            mode="date"
            display="default"
            onChange={(_, date) => {
              setShowToPicker(false);
              if (date) setCustomToDate(date);
            }}
            minimumDate={customFromDate}
            maximumDate={new Date()}
          />
        )
      )}

      {/* Well Picker Modal */}
      <Modal
        visible={showWellPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWellPicker(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Well</Text>
              <TouchableOpacity onPress={() => setShowWellPicker(false)}>
                <Text style={styles.pickerClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerList}>
              {availableWells.map((well) => (
                <TouchableOpacity
                  key={well}
                  style={[
                    styles.pickerItem,
                    well === currentWellName && styles.pickerItemActive,
                  ]}
                  onPress={() => handleWellSelect(well)}
                >
                  <Text
                    style={[
                      styles.pickerItemText,
                      well === currentWellName && styles.pickerItemTextActive,
                    ]}
                  >
                    {well}
                  </Text>
                  {well === currentWellName && (
                    <Text style={styles.pickerCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
              {availableWells.length === 0 && (
                <View style={styles.pickerEmpty}>
                  <Text style={styles.pickerEmptyText}>No wells available</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>Loading {currentWellName} data...</Text>
        </View>
      )}

      {/* Error State */}
      {error && !loading && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              fetchData().finally(() => setLoading(false));
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Data Display */}
      {!loading && !error && wellData && stats && (
        <SectionList
          ref={sectionListRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          stickySectionHeadersEnabled={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#60A5FA"
              colors={["#60A5FA"]}
            />
          }
          sections={[
            {
              title: "pulls",
              data: rows,
            },
          ]}
          keyExtractor={(item, index) => `${item.date}-${index}`}
          ListHeaderComponent={() => (
            <>
              {/* Compact Stats Card with Distribution */}
              <View style={styles.mainStatsCard}>
                {/* Top row: Accuracy + Trend + Distribution */}
                <View style={styles.topStatsRow}>
                  <View style={styles.accuracySection}>
                    <View style={styles.mainAccuracyContainer}>
                      <Text
                        style={[
                          styles.mainAccuracyValue,
                          { color: getAccuracyColor(stats.avgAccuracy) },
                        ]}
                      >
                        {stats.avgAccuracy.toFixed(1)}%
                      </Text>
                      {trendDisplay && (
                        <Text style={[styles.trendArrow, { color: trendDisplay.color }]}>
                          {trendDisplay.icon}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.mainAccuracyLabel}>Avg Accuracy</Text>
                  </View>

                  {/* Compact Distribution */}
                  <View style={styles.distributionSection}>
                    <View style={styles.distributionCompactRow}>
                      <View style={styles.distributionCompactItem}>
                        <View style={[styles.distributionDot, { backgroundColor: "#10B981" }]} />
                        <Text style={styles.distributionCompactCount}>{stats.greenPulls}</Text>
                      </View>
                      <View style={styles.distributionCompactItem}>
                        <View style={[styles.distributionDot, { backgroundColor: "#F59E0B" }]} />
                        <Text style={styles.distributionCompactCount}>{stats.yellowPulls}</Text>
                      </View>
                      <View style={styles.distributionCompactItem}>
                        <View style={[styles.distributionDot, { backgroundColor: "#EF4444" }]} />
                        <Text style={styles.distributionCompactCount}>{stats.redPulls}</Text>
                      </View>
                    </View>
                    <Text style={styles.distributionCompactLabel}>last {rows.length}</Text>
                  </View>
                </View>

                {/* Stats Grid */}
                <View style={styles.statsGrid}>
                  <View style={styles.statCell}>
                    <Text style={styles.statCellValue}>{stats.pulls}</Text>
                    <Text style={styles.statCellLabel}>Total</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.statCell}
                    onPress={() => scrollToRow(bestRowIndex)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.statCellValue, { color: "#10B981" }]}>
                      {stats.bestAccuracy.toFixed(1)}%
                    </Text>
                    <Text style={styles.statCellLabelTappable}>Best ↓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.statCell}
                    onPress={() => scrollToRow(worstRowIndex)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.statCellValue, { color: "#EF4444" }]}>
                      {stats.worstAccuracy.toFixed(1)}%
                    </Text>
                    <Text style={styles.statCellLabelTappable}>Worst ↓</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Pull History Table Title with Date Range on right */}
              <View
                style={styles.tableCard}
                onLayout={(event) => {
                  tableCardYRef.current = event.nativeEvent.layout.y;
                }}
              >
                <View style={styles.tableTitleRow}>
                  <View>
                    <Text style={styles.tableTitle}>Recent Pulls</Text>
                    <Text style={styles.tableSubtitle}>
                      Showing last {rows.length}
                    </Text>
                  </View>
                  {/* Date range - tappable in custom mode */}
                  <View style={styles.tableDateRange}>
                    {dateRangeOption === "custom" ? (
                      <>
                        <TouchableOpacity onPress={() => setShowFromPicker(true)}>
                          <Text style={styles.tableDateTappable}>
                            {formatDateShort(customFromDate)}
                          </Text>
                        </TouchableOpacity>
                        <Text style={styles.tableDateArrow}>→</Text>
                        <TouchableOpacity onPress={() => setShowToPicker(true)}>
                          <Text style={styles.tableDateTappable}>
                            {formatDateShort(customToDate)}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <Text style={styles.tableDateText}>
                        {dateRangeOption === "all"
                          ? `${formatDate(stats.firstDate)} → Now`
                          : `${formatDateShort(getFromDate(dateRangeOption)!)} → Now`}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </>
          )}
          renderSectionHeader={() => (
            <View style={styles.stickyTableHeader}>
              <TouchableOpacity
                style={styles.colDate}
                onPress={() => handleSortChange("date")}
                activeOpacity={0.7}
              >
                <Text style={[styles.tableHeaderText, styles.colDateText, sortColumn === "date" && styles.tableHeaderTextActive]}>
                  Date{getSortArrow("date")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.colValue}
                onPress={() => handleSortChange("predicted")}
                activeOpacity={0.7}
              >
                <Text style={[styles.tableHeaderText, styles.colValueText, sortColumn === "predicted" && styles.tableHeaderTextActive]}>
                  Pred{getSortArrow("predicted")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.colValue}
                onPress={() => handleSortChange("actual")}
                activeOpacity={0.7}
              >
                <Text style={[styles.tableHeaderText, styles.colValueText, sortColumn === "actual" && styles.tableHeaderTextActive]}>
                  Actual{getSortArrow("actual")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.colAccuracy}
                onPress={() => handleSortChange("accuracy")}
                activeOpacity={0.7}
              >
                <Text style={[styles.tableHeaderText, styles.colAccuracyText, sortColumn === "accuracy" && styles.tableHeaderTextActive]}>
                  Accuracy{getSortArrow("accuracy")}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          renderItem={({ item: row, index }) => {
            const accuracyColor = getAccuracyColor(row.accuracy);
            const isBest = bestRowIndices.has(index);
            const isWorst = worstRowIndices.has(index);
            const isAnomaly = row.isAnomaly === true;
            return (
              <View
                style={[
                  styles.tableRowSticky,
                  index % 2 === 0 && styles.tableRowAltSticky,
                  // Anomaly-only: gray border + gray background
                  isAnomaly && !isBest && !isWorst && styles.tableRowAnomalySticky,
                  // Best-only: green border + green background
                  isBest && !isAnomaly && styles.tableRowBestSticky,
                  // Worst-only: red border + red background
                  isWorst && !isAnomaly && styles.tableRowWorstSticky,
                  // Worst+Anomaly combo: gray border + red background
                  isWorst && isAnomaly && styles.tableRowWorstAnomalySticky,
                  // Best+Anomaly combo: gray border + green background
                  isBest && isAnomaly && styles.tableRowBestAnomalySticky,
                ]}
              >
                <Text style={[styles.tableCell, styles.colDate, styles.colDateText, isAnomaly && styles.tableCellAnomaly]}>
                  {formatDate(row.date)}
                  {isBest && " 🏆"}
                  {isWorst && " ⚠️"}
                  {isAnomaly && " 😕"}
                </Text>
                <Text style={[styles.tableCell, styles.colValue, styles.colValueText, isAnomaly && styles.tableCellAnomaly]}>
                  {inchesToFeetInches(row.predictedInches)}
                </Text>
                <Text style={[styles.tableCell, styles.colValue, styles.colValueText, isAnomaly && styles.tableCellAnomaly]}>
                  {inchesToFeetInches(row.actualInches)}
                </Text>
                <Text style={[styles.tableCell, styles.colAccuracy, styles.colAccuracyText, { color: isAnomaly ? "#6B7280" : accuracyColor }]}>
                  {row.accuracy.toFixed(1)}%
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={() => (
            <View style={styles.emptyTable}>
              <Text style={styles.emptyTableText}>No pull data available</Text>
            </View>
          )}
          ListFooterComponent={() => <View style={{ height: hp("5%") }} />}
        />
      )}
    </View>
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
    marginBottom: spacing.md,
  },
  backButton: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: hp("2.4%"),
    color: "#9CA3AF",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: hp("2%"),
    color: "#F9FAFB",
    fontWeight: "700",
  },
  dropdownIcon: {
    fontSize: hp("1%"),
    color: "#60A5FA",
  },
  headerSubtitle: {
    fontSize: hp("1.2%"),
    color: "#60A5FA",
    marginTop: 2,
  },
  settingsButton: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
  },
  settingsIcon: {
    fontSize: hp("2.4%"),
    color: "#9CA3AF",
  },
  // Controls Row (filter toggle)
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: wp("5%"),
    marginBottom: spacing.xs,
  },
  // Filter Toggle
  filterToggle: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.6%"),
    padding: 2,
    borderWidth: 1,
    borderColor: "#374151",
  },
  filterButton: {
    flex: 1,
    paddingVertical: spacing.xs,
    alignItems: "center",
    borderRadius: hp("0.4%"),
  },
  filterButtonActive: {
    backgroundColor: "#2563EB",
  },
  filterButtonText: {
    fontSize: hp("1.2%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  filterButtonTextActive: {
    color: "#FFFFFF",
  },
  // Date Range Section
  dateRangeSection: {
    paddingHorizontal: wp("5%"),
    marginBottom: spacing.sm,
  },
  dateRangeButtons: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.6%"),
    padding: 2,
    borderWidth: 1,
    borderColor: "#374151",
  },
  dateRangeButton: {
    flex: 1,
    paddingVertical: spacing.xs,
    alignItems: "center",
    borderRadius: hp("0.4%"),
  },
  dateRangeButtonActive: {
    backgroundColor: "#2563EB",
  },
  dateRangeButtonText: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  dateRangeButtonTextActive: {
    color: "#FFFFFF",
  },
  customDateButton: {
    flex: 1.3,
  },
  // Date Picker Modal (iOS)
  datePickerModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  datePickerModal: {
    backgroundColor: "#1F2937",
    borderTopLeftRadius: hp("1.5%"),
    borderTopRightRadius: hp("1.5%"),
    paddingBottom: hp("3%"),
  },
  datePickerHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  datePickerDone: {
    fontSize: hp("1.5%"),
    color: "#60A5FA",
    fontWeight: "600",
  },
  // Well Picker Modal
  pickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  pickerContainer: {
    backgroundColor: "#1F2937",
    borderTopLeftRadius: hp("1.5%"),
    borderTopRightRadius: hp("1.5%"),
    maxHeight: hp("60%"),
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  pickerTitle: {
    fontSize: hp("1.6%"),
    color: "#F9FAFB",
    fontWeight: "600",
  },
  pickerClose: {
    fontSize: hp("1.4%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  pickerList: {
    paddingVertical: spacing.xs,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pickerItemActive: {
    backgroundColor: "#2563EB20",
  },
  pickerItemText: {
    fontSize: hp("1.5%"),
    color: "#F9FAFB",
  },
  pickerItemTextActive: {
    color: "#60A5FA",
    fontWeight: "600",
  },
  pickerCheck: {
    fontSize: hp("1.4%"),
    color: "#60A5FA",
  },
  pickerEmpty: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  pickerEmptyText: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: hp("10%"),
  },
  loadingText: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    marginTop: spacing.md,
  },
  // Error
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: wp("10%"),
    paddingBottom: hp("10%"),
  },
  errorIcon: {
    fontSize: hp("5%"),
    color: "#F59E0B",
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: hp("1.6%"),
    color: "#EF4444",
    textAlign: "center",
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: "#2563EB",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: hp("0.8%"),
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: hp("1.5%"),
    fontWeight: "600",
  },
  // Scroll View
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: wp("5%"),
  },
  // Main Stats Card - Compact
  mainStatsCard: {
    backgroundColor: "#111827",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  topStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  accuracySection: {
    flex: 1,
  },
  mainAccuracyContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  mainAccuracyValue: {
    fontSize: hp("3.2%"),
    fontWeight: "700",
  },
  mainAccuracyLabel: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
  },
  trendArrow: {
    fontSize: hp("2.2%"),
    fontWeight: "700",
    marginLeft: 4,
  },
  // Compact Distribution (inline with accuracy)
  distributionSection: {
    alignItems: "flex-end",
  },
  distributionCompactRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  distributionCompactItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  distributionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  distributionCompactCount: {
    fontSize: hp("1.4%"),
    fontWeight: "600",
    color: "#F9FAFB",
  },
  distributionCompactLabel: {
    fontSize: hp("1%"),
    color: "#6B7280",
    marginTop: 2,
  },
  // Stats Grid - Compact
  statsGrid: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  statCell: {
    flex: 1,
    backgroundColor: "#0D1117",
    borderRadius: hp("0.5%"),
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
  },
  statCellValue: {
    fontSize: hp("1.6%"),
    fontWeight: "700",
    color: "#60A5FA",
  },
  statCellLabel: {
    fontSize: hp("1%"),
    color: "#6B7280",
  },
  statCellLabelTappable: {
    fontSize: hp("1%"),
    color: "#60A5FA",
  },
  // Table Card - Compact
  tableCard: {
    backgroundColor: "#111827",
    borderTopLeftRadius: hp("0.6%"),
    borderTopRightRadius: hp("0.6%"),
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: 0,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#1F2937",
  },
  tableTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableTitle: {
    fontSize: hp("1.4%"),
    color: "#F9FAFB",
    fontWeight: "600",
  },
  tableSubtitle: {
    fontSize: hp("1%"),
    color: "#6B7280",
  },
  tableDateRange: {
    flexDirection: "row",
    alignItems: "center",
  },
  tableDateText: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
  },
  tableDateTappable: {
    fontSize: hp("1.2%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  tableDateArrow: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    marginHorizontal: 4,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
    paddingBottom: spacing.xs,
    marginBottom: spacing.xs,
  },
  tableHeaderText: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    fontWeight: "600",
  },
  tableHeaderTextActive: {
    color: "#60A5FA",
  },
  // Sticky table header - sticks below the stats cards when scrolling
  stickyTableHeader: {
    flexDirection: "row",
    backgroundColor: "#111827",
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: wp("5%"),
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  // Rows for sticky table (with full-width padding)
  tableRowSticky: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
    paddingHorizontal: wp("5%"),
    backgroundColor: "#111827",
  },
  tableRowAltSticky: {
    backgroundColor: "#0D1117",
  },
  tableRowBestSticky: {
    backgroundColor: "#10B98120",
    borderLeftWidth: 3,
    borderLeftColor: "#10B981",
  },
  tableRowWorstSticky: {
    backgroundColor: "#EF444420",
    borderLeftWidth: 3,
    borderLeftColor: "#EF4444",
  },
  tableRowAnomalySticky: {
    backgroundColor: "#37415140",
    borderLeftWidth: 3,
    borderLeftColor: "#6B7280",
  },
  // Combo: worst + anomaly = gray border + red background
  tableRowWorstAnomalySticky: {
    backgroundColor: "#EF444420",
    borderLeftWidth: 3,
    borderLeftColor: "#6B7280",
  },
  // Combo: best + anomaly = gray border + green background
  tableRowBestAnomalySticky: {
    backgroundColor: "#10B98120",
    borderLeftWidth: 3,
    borderLeftColor: "#6B7280",
  },
  tableCellAnomaly: {
    color: "#6B7280",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
  },
  tableRowAlt: {
    backgroundColor: "#0D1117",
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  tableRowBest: {
    backgroundColor: "#10B98120",
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: "#10B981",
  },
  tableRowWorst: {
    backgroundColor: "#EF444420",
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: "#EF4444",
  },
  tableCell: {
    fontSize: hp("1.3%"),
    color: "#F9FAFB",
  },
  colDate: {
    flex: 2.3,
  },
  colDateText: {
    textAlign: "left",
  },
  colValue: {
    flex: 1.5,
  },
  colValueText: {
    textAlign: "center",
  },
  colAccuracy: {
    flex: 2.2,
    paddingRight: spacing.xs,
  },
  colAccuracyText: {
    textAlign: "right",
    fontWeight: "600",
  },
  emptyTable: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  emptyTableText: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
});

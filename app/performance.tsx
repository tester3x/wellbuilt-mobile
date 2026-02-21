// app/performance.tsx
// Performance Tracker - Shows prediction accuracy for all wells
// Reads from packets/processed (same source as well history) - no separate cache needed

import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getPerformanceData,
  PerformanceResponse,
  WellPerformance,
} from "../src/services/firebase";
import { isCurrentUserAdmin } from "../src/services/driverAuth";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Constants for filtering
const TEST_ROUTE_NAME = "Test Route";
const MIN_PULLS_FOR_AVERAGE = 5;  // Wells need at least this many pulls to be included in overall average
import { hp, spacing, wp } from "../src/ui/layout";

// Storage key for selected wells (same as settings.tsx)
const STORAGE_KEY_SELECTED_WELLS = "wellbuilt_selected_wells";

// Sorting types for well list
type WellSortColumn = "wellName" | "pulls" | "accuracy" | "trend";
type SortDirection = "asc" | "desc";

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

// Get color based on accuracy percentage
// 100% = perfect, deviation in either direction is worse
const getAccuracyColor = (accuracy: number): string => {
  const deviation = Math.abs(100 - accuracy);
  if (deviation <= 5) return "#10B981"; // Green: within 5% of actual
  if (deviation <= 10) return "#F59E0B"; // Amber: within 10% of actual
  return "#EF4444"; // Red: more than 10% off
};

// Get trend icon and color
const getTrendDisplay = (trend: string): { icon: string; color: string } => {
  switch (trend) {
    case "improving":
      return { icon: "↑", color: "#10B981" };
    case "declining":
      return { icon: "↓", color: "#EF4444" };
    default:
      return { icon: "→", color: "#6B7280" };
  }
};

// Format timestamp for display
const formatLastUpdated = (timestamp: string | undefined): string => {
  if (!timestamp) return "Never";
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return timestamp;
  }
};

export default function PerformanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set());
  // Default to "myroutes", but respect URL param if provided
  const [showMyRoutesOnly, setShowMyRoutesOnly] = useState(params.filter !== "all");
  // Admin status - determines if Test Route wells are visible
  const [isAdmin, setIsAdmin] = useState(false);

  // Sorting state for well list
  const [sortColumn, setSortColumn] = useState<WellSortColumn>("accuracy");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc"); // worst accuracy first by default

  // Date range state
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("90d");
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
      console.log("[Performance] Loaded selected wells:", savedSelections);
      if (savedSelections) {
        const wells: string[] = JSON.parse(savedSelections);
        console.log("[Performance] Parsed wells count:", wells.length);
        setSelectedWells(new Set(wells));
      } else {
        console.log("[Performance] No saved selections found");
      }
    } catch (err) {
      console.error("[Performance] Error loading selected wells:", err);
    }
  }, []);

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
        toDate = undefined; // Up to now
      }

      console.log("[Performance] Fetching from packets/processed with date range:", {
        fromDate: fromDate?.toISOString(),
        toDate: toDate?.toISOString(),
      });
      const response = await getPerformanceData(fromDate, toDate);

      if (response.status === "error") {
        setError(response.errorMessage || "Unknown error");
        return;
      }

      setData(response);
    } catch (err) {
      console.error("[Performance] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    }
  }, [dateRangeOption, customFromDate, customToDate]);

  useEffect(() => {
    setLoading(true);
    // Load admin status
    isCurrentUserAdmin().then(setIsAdmin);
    Promise.all([fetchData(), loadSelectedWells()]).finally(() => setLoading(false));
  }, [fetchData, loadSelectedWells]);

  // Update filter when URL param changes
  useEffect(() => {
    if (params.filter === "all") {
      setShowMyRoutesOnly(false);
    } else if (params.filter === "myroutes") {
      setShowMyRoutesOnly(true);
    }
  }, [params.filter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), loadSelectedWells()]);
    setRefreshing(false);
  };

  const handleWellPress = (wellName: string) => {
    // Pass date range and filter context to detail screen
    const fromDate = dateRangeOption === "custom" ? customFromDate : getFromDate(dateRangeOption);
    router.push({
      pathname: "/performance-detail",
      params: {
        wellName,
        fromDate: fromDate?.toISOString(),
        toDate: dateRangeOption === "custom" ? customToDate.toISOString() : undefined,
        filterContext: showMyRoutesOnly ? "myroutes" : "all",
      },
    });
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

  // Handle column header tap to sort
  const handleSortChange = (column: WellSortColumn) => {
    if (sortColumn === column) {
      // Same column - toggle direction
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      // New column - set default direction
      setSortColumn(column);
      // Default: accuracy asc (worst first), others alphabetical/desc
      setSortDirection(column === "accuracy" ? "asc" : column === "wellName" ? "asc" : "desc");
    }
  };

  // Get sort arrow for a column (only shows on active sort column)
  const getSortArrow = (column: WellSortColumn): string => {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  // Filter wells:
  // 1. Apply My Routes filter if enabled
  // 2. Hide Test Route wells from non-admins (admins can see them)
  const filteredWells = data?.wells
    ? data.wells.filter(w => {
        // Filter by My Routes if enabled
        if (showMyRoutesOnly && !selectedWells.has(w.wellName)) {
          return false;
        }
        // Hide Test Route from non-admins
        if (!isAdmin && w.route === TEST_ROUTE_NAME) {
          return false;
        }
        return true;
      })
    : [];

  // Debug logging for filter
  console.log("[Performance] Filter state:", {
    showMyRoutesOnly,
    selectedWellsCount: selectedWells.size,
    totalWells: data?.wells?.length || 0,
    filteredCount: filteredWells.length,
    isAdmin,
  });

  // Wells that count toward the overall average:
  // - Exclude Test Route wells (even for admins - they shouldn't skew the average)
  // - Exclude wells with fewer than MIN_PULLS_FOR_AVERAGE pulls (not enough data)
  const wellsForAverage = filteredWells.filter(w =>
    w.route !== TEST_ROUTE_NAME &&
    w.filteredPulls >= MIN_PULLS_FOR_AVERAGE
  );

  // Calculate overall stats (from wells eligible for average)
  const overallStats = filteredWells.length > 0 ? {
    totalWells: filteredWells.length,
    totalPulls: filteredWells.reduce((sum, w) => sum + w.filteredPulls, 0),
    // Use only eligible wells for average calculation
    avgAccuracy: wellsForAverage.length > 0
      ? wellsForAverage.reduce((sum, w) => sum + w.avgAccuracy * w.filteredPulls, 0) /
        wellsForAverage.reduce((sum, w) => sum + w.filteredPulls, 0)
      : 0,
    improvingCount: filteredWells.filter(w => w.trend === "improving").length,
    decliningCount: filteredWells.filter(w => w.trend === "declining").length,
    // Track how many wells are excluded from average
    excludedFromAvg: filteredWells.length - wellsForAverage.length,
    // Total anomalous pulls filtered out across all wells
    totalAnomalies: filteredWells.reduce((sum, w) => sum + (w.anomalyCount || 0), 0),
  } : null;

  // Sort wells based on current sort state
  const sortedWells = [...filteredWells].sort((a, b) => {
    let comparison = 0;
    switch (sortColumn) {
      case "wellName":
        comparison = a.wellName.localeCompare(b.wellName);
        break;
      case "pulls":
        comparison = a.filteredPulls - b.filteredPulls;
        break;
      case "accuracy":
        comparison = a.avgAccuracy - b.avgAccuracy;
        break;
      case "trend":
        // Sort order: improving > stable > declining
        const trendOrder = { improving: 0, stable: 1, declining: 2 };
        comparison = (trendOrder[a.trend as keyof typeof trendOrder] || 1) - (trendOrder[b.trend as keyof typeof trendOrder] || 1);
        break;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  // Render a single well row
  const renderWellRow = ({ item }: { item: WellPerformance }) => {
    const trendDisplay = getTrendDisplay(item.trend);
    const accuracyColor = getAccuracyColor(item.avgAccuracy);
    // Check if this well is excluded from the overall average
    const isExcludedFromAvg = item.route === TEST_ROUTE_NAME || item.filteredPulls < MIN_PULLS_FOR_AVERAGE;
    const isTestRoute = item.route === TEST_ROUTE_NAME;

    return (
      <TouchableOpacity
        style={[styles.wellRow, isTestRoute && styles.wellRowTestRoute]}
        onPress={() => handleWellPress(item.wellName)}
        activeOpacity={0.7}
      >
        <View style={styles.wellInfo}>
          <Text style={[styles.wellName, isTestRoute && styles.wellNameTestRoute]} numberOfLines={1}>
            {item.wellName}
            {isTestRoute ? " [TEST]" : ""}
          </Text>
          <Text style={styles.wellPulls}>
            {item.filteredPulls} pull{item.filteredPulls !== 1 ? "s" : ""}
          </Text>
        </View>

        <View style={styles.wellStats}>
          {/* Exclusion indicator - shows when well is not counted in overall average */}
          {isExcludedFromAvg && (
            <View style={styles.excludedIndicator}>
              <Text style={styles.excludedX}>✕</Text>
            </View>
          )}

          <View style={styles.accuracyContainer}>
            <Text style={[styles.accuracyValue, { color: accuracyColor }]}>
              {item.avgAccuracy.toFixed(1)}%
            </Text>
            <Text style={styles.accuracyLabel}>avg</Text>
          </View>

          <View style={styles.rangeContainer}>
            <Text style={styles.rangeValue}>
              {item.worstAccuracy.toFixed(0)}-{item.bestAccuracy.toFixed(0)}%
            </Text>
            <Text style={styles.rangeLabel}>range</Text>
          </View>

          <View style={styles.trendContainer}>
            <Text style={[styles.trendIcon, { color: trendDisplay.color }]}>
              {trendDisplay.icon}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"<"}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Performance</Text>
          <Text style={styles.headerSubtitle}>Prediction Accuracy</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/settings")} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Toggle */}
      <View style={styles.controlsRow}>
        <View style={styles.filterToggle}>
          <TouchableOpacity
            style={[styles.filterButton, showMyRoutesOnly && styles.filterButtonActive]}
            onPress={() => {
              console.log("[Performance] Tapped My Routes");
              setShowMyRoutesOnly(true);
            }}
          >
            <Text style={[styles.filterButtonText, showMyRoutesOnly && styles.filterButtonTextActive]}>
              My Routes ({selectedWells.size})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, !showMyRoutesOnly && styles.filterButtonActive]}
            onPress={() => {
              console.log("[Performance] Tapped All Wells");
              setShowMyRoutesOnly(false);
            }}
          >
            <Text style={[styles.filterButtonText, !showMyRoutesOnly && styles.filterButtonTextActive]}>
              All Wells ({data?.wells?.length || 0})
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

        {/* Custom Date Pickers */}
        {dateRangeOption === "custom" && (
          <View style={styles.customDateRow}>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => setShowFromPicker(true)}
            >
              <Text style={styles.datePickerLabel}>From:</Text>
              <Text style={styles.datePickerValue}>{formatDateShort(customFromDate)}</Text>
            </TouchableOpacity>
            <Text style={styles.dateSeparator}>→</Text>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => setShowToPicker(true)}
            >
              <Text style={styles.datePickerLabel}>To:</Text>
              <Text style={styles.datePickerValue}>{formatDateShort(customToDate)}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Date Picker Modals */}
      {showFromPicker && (
        Platform.OS === "ios" ? (
          <Modal transparent animationType="slide" visible={showFromPicker}>
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModal}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={() => setShowFromPicker(false)}>
                    <Text style={styles.pickerDone}>Done</Text>
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
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModal}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={() => setShowToPicker(false)}>
                    <Text style={styles.pickerDone}>Done</Text>
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

      {/* Last Updated */}
      {data?.lastUpdated && (
        <Text style={styles.lastUpdated}>
          Last updated: {formatLastUpdated(data.lastUpdated)}
        </Text>
      )}

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>Loading performance data...</Text>
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
      {!loading && !error && data && (
        <>
          {/* Overall Stats */}
          {overallStats && (
            <View style={styles.statsSection}>
              <View style={styles.mainStatCard}>
                <Text
                  style={[
                    styles.mainStatValue,
                    { color: getAccuracyColor(overallStats.avgAccuracy) },
                  ]}
                >
                  {overallStats.avgAccuracy.toFixed(1)}%
                </Text>
                <Text style={styles.mainStatLabel}>Overall Accuracy</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{overallStats.totalWells}</Text>
                  <Text style={styles.statLabel}>Wells</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{overallStats.totalPulls}</Text>
                  <Text style={styles.statLabel}>Pulls</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={[styles.statValue, { color: "#10B981" }]}>
                    {overallStats.improvingCount}
                  </Text>
                  <Text style={styles.statLabel}>Improving</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={[styles.statValue, { color: "#EF4444" }]}>
                    {overallStats.decliningCount}
                  </Text>
                  <Text style={styles.statLabel}>Declining</Text>
                </View>
              </View>
            </View>
          )}

          {/* Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#10B981" }]} />
              <Text style={styles.legendText}>95%+</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#F59E0B" }]} />
              <Text style={styles.legendText}>90-95%</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#EF4444" }]} />
              <Text style={styles.legendText}>&lt;90%</Text>
            </View>
            <Text style={styles.legendHint}>Tap well for details</Text>
          </View>

          {/* Sort Controls */}
          <View style={styles.sortControls}>
            <Text style={styles.sortLabel}>Sort:</Text>
            <TouchableOpacity
              style={[styles.sortButton, sortColumn === "wellName" && styles.sortButtonActive]}
              onPress={() => handleSortChange("wellName")}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortButtonText, sortColumn === "wellName" && styles.sortButtonTextActive]}>
                Name{getSortArrow("wellName")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortColumn === "pulls" && styles.sortButtonActive]}
              onPress={() => handleSortChange("pulls")}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortButtonText, sortColumn === "pulls" && styles.sortButtonTextActive]}>
                Pulls{getSortArrow("pulls")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortColumn === "accuracy" && styles.sortButtonActive]}
              onPress={() => handleSortChange("accuracy")}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortButtonText, sortColumn === "accuracy" && styles.sortButtonTextActive]}>
                Acc{getSortArrow("accuracy")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortColumn === "trend" && styles.sortButtonActive]}
              onPress={() => handleSortChange("trend")}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortButtonText, sortColumn === "trend" && styles.sortButtonTextActive]}>
                Trend{getSortArrow("trend")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Wells List */}
          <FlatList
            data={sortedWells}
            renderItem={renderWellRow}
            keyExtractor={(item) => item.wellName}
            style={styles.flatList}
            contentContainerStyle={styles.flatListContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#60A5FA"
                colors={["#60A5FA"]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No performance data</Text>
                <Text style={styles.emptySubtext}>
                  Pull down to refresh. Data appears after drivers submit pulls.
                </Text>
              </View>
            }
            ListFooterComponent={
              sortedWells.length > 0 && overallStats && (overallStats.excludedFromAvg > 0 || overallStats.totalAnomalies > 0) ? (
                <View style={styles.footerContainer}>
                  {overallStats.excludedFromAvg > 0 && (
                    <Text style={styles.footerNote}>
                      ✕ = excluded from overall average
                    </Text>
                  )}
                  {overallStats.totalAnomalies > 0 && (
                    <Text style={styles.footerNote}>
                      {overallStats.totalAnomalies} anomalous pull{overallStats.totalAnomalies !== 1 ? "s" : ""} filtered from averages
                    </Text>
                  )}
                </View>
              ) : null
            }
          />
        </>
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
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: hp("2.2%"),
    color: "#F9FAFB",
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: hp("1.2%"),
    color: "#6B7280",
    marginTop: 2,
  },
  headerRight: {
    width: hp("2.4%"),
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
    gap: spacing.sm,
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
    marginBottom: spacing.xs,
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
  customDateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  datePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.6%"),
    borderWidth: 1,
    borderColor: "#374151",
  },
  datePickerLabel: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    marginRight: spacing.xs,
  },
  datePickerValue: {
    fontSize: hp("1.2%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  dateSeparator: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
  },
  // Date Picker Modal (iOS)
  pickerModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  pickerModal: {
    backgroundColor: "#1F2937",
    borderTopLeftRadius: hp("1.5%"),
    borderTopRightRadius: hp("1.5%"),
    paddingBottom: hp("3%"),
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  pickerDone: {
    fontSize: hp("1.5%"),
    color: "#60A5FA",
    fontWeight: "600",
  },
  lastUpdated: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
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
  // Stats Section
  statsSection: {
    paddingHorizontal: wp("5%"),
    marginBottom: spacing.md,
  },
  mainStatCard: {
    backgroundColor: "#111827",
    borderRadius: hp("1%"),
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  mainStatValue: {
    fontSize: hp("4%"),
    fontWeight: "700",
  },
  mainStatLabel: {
    fontSize: hp("1.3%"),
    color: "#9CA3AF",
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  statValue: {
    fontSize: hp("1.8%"),
    fontWeight: "700",
    color: "#60A5FA",
  },
  statLabel: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    marginTop: 2,
  },
  // Legend
  legendRow: {
    flexDirection: "row",
    paddingHorizontal: wp("5%"),
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: spacing.md,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  legendText: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
  },
  legendHint: {
    flex: 1,
    textAlign: "right",
    fontSize: hp("1.1%"),
    color: "#4B5563",
    fontStyle: "italic",
  },
  // Sort Controls
  sortControls: {
    flexDirection: "row",
    paddingHorizontal: wp("5%"),
    paddingVertical: spacing.xs,
    alignItems: "center",
    gap: spacing.xs,
  },
  sortLabel: {
    fontSize: hp("1.2%"),
    color: "#6B7280",
    marginRight: spacing.xs,
  },
  sortButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.4%"),
    backgroundColor: "#1F2937",
  },
  sortButtonActive: {
    backgroundColor: "#2563EB",
  },
  sortButtonText: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  sortButtonTextActive: {
    color: "#FFFFFF",
  },
  // Wells List
  flatList: {
    flex: 1,
  },
  flatListContent: {
    paddingHorizontal: wp("5%"),
    paddingBottom: hp("5%"),
  },
  wellRow: {
    flexDirection: "row",
    backgroundColor: "#111827",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: "#1F2937",
    alignItems: "center",
  },
  wellRowTestRoute: {
    backgroundColor: "#1a1a2e",
    borderColor: "#4B5563",
    opacity: 0.8,
  },
  wellInfo: {
    flex: 1,
  },
  wellName: {
    fontSize: hp("1.5%"),
    fontWeight: "600",
    color: "#F9FAFB",
  },
  wellNameTestRoute: {
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  wellPulls: {
    fontSize: hp("1.2%"),
    color: "#6B7280",
    marginTop: 2,
  },
  wellStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  excludedIndicator: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#7F1D1D",
    justifyContent: "center",
    alignItems: "center",
  },
  excludedX: {
    fontSize: hp("1%"),
    color: "#FCA5A5",
    fontWeight: "700",
  },
  accuracyContainer: {
    alignItems: "center",
    minWidth: 50,
  },
  accuracyValue: {
    fontSize: hp("1.6%"),
    fontWeight: "700",
  },
  accuracyLabel: {
    fontSize: hp("1%"),
    color: "#6B7280",
  },
  rangeContainer: {
    alignItems: "center",
    minWidth: 60,
  },
  rangeValue: {
    fontSize: hp("1.2%"),
    color: "#9CA3AF",
  },
  rangeLabel: {
    fontSize: hp("1%"),
    color: "#6B7280",
  },
  trendContainer: {
    width: 24,
    alignItems: "center",
  },
  trendIcon: {
    fontSize: hp("2%"),
    fontWeight: "700",
  },
  // Empty State
  emptyContainer: {
    alignItems: "center",
    paddingTop: hp("10%"),
  },
  emptyText: {
    fontSize: hp("1.8%"),
    color: "#9CA3AF",
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
  // Footer
  footerContainer: {
    alignItems: "center",
    paddingBottom: spacing.md,
  },
  footerNote: {
    textAlign: "center",
    fontSize: hp("1.1%"),
    color: "#4B5563",
    marginTop: spacing.sm,
    fontStyle: "italic",
  },
});

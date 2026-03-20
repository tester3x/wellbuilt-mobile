// app/well-data.tsx
// Shows historical data from WellBuilt database for a specific well
// Data is fetched via Firebase from VBA (columns A-K of well sheet)

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Sorting types for well data list
type WellDataSortColumn = "dateTime" | "bbls24" | "flow";
type SortDirection = "asc" | "desc";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Format date as M/D/YY H:MM AM (shorter format)
const formatShortDate = (dateStr: string): string => {
  if (!dateStr) return "-";
  // Strip commas — WB T formats as "3/19/2026, 9:30:00 AM" which Hermes can't parse
  const date = new Date(dateStr.replace(/,/g, ''));
  if (isNaN(date.getTime())) return dateStr;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear() % 100; // 2-digit year
  const hours = date.getHours();
  const mins = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${month}/${day}/${year.toString().padStart(2, "0")} ${h12}:${mins.toString().padStart(2, "0")} ${ampm}`;
};
import {
  requestWellHistory,
  WellHistoryResponse,
  WellHistoryRow,
} from "../src/services/firebase";
import { getDriverName, isCurrentUserAdmin } from "../src/services/driverAuth";
import { hp, spacing, wp } from "../src/ui/layout";

export default function WellDataScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ wellName: string }>();
  const wellName = params.wellName || "Unknown";
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WellHistoryResponse | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [displayLimit, setDisplayLimit] = useState(20); // How many rows to show (20/35/50)
  const [totalRowsAvailable, setTotalRowsAvailable] = useState<number>(0);
  const [currentDriverName, setCurrentDriverName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [cachedRows, setCachedRows] = useState<WellHistoryRow[]>([]); // Cache all 50 rows

  // Sorting state for well data list
  const [sortColumn, setSortColumn] = useState<WellDataSortColumn>("dateTime");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc"); // newest first by default

  // Track if initial fetch has been done
  const [hasFetched, setHasFetched] = useState(false);

  // Always fetch 50 rows and cache them - display limit controls what we show
  const fetchData = useCallback(async (forceRefresh: boolean = false) => {
    setError(null);
    try {
      console.log("[WellData] Fetching history for:", wellName, "limit: 50 (always fetch max)");
      const response = await requestWellHistory(wellName, 50); // Always fetch 50

      if (!response) {
        setError("Request timed out. Is WellBuilt running with sync active?");
        return;
      }

      if (response.status === "error") {
        setError(response.errorMessage || "Unknown error");
        return;
      }

      setData(response);
      // Log first few rows to debug
      console.log("[WellData] First 3 rows:", JSON.stringify((response.rows || []).slice(0, 3)));
      // Filter out blank/invalid rows when caching - not when displaying
      // A valid row must have dateTime AND level AND bbls (all display fields)
      const validRows = (response.rows || []).filter((row, idx) => {
        const hasDate = row.dateTime && row.dateTime.trim() !== "";
        const hasLevel = row.topLevel && row.topLevel.trim() !== "" && /\d+'/.test(row.topLevel);
        const hasBbls = row.bbls && row.bbls.trim() !== "";
        const valid = hasDate && hasLevel && hasBbls;
        if (!valid && idx < 10) {
          console.log("[WellData] Filtered out row", idx, "- date:", hasDate, "level:", hasLevel, "bbls:", hasBbls, "row:", row.dateTime, row.topLevel, row.bbls);
        }
        return valid;
      });
      console.log("[WellData] Received", response.rows?.length, "rows, filtered to", validRows.length, "valid rows");
      setCachedRows(validRows);
      // Track total valid rows for button states
      setTotalRowsAvailable(validRows.length);
      setHasFetched(true);
    } catch (err) {
      console.error("[WellData] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    }
  }, [wellName]);

  useEffect(() => {
    if (!hasFetched) {
      setLoading(true);
      fetchData(false).finally(() => setLoading(false));
    }
  }, [fetchData, hasFetched]);

  // Get current driver name and admin status for display logic
  useEffect(() => {
    getDriverName().then(name => setCurrentDriverName(name));
    isCurrentUserAdmin().then(admin => setIsAdmin(admin));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData(true); // Force refresh from Excel
    setRefreshing(false);
  };

  // Just change display limit - data is already cached
  const handleChangeLimit = (limit: number) => {
    setDisplayLimit(limit);
  };

  const toggleExpand = (index: number) => {
    setExpandedRow(prev => prev === index ? null : index);
  };

  // Handle column header tap to sort
  const handleSortChange = (column: WellDataSortColumn) => {
    if (sortColumn === column) {
      // Same column - toggle direction
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      // New column - set default direction
      setSortColumn(column);
      // Default: dateTime desc (newest first), others desc
      setSortDirection("desc");
    }
  };

  // Get sort arrow for a column (only shows on active sort column)
  const getSortArrow = (column: WellDataSortColumn): string => {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  // Parse flow rate for sorting (e.g., "1:33:21" -> seconds)
  const parseFlowToSeconds = (flow: string): number => {
    if (!flow || flow === "-") return 0;
    const parts = flow.split(":").map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  // Parse dateTime string to timestamp for sorting
  // Format: "M/D/YYYY H:MM:SS AM/PM" or "M/D/YYYY H:MM AM/PM"
  const parseDateTimeToMs = (dateTime: string): number => {
    if (!dateTime) return 0;
    // Strip commas — WB T formats as "3/19/2026, 9:30:00 AM" (comma after year)
    // while WB M formats as "3/19/2026 10:42 AM" (no comma). Hermes can't parse the comma format.
    const cleaned = dateTime.replace(/,/g, '');
    // Try native Date parsing first (works for most formats)
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
    // Fallback: manual parsing for "M/D/YYYY H:MM AM/PM"
    const match = cleaned.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/i);
    if (match) {
      let [, month, day, year, hours, minutes, seconds, ampm] = match;
      let h = parseInt(hours);
      if (ampm) {
        if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
        if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
      }
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        h,
        parseInt(minutes),
        parseInt(seconds || "0")
      ).getTime();
    }
    return 0;
  };

  // Get the N most recent rows first, THEN sort those by selected column
  // This ensures 20/35/50 always shows the most recent pulls, just sorted differently
  const sortedRows = useMemo(() => {
    if (cachedRows.length === 0) return [];

    // First: get the most recent N rows (sorted by date descending, then sliced)
    const byDateDesc = [...cachedRows].sort((a, b) =>
      parseDateTimeToMs(b.dateTime) - parseDateTimeToMs(a.dateTime)
    );
    const recentRows = byDateDesc.slice(0, displayLimit);

    // Second: sort these recent rows by the selected column
    const sorted = [...recentRows].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case "dateTime":
          comparison = parseDateTimeToMs(a.dateTime) - parseDateTimeToMs(b.dateTime);
          break;
        case "bbls24":
          comparison = (parseInt(a.bbls24hrs) || 0) - (parseInt(b.bbls24hrs) || 0);
          break;
        case "flow":
          comparison = parseFlowToSeconds(a.flowRate || "") - parseFlowToSeconds(b.flowRate || "");
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [cachedRows, sortColumn, sortDirection, displayLimit]);

  // Calculate summary stats from displayed rows (based on displayLimit)
  const stats = useMemo(() => {
    if (sortedRows.length === 0) return null;
    const totalBbls = sortedRows.reduce((sum, row) => sum + (parseInt(row.bbls) || 0), 0);
    const rowsWithBbls = sortedRows.filter(r => parseInt(r.bbls) > 0).length;
    return {
      totalPulls: sortedRows.length,
      totalBbls,
      avgBbls: Math.round(totalBbls / Math.max(rowsWithBbls, 1)),
    };
  }, [sortedRows]);

  // Check if this row was pulled by the current driver
  const isMyPull = (pulledBy: string | undefined) => {
    if (!currentDriverName || !pulledBy) return false;
    return pulledBy.trim().toLowerCase() === currentDriverName.trim().toLowerCase();
  };

  // Helper to check if a value changed (for highlighting edits)
  const valueChanged = (current: string | undefined, original: string | undefined): boolean => {
    if (!current || !original) return false;
    return current.trim() !== original.trim();
  };

  // Render a single data row
  // Row shows: Date (m/d/yy time), BBLs/day, Flow Rate
  // Dropdown shows: BBLs Taken, Time Dif, Recovery, Top Level, Bottom Level, etc.
  const renderRow = ({ item, index }: { item: WellHistoryRow; index: number }) => {
    const myPull = isMyPull(item.pulledBy);
    const isEdited = item.isEdit === true;
    const hasOriginalData = isEdited && item.originalData;
    return (
    <TouchableOpacity
      style={[
        styles.dataRow,
        index % 2 === 0 && styles.dataRowAlt,
        expandedRow === index && styles.dataRowExpanded,
        myPull && styles.dataRowMyPull,
        isEdited && styles.dataRowEdited,
      ]}
      onPress={() => toggleExpand(index)}
      activeOpacity={0.7}
    >
      <View style={styles.dataRowMain}>
        <View style={styles.dateCellContainer}>
          <Text style={[styles.dataCell, styles.dataCellDate]} numberOfLines={1}>
            {formatShortDate(item.dateTimeUTC || item.dateTime)}
          </Text>
          {isEdited && (
            <View style={styles.editedBadge}>
              <Text style={styles.editedBadgeText}>{t("wellData.edited")}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.dataCell, styles.dataCellBbls24]}>
          {item.bbls24hrs || "-"}
        </Text>
        <Text style={[styles.dataCell, styles.dataCellFlow]} numberOfLines={1}>
          {item.flowRate || "-"}
        </Text>
      </View>

      {expandedRow === index && (
        <View style={styles.expandedDetails}>
          <View style={styles.detailGrid}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{t("wellData.bblsTaken")}</Text>
              <Text style={[
                styles.detailValue,
                hasOriginalData && valueChanged(item.bbls, item.originalData?.bbls) && styles.detailValueChanged
              ]}>
                {item.bbls || "0"}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{t("wellData.timeDif")}</Text>
              <Text style={styles.detailValue}>{item.timeDif || "-"}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{t("wellData.recovery")}</Text>
              <Text style={styles.detailValue}>{item.recoveryInches ? `${item.recoveryInches}"` : "-"}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{t("wellData.topLevel")}</Text>
              <Text style={[
                styles.detailValue,
                hasOriginalData && valueChanged(item.topLevel, item.originalData?.topLevel) && styles.detailValueChanged
              ]}>
                {item.topLevel}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{t("wellData.bottomLevel")}</Text>
              <Text style={styles.detailValue}>
                {item.bottomLevel || "-"}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{t("wellData.rcvryNeeded")}</Text>
              <Text style={styles.detailValue}>{item.recoveryNeeded ? `${item.recoveryNeeded}"` : "-"}</Text>
            </View>
          </View>

          {/* Show original values if this is an edit - only show fields user can directly change */}
          {hasOriginalData && (
            <View style={styles.originalDataSection}>
              <Text style={styles.originalDataHeader}>{t("wellData.originalValues")}</Text>
              <View style={styles.originalDataGrid}>
                {valueChanged(item.dateTime, item.originalData?.dateTime) && (
                  <View style={styles.originalDataItem}>
                    <Text style={styles.originalDataLabel}>{t("wellData.timeLabel")}</Text>
                    <Text style={styles.originalDataValue}>{formatShortDate(item.originalData?.dateTime || "")}</Text>
                    <Text style={styles.originalDataArrow}>→</Text>
                    <Text style={styles.originalDataNewValue}>{formatShortDate(item.dateTime)}</Text>
                  </View>
                )}
                {valueChanged(item.topLevel, item.originalData?.topLevel) && (
                  <View style={styles.originalDataItem}>
                    <Text style={styles.originalDataLabel}>{t("wellData.topLabel")}</Text>
                    <Text style={styles.originalDataValue}>{item.originalData?.topLevel}</Text>
                    <Text style={styles.originalDataArrow}>→</Text>
                    <Text style={styles.originalDataNewValue}>{item.topLevel}</Text>
                  </View>
                )}
                {valueChanged(item.bbls, item.originalData?.bbls) && (
                  <View style={styles.originalDataItem}>
                    <Text style={styles.originalDataLabel}>{t("wellData.bblsLabel")}</Text>
                    <Text style={styles.originalDataValue}>{item.originalData?.bbls}</Text>
                    <Text style={styles.originalDataArrow}>→</Text>
                    <Text style={styles.originalDataNewValue}>{item.bbls}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Show pulled by:
              - Admin sees all driver names
              - Regular drivers only see their own name (myPull)
              - If no pulledBy data and not admin, hide the row */}
          {(isAdmin || myPull) && item.pulledBy && item.pulledBy.trim() !== "" && (
            <View style={styles.pulledByRow}>
              <Text style={styles.pulledByLabel}>{t("wellData.pulledBy")}</Text>
              <Text style={[styles.pulledByValue, myPull && styles.pulledByValueMe]}>
                {item.pulledBy}{myPull ? " " + t("wellData.you") : ""}
              </Text>
            </View>
          )}
        </View>
      )}
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
          <Text style={styles.headerTitle}>{wellName}</Text>
          <Text style={styles.headerSubtitle}>{t("wellData.subtitle")}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>{t("wellData.fetching")}</Text>
          <Text style={styles.loadingSubtext}>{t("wellData.fetchingSubtext")}</Text>
        </View>
      )}

      {/* Error State */}
      {error && !loading && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.errorText}>{error}</Text>
          {/* If VBA is offline, show OK button to go back; otherwise show Retry */}
          {error.includes("offline") || error.includes("database is currently") ? (
            <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
              <Text style={styles.retryButtonText}>{t("wellData.ok")}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.retryButton} onPress={() => {
              setLoading(true);
              fetchData(true).finally(() => setLoading(false));
            }}>
              <Text style={styles.retryButtonText}>{t("wellData.retry")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Data Display */}
      {!loading && !error && data && (
        <>
          {/* Stats Summary */}
          {stats && (
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.totalPulls}</Text>
                <Text style={styles.statLabel}>{t("wellData.pulls")}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, styles.statValueGreen]}>
                  {stats.totalBbls.toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>{t("wellData.totalBbls")}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, styles.statValueAmber]}>
                  {stats.avgBbls}
                </Text>
                <Text style={styles.statLabel}>{t("wellData.avgBbl")}</Text>
              </View>
            </View>
          )}

          {/* Display Limit Buttons */}
          <View style={styles.loadMoreButtonsRow}>
            {[20, 35, 50].map((limit) => {
              const isDisabled = totalRowsAvailable > 0 && totalRowsAvailable < limit;
              return (
                <TouchableOpacity
                  key={limit}
                  style={[
                    styles.loadMoreButton,
                    displayLimit === limit && styles.loadMoreButtonActive,
                    isDisabled && styles.loadMoreButtonDisabled,
                  ]}
                  onPress={() => !isDisabled && handleChangeLimit(limit)}
                  disabled={isDisabled}
                >
                  <Text
                    style={[
                      styles.loadMoreButtonText,
                      displayLimit === limit && styles.loadMoreButtonTextActive,
                      isDisabled && styles.loadMoreButtonTextDisabled,
                    ]}
                  >
                    {limit}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Sticky Column Headers - Sortable */}
          <View style={styles.tableHeaderContainer}>
            <View style={styles.tableHeader}>
              <TouchableOpacity
                style={styles.headerCellDate}
                onPress={() => handleSortChange("dateTime")}
                activeOpacity={0.7}
              >
                <Text style={[styles.headerCell, styles.headerCellDateText, sortColumn === "dateTime" && styles.headerCellActive]}>
                  {t("wellData.dateHeader")}{getSortArrow("dateTime")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerCellBbls24}
                onPress={() => handleSortChange("bbls24")}
                activeOpacity={0.7}
              >
                <Text style={[styles.headerCell, styles.headerCellCenterText, sortColumn === "bbls24" && styles.headerCellActive]}>
                  {t("wellData.bblsDayHeader")}{getSortArrow("bbls24")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerCellFlow}
                onPress={() => handleSortChange("flow")}
                activeOpacity={0.7}
              >
                <Text style={[styles.headerCell, styles.headerCellRightText, sortColumn === "flow" && styles.headerCellActive]}>
                  {t("wellData.flowHeader")}{getSortArrow("flow")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Data Rows - Using FlatList for sticky header behavior */}
          <FlatList
            data={sortedRows}
            renderItem={renderRow}
            keyExtractor={(item, index) => `${item.dateTime}_${index}`}
            extraData={sortColumn + sortDirection}
            style={styles.flatList}
            contentContainerStyle={styles.flatListContent}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t("wellData.noData")}</Text>
              </View>
            }
            ListFooterComponent={
              sortedRows.length > 0 ? (
                <Text style={styles.footerNote}>
                  Data from WellBuilt - Last updated: {data?.timestamp}
                </Text>
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
  loadingSubtext: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    marginTop: spacing.xs,
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
  // Stats
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: wp("5%"),
    gap: spacing.xs,
    marginBottom: spacing.sm,
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
    fontSize: hp("2%"),
    fontWeight: "700",
    color: "#60A5FA",
  },
  statValueGreen: {
    color: "#10B981",
  },
  statValueAmber: {
    color: "#F59E0B",
  },
  statLabel: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    marginTop: 2,
  },
  // Load More
  loadMoreButtonsRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  loadMoreButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: hp("0.5%"),
    backgroundColor: "#1F2937",
  },
  loadMoreButtonActive: {
    backgroundColor: "#2563EB",
  },
  loadMoreButtonDisabled: {
    backgroundColor: "#1F2937",
    opacity: 0.4,
  },
  loadMoreButtonText: {
    fontSize: hp("1.3%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  loadMoreButtonTextActive: {
    color: "#FFFFFF",
  },
  loadMoreButtonTextDisabled: {
    color: "#4B5563",
  },
  // Sticky Table Header
  tableHeaderContainer: {
    paddingHorizontal: wp("3%"),
    backgroundColor: "#05060B",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: hp("0.5%"),
  },
  headerCell: {
    fontSize: hp("1.2%"),
    fontWeight: "600",
    color: "#9CA3AF",
  },
  headerCellActive: {
    color: "#60A5FA",
  },
  headerCellDate: {
    flex: 2.5,
  },
  headerCellDateText: {
    textAlign: "left",
  },
  headerCellBbls24: {
    flex: 1.2,
  },
  headerCellCenterText: {
    textAlign: "center",
  },
  headerCellFlow: {
    flex: 1.3,
    paddingRight: spacing.xs,
  },
  headerCellRightText: {
    textAlign: "right",
  },
  // FlatList
  flatList: {
    flex: 1,
  },
  flatListContent: {
    paddingHorizontal: wp("3%"),
    paddingTop: spacing.xs,
    paddingBottom: hp("5%"),
  },
  // Data Rows
  dataRow: {
    backgroundColor: "#111827",
    borderRadius: hp("0.5%"),
    marginBottom: 2,
    borderWidth: 1,
    borderColor: "#1F2937",
    overflow: "hidden",
  },
  dataRowAlt: {
    backgroundColor: "#0D1117",
  },
  dataRowExpanded: {
    borderColor: "#2563EB",
  },
  dataRowMyPull: {
    borderLeftWidth: 3,
    borderLeftColor: "#10B981",
  },
  dataRowEdited: {
    borderRightWidth: 3,
    borderRightColor: "#F59E0B",
  },
  dataRowMain: {
    flexDirection: "row",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
  },
  dataCell: {
    fontSize: hp("1.3%"),
    color: "#E5E7EB",
  },
  dataCellDate: {
    flex: 1,
    color: "#9CA3AF",
    fontSize: hp("1.2%"),
  },
  dateCellContainer: {
    flex: 2.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editedBadge: {
    backgroundColor: "#F59E0B",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  editedBadgeText: {
    fontSize: hp("0.9%"),
    color: "#000",
    fontWeight: "600",
  },
  dataCellBbls24: {
    flex: 1.2,
    textAlign: "center",
    color: "#10B981",
    fontWeight: "600",
  },
  dataCellFlow: {
    flex: 1.3,
    textAlign: "right",
    color: "#60A5FA",
    fontWeight: "500",
  },
  // Expanded Details
  expandedDetails: {
    backgroundColor: "#0D1117",
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
    padding: spacing.sm,
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  detailItem: {
    width: "33%",
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  detailLabel: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    textAlign: "center",
  },
  detailValue: {
    fontSize: hp("1.3%"),
    color: "#E5E7EB",
    fontWeight: "500",
    marginTop: 2,
    textAlign: "center",
  },
  detailValueChanged: {
    color: "#F59E0B",
    fontWeight: "700",
  },
  // Original data section (for edited pulls)
  originalDataSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "#374151",
    backgroundColor: "#1a1a2e",
    padding: spacing.sm,
    borderRadius: 4,
  },
  originalDataHeader: {
    fontSize: hp("1.1%"),
    color: "#F59E0B",
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  originalDataGrid: {
    gap: 4,
  },
  originalDataItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  originalDataLabel: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    width: 50,
  },
  originalDataValue: {
    fontSize: hp("1.2%"),
    color: "#EF4444",
    textDecorationLine: "line-through",
  },
  originalDataArrow: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
  },
  originalDataNewValue: {
    fontSize: hp("1.2%"),
    color: "#10B981",
    fontWeight: "600",
  },
  pulledByRow: {
    flexDirection: "row",
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
  },
  pulledByLabel: {
    fontSize: hp("1.2%"),
    color: "#6B7280",
    marginRight: spacing.xs,
  },
  pulledByValue: {
    fontSize: hp("1.2%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  pulledByValueMe: {
    color: "#10B981",
    fontWeight: "600",
  },
  // Empty
  emptyContainer: {
    alignItems: "center",
    paddingTop: hp("10%"),
  },
  emptyText: {
    fontSize: hp("1.6%"),
    color: "#6B7280",
  },
  // Footer
  footerNote: {
    textAlign: "center",
    fontSize: hp("1.1%"),
    color: "#4B5563",
    marginTop: spacing.md,
  },
});

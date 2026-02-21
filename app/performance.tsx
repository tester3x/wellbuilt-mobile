// app/performance.tsx
// Performance Tracker - Well picker screen
// Shows list of wells from well_config (lightweight, no packet download)
// Tapping a well navigates to performance-detail which fetches only that well's data

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getWellNameList,
} from "../src/services/firebase";
import { isCurrentUserAdmin } from "../src/services/driverAuth";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Constants for filtering
const TEST_ROUTE_NAME = "Test Route";
import { hp, spacing, wp } from "../src/ui/layout";

// Storage key for selected wells (same as settings.tsx)
const STORAGE_KEY_SELECTED_WELLS = "wellbuilt_selected_wells";

interface WellItem {
  name: string;
  route?: string;
}

export default function PerformanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allWells, setAllWells] = useState<WellItem[]>([]);
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set());
  // Default to "myroutes", but respect URL param if provided
  const [showMyRoutesOnly, setShowMyRoutesOnly] = useState(params.filter !== "all");
  // Admin status - determines if Test Route wells are visible
  const [isAdmin, setIsAdmin] = useState(false);

  // Load selected wells from settings
  const loadSelectedWells = useCallback(async () => {
    try {
      const savedSelections = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_WELLS);
      if (savedSelections) {
        const wells: string[] = JSON.parse(savedSelections);
        setSelectedWells(new Set(wells));
      }
    } catch (err) {
      console.error("[Performance] Error loading selected wells:", err);
    }
  }, []);

  // Load well names from well_config (tiny payload, no packets downloaded)
  const fetchWells = useCallback(async () => {
    setError(null);
    try {
      const wellList = await getWellNameList();
      // Sort alphabetically
      wellList.sort((a, b) => a.name.localeCompare(b.name));
      setAllWells(wellList);
    } catch (err) {
      console.error("[Performance] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load wells");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    isCurrentUserAdmin().then(setIsAdmin);
    Promise.all([fetchWells(), loadSelectedWells()]).finally(() => setLoading(false));
  }, [fetchWells, loadSelectedWells]);

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
    await Promise.all([fetchWells(), loadSelectedWells()]);
    setRefreshing(false);
  };

  const handleWellPress = (wellName: string) => {
    router.push({
      pathname: "/performance-detail",
      params: {
        wellName,
        filterContext: showMyRoutesOnly ? "myroutes" : "all",
      },
    });
  };

  // Filter wells:
  // 1. Apply My Routes filter if enabled
  // 2. Hide Test Route wells from non-admins
  const filteredWells = allWells.filter(w => {
    if (showMyRoutesOnly && !selectedWells.has(w.name)) return false;
    if (!isAdmin && w.route === TEST_ROUTE_NAME) return false;
    return true;
  });

  // Render a single well row
  const renderWellRow = ({ item }: { item: WellItem }) => {
    const isTestRoute = item.route === TEST_ROUTE_NAME;

    return (
      <TouchableOpacity
        style={[styles.wellRow, isTestRoute && styles.wellRowTestRoute]}
        onPress={() => handleWellPress(item.name)}
        activeOpacity={0.7}
      >
        <Text style={[styles.wellName, isTestRoute && styles.wellNameTestRoute]} numberOfLines={1}>
          {item.name}
          {isTestRoute ? " [TEST]" : ""}
        </Text>
        <Text style={styles.chevron}>{">"}</Text>
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
          <Text style={styles.headerSubtitle}>Select a well to view</Text>
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
            onPress={() => setShowMyRoutesOnly(true)}
          >
            <Text style={[styles.filterButtonText, showMyRoutesOnly && styles.filterButtonTextActive]}>
              My Routes ({selectedWells.size})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, !showMyRoutesOnly && styles.filterButtonActive]}
            onPress={() => setShowMyRoutesOnly(false)}
          >
            <Text style={[styles.filterButtonText, !showMyRoutesOnly && styles.filterButtonTextActive]}>
              All Wells ({allWells.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>Loading wells...</Text>
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
              fetchWells().finally(() => setLoading(false));
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Wells List */}
      {!loading && !error && (
        <FlatList
          data={filteredWells}
          renderItem={renderWellRow}
          keyExtractor={(item) => item.name}
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
              <Text style={styles.emptyText}>No wells found</Text>
              <Text style={styles.emptySubtext}>
                {showMyRoutesOnly
                  ? "No wells selected in My Routes. Go to Settings to select wells."
                  : "Pull down to refresh."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060B",
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
    marginBottom: spacing.sm,
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
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
  wellName: {
    flex: 1,
    fontSize: hp("1.6%"),
    fontWeight: "600",
    color: "#F9FAFB",
  },
  wellNameTestRoute: {
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  chevron: {
    fontSize: hp("1.8%"),
    color: "#4B5563",
    marginLeft: spacing.sm,
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
    textAlign: "center",
    paddingHorizontal: wp("10%"),
  },
});

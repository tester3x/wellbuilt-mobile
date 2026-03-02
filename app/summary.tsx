import { Slider } from '@miblanchard/react-native-slider';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getLevelSnapshot,
  loadLevelSnapshots,
} from "../src/services/wellHistory";
import { loadWellConfig, WellConfigMap } from "../src/services/wellConfig";
import { hp, spacing, wp } from "../src/ui/layout";

const STORAGE_KEY_SELECTED_WELLS = "wellbuilt_selected_wells";
const STORAGE_KEY_EXPANDED_ROUTES = "wellbuilt_summary_expanded";
const STORAGE_KEY_ROUTE_ORDER = "wellbuilt_route_order";
const STORAGE_KEY_LOAD_SIZE = "wellbuilt_load_size";
const STORAGE_KEY_SLIDER_FEET = "wellbuilt_summary_slider_feet";
const STORAGE_KEY_SLIDER_HOURS = "wellbuilt_summary_slider_hours";
const STORAGE_KEY_SLIDER_MODE = "wellbuilt_summary_slider_mode";

const DEFAULT_PULL_BBLS = 140;
const DEFAULT_SLIDER_FEET = 10.5; // 10' 6"
const DEFAULT_SLIDER_HOURS = 6;
const MIN_SLIDER_FEET = 1.33; // 1' 4" - literal load line
const MAX_SLIDER_FEET = 18;
const MIN_SLIDER_HOURS = 0;
const MAX_SLIDER_HOURS = 24;

// Slider timing constants
const SLIDER_LOCK_DELAY = 5000; // 5 seconds of inactivity to lock
const DOUBLE_TAP_DELAY = 300; // Max ms between taps for double-tap

// Well config interface - imported from wellConfig.ts

interface WellSummaryData {
  wellName: string;
  route: string;
  routeColor: string;
  levelFeet: number;
  flowRateMinutes: number;
  numTanks: number;
  loadLine: number;
  allowedBottom: number;
  isDown: boolean;
  snapshotTimestamp: number;
  windowBblsDay: number;
  overnightBblsDay: number;
}

interface RouteGroup {
  routeName: string;
  color: string;
  wells: WellSummaryData[];
  expanded: boolean;
  totalWells: number;  // Total wells in route (from config, not just selected)
}

// Generate unique color from route name using HSL color space
// Uses djb2 hash to pick a hue, then converts to RGB
// Matches VBA implementation in modRouteBuilderAdapter.bas
function getRouteColor(routeName: string): string {
  // djb2 hash - good distribution
  let hash = 5381;
  for (let i = 0; i < routeName.length; i++) {
    hash = ((hash << 5) + hash) + routeName.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  hash = Math.abs(hash);

  // Use hash to pick Hue (0-360), keep Saturation and Lightness fixed
  const hue = hash % 360;
  const sat = 0.65;  // 65% saturation - vibrant but not neon
  const lum = 0.55;  // 55% lightness - visible on dark background

  // Convert HSL to RGB
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lum - c / 2;

  let r1 = 0, g1 = 0, b1 = 0;
  const hueSection = Math.floor(hue / 60);
  switch (hueSection) {
    case 0: r1 = c; g1 = x; b1 = 0; break;
    case 1: r1 = x; g1 = c; b1 = 0; break;
    case 2: r1 = 0; g1 = c; b1 = x; break;
    case 3: r1 = 0; g1 = x; b1 = c; break;
    case 4: r1 = x; g1 = 0; b1 = c; break;
    default: r1 = c; g1 = 0; b1 = x; break;
  }

  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return `rgb(${r}, ${g}, ${b})`;
}

// Format decimal feet to feet'inches" - omit inches if zero
// Always floor - matches packet level sent to VBA for consistent display
function formatFeetInches(feet: number): string {
  if (feet < 0) feet = 0;
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (inches === 0) return `${ft}'`;
  return `${ft}'${inches}"`;
}

// Format datetime for display - day suffix for natural reading
function formatDateTime(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;

  if (date.toDateString() === now.toDateString()) {
    return timeStr;
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return `${timeStr} Tm`;
  } else {
    return `${timeStr} ${date.getMonth() + 1}/${date.getDate()}`;
  }
}

// Split datetime into time + date for two-line column display
function formatDateTimeSplit(date: Date): { time: string; date: string } {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;

  if (date.toDateString() === now.toDateString()) {
    return { time: timeStr, date: '' };
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return { time: timeStr, date: 'Tm' };
  } else {
    return { time: timeStr, date: `${date.getMonth() + 1}/${date.getDate()}` };
  }
}

// Calculate current estimated level based on snapshot and flow rate
// CRITICAL: Cap at 20' (full tank) to prevent insane values from bad timestamps
const FULL_TANK_FEET = 20;

function getCurrentLevel(well: WellSummaryData): number {
  if (well.flowRateMinutes <= 0) return Math.min(well.levelFeet, FULL_TANK_FEET);
  
  // Validate timestamp - if it's too old (before 2024) or in future, just use base level
  const now = Date.now();
  const jan2024 = new Date('2024-01-01').getTime();
  if (well.snapshotTimestamp < jan2024 || well.snapshotTimestamp > now) {
    return Math.min(well.levelFeet, FULL_TANK_FEET);
  }
  
  const minutesSinceSnapshot = (now - well.snapshotTimestamp) / 60000;
  const feetRisen = minutesSinceSnapshot / well.flowRateMinutes;
  
  // Cap at full tank
  return Math.min(well.levelFeet + feetRisen, FULL_TANK_FEET);
}

// Calculate ready level based on pullBbls and well config
// Uses allowedBottom - can't pull below that without permission
function getReadyLevel(well: WellSummaryData, pullBbls: number): number {
  const feetNeeded = pullBbls / (20 * well.numTanks);
  return well.allowedBottom + feetNeeded;
}

// Calculate datetime when well will hit target level
function getTimeAtLevel(well: WellSummaryData, targetFeet: number): Date | null {
  if (well.flowRateMinutes <= 0) return null;
  const currentLevel = getCurrentLevel(well);
  if (currentLevel >= targetFeet) return new Date(); // Already there
  const feetToGo = targetFeet - currentLevel;
  const minutesToGo = feetToGo * well.flowRateMinutes;
  return new Date(Date.now() + minutesToGo * 60000);
}

// Calculate when well originally became ready (for frozen ready time display)
// This calculates backwards from current level to find when it crossed the ready threshold
function getTimeWhenBecameReady(well: WellSummaryData, readyLevel: number): Date | null {
  if (well.flowRateMinutes <= 0) return null;
  const currentLevel = getCurrentLevel(well);
  if (currentLevel < readyLevel) return null; // Not ready yet

  // Calculate how many feet above ready level we are
  const feetAboveReady = currentLevel - readyLevel;
  // Calculate how many minutes ago we crossed the ready threshold
  const minutesAgo = feetAboveReady * well.flowRateMinutes;
  return new Date(Date.now() - minutesAgo * 60000);
}

// Calculate level at a future time
function getLevelAtTime(well: WellSummaryData, hoursFromNow: number): number {
  if (well.flowRateMinutes <= 0) return getCurrentLevel(well);
  const currentLevel = getCurrentLevel(well);
  const feetGained = (hoursFromNow * 60) / well.flowRateMinutes;
  return Math.min(currentLevel + feetGained, 20); // Cap at 20'
}

// Fetch well_config from Firebase (via wellConfig service)
async function fetchWellConfig(): Promise<WellConfigMap | null> {
  try {
    return await loadWellConfig();
  } catch (error) {
    console.error("[Summary] Error fetching well config:", error);
    return null;
  }
}

export default function SummaryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [routeGroups, setRouteGroups] = useState<RouteGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Slider mode: 'feet' or 'time'
  const [sliderMode, setSliderMode] = useState<'feet' | 'time'>('feet');
  const [sliderFeet, setSliderFeet] = useState(DEFAULT_SLIDER_FEET);
  const [sliderHours, setSliderHours] = useState(DEFAULT_SLIDER_HOURS);
  const [pullBbls, setPullBbls] = useState(DEFAULT_PULL_BBLS);
  const [pullBblsInput, setPullBblsInput] = useState(String(DEFAULT_PULL_BBLS));
  
  // Track expanded states - persisted to AsyncStorage
  const [expandedStates, setExpandedStates] = useState<{ [routeName: string]: boolean }>({});

  // Track which well row is expanded (show details)
  const [expandedWell, setExpandedWell] = useState<string | null>(null);

  // Slider lock state
  const [sliderLocked, setSliderLocked] = useState(true);

  // Refs for timers and tracking
  const sliderLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef<number>(0); // For double-tap detection on slider
  const wellTapTimeRef = useRef<{ [wellName: string]: number }>({}); // For double-tap on wells

  // Load expanded states from AsyncStorage
  const loadExpandedStates = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_EXPANDED_ROUTES);
      if (saved) {
        setExpandedStates(JSON.parse(saved));
      }
    } catch (error) {
      console.error("[Summary] Error loading expanded states:", error);
    }
  }, []);

  // Save expanded states to AsyncStorage
  const saveExpandedStates = useCallback(async (states: { [routeName: string]: boolean }) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_EXPANDED_ROUTES, JSON.stringify(states));
    } catch (error) {
      console.error("[Summary] Error saving expanded states:", error);
    }
  }, []);

  const loadSummaryData = useCallback(async () => {
    try {
      // Load expanded states first
      await loadExpandedStates();
      
      // Load selected wells
      const savedSelections = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_WELLS);
      const selectedWells: string[] = savedSelections
        ? JSON.parse(savedSelections)
        : [];

      if (selectedWells.length === 0) {
        setRouteGroups([]);
        setIsLoading(false);
        return;
      }

      // Load well config for route info
      const wellConfig = await fetchWellConfig();

      // Load cached data (flow rate is now in level snapshots)
      await loadLevelSnapshots();

      // Build summary data for each well
      const summaryData: WellSummaryData[] = [];

      for (const wellName of selectedWells) {
        const config = wellConfig?.[wellName];
        const snapshot = await getLevelSnapshot(wellName);

        const route = config?.route || "Unknown";
        const routeColor = config?.routeColor || getRouteColor(route);
        const levelFeet = snapshot?.levelFeet || 0;
        const isDown = snapshot?.isDown ?? config?.isDown ?? false;
        // Flow rate now stored in snapshot (not separately cached)
        const flowRateMinutes = snapshot?.flowRateMinutes || config?.avgFlowRateMinutes || 0;
        const numTanks = config?.numTanks || 1;
        const loadLine = config?.loadLine ?? 1.33;
        const allowedBottom = config?.allowedBottom ?? 1.33;

        summaryData.push({
          wellName,
          route,
          routeColor,
          levelFeet,
          flowRateMinutes,
          numTanks,
          loadLine,
          allowedBottom,
          isDown,
          snapshotTimestamp: snapshot?.timestamp || Date.now(),
          windowBblsDay: snapshot?.windowBblsDay || 0,
          overnightBblsDay: snapshot?.overnightBblsDay || 0,
        });
      }

      // Group by route
      const routeMap: { [route: string]: WellSummaryData[] } = {};
      for (const well of summaryData) {
        if (!routeMap[well.route]) {
          routeMap[well.route] = [];
        }
        routeMap[well.route].push(well);
      }

      // Calculate total wells per route from full config
      const totalWellsPerRoute: { [route: string]: number } = {};
      if (wellConfig) {
        for (const [wellName, config] of Object.entries(wellConfig)) {
          const route = config.route || "Unknown";
          totalWellsPerRoute[route] = (totalWellsPerRoute[route] || 0) + 1;
        }
      }

      // Load expanded states from AsyncStorage
      const savedExpanded = await AsyncStorage.getItem(STORAGE_KEY_EXPANDED_ROUTES);
      const expanded = savedExpanded ? JSON.parse(savedExpanded) : {};

      // Load saved route order
      const savedOrder = await AsyncStorage.getItem(STORAGE_KEY_ROUTE_ORDER);
      const routeOrder: string[] = savedOrder ? JSON.parse(savedOrder) : [];

      // Create route groups
      const groups: RouteGroup[] = Object.entries(routeMap)
        .map(([routeName, wells]) => ({
          routeName,
          color: wells[0]?.routeColor || getRouteColor(routeName),
          wells,
          expanded: expanded[routeName] ?? true, // Default to expanded
          totalWells: totalWellsPerRoute[routeName] || wells.length,
        }));

      // Sort by saved order, new routes go to end alphabetically
      groups.sort((a, b) => {
        const aIndex = routeOrder.indexOf(a.routeName);
        const bIndex = routeOrder.indexOf(b.routeName);
        
        // Both in saved order - use saved positions
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        // Only a is in saved order - a comes first
        if (aIndex !== -1) return -1;
        // Only b is in saved order - b comes first
        if (bIndex !== -1) return 1;
        // Neither in saved order - alphabetical
        return a.routeName.localeCompare(b.routeName);
      });

      setRouteGroups(groups);
      setExpandedStates(expanded);
    } catch (error) {
      console.error("[Summary] Error loading data:", error);
    }
    setIsLoading(false);
    setIsRefreshing(false);
  }, [loadExpandedStates]);

  // Reload on focus - load saved load size, reset sliders to defaults
  // Load saved slider settings on focus
  useFocusEffect(
    useCallback(() => {
      // Load saved slider positions and mode
      const loadSliderSettings = async () => {
        const [savedFeet, savedHours, savedMode, savedSize] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_SLIDER_FEET),
          AsyncStorage.getItem(STORAGE_KEY_SLIDER_HOURS),
          AsyncStorage.getItem(STORAGE_KEY_SLIDER_MODE),
          AsyncStorage.getItem(STORAGE_KEY_LOAD_SIZE),
        ]);

        if (savedFeet) {
          const feet = parseFloat(savedFeet);
          if (!isNaN(feet)) setSliderFeet(feet);
        }
        if (savedHours) {
          const hours = parseFloat(savedHours);
          if (!isNaN(hours)) setSliderHours(hours);
        }
        if (savedMode === 'feet' || savedMode === 'time') {
          setSliderMode(savedMode);
        }
        if (savedSize) {
          const size = parseInt(savedSize, 10);
          if (!isNaN(size) && size > 0) {
            setPullBbls(size);
            setPullBblsInput(String(size));
          }
        }
      };

      loadSliderSettings();
      loadSummaryData();
    }, [loadSummaryData])
  );

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (sliderLockTimerRef.current) clearTimeout(sliderLockTimerRef.current);
    };
  }, []);

  // Reset the auto-lock timer (called on any slider interaction when unlocked)
  const resetSliderLockTimer = () => {
    if (sliderLockTimerRef.current) {
      clearTimeout(sliderLockTimerRef.current);
    }
    sliderLockTimerRef.current = setTimeout(() => {
      setSliderLocked(true);
    }, SLIDER_LOCK_DELAY);
  };

  // Handle tap on slider overlay - double tap to unlock
  const handleSliderOverlayTap = () => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
      // Double tap - unlock the slider
      setSliderLocked(false);
      resetSliderLockTimer();
      // Reset tap time to prevent triple-tap issues
      lastTapTimeRef.current = 0;
    }
  };

  // Handle slider touch start - cancel any pending lock timer
  const handleSlidingStart = () => {
    if (sliderLockTimerRef.current) {
      clearTimeout(sliderLockTimerRef.current);
      sliderLockTimerRef.current = null;
    }
  };

  // Handle sliding complete - start the lock timer only when released
  const handleSlidingComplete = () => {
    resetSliderLockTimer();
  };

  // Save slider feet
  const handleSliderFeetChange = (value: number) => {
    setSliderFeet(value);
    AsyncStorage.setItem(STORAGE_KEY_SLIDER_FEET, String(value));
  };

  // Save slider hours
  const handleSliderHoursChange = (value: number) => {
    setSliderHours(value);
    AsyncStorage.setItem(STORAGE_KEY_SLIDER_HOURS, String(value));
  };

  // Save slider mode
  const handleSliderModeChange = (mode: 'feet' | 'time') => {
    setSliderMode(mode);
    AsyncStorage.setItem(STORAGE_KEY_SLIDER_MODE, mode);
  };

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadSummaryData();
  }, [loadSummaryData]);

  // Handle well row tap - single tap expands, double tap navigates
  const handleWellPress = (wellName: string) => {
    const now = Date.now();
    const lastTap = wellTapTimeRef.current[wellName] || 0;
    const timeSinceLastTap = now - lastTap;
    wellTapTimeRef.current[wellName] = now;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
      // Double tap - navigate to well
      wellTapTimeRef.current[wellName] = 0; // Reset to prevent triple-tap
      AsyncStorage.setItem('@wellbuilt_jump_to_well', wellName);
      router.back();
    } else {
      // Single tap - toggle expand/collapse
      setExpandedWell(prev => prev === wellName ? null : wellName);
    }
  };

  const toggleRouteExpanded = async (routeName: string) => {
    const newExpanded = { ...expandedStates, [routeName]: !(expandedStates[routeName] ?? true) };
    setExpandedStates(newExpanded);
    await saveExpandedStates(newExpanded);
    
    setRouteGroups(prev => prev.map(r => 
      r.routeName === routeName ? { ...r, expanded: !r.expanded } : r
    ));
  };

  const handlePullBblsChange = (text: string) => {
    setPullBblsInput(text);
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > 0) {
      setPullBbls(num);
    }
  };

  const handlePullBblsBlur = () => {
    // Reset to valid value if input is invalid
    const num = parseInt(pullBblsInput, 10);
    if (isNaN(num) || num <= 0) {
      setPullBblsInput(String(pullBbls));
    } else {
      // Save the valid load size to persist across screens
      AsyncStorage.setItem(STORAGE_KEY_LOAD_SIZE, String(num));
    }
    Keyboard.dismiss();
  };

  // Format flow rate minutes to compact display (e.g., "3:40/ft" or "76min/ft")
  const formatFlowRateCompact = (flowRateMinutes: number): string => {
    if (flowRateMinutes <= 0) return '--';
    if (flowRateMinutes >= 60) {
      const hours = Math.floor(flowRateMinutes / 60);
      const mins = Math.round(flowRateMinutes % 60);
      return `${hours}:${mins.toString().padStart(2, '0')}/ft`;
    }
    return `${Math.round(flowRateMinutes)}min/ft`;
  };

  // Calculate BBLs available above load line
  const getBblsAvailable = (well: WellSummaryData): number => {
    const currentLevel = getCurrentLevel(well);
    const feetAboveLoadLine = Math.max(0, currentLevel - well.loadLine);
    // 20 bbl per foot per tank
    return Math.round(feetAboveLoadLine * 20 * well.numTanks);
  };

  // Render well row with calculated values
  const renderWellRow = (well: WellSummaryData) => {
    const currentLevel = getCurrentLevel(well);
    const readyLevel = getReadyLevel(well, pullBbls);
    const isReady = currentLevel >= readyLevel;
    const isExpanded = expandedWell === well.wellName;

    // For ready time: if already ready, show WHEN it became ready (frozen time)
    // If not ready yet, show when it WILL be ready (future time)
    let readyTime: Date | null;
    if (isReady) {
      readyTime = getTimeWhenBecameReady(well, readyLevel);
    } else {
      readyTime = getTimeAtLevel(well, readyLevel);
    }

    let atParts: { time: string; date: string };
    if (sliderMode === 'feet') {
      const targetTime = getTimeAtLevel(well, sliderFeet);
      if (well.isDown || !targetTime) {
        atParts = { time: '--', date: '' };
      } else {
        atParts = formatDateTimeSplit(targetTime);
      }
    } else {
      const levelAtTime = getLevelAtTime(well, sliderHours);
      atParts = { time: well.isDown ? '--' : formatFeetInches(levelAtTime), date: '' };
    }

    let readyParts: { time: string; date: string };
    if (well.isDown) {
      readyParts = { time: t('summary.down'), date: '' };
    } else if (readyTime) {
      readyParts = formatDateTimeSplit(readyTime);
    } else {
      readyParts = { time: '--', date: '' };
    }

    // Detail row values
    const tanksText = `${well.numTanks} tank${well.numTanks !== 1 ? 's' : ''}`;
    const bblsAvailable = getBblsAvailable(well);
    const bblsText = `${bblsAvailable} bbl`;
    const flowText = formatFlowRateCompact(well.flowRateMinutes);

    return (
      <TouchableOpacity
        key={well.wellName}
        style={[
          styles.wellRow,
          well.isDown && styles.wellRowDown,
          isExpanded && styles.wellRowExpanded,
        ]}
        onPress={() => handleWellPress(well.wellName)}
        activeOpacity={0.7}
      >
        {/* Main row */}
        <View style={styles.wellRowMain}>
          <Text
            style={[styles.wellText, styles.colWell, well.isDown && styles.textDown]}
            numberOfLines={1}
          >
            {well.wellName}
          </Text>
          <Text style={[styles.wellText, styles.colLevel, well.isDown && styles.textDown]}>
            {formatFeetInches(currentLevel)}
          </Text>
          <View style={[styles.colAt, styles.colTwoLine]}>
            <Text style={[styles.wellText, well.isDown && styles.textDown]} numberOfLines={1}>
              {atParts.time}
            </Text>
            {atParts.date ? (
              <Text style={[styles.dateSubText, well.isDown && styles.textDown]}>{atParts.date}</Text>
            ) : null}
          </View>
          <View style={[styles.colReady, styles.colTwoLine, { alignItems: 'flex-end' }]}>
            <Text
              style={[
                styles.wellText,
                well.isDown && styles.textDown,
                isReady && !well.isDown && styles.textReady,
              ]}
              numberOfLines={1}
            >
              {readyParts.time}
            </Text>
            {readyParts.date ? (
              <Text style={[styles.dateSubText, well.isDown && styles.textDown, isReady && !well.isDown && styles.textReady]}>
                {readyParts.date}
              </Text>
            ) : null}
          </View>
        </View>
        {/* Compact detail row (always visible) */}
        <View style={styles.wellRowDetail}>
          <Text style={styles.detailText}>
            {tanksText} • {bblsText} • {flowText}
          </Text>
        </View>
        {/* Expanded details */}
        {isExpanded && (() => {
          // Calculate flow rates
          // flowRateMinutes = minutes per 1 foot of rise
          // 1" flow = 1' flow / 12
          const oneInchMins = well.flowRateMinutes / 12;
          const formatOneInchFlow = (mins: number): string => {
            if (mins <= 0) return '--';
            const hours = Math.floor(mins / 60);
            const m = Math.floor(mins % 60);
            const secs = Math.round((mins % 1) * 60);
            if (hours > 0) return `${hours}h ${m}m ${secs}s`;
            if (m > 0) return `${m}m ${secs}s`;
            return `${secs}s`;
          };
          const oneInchFlow = formatOneInchFlow(oneInchMins);

          // Format 1' flow with full h/m/s format
          const formatOneFootFlow = (mins: number): string => {
            if (mins <= 0) return '--';
            const hours = Math.floor(mins / 60);
            const m = Math.floor(mins % 60);
            const secs = Math.round((mins % 1) * 60);
            if (hours > 0) return `${hours}h ${m}m ${secs}s`;
            if (m > 0) return `${m}m ${secs}s`;
            return `${secs}s`;
          };
          const oneFootFlow = formatOneFootFlow(well.flowRateMinutes);

          // Calculate BBL production rates
          // Use window-averaged from Cloud Function (matches main screen), fall back to AFR
          const bblPerFoot = 20 * well.numTanks;
          const afrBblPerDay = well.flowRateMinutes > 0
            ? Math.round((60 / well.flowRateMinutes) * bblPerFoot * 24)
            : 0;
          const bblPerDay = well.windowBblsDay > 0 ? well.windowBblsDay : afrBblPerDay;
          const bblPerHour = bblPerDay > 0 ? bblPerDay / 24 : 0;

          return (
          <View style={styles.expandedSection}>
            <View style={styles.expandedGrid}>
              {/* Row 1: Current Level | Ready Level */}
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.currentLevel')}</Text>
                <Text style={styles.expandedValue}>{formatFeetInches(currentLevel)}</Text>
              </View>
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.readyLevel')}</Text>
                <Text style={styles.expandedValue}>{formatFeetInches(readyLevel)}</Text>
              </View>
              {/* Row 2: BBLs Available | Tanks */}
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.bblsAvailable')}</Text>
                <Text style={styles.expandedValue}>{bblsAvailable}</Text>
              </View>
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.tanks')}</Text>
                <Text style={styles.expandedValue}>{well.numTanks}</Text>
              </View>
              {/* Row 3: 1" Flow | 1' Flow */}
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.oneInchFlow')}</Text>
                <Text style={styles.expandedValue}>{oneInchFlow}</Text>
              </View>
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.oneFootFlow')}</Text>
                <Text style={styles.expandedValue}>{oneFootFlow}</Text>
              </View>
              {/* Row 4: BBL/hr | BBL/day */}
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.bblPerHr')}</Text>
                <Text style={styles.expandedValue}>{bblPerHour.toFixed(1)}</Text>
              </View>
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.bblPerDay')}</Text>
                <Text style={styles.expandedValue}>{Math.round(bblPerDay)}</Text>
              </View>
              {/* Row 5: Load Line | Allowed Bottom */}
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.loadLine')}</Text>
                <Text style={styles.expandedValue}>{formatFeetInches(well.loadLine)}</Text>
              </View>
              <View style={styles.expandedItem}>
                <Text style={styles.expandedLabel}>{t('summaryExpanded.allowedBottom')}</Text>
                <Text style={styles.expandedValue}>{formatFeetInches(well.allowedBottom)}</Text>
              </View>
            </View>
            <Text style={styles.expandedHint}>{t('summaryExpanded.doubleTapHint')}</Text>
          </View>
        );
        })()}
      </TouchableOpacity>
    );
  };

  // Sort wells by ready time (for current display)
  // Wells already ready sort first (by how long ago they became ready - earliest first)
  // Then wells not yet ready (by when they will become ready - soonest first)
  const getSortedWells = (wells: WellSummaryData[]): WellSummaryData[] => {
    return [...wells].sort((a, b) => {
      // Down wells go to bottom
      if (a.isDown && !b.isDown) return 1;
      if (!a.isDown && b.isDown) return -1;
      if (a.isDown && b.isDown) return a.wellName.localeCompare(b.wellName);

      const readyLevelA = getReadyLevel(a, pullBbls);
      const readyLevelB = getReadyLevel(b, pullBbls);
      const currentLevelA = getCurrentLevel(a);
      const currentLevelB = getCurrentLevel(b);
      const aIsReady = currentLevelA >= readyLevelA;
      const bIsReady = currentLevelB >= readyLevelB;

      // Ready wells come before not-ready wells
      if (aIsReady && !bIsReady) return -1;
      if (!aIsReady && bIsReady) return 1;

      if (aIsReady && bIsReady) {
        // Both ready - sort by when they became ready (earliest first)
        const timeA = getTimeWhenBecameReady(a, readyLevelA);
        const timeB = getTimeWhenBecameReady(b, readyLevelB);
        if (!timeA && !timeB) return a.wellName.localeCompare(b.wellName);
        if (!timeA) return 1;
        if (!timeB) return -1;
        return timeA.getTime() - timeB.getTime(); // Earlier time = smaller = first
      }

      // Neither ready - sort by when they will be ready (soonest first)
      const timeA = getTimeAtLevel(a, readyLevelA);
      const timeB = getTimeAtLevel(b, readyLevelB);
      if (!timeA && !timeB) return a.wellName.localeCompare(b.wellName);
      if (!timeA) return 1;
      if (!timeB) return -1;
      return timeA.getTime() - timeB.getTime();
    });
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>{t('summary.loading')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('summary.title')}</Text>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Controls row - Load Size and Mode Toggle */}
      <View style={styles.controlsRow}>
        <View style={styles.pullBblsGroup}>
          <Text style={styles.pullBblsLabel}>{t('summary.loadSize')}</Text>
          <TextInput
            style={styles.pullBblsInput}
            value={pullBblsInput}
            onChangeText={handlePullBblsChange}
            onBlur={handlePullBblsBlur}
            keyboardType="number-pad"
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={handlePullBblsBlur}
          />
          <Text style={styles.pullBblsUnit}>{t('summary.bbl')}</Text>
        </View>
        
        {/* Mode toggle */}
        <View style={styles.modeToggleContainer}>
          <Text style={styles.modeToggleLabel}>@</Text>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeButton, sliderMode === 'feet' && styles.modeButtonActive]}
              onPress={() => handleSliderModeChange('feet')}
            >
              <Text style={[styles.modeButtonText, sliderMode === 'feet' && styles.modeButtonTextActive]}>{t('summary.modeFeet')}</Text>
            </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, sliderMode === 'time' && styles.modeButtonActive]}
            onPress={() => handleSliderModeChange('time')}
          >
            <Text style={[styles.modeButtonText, sliderMode === 'time' && styles.modeButtonTextActive]}>{t('summary.modeTime')}</Text>
          </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Scrollable content with routes */}
      {routeGroups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('summary.noWellsSelected')}</Text>
          <Text style={styles.emptySubtext}>
            {t('summary.goToSettings')}
          </Text>
        </View>
      ) : (
        <GestureHandlerRootView style={styles.scrollView}>
          <DraggableFlatList
            data={routeGroups}
            keyExtractor={(item) => item.routeName}
            onDragEnd={() => {}}
            activationDistance={999}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor="#60A5FA"
                colors={["#60A5FA"]}
              />
            }
            renderItem={({ item: route }: RenderItemParams<RouteGroup>) => (
              <View style={styles.routeSection}>
                {/* Route header */}
                <TouchableOpacity
                  style={styles.routeHeader}
                  onPress={() => toggleRouteExpanded(route.routeName)}
                >
                  <View style={[styles.routeColorBar, { backgroundColor: route.color }]} />
                  <Text style={styles.routeExpandIcon}>
                    {route.expanded ? 'v' : '>'}
                  </Text>
                  <Text style={[styles.routeName, { color: route.color }]}>{route.routeName}</Text>
                  <Text style={styles.routeCount}>
                    ({route.wells.length}/{route.totalWells})
                  </Text>
                </TouchableOpacity>

                {/* Wells table */}
                {route.expanded && (
                  <>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableHeaderText, styles.colWell]}>{t('summary.columnWell')}</Text>
                      <Text style={[styles.tableHeaderText, styles.colLevel]}>{t('summary.columnLevel')}</Text>
                      <Text style={[styles.tableHeaderText, styles.colAt]}>
                        @ {sliderMode === 'feet'
                          ? formatFeetInches(sliderFeet)
                          : formatDateTime(new Date(Date.now() + sliderHours * 60 * 60 * 1000))
                        }
                      </Text>
                      <Text style={[styles.tableHeaderText, styles.colReady]}>{t('summary.columnReady')}</Text>
                    </View>
                    {getSortedWells(route.wells).map(renderWellRow)}
                  </>
                )}
              </View>
            )}
          />
        </GestureHandlerRootView>
      )}

      {/* Footer slider */}
      <View style={styles.sliderFooter}>
        <View style={styles.sliderLabelRow}>
          <Text style={styles.sliderEndLabelLeft}>
            {sliderMode === 'feet' ? formatFeetInches(MIN_SLIDER_FEET) : t('summary.now')}
          </Text>
          <Text style={styles.sliderValueLabel}>
            @ {sliderMode === 'feet'
              ? formatFeetInches(sliderFeet)
              : formatDateTime(new Date(Date.now() + sliderHours * 60 * 60 * 1000))
            }
          </Text>
          <Text style={styles.sliderEndLabelRight}>
            {sliderMode === 'feet' ? `${MAX_SLIDER_FEET}'` : `+${MAX_SLIDER_HOURS}h`}
          </Text>
        </View>
        <View style={styles.sliderContainer}>
          <View pointerEvents={sliderLocked ? "none" : "auto"}>
            <Slider
              value={sliderMode === 'feet' ? sliderFeet : sliderHours}
              onValueChange={(val) => {
                if (sliderMode === 'feet') {
                  handleSliderFeetChange(val[0]);
                } else {
                  handleSliderHoursChange(val[0]);
                }
              }}
              onSlidingStart={handleSlidingStart}
              onSlidingComplete={handleSlidingComplete}
              minimumValue={sliderMode === 'feet' ? MIN_SLIDER_FEET : MIN_SLIDER_HOURS}
              maximumValue={sliderMode === 'feet' ? MAX_SLIDER_FEET : MAX_SLIDER_HOURS}
              step={sliderMode === 'feet' ? 0.25 : 0.25}  // 3" for feet, 15 min for hours
              minimumTrackTintColor={sliderLocked ? "#374151" : "#2563EB"}
              maximumTrackTintColor="#374151"
              containerStyle={styles.slider}
              trackStyle={styles.sliderTrack}
              renderThumbComponent={() => (
                <View style={[styles.sliderThumb, sliderLocked && styles.sliderThumbLocked]}>
                  {sliderLocked && <Text style={styles.lockIcon}>🔒</Text>}
                </View>
              )}
            />
          </View>
          {/* Overlay to handle double-tap unlock when locked */}
          {sliderLocked && (
            <Pressable
              onPress={handleSliderOverlayTap}
              style={styles.sliderOverlay}
            />
          )}
        </View>
        {/* Unlock hint - always show but invisible when unlocked to keep consistent height */}
        <Text style={[styles.unlockHint, !sliderLocked && styles.unlockHintHidden]}>
          {t('summary.doubleTapUnlock')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060B",
    // paddingTop is applied dynamically via insets.top
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: hp("1.8%"),
    color: "#9CA3AF",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: wp("4%"),
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
  },
  modeToggleContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  modeToggleLabel: {
    fontSize: hp("1.8%"),
    color: "#9CA3AF",
    fontWeight: "600",
    marginRight: spacing.sm,
  },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: 6,
    overflow: "hidden",
  },
  modeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  modeButtonActive: {
    backgroundColor: "#2563EB",
  },
  modeButtonText: {
    fontSize: hp("1.6%"),
    color: "#6B7280",
    fontWeight: "600",
  },
  modeButtonTextActive: {
    color: "#FFFFFF",
  },
  settingsButton: {
    padding: spacing.xs,
  },
  settingsIcon: {
    fontSize: hp("2.2%"),
    color: "#9CA3AF",
  },
  editButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.xs,
  },
  editButtonText: {
    fontSize: hp("1.6%"),
    color: "#60A5FA",
    fontWeight: "600",
  },
  editButtonTextActive: {
    color: "#22C55E",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: wp("4%"),
    paddingVertical: spacing.sm,
    backgroundColor: "#111827",
    marginHorizontal: wp("4%"),
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  pullBblsGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  pullBblsLabel: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    marginRight: spacing.sm,
  },
  pullBblsInput: {
    fontSize: hp("1.8%"),
    color: "#F9FAFB",
    fontWeight: "600",
    backgroundColor: "#1F2937",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 60,
    textAlign: "center",
  },
  pullBblsUnit: {
    fontSize: hp("1.6%"),
    color: "#6B7280",
    marginLeft: spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: wp("3%"),
    paddingBottom: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: hp("20%"),
  },
  emptyText: {
    fontSize: hp("2%"),
    color: "#9CA3AF",
    marginBottom: spacing.sm,
  },
  emptySubtext: {
    fontSize: hp("1.6%"),
    color: "#6B7280",
  },
  routeSection: {
    marginBottom: spacing.md,
  },
  routeSectionDragging: {
    opacity: 0.9,
    shadowColor: "#60A5FA",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    marginBottom: spacing.xs,
  },
  routeHeaderDragging: {
    backgroundColor: "#2563EB",
  },
  dragHandle: {
    paddingRight: spacing.sm,
  },
  dragHandleText: {
    fontSize: hp("2%"),
    color: "#9CA3AF",
  },
  routeColorBar: {
    width: 4,
    height: hp("2.5%"),
    borderRadius: 2,
    marginRight: spacing.sm,
  },
  routeName: {
    fontSize: hp("1.8%"),
    color: "#F9FAFB",
    fontWeight: "600",
    flex: 1,
  },
  routeExpandIcon: {
    fontSize: hp("1.4%"),
    color: "#9CA3AF",
    marginRight: spacing.sm,
    width: hp("2%"),
  },
  routeCount: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  tableHeaderText: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    fontWeight: "500",
  },
  colWell: {
    flex: 1.8,
  },
  colLevel: {
    flex: 1,
    textAlign: "center",
  },
  colAt: {
    flex: 1.5,
    textAlign: "center",
  },
  colReady: {
    flex: 1.5,
    textAlign: "right",
  },
  colTwoLine: {
    alignItems: "center",
    justifyContent: "center",
  },
  dateSubText: {
    fontSize: hp("1.1%"),
    color: "#9CA3AF",
    marginTop: 1,
  },
  wellRow: {
    flexDirection: "column",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  wellRowMain: {
    flexDirection: "row",
    alignItems: "center",
  },
  wellRowDetail: {
    flexDirection: "row",
    paddingTop: 4,
    paddingLeft: spacing.xs,
  },
  wellRowDown: {
    backgroundColor: "rgba(127, 29, 29, 0.2)",
  },
  wellRowExpanded: {
    backgroundColor: "#111827",
    borderLeftWidth: 3,
    borderLeftColor: "#2563EB",
  },
  wellText: {
    fontSize: hp("1.5%"),
    color: "#E5E7EB",
  },
  detailText: {
    fontSize: hp("1.2%"),
    color: "#6B7280",
  },
  textDown: {
    color: "#6B7280",
  },
  textReady: {
    color: "#22C55E",
    fontWeight: "600",
  },
  expandedSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  expandedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  expandedItem: {
    width: "50%",
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  expandedLabel: {
    fontSize: hp("1.1%"),
    color: "#6B7280",
    textAlign: "center",
  },
  expandedValue: {
    fontSize: hp("1.4%"),
    color: "#E5E7EB",
    fontWeight: "500",
    marginTop: 2,
    textAlign: "center",
  },
  expandedValueDown: {
    color: "#EF4444",
  },
  expandedHint: {
    fontSize: hp("1.1%"),
    color: "#4B5563",
    textAlign: "center",
    marginTop: spacing.sm,
    fontStyle: "italic",
  },
  sliderFooter: {
    backgroundColor: "#05060B",
    paddingHorizontal: wp("5%"),
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? hp("4%") : hp("8%"),
  },
  sliderLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sliderEndLabelLeft: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
    width: 40,
    textAlign: "left",
  },
  sliderEndLabelRight: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
    width: 40,
    textAlign: "right",
  },
  sliderValueLabel: {
    fontSize: hp("1.8%"),
    color: "#60A5FA",
    fontWeight: "600",
    textAlign: "center",
  },
  sliderContainer: {
    position: "relative",
  },
  slider: {
    width: "100%",
    height: Platform.OS === 'android' ? 54 : 48,
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
  },
  sliderThumb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#60A5FA",
    justifyContent: "center",
    alignItems: "center",
  },
  sliderThumbLocked: {
    backgroundColor: "#4B5563",
  },
  lockIcon: {
    fontSize: 18,
  },
  sliderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  unlockHint: {
    fontSize: hp("1.3%"),
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: spacing.md,
  },
  unlockHintHidden: {
    opacity: 0,
  },
});

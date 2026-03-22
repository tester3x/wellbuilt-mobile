import { Slider } from '@miblanchard/react-native-slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  ViewToken,
} from 'react-native';
import { GestureHandlerRootView, TapGestureHandler, State } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { manualRefresh, onSyncStatusChange, startBackgroundSync, stopBackgroundSync, syncFromProcessedFolder } from '../../src/services/backgroundSync';
// Response processing handled entirely by backgroundSync
// Drain animation plays for visual feedback; backgroundSync saves snapshot and clears pending
import { getWellConfig, WellConfig, loadWellConfig, fetchDriverRouteAssignment, filterWellConfigByAssignment } from '../../src/services/wellConfig';
import {
  getLevelSnapshot,
  getPendingPull,
  getSliderPosition,
  getWellPull,
  LevelSnapshot,
  PendingPull,
  saveSliderPosition,
  WellPullRecord
} from '../../src/services/wellHistory';
import { getTankDimensions, hp, isTablet, spacing, wp } from '../../src/ui/layout';
import { useAppAlert } from '../../components/AppAlert';
import { debugLog, autoFlushIfNeeded } from '../../src/services/debugLog';
import { isCurrentUserViewer } from '../../src/services/driverAuth';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// Get responsive tank dimensions based on device type
const tankDims = getTankDimensions();
const WellBuiltTankFrame = require('../../assets/images/WellBuilt_TankFrame_v2.png');
const XdownOverlay = require('../../assets/images/Xdown.png');

// Well config map interface
interface WellConfigMap {
  [wellName: string]: WellConfig;
}

// Fetch well_config from Firebase (via wellConfig service)
// Uses cached version by default - only fetches from Firebase if cache is stale (3+ days)
async function fetchWellConfigMap(forceRefresh: boolean = false): Promise<WellConfigMap | null> {
  try {
    const config = await loadWellConfig(forceRefresh);
    if (config) {
      console.log("[Main] Loaded", Object.keys(config).length, "wells from config");
    }
    return config;
  } catch (error) {
    console.error("[Main] Error fetching well config:", error);
    return null;
  }
}

const STORAGE_KEY_LAST_WELL = '@wellbuilt_last_well_index';
const STORAGE_KEY_SELECTED_WELLS = 'wellbuilt_selected_wells';
const STORAGE_KEY_ROUTE_ORDER = 'wellbuilt_route_order';
const STORAGE_KEY_LOAD_SIZE = 'wellbuilt_load_size';
const STORAGE_KEY_LAST_GOOD_WELLS = '@wellbuilt_last_good_wells';
const FULL_TANK_FEET = 20;
const DROP_ANIMATION_MS = 2000;  // 2 seconds drain animation (Firebase responds in 1-3s)
// REMOVED: const POLL_INTERVAL_MS = 3000; // No more polling! Using Firebase listeners now
const LIVE_UPDATE_MS = 30000;    // Update level estimate every 30 seconds
// Removed: RESPONSE_TIMEOUT_MS - no longer waiting for responses

// Tank dimensions - responsive based on device type (phone vs tablet)
const TANK_WIDTH = tankDims.tankWidth;
const TANK_HEIGHT = tankDims.tankHeight;
const INTERIOR_LEFT = tankDims.interiorLeft;
const INTERIOR_RIGHT = tankDims.interiorRight;
const INTERIOR_TOP = tankDims.interiorTop;
const INTERIOR_BOTTOM = tankDims.interiorBottom;
const INTERIOR_HEIGHT = tankDims.interiorHeight;
const NUMBER_OFFSET = isTablet ? TANK_HEIGHT * 0.025 : SCREEN_HEIGHT * 0.015;

// Responsive font sizing - tablets get scaled down to prevent oversized text
const scaledFont = (phoneSize: number): number => {
  if (isTablet) {
    // On tablets, use a maximum cap and reduce the multiplier
    return Math.round(Math.min(phoneSize * SCREEN_HEIGHT * 0.6, phoneSize * 800));
  }
  return Math.round(phoneSize * SCREEN_HEIGHT);
};

const clampFraction = (n: number) => Math.min(Math.max(n, 0), 1);

import { getRouteColor } from '../../src/services/routeColor';

const isWellDown = (raw: unknown): boolean => {
  const str = String(raw ?? '').trim().toLowerCase();
  return str === 'down' || str === 'offline' || str === 'shut in';
};

const parseFeet = (raw: unknown): number => {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  const str = String(raw ?? '').trim();
  if (!str || isWellDown(str)) return 0;
  const feetInchMatch = str.match(/^(\d+)\s*'\s*(\d+)"?$/);
  if (feetInchMatch) {
    return Number(feetInchMatch[1]) + Number(feetInchMatch[2]) / 12;
  }
  const asNumber = Number(str.replace(/[^0-9.+-]/g, ''));
  return Number.isNaN(asNumber) ? 0 : asNumber;
};

const formatFeetInches = (feet: number | null | undefined): string => {
  if (feet == null || Number.isNaN(feet)) return '';
  // Always floor - matches packet level sent to VBA for consistent display
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  // Omit inches if zero for cleaner display (e.g., "3'" not "3'0"")
  if (inches === 0) return `${ft}'`;
  return `${ft}'${inches}"`;  // No space: 1'4" not 1' 4"
};

const formatDateTime = (date: Date, todayStr: string = 'Today', tomorrowStr: string = 'Tomorrow'): string => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;

  if (isToday) return `${todayStr} ${timeStr}`;
  if (isTomorrow) return `${tomorrowStr} ${timeStr}`;
  return `${(date.getMonth() + 1)}/${date.getDate()} ${timeStr}`;
};

// Format with day suffix instead of prefix: "7:21 AM Tomorrow"
const formatDateTimeSuffix = (date: Date, todayStr: string = 'Today', tomorrowStr: string = 'Tomorrow'): string => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;

  if (isToday) return `${timeStr} ${todayStr}`;
  if (isTomorrow) return `${timeStr} ${tomorrowStr}`;
  return `${timeStr} ${(date.getMonth() + 1)}/${date.getDate()}`;
};

const calculateOneInchFlow = (oneFootFlowMins: number): string => {
  if (oneFootFlowMins <= 0) return 'N/A';
  const oneInchMins = oneFootFlowMins / 12;

  // Convert to total seconds first to avoid rounding issues
  const totalSeconds = Math.round(oneInchMins * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

// Convert "3:34:22" to "3h 34m 22s" format
const formatFlowRate = (flowRate: string): string => {
  if (!flowRate || flowRate === 'N/A' || flowRate === 'Unknown') return 'N/A';
  const parts = flowRate.split(':');
  if (parts.length !== 3) return flowRate;
  
  const hours = parseInt(parts[0], 10);
  const mins = parseInt(parts[1], 10);
  const secs = parseInt(parts[2], 10);
  
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

// Parse flow rate string "H:MM:SS" to minutes
const parseFlowRateToMinutes = (flowRate: string): number => {
  if (!flowRate || flowRate === 'N/A' || flowRate === 'Unknown') return 0;
  const parts = flowRate.split(':').map(Number);
  if (parts.length !== 3) return 0;
  return parts[0] * 60 + parts[1] + parts[2] / 60;
};

// Individual well view component - memoized to prevent re-renders
interface WellViewProps {
  wellName: string;
  isActive: boolean;
  getPreviousLevel: () => number; // Getter for previous well's level (0-1)
  onLevelChange?: (level: number) => void; // Report current level to parent
  refreshTrigger?: number; // Triggers data reload after sync
  onSliderActiveChange?: (active: boolean) => void; // Block FlatList scroll during slider use
  loadBbls?: number; // Load size in bbls for "next load ready" calculation
  onTankDoubleTap?: () => void; // Navigate to performance screen on tank double-tap
  onTankLongPress?: () => void; // Long press to hide well from My Wells
  showOvernightBbls?: boolean; // Global toggle for overnight vs segment bbls/day
  onToggleOvernightBbls?: () => void; // Toggle handler (persists to AsyncStorage)
}

const WellView = React.memo(function WellView({ wellName, isActive, getPreviousLevel, onLevelChange, refreshTrigger, onSliderActiveChange, loadBbls = 140, onTankDoubleTap, onTankLongPress, showOvernightBbls = false, onToggleOvernightBbls }: WellViewProps) {
  const { t } = useTranslation();
  const [displayFeet, setDisplayFeet] = useState(0);
  const [sliderFeet, setSliderFeet] = useState(10.5);
  const [wellConfig, setWellConfig] = useState<WellConfig | null>(null);
  const [pullRecord, setPullRecord] = useState<WellPullRecord | null>(null);
  // Flow rate now stored in levelSnapshot (not separately cached) to prevent stale values
  const [levelSnapshot, setLevelSnapshot] = useState<LevelSnapshot | null>(null);
  const [wellDown, setWellDown] = useState(false);
  const [lastPullInfo, setLastPullInfo] = useState<{dateTime: string, bbls: number, topLevel?: string, bottomLevel?: string} | null>(null);
  const [targetFraction, setTargetFraction] = useState<number | null>(null);
  const [drainCompleteSignal, setDrainCompleteSignal] = useState(0); // Triggers live update effect after drain finishes
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [sliderUIActive, setSliderUIActive] = useState(false); // Controls slider level/datetime visibility
  const [sliderLocked, setSliderLocked] = useState(true); // Slider locked state
  const [sliderPeeking, setSliderPeeking] = useState(false); // Tap to peek values without unlocking
  // showOvernightBbls is now a prop from MainScreen (global toggle)
  const hasAnimated = useRef(false);
  const prevIsActive = useRef(isActive);
  const sliderInactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef<number>(0); // For double-tap detection on slider
  const lastTankTapTimeRef = useRef<number>(0); // For double-tap detection on tank
  const sliderOpacity = useSharedValue(0); // For fade animation

  // Slider timing constants
  const SLIDER_LOCK_DELAY = 5000; // 5 seconds of inactivity to lock
  const DOUBLE_TAP_DELAY = 300; // Max ms between taps for double-tap
  const PEEK_DURATION = 3000; // 3 seconds to show values on single tap
  
  // Pending pull / waiting state
  const [pendingPull, setPendingPull] = useState<PendingPull | null>(null);
  // Removed: const [isWaiting, setIsWaiting] = useState(false);
  // "Waiting for WellBuilt..." spinner removed - Cloud Functions handle everything now
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // REMOVED: const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null); // No more polling!
  const liveUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animationStartTimeRef = useRef<number>(0); // Track when drop animation started
  const drainAnimationActive = useRef(false); // Prevents live updates from fighting drain animation
  // Removed: waitingForResponseRef - no longer waiting for responses

  // MUST declare waterFraction before effects that use it
  const waterFraction = useSharedValue(0);

  // Handle animation when well becomes active - separate effect to ensure proper ordering
  useEffect(() => {
    // Only trigger when transitioning from inactive to active
    if (isActive && !prevIsActive.current && levelSnapshot) {
      // Calculate current level with flow estimate
      // Formula: currentLevel = bottomLevel + (minutesSincePull / flowRateMinutes)
      const startingLevel = levelSnapshot.lastPullBottomLevelFeet ?? levelSnapshot.levelFeet;
      let currentLevel = startingLevel;
      const flowMins = levelSnapshot.flowRateMinutes ?? wellConfig?.avgFlowRateMinutes ?? 0;
      if (flowMins > 0 && !levelSnapshot.isDown) {
        const minutesSincePull = (Date.now() - levelSnapshot.timestamp) / (1000 * 60);
        currentLevel = Math.min(startingLevel + (minutesSincePull / flowMins), FULL_TANK_FEET);
      }

      const fraction = clampFraction(currentLevel / FULL_TANK_FEET);
      const prevLevel = getPreviousLevel();

      // Start at previous well's level, animate to this well's level
      waterFraction.value = prevLevel;
      waterFraction.value = withTiming(fraction, {
        duration: 800,
        easing: Easing.inOut(Easing.ease),
      });
      hasAnimated.current = true;

      // DON'T reset slider to current level - keep persisted position
      // Slider position is loaded from storage in loadData
    }

    prevIsActive.current = isActive;
  }, [isActive, levelSnapshot, wellConfig, getPreviousLevel, waterFraction, wellName]);

  // Cleanup animations and timers when component unmounts
  // Note: Empty dependency array - only runs on unmount, not on state changes
  // This prevents the watcher from being cancelled while we're actively waiting
  useEffect(() => {
    return () => {
      cancelAnimation(waterFraction);
      cancelAnimation(sliderOpacity);
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      // REMOVED: pollTimerRef cleanup - no more polling!
      if (liveUpdateRef.current) clearInterval(liveUpdateRef.current);
      if (sliderInactivityTimer.current) clearTimeout(sliderInactivityTimer.current);
      if (sliderLockTimerRef.current) clearTimeout(sliderLockTimerRef.current);
    };
  }, []);

  // Separate effect to cancel watcher only on unmount (uses ref to get current value)
  // Removed: cancelWaitForResponse cleanup - no longer waiting for responses

  const updateDisplayFeet = (fraction: number) => {
    setDisplayFeet(fraction * FULL_TANK_FEET);
    // Always report level to parent (so we can track all well levels for animation)
    if (onLevelChange) {
      onLevelChange(fraction);
    }
  };

  useAnimatedReaction(
    () => waterFraction.value,
    (currentFraction) => runOnJS(updateDisplayFeet)(currentFraction),
    [waterFraction]
  );

  // Response processing handled entirely by backgroundSync
  // Drain animation plays for visual feedback; backgroundSync saves snapshot and clears pending

  // Load data and check for pending pull on mount/refresh
  useEffect(() => {
    const loadData = async () => {
      // Clear stale data from previous well immediately to prevent showing wrong well's info
      setLastPullInfo(null);
      // Don't clear levelSnapshot here - it causes flickering. Instead rely on proper loading.

      // Load well config - MUST await since it's async
      const config = await getWellConfig(wellName);
      setWellConfig(config);

      // Load level snapshot (flow rate is now stored with snapshot, not separately)
      const snapshot = await getLevelSnapshot(wellName);

      // Pre-check for pending pull BEFORE setting levelSnapshot.
      // setLevelSnapshot triggers the live update useEffect — if there's a pending pull,
      // we need drainAnimationActive=true BEFORE that effect runs, otherwise
      // the live update starts a competing 500ms animation (the "double animation" bug).
      const pending = await getPendingPull(wellName);
      if (pending) {
        drainAnimationActive.current = true;
      }

      setLevelSnapshot(snapshot);

      // Update well down status from snapshot
      setWellDown(snapshot?.isDown ?? false);

      // Load last pull record
      const pull = await getWellPull(wellName);
      setPullRecord(pull);

      // Calculate bblsPerFoot for level calculations
      const bblsPerFoot = (config?.numTanks ?? 1) * 20;

      // Build lastPullInfo - prefer snapshot data from VBA (has levels directly)
      let lastPullDateTime = '';
      let lastPullBbls = 0;
      let lastPullTopLevel: string | undefined;
      let lastPullBottomLevel: string | undefined;

      // Priority 1: Use levels from snapshot (VBA sends them directly now)
      if (snapshot?.lastPullDateTime) {
        lastPullDateTime = snapshot.lastPullDateTime;
        lastPullBbls = snapshot.lastPullBbls || 0;

        // VBA sends top/bottom levels directly - use them if available
        if (snapshot.lastPullTopLevel && snapshot.lastPullTopLevel !== 'Unknown') {
          lastPullTopLevel = snapshot.lastPullTopLevel;
        }
        if (snapshot.lastPullBottomLevel && snapshot.lastPullBottomLevel !== 'Unknown') {
          lastPullBottomLevel = snapshot.lastPullBottomLevel;
        }
      }

      // Fallback: Calculate from local pull record if VBA levels are missing
      if ((!lastPullTopLevel || !lastPullBottomLevel) && pull) {
        if (!lastPullDateTime) {
          lastPullDateTime = pull.dateTime || '';
        }
        if (!lastPullBbls) {
          lastPullBbls = pull.bblsTaken || 0;
        }
        const bottomLevel = pull.levelFeet;
        const topLevel = bottomLevel + (lastPullBbls / bblsPerFoot);
        lastPullTopLevel = lastPullTopLevel || formatFeetInches(topLevel);
        lastPullBottomLevel = lastPullBottomLevel || formatFeetInches(bottomLevel);
      }

      if (lastPullDateTime) {
        setLastPullInfo({
          dateTime: lastPullDateTime,
          bbls: lastPullBbls,
          topLevel: lastPullTopLevel,
          bottomLevel: lastPullBottomLevel,
        });
      }

      // Load persisted slider position (keeps driver's last setting)
      const savedSliderPos = await getSliderPosition(wellName);
      setSliderFeet(savedSliderPos);

      // Use pending pull from pre-check above (already fetched before setLevelSnapshot)
      if (pending) {
        setPendingPull(pending);

        // Always start drain animation — backgroundSync handles the response:
        // 1. Saves snapshot (saveLevelSnapshot)
        // 2. Clears pending pull (clearPendingPull)
        // 3. Notifies listeners → refreshTrigger bumps → loadData re-runs
        // On re-run, pending is null → falls into else branch below
        const bblPerFoot = (config?.numTanks ?? 1) * 20;
        const topLevel = pending.topLevel || 10;
        const targetLevel = pending.wellDown ? topLevel : Math.max(topLevel - (pending.bblsTaken / bblPerFoot), 0);

        // Calculate how much time has elapsed since submission
        const elapsedMs = Date.now() - pending.timestamp;
        const remainingMs = Math.max(DROP_ANIMATION_MS - elapsedMs, 500);

        // Track animation start time for drain duration calculation
        animationStartTimeRef.current = pending.timestamp;
        drainAnimationActive.current = true;

        if (pending.bblsTaken === 0) {
          // Zero-BBL check pull: animate FROM current displayed level TO new read level
          // Don't reset waterFraction — keep old level as starting point
          waterFraction.value = withTiming(
            clampFraction(topLevel / FULL_TANK_FEET),
            { duration: remainingMs, easing: Easing.linear }
          );
        } else {
          // Normal pull: animate drain from top level down to estimated bottom
          const animationProgress = Math.min(elapsedMs / DROP_ANIMATION_MS, 1);
          const currentAnimatedLevel = topLevel - (animationProgress * (topLevel - targetLevel));
          waterFraction.value = clampFraction(currentAnimatedLevel / FULL_TANK_FEET);
          waterFraction.value = withTiming(
            clampFraction(targetLevel / FULL_TANK_FEET),
            { duration: remainingMs, easing: Easing.linear }
          );
        }

        hasAnimated.current = true;
        setIsLoadingInitial(false);
      } else if (drainAnimationActive.current) {
        // Drain animation still playing but backgroundSync already cleared the pending pull.
        // DON'T touch waterFraction — let the drain finish undisturbed.
        // Just update React state so UI text (level, flow rate, etc.) reflects new data.
        const elapsed = Date.now() - animationStartTimeRef.current;
        const remaining = Math.max(DROP_ANIMATION_MS - elapsed, 0);
        setTimeout(() => {
          drainAnimationActive.current = false;
          animationStartTimeRef.current = 0;
          // Signal live update effect to re-run now that drain is complete
          setDrainCompleteSignal(prev => prev + 1);
        }, remaining + 100); // Wait for drain to finish + small buffer

        // Update targetFraction so live update knows the correct level when it starts
        if (snapshot && snapshot.levelFeet > 0) {
          const startingLevel = snapshot.lastPullBottomLevelFeet ?? snapshot.levelFeet;
          let currentLevel = startingLevel;
          const flowMins = snapshot?.flowRateMinutes ?? config?.avgFlowRateMinutes ?? 0;
          if (flowMins > 0 && !snapshot.isDown) {
            const minutesSincePull = (Date.now() - snapshot.timestamp) / (1000 * 60);
            if (minutesSincePull > 0 && minutesSincePull < 10080) {
              currentLevel = Math.min(startingLevel + (minutesSincePull / flowMins), FULL_TANK_FEET);
            }
          }
          setTargetFraction(clampFraction(currentLevel / FULL_TANK_FEET));
        }
        setIsLoadingInitial(false);
      } else {
        // Normal path: no drain animation, no pending pull
        // Calculate estimated current level from snapshot
        const flowMins = snapshot?.flowRateMinutes ?? config?.avgFlowRateMinutes ?? 0;

        if (snapshot && snapshot.levelFeet > 0) {
          const startingLevel = snapshot.lastPullBottomLevelFeet ?? snapshot.levelFeet;
          let currentLevel = startingLevel;

          if (flowMins > 0 && !snapshot.isDown) {
            const minutesSincePull = (Date.now() - snapshot.timestamp) / (1000 * 60);
            if (minutesSincePull > 0 && minutesSincePull < 10080) {
              currentLevel = Math.min(startingLevel + (minutesSincePull / flowMins), FULL_TANK_FEET);
            }
          }

          const fraction = clampFraction(currentLevel / FULL_TANK_FEET);

          // On initial load (first time mounting), set level directly
          // Animation on swipe is handled by the isActive transition effect
          if (!hasAnimated.current) {
            if (isActive) {
              // Active on first mount - animate from previous well's level
              const prevLevel = getPreviousLevel();
              waterFraction.value = prevLevel;
              waterFraction.value = withTiming(fraction, {
                duration: 800,
                easing: Easing.inOut(Easing.ease),
              });
            } else {
              // Not active yet - just set the value
              waterFraction.value = fraction;
            }
            hasAnimated.current = true;
          }

          setTargetFraction(fraction);
        }
        setIsLoadingInitial(false);
      }
    };
    
    loadData();
  }, [wellName, refreshTrigger, isActive, getPreviousLevel, waterFraction]);

  // Live level update based on flow rate (now stored in levelSnapshot)
  // Formula matches dashboard: currentLevel = bottomLevel + (minutesSincePull / flowRateMinutes)
  // - levelFeet = bottom level after last pull (from lastPullBottomLevel or currentLevel)
  // - timestamp = time of last pull (from lastPullDateTimeUTC)
  // - flowRateMinutes = minutes per foot of rise (AFR)
  useEffect(() => {
    if (!levelSnapshot || wellDown) {
      return;
    }

    // Don't run live updates while drain animation is active (ref avoids re-render cycles)
    if (drainAnimationActive.current) return;

    const flowMins = levelSnapshot.flowRateMinutes ?? 0;
    if (flowMins <= 0) return;

    // Calculate current estimated level
    // Use lastPullBottomLevelFeet if available (more precise), fallback to levelFeet
    const updateEstimate = () => {
      // Skip if drain animation started since this effect was set up
      if (drainAnimationActive.current) return;
      const startingLevel = levelSnapshot.lastPullBottomLevelFeet ?? levelSnapshot.levelFeet;
      const minutesSincePull = (Date.now() - levelSnapshot.timestamp) / (1000 * 60);
      const feetGained = minutesSincePull / flowMins;
      const currentLevel = Math.min(startingLevel + feetGained, FULL_TANK_FEET);
      const fraction = clampFraction(currentLevel / FULL_TANK_FEET);

      // Smoothly update display
      waterFraction.value = withTiming(fraction, {
        duration: 500,
        easing: Easing.linear,
      });
    };

    // Initial update
    updateEstimate();

    // Periodic updates
    liveUpdateRef.current = setInterval(updateEstimate, LIVE_UPDATE_MS);

    return () => {
      if (liveUpdateRef.current) {
        clearInterval(liveUpdateRef.current);
        liveUpdateRef.current = null;
      }
    };
  }, [levelSnapshot, wellDown, waterFraction, drainCompleteSignal]);

  // Reset slider lock timer - call after any slider interaction
  const resetSliderLockTimer = useCallback(() => {
    if (sliderLockTimerRef.current) {
      clearTimeout(sliderLockTimerRef.current);
      sliderLockTimerRef.current = null;
    }
    sliderLockTimerRef.current = setTimeout(() => {
      setSliderLocked(true);
      setSliderPeeking(false);
      sliderOpacity.value = withTiming(0, { duration: 300 });
      setTimeout(() => setSliderUIActive(false), 300);
    }, SLIDER_LOCK_DELAY);
  }, [sliderOpacity]);

  // Slider UI activation - fade in level/datetime
  const activateSliderUI = useCallback(() => {
    // Clear any existing inactivity timer
    if (sliderInactivityTimer.current) {
      clearTimeout(sliderInactivityTimer.current);
      sliderInactivityTimer.current = null;
    }

    // Fade in if not already visible
    if (!sliderUIActive) {
      setSliderUIActive(true);
      sliderOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [sliderUIActive, sliderOpacity]);

  // Handle tap on slider track - single tap to peek, double tap to unlock
  const handleSliderTrackTap = useCallback(() => {
    if (wellDown) return;

    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (sliderLocked) {
      // Check for double-tap to unlock
      if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
        // Double tap - unlock the slider
        setSliderLocked(false);
        setSliderPeeking(false);
        activateSliderUI();
        // Start lock timer immediately
        resetSliderLockTimer();
        // Reset tap time to prevent triple-tap issues
        lastTapTimeRef.current = 0;
      } else {
        // Single tap - peek values without unlocking
        setSliderPeeking(true);
        activateSliderUI();

        // Clear any existing lock timer
        if (sliderLockTimerRef.current) {
          clearTimeout(sliderLockTimerRef.current);
          sliderLockTimerRef.current = null;
        }

        // Auto-hide after peek duration
        sliderLockTimerRef.current = setTimeout(() => {
          setSliderPeeking(false);
          sliderOpacity.value = withTiming(0, { duration: 300 });
          setTimeout(() => setSliderUIActive(false), 300);
        }, PEEK_DURATION);
      }
    } else {
      // Already unlocked - just reset the lock timer
      activateSliderUI();
      resetSliderLockTimer();
    }
  }, [wellDown, sliderLocked, activateSliderUI, resetSliderLockTimer, sliderOpacity]);

  // Handle slider changes with custom snapping
  // Above current: standard 3" grid (10'0", 10'3", 10'6"...)
  // Below current: 3" grid based on current level (auto-adjusts as tank fills)
  const handleSliderChange = useCallback((value: number) => {
    // Calculate dynamic slider minimum
    const literalLoadLine = wellConfig?.loadLine ?? 1.33;
    const allowedBottom = wellConfig?.allowedBottom ?? 3;
    const sliderMin = allowedBottom < literalLoadLine ? allowedBottom : literalLoadLine;

    // Use current displayed level as reference (auto-updates as tank fills)
    const reference = Math.max(sliderMin, Math.min(18, displayFeet));
    let snappedValue: number;

    if (value >= reference) {
      // Above current: snap to standard 3" grid (0.25 ft increments from 0)
      snappedValue = Math.round(value * 4) / 4;
    } else {
      // Below current: snap to 3" grid based on current level
      const diff = reference - value;
      const snappedDiff = Math.round(diff * 4) / 4;
      snappedValue = reference - snappedDiff;
    }

    // Clamp to slider range
    snappedValue = Math.max(sliderMin, Math.min(18, snappedValue));

    setSliderFeet(snappedValue);

    // Save slider position to storage (persists across app restarts)
    saveSliderPosition(wellName, snappedValue);
  }, [displayFeet, wellName, wellConfig]);

  // Handle slider drag start - activate UI, cancel lock timer, and notify parent
  const handleSliderStart = useCallback(() => {
    // Cancel lock timer while sliding
    if (sliderLockTimerRef.current) {
      clearTimeout(sliderLockTimerRef.current);
      sliderLockTimerRef.current = null;
    }
    activateSliderUI();
    onSliderActiveChange?.(true);
  }, [activateSliderUI, onSliderActiveChange]);

  // Handle slider drag end - start lock timer and notify parent
  const handleSliderEnd = useCallback(() => {
    resetSliderLockTimer();
    onSliderActiveChange?.(false);
  }, [resetSliderLockTimer, onSliderActiveChange]);

  // Animated style for slider level/datetime fade
  const sliderInfoStyle = useAnimatedStyle(() => ({
    opacity: sliderOpacity.value,
  }));

  // Calculate display values
  const numTanks = wellConfig?.numTanks ?? 1;
  const currentLevelDisplay = formatFeetInches(displayFeet);
  
  // BBLs per foot based on number of tanks (20 bbl/ft per tank)
  const bblsPerFoot = numTanks * 20;
  
  // Calculate BBLs available (from current level down to load line)
  const loadLine = wellConfig?.loadLine ?? 0;
  const bblsAvailable = Math.max(Math.round((displayFeet - loadLine) * bblsPerFoot), 0);
  
  // Flow rate display (now from levelSnapshot, not separately cached)
  const flowRate = levelSnapshot?.flowRate ?? wellConfig?.avgFlowRate ?? 'N/A';
  const flowMins = levelSnapshot?.flowRateMinutes ?? wellConfig?.avgFlowRateMinutes ?? 0;
  
  const oneInchFlow = calculateOneInchFlow(flowMins);
  
  // BBLs per hour/day — window-averaged (matches history screen), overnight as easter egg
  const windowBblsDay = levelSnapshot?.windowBblsDay ?? 0;
  const overnightBblsDay = levelSnapshot?.overnightBblsDay ?? 0;
  const afrBblsPerDay = flowMins > 0 ? Math.round((60 / flowMins) * bblsPerFoot * 24) : 0;
  const bblsPerDay = windowBblsDay > 0 ? windowBblsDay : afrBblsPerDay; // Prefer window-averaged, fall back to AFR
  const bblsPerHour = bblsPerDay > 0 ? Math.round(bblsPerDay / 24 * 10) / 10 : 0;
  // Easter egg: tap bbls/day to toggle overnight formula
  const displayBblsPerDay = showOvernightBbls && overnightBblsDay > 0 ? overnightBblsDay : bblsPerDay;
  const displayBblsPerHour = displayBblsPerDay > 0 ? Math.round(displayBblsPerDay / 24 * 10) / 10 : 0;
  
  // Ready at calculation
  // Above current level (Fill side): "When will it reach slider level?"
  // Below current level (Pull side): "If I pull to slider level, what level will it be in X hours?"
  //   - Hours forward is based on how much we're pulling (more pull = more hours forward)
  //   - Similar to the hr slider on summary screen

  const MAX_PULL_HOURS = 24; // Max hours to project forward when fully pulled

  let readyAtText = '';
  let isPlanningPull = false;
  let bblsToPull = 0; // BBLs that would be taken if pulling to slider level

  if (wellDown) {
    readyAtText = 'OFFLINE';
  } else if (flowMins <= 0) {
    readyAtText = 'N/A';
  } else if (displayFeet < sliderFeet) {
    // Slider is ABOVE current level (Fill side) - when will tank reach slider level?
    const feetNeeded = sliderFeet - displayFeet;
    const minsNeeded = feetNeeded * flowMins;
    const readyAt = new Date(Date.now() + minsNeeded * 60 * 1000);
    readyAtText = formatDateTimeSuffix(readyAt, t('well.today'), t('well.tomorrow'));
  } else {
    // Slider is AT or BELOW current level (Pull side) - planning a pull
    // Calculate hours forward based on how far we're pulling down
    // The more we pull, the more hours forward we project
    isPlanningPull = true;
    const feetToPull = displayFeet - sliderFeet;
    bblsToPull = Math.round(feetToPull * bblsPerFoot);

    // Calculate hours forward: scale from 0 to MAX_PULL_HOURS based on pull amount
    // Use the ratio of feet pulled to total pullable feet (current level - min level)
    const minLevel = wellConfig?.allowedBottom ?? 1;
    const maxPullableFeet = Math.max(displayFeet - minLevel, 1);
    const pullRatio = Math.min(feetToPull / maxPullableFeet, 1);
    const hoursForward = pullRatio * MAX_PULL_HOURS;

    // Calculate what level the tank will be at after hoursForward
    // Starting from slider level (post-pull), adding flow over time
    const feetGained = (hoursForward * 60) / flowMins;
    const levelAtTime = Math.min(sliderFeet + feetGained, FULL_TANK_FEET);
    const futureTime = new Date(Date.now() + hoursForward * 60 * 60 * 1000);

    // Display: "→ 12' 3" @ 7:00 AM"
    readyAtText = `→ ${formatFeetInches(levelAtTime)} @ ${formatDateTimeSuffix(futureTime, t('well.today'), t('well.tomorrow'))}`;
  }

  // Calculate "Next Pull Ready" - when well reaches ready level, and how many loads available
  // Uses same logic as summary screen: readyLevel = allowedBottom + (loadBbls / bblsPerFoot)
  const calculateNextPullReady = (): { text: string; isReady: boolean; loads: number } => {
    if (wellDown) {
      return { text: t('well.wellIsDown', 'Well is down'), isReady: false, loads: 0 };
    }

    const currentLevel = displayFeet;
    const allowedBottom = wellConfig?.allowedBottom ?? 3;
    const bblFt = bblsPerFoot;

    // Calculate feet needed for one load
    const feetPerLoad = loadBbls / bblFt;
    // Ready level = allowedBottom + feet needed for a load
    const readyLevel = allowedBottom + feetPerLoad;

    // If already at or above ready level, calculate loads available
    if (currentLevel >= readyLevel) {
      // BBLs available = (current - allowedBottom) * bblsPerFoot
      const bblsAvailable = (currentLevel - allowedBottom) * bblFt;
      const loads = loadBbls > 0 ? Math.floor(bblsAvailable / loadBbls) : 1;

      if (loads > 1) {
        return { text: t('well.readyWithLoads', { count: loads, defaultValue: `Ready (${loads})` }), isReady: true, loads };
      }
      return { text: t('well.ready', 'Ready'), isReady: true, loads: 1 };
    }

    // Not ready yet - calculate when
    if (flowMins <= 0) {
      return { text: t('well.noFlowData', 'No flow data'), isReady: false, loads: 0 };
    }

    const feetToGrow = readyLevel - currentLevel;
    const minutesToReady = feetToGrow * flowMins;
    const readyAt = new Date(Date.now() + minutesToReady * 60 * 1000);

    return { text: formatDateTime(readyAt, t('well.today'), t('well.tomorrow')), isReady: false, loads: 0 };
  };

  const nextPullReady = calculateNextPullReady();

  // Animated water styles
  const waterStyle = useAnimatedStyle(() => ({
    height: `${waterFraction.value * 100}%`,
  }));
  
  // Number floats half in/half out of water - positioned from TOP of interior
  const numberStyle = useAnimatedStyle(() => {
    // Water surface is at this distance from TOP of interior
    const waterTop = INTERIOR_HEIGHT * (1 - waterFraction.value);
    // Clamp so number stays visible even at very low/high levels
    const clampedTop = Math.max(INTERIOR_HEIGHT * 0.15, Math.min(INTERIOR_HEIGHT * 0.75, waterTop));
    // Offset to center the number on the water line (half above, half below)
    return { top: clampedTop - NUMBER_OFFSET };
  });
  
  // Waiting message
  // Removed: waitingMessage - no longer showing waiting UI

  // Handle tank tap - double-tap navigates to performance screen
  const handleTankTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTankTapTimeRef.current;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
      // Double-tap detected - navigate to performance
      if (onTankDoubleTap) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onTankDoubleTap();
      }
      lastTankTapTimeRef.current = 0; // Reset to prevent triple-tap
    } else {
      // First tap - just record the time
      lastTankTapTimeRef.current = now;
    }
  }, [onTankDoubleTap]);

  // Handle tank long press - hide well from My Wells
  const handleTankLongPress = useCallback(() => {
    if (onTankLongPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      onTankLongPress();
    }
  }, [onTankLongPress]);

  return (
    <View style={styles.wellView}>
      {/* Top section - tank and stats */}
      <View style={styles.topSection}>
        {/* Tank - double-tap for Performance, long-press to hide well */}
        <View style={styles.tankSection}>
        <Pressable onPress={handleTankTap} onLongPress={handleTankLongPress} delayLongPress={500}>
        <View style={styles.tankOuter}>
          {/* Tank count badge - at BOTTOM right */}
          <View style={styles.tankBadge}>
            <Text style={styles.tankBadgeText}>{numTanks}</Text>
          </View>
          <View style={styles.tankInterior}>
            <View style={styles.waterWrapper}>
              <Animated.View style={[styles.tankWater, waterStyle]} />
            </View>
            
            <Animated.View style={[styles.numberContainer, numberStyle]}>
              <Text style={styles.tankNumber}>{currentLevelDisplay}</Text>
            </Animated.View>
          </View>
          <Image source={WellBuiltTankFrame} style={styles.tankFrame} resizeMode="stretch" />
          
          {/* DOWN overlay - covers full tank */}
          {wellDown && (
            <Image source={XdownOverlay} style={styles.downOverlay} resizeMode="contain" />
          )}
          
          {/* Loading overlay - shows while fetching initial level data */}
          {isLoadingInitial && !wellDown && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#60A5FA" />
              <Text style={styles.loadingOverlayText}>{t('homeExtra.loading')}</Text>
            </View>
          )}
          
          {/* BBLs available */}
          <View style={styles.bblsAvailableContainer}>
            <Text style={styles.bblsAvailableText}>{bblsAvailable} {t('units.bbl')}</Text>
          </View>
        </View>
        </Pressable>
      </View>

      {/* Quick stats */}
      <View style={styles.statsSection}>
        <View style={styles.statsRow}>
          <Text style={styles.statLeft}>{oneInchFlow}{t('units.perInch')}</Text>
          <Text style={styles.statDivider}>•</Text>
          <Text style={styles.statRight}>{formatFlowRate(flowRate)}{t('units.perFoot')}</Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggleOvernightBbls?.();
          }}
        >
          <View style={styles.statsRow}>
            <Text style={styles.statLeft}>{displayBblsPerHour} {t('units.bbl')}{t('units.perHour')}</Text>
            <Text style={styles.statDivider}>•</Text>
            <Text style={styles.statRight}>{displayBblsPerDay} {t('units.bbl')}{t('units.perDay')}{showOvernightBbls && overnightBblsDay > 0 ? ' ON' : ''}</Text>
          </View>
        </Pressable>

        {/* Last pull info - below stats, two lines for readability */}
        {lastPullInfo && lastPullInfo.dateTime && (
          <View style={styles.lastPullContainer}>
            <Text style={styles.lastPullLabel}>{t('well.lastPull')}</Text>
            <Text style={styles.lastPullInfo}>
              {lastPullInfo.dateTime}
              {lastPullInfo.topLevel && lastPullInfo.bottomLevel
                ? ` • ${lastPullInfo.topLevel} → ${lastPullInfo.bottomLevel}`
                : ''}
              {lastPullInfo.bbls ? ` • ${lastPullInfo.bbls} ${t('units.bbl')}` : ''}
            </Text>
          </View>
        )}
      </View>
      </View>

      {/* Slider - tap to peek values, long press to unlock */}
      {(() => {
        // Calculate slider minimum: use loadLine (1.33') or allowedBottom if lower
        const literalLoadLine = wellConfig?.loadLine ?? 1.33;
        const allowedBottom = wellConfig?.allowedBottom ?? 3;
        // If allowedBottom < literal load line, use allowedBottom only
        // Otherwise use literal load line as minimum, with allowedBottom marker if higher
        const sliderMin = allowedBottom < literalLoadLine ? allowedBottom : literalLoadLine;
        const showAllowedBottomMarker = allowedBottom > literalLoadLine;

        // Calculate position of allowedBottom marker as percentage of slider range
        // Account for the slider track width (excluding Pull/Fill labels which are 50px each)
        const sliderRange = 18 - sliderMin;
        const allowedBottomPercent = ((allowedBottom - sliderMin) / sliderRange) * 100;

        // Color coding for ready time text (not level - keep level white for consistency):
        // - Green: safe range (slider above allowedBottom but below ready level - normal pull)
        // - Blue: above ready level (fill side)
        // - Red: below allowedBottom (danger zone)
        const readyLevel = allowedBottom + (loadBbls / bblsPerFoot);
        let readyTimeColor = '#60A5FA'; // Default blue
        if (!wellDown && !sliderLocked) {
          if (sliderFeet < allowedBottom) {
            readyTimeColor = '#EF4444'; // Red - below allowed
          } else if (sliderFeet >= readyLevel) {
            readyTimeColor = '#60A5FA'; // Blue - above ready (fill side)
          } else {
            readyTimeColor = '#10B981'; // Green - safe pull zone
          }
        }

        // Show Next Pull info when slider is locked (same position as slider level info)
        const showNextPull = sliderLocked && !sliderPeeking && !wellDown;

        return (
          <View style={[styles.sliderContainer, wellDown && styles.sliderDisabled]}>
            {/* Info container - shows either Next Pull (when locked) or Slider level (when active) */}
            <View style={styles.sliderInfoContainer}>
              {showNextPull ? (
                // Next Pull Ready - shows in same spot as slider info when locked
                <>
                  <Text style={styles.nextPullLabel}>{t('well.nextPull', 'Next Pull')}</Text>
                  <Text style={[
                    styles.nextPullTime,
                    nextPullReady.isReady && styles.nextPullReady
                  ]}>
                    {nextPullReady.text}
                  </Text>
                </>
              ) : (
                // Slider level and ready-at text - fades in/out
                <Animated.View style={[styles.sliderInfoInner, sliderInfoStyle]}>
                  <View style={styles.sliderValueRow}>
                    <Text style={[styles.sliderValue, wellDown && styles.textDisabled]}>{formatFeetInches(sliderFeet)}</Text>
                    {isPlanningPull && bblsToPull > 0 && (
                      <Text style={styles.sliderBbls}>  −{bblsToPull} {t('units.bbl')}</Text>
                    )}
                  </View>
                  <Text style={[
                    styles.readyAt,
                    { color: readyTimeColor },
                    wellDown && styles.textDisabled
                  ]}>
                    {readyAtText}
                  </Text>
                </Animated.View>
              )}
            </View>

            <View style={styles.sliderRowContainer}>
              {/* Level markers row - above slider, aligned with Pull/Fill words (not arrows) */}
              <View style={styles.sliderMarkersRow}>
                <Text style={styles.sliderMarkerArrowLeft}>←</Text>
                <Text style={[
                  styles.sliderMarkerLeft,
                  !showAllowedBottomMarker && styles.sliderMarkerAllowedBottom
                ]}>{formatFeetInches(sliderMin)}</Text>
                {/* Track area - uses flex to position allowed bottom marker at correct percentage */}
                <View style={styles.sliderMarkerTrackArea}>
                  {showAllowedBottomMarker && (
                    <>
                      {/* Flex spacer to push marker to correct position */}
                      <View style={{ flex: allowedBottomPercent }} />
                      <Text style={styles.sliderMarkerPositioned}>
                        {formatFeetInches(allowedBottom)}
                      </Text>
                      <View style={{ flex: 100 - allowedBottomPercent }} />
                    </>
                  )}
                </View>
                <Text style={styles.sliderMarkerRight}>18'</Text>
                <Text style={styles.sliderMarkerArrowRight}>→</Text>
              </View>

              <View style={styles.sliderRow}>
                <Text style={[styles.sliderArrowLeft, wellDown && styles.textDisabled]}>←</Text>
                <Text style={[styles.sliderEndWord, wellDown && styles.textDisabled]}>{t('well.pull')}</Text>
                <View style={styles.sliderWrapper} pointerEvents={sliderLocked ? "none" : "auto"}>
                  <Slider
                    containerStyle={styles.slider}
                    minimumValue={sliderMin}
                    maximumValue={18}
                    step={0.01}
                    value={sliderFeet}
                    onValueChange={(val) => handleSliderChange(Array.isArray(val) ? val[0] : val)}
                    onSlidingStart={handleSliderStart}
                    onSlidingComplete={handleSliderEnd}
                    minimumTrackTintColor={wellDown ? '#374151' : (!sliderLocked ? '#2563EB' : '#374151')}
                    maximumTrackTintColor="#374151"
                    thumbTintColor={wellDown ? '#6B7280' : (!sliderLocked ? '#60A5FA' : '#4B5563')}
                    thumbStyle={styles.sliderThumb}
                    trackStyle={styles.sliderTrack}
                    disabled={wellDown}
                    renderThumbComponent={() => (
                      <View style={[styles.sliderThumb, { backgroundColor: wellDown ? '#6B7280' : (!sliderLocked ? '#60A5FA' : '#4B5563'), justifyContent: 'center', alignItems: 'center' }]}>
                        {sliderLocked && <Text style={styles.lockIcon}>🔒</Text>}
                      </View>
                    )}
                  />
                </View>
                <Text style={[styles.sliderEndWord, wellDown && styles.textDisabled]}>{t('well.fill')}</Text>
                <Text style={[styles.sliderArrowRight, wellDown && styles.textDisabled]}>→</Text>
                {/* Overlay to capture taps when locked - covers full slider row */}
                {sliderLocked && (
                  <Pressable
                    onPress={handleSliderTrackTap}
                    style={styles.sliderOverlay}
                  />
                )}
              </View>
            </View>
            {/* Unlock hint - always visible when locked to prevent layout jumping */}
            <Text style={[styles.unlockHint, !sliderLocked && styles.unlockHintHidden]}>
              {t('slider.unlockHint', 'Tap to peek  •  Double tap to unlock')}
            </Text>
          </View>
        );
      })()}
    </View>
  );
});

// Main screen
export default function MainScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const pickerListRef = useRef<FlatList>(null);

  // Track levels for ALL wells, not just the active one
  const wellLevels = useRef<{ [wellName: string]: number }>({});
  const previousIndex = useRef(0);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [tempSelectedIndex, setTempSelectedIndex] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isInitialSyncing, setIsInitialSyncing] = useState(true); // Start true
  const [isFreshInstall, setIsFreshInstall] = useState(false); // Determines which loading UI to show
  const [syncStatus, setSyncStatus] = useState<'auth' | 'sync' | 'refresh'>('auth');
  const [setupSteps, setSetupSteps] = useState({
    auth: 'pending' as 'pending' | 'active' | 'done',
    config: 'pending' as 'pending' | 'active' | 'done',
    sync: 'pending' as 'pending' | 'active' | 'done',
  });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [pickerScrolling, setPickerScrolling] = useState(false);
  const [sliderActive, setSliderActive] = useState(false);
  const [wells, setWells] = useState<string[]>([]);
  const [wellConfigMap, setWellConfigMap] = useState<WellConfigMap | null>(null); // For route info
  const [loadBbls, setLoadBbls] = useState(140); // Load size from Summary screen
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false); // Sync indicator
  const [currentWellHasDraft, setCurrentWellHasDraft] = useState(false); // Draft indicator for Pull button
  const [isViewer, setIsViewer] = useState(false); // Viewer-only mode (can't submit pulls)
  const [appForegroundCount, setAppForegroundCount] = useState(0); // Bumps when app returns to foreground
  const [showOvernightBbls, setShowOvernightBbls] = useState(false); // Global overnight vs segment bbls/day toggle
  const lastTickIndex = useRef(0);
  const wellRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wellRetryCount = useRef(0);

  // Alert hook for confirmations
  const alert = useAppAlert();

  // Draft storage prefix (must match record.tsx)
  const DRAFT_STORAGE_PREFIX = 'wellbuilt_draft_';
  const getDraftKey = (wellName: string) => `${DRAFT_STORAGE_PREFIX}${wellName.replace(/\s+/g, '_')}`;

  // Play tick feedback for picker scroll
  const playTick = useCallback(() => {
    Haptics.selectionAsync();
  }, []);

  // Load last well index on mount
  useEffect(() => {
    const loadLastWell = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY_LAST_WELL);
        if (saved !== null) {
          const idx = parseInt(saved, 10);
          if (idx >= 0 && idx < wells.length) {
            setCurrentIndex(idx);
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({ index: idx, animated: false });
            }, 100);
          }
        }
      } catch (err) {
        console.log('[Main] Error loading last well:', err);
      }
      setIsReady(true);
    };
    loadLastWell();
    // Load overnight bbls/day preference
    AsyncStorage.getItem('@wellbuilt_show_overnight_bbls').then(v => {
      if (v === 'true') setShowOvernightBbls(true);
    }).catch(() => {});
  }, []);

  // Toggle handler for overnight bbls/day (persists + updates all wells)
  const handleToggleOvernightBbls = useCallback(() => {
    setShowOvernightBbls(prev => {
      const next = !prev;
      AsyncStorage.setItem('@wellbuilt_show_overnight_bbls', next ? 'true' : 'false');
      return next;
    });
  }, []);

  // Save current well index when it changes
  useEffect(() => {
    if (isReady) {
      AsyncStorage.setItem(STORAGE_KEY_LAST_WELL, String(currentIndex));
    }
  }, [currentIndex, isReady]);

  // Background sync - Firebase version (no auth needed)
  useEffect(() => {
    const initSync = async () => {
      console.log('[Main] ====== SETUP FLOW STARTED ======');
      console.log('[Main] Platform:', Platform.OS);

      // Firebase doesn't need OAuth - skip auth step
      console.log('[Main] Using Firebase - no auth needed');
      setSetupSteps(s => ({ ...s, auth: 'done' }));

      // Check if first install or returning user (cold/warm start)
      const hasData = await AsyncStorage.getItem('@wellbuilt_has_synced');
      console.log('[Main] Has previous sync data:', !!hasData);

      if (hasData) {
        // COLD/WARM START - show splash and sync before showing UI
        console.log('[Main] Cold/warm start detected - showing splash while syncing');
        setIsFreshInstall(false);

        // Run sync and wait for it (with timeout)
        const syncPromise = syncFromProcessedFolder();
        const timeoutPromise = new Promise<number>((resolve) =>
          setTimeout(() => resolve(-1), 8000) // 8 second timeout for cold start
        );

        const count = await Promise.race([syncPromise, timeoutPromise]);

        if (count === -1) {
          console.log('[Main] Cold start sync timed out, using cached data');
        } else {
          console.log('[Main] Cold start sync complete, updated', count, 'wells');
        }

        // Brief delay so splash doesn't flash too fast (min 800ms total)
        await new Promise(resolve => setTimeout(resolve, 300));

        console.log('[Main] ====== COLD START COMPLETE ======');
        setIsInitialSyncing(false);

        // Trigger UI refresh
        setRefreshTrigger(prev => prev + 1);

        // Start the regular polling timer
        startBackgroundSync();
        return;
      }

      // FRESH INSTALL - need to fetch everything with full loading UI
      console.log('[Main] Fresh install - showing setup UI');
      setIsFreshInstall(true);
      setSyncStatus('sync');

      // Load well config
      console.log('[Main] Step 2: Loading well configuration...');
      setSetupSteps(s => ({ ...s, config: 'active' }));
      const config = await fetchWellConfigMap();

      // Save default well selections during initial setup — filtered by driver's assigned routes
      if (config) {
        // Fetch driver's route/well assignments so fresh install only shows assigned wells
        const assignment = await fetchDriverRouteAssignment();
        const filteredConfig = filterWellConfigByAssignment(config, assignment.routes, assignment.wells);
        const wellNames = Object.keys(filteredConfig);
        console.log('[Main] Saving default well selections:', wellNames.length, 'wells (from', Object.keys(config).length, 'total, assigned routes:', assignment.routes.length, ')');
        await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify(wellNames));

        // Also save default route order based on filtered config
        const routes = [...new Set(wellNames.map(w => filteredConfig[w]?.route || 'Unknown'))];
        routes.sort();
        console.log('[Main] Saving default route order:', routes);
        await AsyncStorage.setItem(STORAGE_KEY_ROUTE_ORDER, JSON.stringify(routes));
      }

      setSetupSteps(s => ({ ...s, config: 'done' }));
      console.log('[Main] Well config loaded');

      // Sync well data
      console.log('[Main] Step 3: Syncing well data...');
      setSetupSteps(s => ({ ...s, sync: 'active' }));

      const syncPromise = syncFromProcessedFolder();
      const timeoutPromise = new Promise<number>((resolve) =>
        setTimeout(() => resolve(-1), 10000)
      );

      const count = await Promise.race([syncPromise, timeoutPromise]);

      if (count === -1) {
        console.log('[Main] Sync timed out, continuing with cached data');
      } else {
        console.log('[Main] Sync complete, updated', count, 'wells');
      }

      // Mark as synced so next cold start uses splash instead
      await AsyncStorage.setItem('@wellbuilt_has_synced', 'true');

      setSetupSteps(s => ({ ...s, sync: 'done' }));
      console.log('[Main] All setup steps complete, showing final checkmarks...');

      // Let user see the final checkmark before transitioning
      await new Promise(resolve => setTimeout(resolve, 600));
      console.log('[Main] Delay complete, transitioning to main UI');

      console.log('[Main] ====== SETUP FLOW COMPLETE ======');
      setIsInitialSyncing(false);

      // Trigger UI refresh
      setRefreshTrigger(prev => prev + 1);

      // Start the regular polling timer
      startBackgroundSync();
    };
    
    initSync();
    
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      console.log('[Main] AppState changed to:', nextAppState);
      if (nextAppState === 'active') {
        startBackgroundSync();
        // Re-trigger well load — covers returning from dead zone while backgrounded
        setAppForegroundCount(prev => prev + 1);
      } else {
        stopBackgroundSync();
        // Auto-flush debug logs to Firebase when app goes to background
        autoFlushIfNeeded();
      }
    });
    return () => {
      subscription.remove();
      stopBackgroundSync();
    };
  }, []);

  // Subscribe to background sync status for UI indicator
  useEffect(() => {
    const unsubscribe = onSyncStatusChange((syncing) => {
      setIsBackgroundSyncing(syncing);
      // Trigger refresh when sync completes
      if (!syncing) {
        setRefreshTrigger(prev => prev + 1);
      }
    });
    return unsubscribe;
  }, []);

  // Trigger refresh when screen comes into focus (returning from record.tsx, summary, or settings)
  // This only runs when navigating TO this screen, not on swipes
  useFocusEffect(
    useCallback(() => {
      // Skip if we're still doing initial sync - wells will load when sync finishes
      if (isInitialSyncing) {
        console.log('[Main] Skipping focus effect - initial sync in progress');
        return;
      }

      console.log('[Main] Focus effect running');

      // Clear any pending retry timer and reset retry count
      if (wellRetryTimer.current) {
        clearTimeout(wellRetryTimer.current);
        wellRetryTimer.current = null;
      }
      wellRetryCount.current = 0;

      // Bump refresh trigger to make WellView reload and check for pending
      setRefreshTrigger(prev => prev + 1);

      // Load wells from config and filter by selections
      // This handles: returning from Settings (well selection changed),
      // returning from Summary (jump to well), fresh install
      const loadSelectedWellsAndJump = async () => {
        // STEP 1: Instantly load cached wells so the screen is never blank.
        // This runs BEFORE any async fetch — driver sees their wells immediately.
        let usedCache = false;
        try {
          const cachedWells = await AsyncStorage.getItem(STORAGE_KEY_LAST_GOOD_WELLS);
          if (cachedWells) {
            const parsed = JSON.parse(cachedWells) as string[];
            if (parsed.length > 0 && wells.length === 0) {
              console.log('[Main] Instant cache: showing', parsed.length, 'wells from last session');
              debugLog(`Well recovery: loaded ${parsed.length} wells from cache`);
              setWells(parsed);
              setCurrentIndex(prev => Math.min(prev, Math.max(0, parsed.length - 1)));
              usedCache = true;
            }
          }
        } catch (e) {
          console.log('[Main] Cache read error (non-fatal):', e);
        }

        // STEP 2: Full load — fetch config, apply filters, sort by route.
        // If this succeeds, it silently replaces the cached list.
        // If it fails, the cached list stays visible.
        let config: WellConfigMap | null = null;
        let allWellNames: string[] = [];
        let filteredWells: string[] = [];

        try {
          // Check if user is viewer-only (uses SecureStore — can throw on some devices)
          try {
            const viewerStatus = await isCurrentUserViewer();
            setIsViewer(viewerStatus);
          } catch (e) {
            console.log('[Main] SecureStore error checking viewer status, defaulting to non-viewer:', e);
            setIsViewer(false);
          }

          // Load saved load size from Summary screen
          try {
            const savedLoadSize = await AsyncStorage.getItem(STORAGE_KEY_LOAD_SIZE);
            if (savedLoadSize) {
              const size = parseInt(savedLoadSize, 10);
              if (!isNaN(size) && size > 0) {
                setLoadBbls(size);
              }
            }
          } catch (e) {
            console.log('[Main] Error loading load size:', e);
          }

          // Fetch well config - uses cache (no Firebase call unless cache is stale)
          config = await fetchWellConfigMap();
          setWellConfigMap(config); // Save for route info display
          allWellNames = config ? Object.keys(config) : [];

          // RECOVERY: If config cache is empty/corrupt, force refresh from Firebase
          if (allWellNames.length === 0) {
            console.log('[Main] Config cache empty — force refreshing from Firebase');
            config = await fetchWellConfigMap(true);
            setWellConfigMap(config);
            allWellNames = config ? Object.keys(config) : [];
            if (allWellNames.length > 0) {
              // Reset selected wells filtered by assignment (not all wells)
              const assignment = await fetchDriverRouteAssignment();
              const filteredConfig = filterWellConfigByAssignment(config!, assignment.routes, assignment.wells);
              const assignedWellNames = Object.keys(filteredConfig);
              console.log('[Main] Recovery: selecting', assignedWellNames.length, 'assigned wells (from', allWellNames.length, 'total)');
              await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify(assignedWellNames));
            }
          }

          // Filter wells by driver's route assignment FIRST, then by user selections
          const assignment = await fetchDriverRouteAssignment();
          let assignedWellNames = allWellNames;
          if (assignment.routes.length > 0 || assignment.wells.length > 0) {
            const assignedConfig = filterWellConfigByAssignment(config!, assignment.routes, assignment.wells);
            assignedWellNames = Object.keys(assignedConfig);
            console.log('[Main] Route assignment filter:', assignedWellNames.length, 'of', allWellNames.length, 'wells');
          }

          // Load user's selected wells from Settings, intersected with assigned wells
          filteredWells = assignedWellNames;
          try {
            const savedSelections = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_WELLS);
            if (savedSelections) {
              const selected = JSON.parse(savedSelections) as string[];
              if (selected.length > 0) {
                const assignedSet = new Set(assignedWellNames);
                const selectedSet = new Set(selected);
                // Only show wells that are BOTH selected AND assigned
                filteredWells = assignedWellNames.filter(w => selectedSet.has(w));
                // If saved selections had stale wells, clean them up
                const cleanedSelections = selected.filter(w => assignedSet.has(w));
                if (cleanedSelections.length !== selected.length) {
                  console.log('[Main] Cleaned', selected.length - cleanedSelections.length, 'stale wells from selections');
                  await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify(cleanedSelections));
                }
              }
            }
          } catch (e) {
            console.log('[Main] Corrupted selectedWells JSON, resetting to assigned wells:', e);
            filteredWells = assignedWellNames;
            await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify(assignedWellNames));
          }

          // RECOVERY: If filtering resulted in 0 wells, reset to all assigned wells
          if (filteredWells.length === 0 && assignedWellNames.length > 0) {
            console.log('[Main] No wells after filtering — resetting to assigned wells');
            filteredWells = assignedWellNames;
            await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify(assignedWellNames));
          }

          // Load saved route order and sort wells accordingly
          let routeOrder: string[] = [];
          try {
            const savedRouteOrder = await AsyncStorage.getItem(STORAGE_KEY_ROUTE_ORDER);
            if (savedRouteOrder) {
              routeOrder = JSON.parse(savedRouteOrder);
            }
          } catch (e) {
            console.log('[Main] Corrupted routeOrder JSON, using default sort:', e);
            routeOrder = [];
          }

          // Sort wells by route order, then alphabetically within each route
          if (config) {
            filteredWells.sort((a, b) => {
              const routeA = config![a]?.route || 'Unknown';
              const routeB = config![b]?.route || 'Unknown';

              // If we have a saved route order, use it
              if (routeOrder.length > 0) {
                const orderA = routeOrder.indexOf(routeA);
                const orderB = routeOrder.indexOf(routeB);

                // Both routes in saved order
                if (orderA !== -1 && orderB !== -1) {
                  if (orderA !== orderB) return orderA - orderB;
                  return a.localeCompare(b); // Same route, alphabetical
                }
                // Only A in saved order - A comes first
                if (orderA !== -1) return -1;
                // Only B in saved order - B comes first
                if (orderB !== -1) return 1;
              }

              // No saved order or routes not in saved order - alphabetical by route then name
              if (routeA !== routeB) return routeA.localeCompare(routeB);
              return a.localeCompare(b);
            });
          }
        } catch (e) {
          // CRITICAL CATCH: Something unexpected blew up above.
          // Ensure we still load SOMETHING — try to get wells from config as last resort.
          console.error('[Main] CRITICAL: loadSelectedWellsAndJump crashed, attempting recovery:', e);
          debugLog(`Well load CRASHED: ${e}. Attempting recovery...`, 'error');
          try {
            if (!config) {
              config = await fetchWellConfigMap();
              setWellConfigMap(config);
            }
            if (config) {
              filteredWells = Object.keys(config).sort();
              console.log('[Main] Recovery: loaded', filteredWells.length, 'wells from config fallback');
              debugLog(`Well recovery: loaded ${filteredWells.length} wells from config fallback`, 'warn');
            }
          } catch (recoveryError) {
            console.error('[Main] Recovery also failed:', recoveryError);
            debugLog(`Well recovery FAILED: ${recoveryError}`, 'error');
          }
        }

        // FALLBACK: If we STILL have 0 wells, try reading config straight from AsyncStorage
        if (filteredWells.length === 0) {
          try {
            const rawConfig = await AsyncStorage.getItem('@wellbuilt_well_config');
            if (rawConfig) {
              const parsed = JSON.parse(rawConfig);
              const keys = Object.keys(parsed);
              if (keys.length > 0) {
                filteredWells = keys.sort();
                console.log('[Main] FALLBACK: loaded', filteredWells.length, 'wells directly from AsyncStorage config');
                debugLog(`Well recovery: loaded ${filteredWells.length} wells from AsyncStorage config`, 'warn');
              }
            }
          } catch (lastResortError) {
            console.error('[Main] AsyncStorage config read also failed:', lastResortError);
          }
        }

        // LAST RESORT: Load the last known good well list from previous session
        if (filteredWells.length === 0) {
          try {
            const lastGood = await AsyncStorage.getItem(STORAGE_KEY_LAST_GOOD_WELLS);
            if (lastGood) {
              const parsed = JSON.parse(lastGood) as string[];
              if (parsed.length > 0) {
                filteredWells = parsed;
                console.log('[Main] LAST RESORT: using last-good-wells cache:', filteredWells.length, 'wells');
                debugLog(`Well recovery: last resort — loaded ${filteredWells.length} wells from previous session`, 'warn');
              }
            }
          } catch (e) {
            console.error('[Main] Last-good-wells cache read failed:', e);
          }
        }

        // Set wells — if we got results, update the list (replaces instant cache if it was used)
        if (filteredWells.length > 0) {
          console.log('[Main] Loaded', filteredWells.length, 'wells');
          setWells(filteredWells);
          setCurrentIndex(prev => Math.min(prev, Math.max(0, filteredWells.length - 1)));

          // Save as last known good for next time
          try {
            await AsyncStorage.setItem(STORAGE_KEY_LAST_GOOD_WELLS, JSON.stringify(filteredWells));
          } catch (e) {
            console.log('[Main] Failed to save last-good-wells cache:', e);
          }
        } else if (!usedCache) {
          // Full load got 0 wells AND we had no cache to show — set empty and auto-retry
          setWells([]);

          if (wellRetryCount.current < 3) {
            wellRetryCount.current++;
            console.log('[Main] No wells from any source — auto-retry', wellRetryCount.current, 'of 3 in 3s');
            debugLog(`Well load: no wells found, auto-retry ${wellRetryCount.current}/3`, 'warn');
            wellRetryTimer.current = setTimeout(() => {
              console.log('[Main] Auto-retrying well load...');
              loadSelectedWellsAndJump();
            }, 3000);
          } else {
            console.log('[Main] No wells after 3 retries — showing empty state');
            debugLog('Well load: FAILED after 3 retries — empty state shown', 'error');
          }
          return; // Skip jump-to-well logic since we have no wells
        } else {
          // Full load got 0 but cache is already showing — auto-retry silently in background
          if (wellRetryCount.current < 3) {
            wellRetryCount.current++;
            console.log('[Main] Cache visible, full load failed — silent retry', wellRetryCount.current, 'of 3 in 3s');
            debugLog(`Well load: fetch failed, using cache, silent retry ${wellRetryCount.current}/3`, 'warn');
            wellRetryTimer.current = setTimeout(() => {
              loadSelectedWellsAndJump();
            }, 3000);
          } else {
            console.log('[Main] Cache visible, full load failed after 3 retries — keeping cache');
            debugLog('Well load: fetch failed after 3 retries, still using cached wells', 'warn');
          }
        }

        // Check if we should jump to a specific well (from Summary screen)
        try {
          const jumpToWell = await AsyncStorage.getItem('@wellbuilt_jump_to_well');
          if (jumpToWell) {
            await AsyncStorage.removeItem('@wellbuilt_jump_to_well');
            const wellIndex = filteredWells.findIndex(w => w === jumpToWell);
            if (wellIndex >= 0) {
              setCurrentIndex(wellIndex);
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: wellIndex, animated: false });
              }, 100);
            }
          }
        } catch (e) {
          console.log('[Main] Error handling jump-to-well:', e);
        }
      };
      loadSelectedWellsAndJump();

      // Cleanup: cancel retry timer when focus changes
      return () => {
        if (wellRetryTimer.current) {
          clearTimeout(wellRetryTimer.current);
          wellRetryTimer.current = null;
        }
      };
    }, [isInitialSyncing, appForegroundCount])
  );

  // Check for draft when current well changes (separate from focus effect)
  useEffect(() => {
    if (wells.length > 0 && currentIndex >= 0 && currentIndex < wells.length) {
      const wellName = wells[currentIndex];
      const key = getDraftKey(wellName);
      AsyncStorage.getItem(key).then(draftJson => {
        if (!draftJson) {
          setCurrentWellHasDraft(false);
          return;
        }
        try {
          const draft = JSON.parse(draftJson);
          const ageMs = Date.now() - draft.savedAt;
          const maxAgeMs = 4 * 60 * 60 * 1000; // 4 hours
          const hasDraftData = ageMs < maxAgeMs && (draft.level || draft.barrels);
          setCurrentWellHasDraft(hasDraftData);
        } catch {
          setCurrentWellHasDraft(false);
        }
      });
    }
  }, [wells, currentIndex]);

  // Note: Well loading is now handled entirely by useFocusEffect above
  // It runs when initial sync completes (isInitialSyncing changes) AND on screen focus
  // This consolidates the logic and avoids duplicate well loading

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    console.log('[Main] Pull-to-refresh triggered');
    setIsRefreshing(true);
    
    try {
      await manualRefresh();
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.log('[Main] Refresh error:', err);
    }
    
    setIsRefreshing(false);
  }, []);

  // Navigate to record screen
  const handlePullPress = useCallback(() => {
    if (isViewer) {
      alert.show(
        'View Only',
        'Your account is view-only. Contact an admin to enable pull submissions.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (wells.length > 0) {
      router.push({
        pathname: '/record',
        params: { wellName: wells[currentIndex] },
      });
    }
  }, [router, wells, currentIndex, isViewer, alert]);

  // Navigate to settings
  const handleSettingsPress = useCallback(() => {
    router.push('/settings');
  }, [router]);

  // Navigate to summary
  const handleSummaryPress = useCallback(() => {
    router.push('/summary');
  }, [router]);

  // Handle well change from swipe
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;
  
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      const newIndex = viewableItems[0].index;
      // Save current as previous BEFORE updating to new
      if (newIndex !== currentIndex) {
        console.log('[Main] Swipe: currentIndex', currentIndex, '→', newIndex, ', setting previousIndex to', currentIndex);
        previousIndex.current = currentIndex;
      }
      setCurrentIndex(newIndex);
    }
  }, [currentIndex]);

  // Open picker for well selection
  const openPicker = () => {
    setTempSelectedIndex(currentIndex);
    lastTickIndex.current = currentIndex;
    setPickerScrolling(false);
    setShowPicker(true);
  };

  const confirmPicker = () => {
    // Save current as previous before changing
    if (tempSelectedIndex !== currentIndex) {
      previousIndex.current = currentIndex;
    }
    setCurrentIndex(tempSelectedIndex);
    flatListRef.current?.scrollToIndex({ index: tempSelectedIndex, animated: true });
    setShowPicker(false);
  };

  const cancelPicker = () => {
    setTempSelectedIndex(currentIndex);
    setShowPicker(false);
  };

  // Get the level of the well we're coming FROM (the previous well)
  const getPreviousLevel = useCallback(() => {
    const prevWellName = wells[previousIndex.current];
    const level = prevWellName && wellLevels.current[prevWellName] !== undefined 
      ? wellLevels.current[prevWellName] 
      : 0.5;
    console.log('[Main] getPreviousLevel: prevWell=', prevWellName, 'level=', level);
    return level;
  }, [wells]);

  // Update level for a specific well - called by ALL wells, not just active
  const handleLevelChange = useCallback((wellName: string, level: number) => {
    wellLevels.current[wellName] = level;
  }, []);

  // Navigate to current well's performance detail on tank double-tap
  const handleTankDoubleTap = useCallback(() => {
    const currentWell = wells[currentIndex];
    if (currentWell) {
      router.push({
        pathname: '/performance-detail',
        params: { wellName: currentWell },
      });
    }
  }, [router, wells, currentIndex]);

  // Hide well from My Wells on tank long-press
  const handleTankLongPress = useCallback(() => {
    const currentWell = wells[currentIndex];
    if (!currentWell) return;

    // Show confirmation dialog
    alert.show(
      t('well.hideWellTitle', 'Hide Well?'),
      t('well.hideWellMessage', 'Remove {{wellName}} from your wells list? You can re-enable it in Settings.', { wellName: currentWell }),
      [
        {
          text: t('common.cancel', 'Cancel'),
          style: 'cancel',
        },
        {
          text: t('common.yes', 'Yes'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Load current selections
              const savedSelections = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_WELLS);
              if (savedSelections) {
                const selections = new Set<string>(JSON.parse(savedSelections));
                selections.delete(currentWell);
                await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify([...selections]));

                // Update local wells list - remove the current well
                const newWells = wells.filter(w => w !== currentWell);
                setWells(newWells);

                // Update last-good-wells cache
                if (newWells.length > 0) {
                  await AsyncStorage.setItem(STORAGE_KEY_LAST_GOOD_WELLS, JSON.stringify(newWells));
                }

                // Adjust current index if needed
                if (currentIndex >= newWells.length) {
                  const newIndex = Math.max(0, newWells.length - 1);
                  setCurrentIndex(newIndex);
                  await AsyncStorage.setItem(STORAGE_KEY_LAST_WELL, String(newIndex));
                }
              }
            } catch (error) {
              console.error('[Main] Error hiding well:', error);
            }
          },
        },
      ]
    );
  }, [wells, currentIndex, alert, t]);

  const renderWell = useCallback(({ item, index }: { item: string; index: number }) => (
    <View style={{ width: SCREEN_WIDTH }}>
      <WellView
        wellName={item}
        isActive={index === currentIndex}
        getPreviousLevel={getPreviousLevel}
        onLevelChange={(level) => handleLevelChange(item, level)}
        refreshTrigger={refreshTrigger}
        onSliderActiveChange={setSliderActive}
        loadBbls={loadBbls}
        onTankDoubleTap={handleTankDoubleTap}
        onTankLongPress={handleTankLongPress}
        showOvernightBbls={showOvernightBbls}
        onToggleOvernightBbls={handleToggleOvernightBbls}
      />
    </View>
  ), [currentIndex, getPreviousLevel, handleLevelChange, refreshTrigger, loadBbls, handleTankDoubleTap, handleTankLongPress, showOvernightBbls, handleToggleOvernightBbls]);

  const getItemLayout = (_: any, index: number) => ({
    length: SCREEN_WIDTH,
    offset: SCREEN_WIDTH * index,
    index,
  });

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  // Initial sync overlay - show different UI based on fresh install vs cold/warm start
  if (isInitialSyncing) {
    // COLD/WARM START - Simple splash with logo
    if (!isFreshInstall) {
      return (
        <View style={styles.splashContainer}>
          <Image
            source={require('../../assets/images/WellBuilt_Logo.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <View style={styles.splashSyncRow}>
            <ActivityIndicator size="small" color="#D4A84B" />
            <Text style={styles.splashSyncText}>{t('home.syncing')}</Text>
          </View>
        </View>
      );
    }

    // FRESH INSTALL - Full step-by-step progress
    const StepItem = ({ label, status }: { label: string; status: 'pending' | 'active' | 'done' }) => (
      <View style={styles.setupStepRow}>
        {status === 'done' ? (
          <Text style={styles.setupCheckmark}>✔</Text>
        ) : status === 'active' ? (
          <ActivityIndicator size="small" color="#60A5FA" style={styles.setupSpinner} />
        ) : (
          <Text style={styles.setupPending}>○</Text>
        )}
        <Text style={[
          styles.setupStepText,
          status === 'done' && styles.setupStepDone,
          status === 'pending' && styles.setupStepPending,
        ]}>
          {label}
        </Text>
      </View>
    );

    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.setupTitle}>{t('home.settingUp')}</Text>
        <View style={styles.setupStepsContainer}>
          <StepItem label={t('home.stepAuth')} status={setupSteps.auth} />
          <StepItem label={t('home.stepConfig')} status={setupSteps.config} />
          <StepItem label={t('home.stepSync')} status={setupSteps.sync} />
        </View>
        <Text style={styles.syncingSubtext}>{t('home.syncingOnce')}</Text>
      </View>
    );
  }

  // Empty state - no wells loaded (config fetch failed, offline on first load, etc.)
  if (wells.length === 0) {
    return (
      <GestureHandlerRootView style={styles.container}>
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateIcon}>⚠️</Text>
          <Text style={styles.emptyStateTitle}>{t('homeExtra.noWellsLoaded')}</Text>
          <Text style={styles.emptyStateMessage}>
            {t('homeExtra.noWellsMessage')}
          </Text>
          <TouchableOpacity
            style={styles.emptyStateButton}
            onPress={async () => {
              setIsRefreshing(true);
              try {
                await manualRefresh();
                setRefreshTrigger(prev => prev + 1);
              } catch (e) {
                console.log('[Main] Empty state refresh error:', e);
              }
              setIsRefreshing(false);
            }}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color="#05060B" />
            ) : (
              <Text style={styles.emptyStateButtonText}>{t('homeExtra.retry')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.emptyStateSettingsLink}
            onPress={() => router.push('/settings')}
          >
            <Text style={styles.emptyStateSettingsText}>{t('homeExtra.openSettings')}</Text>
          </TouchableOpacity>
        </View>

        {/* Keep bottom nav accessible so user can still navigate */}
        <View style={styles.bottomNav}>
          <View style={styles.navSide}>
            <TouchableOpacity style={styles.navButton} onPress={() => router.push('/history')}>
              <Text style={styles.navIcon}>📋</Text>
              <Text style={styles.navLabel}>{t('nav.history')}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.pullButton, styles.pullButtonDisabled]}
            disabled
          >
            <Text style={[styles.pullButtonText, styles.pullButtonTextDisabled]}>{t('homeExtra.pull')}</Text>
          </TouchableOpacity>
          <View style={styles.navSide}>
            <TouchableOpacity style={styles.navButton} onPress={handleSummaryPress}>
              <Text style={styles.navIcon}>📊</Text>
              <Text style={styles.navLabel}>{t('nav.summary')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Header with tappable well name and settings */}
      <View style={styles.header}>
        {/* Empty spacer for balance */}
        <View style={styles.headerSpacer} />

        {/* Center - route name and well name */}
        <View style={styles.headerCenter}>
          {/* Route name - smaller, in route color */}
          {wellConfigMap && wells[currentIndex] && wellConfigMap[wells[currentIndex]]?.route && (
            <Text style={[
              styles.routeName,
              { color: getRouteColor(wellConfigMap[wells[currentIndex]]?.route || '') }
            ]}>
              {wellConfigMap[wells[currentIndex]]?.route}
            </Text>
          )}
          <TouchableOpacity onPress={openPicker} style={styles.wellNameButton}>
            <Text style={styles.wellName}>{wells[currentIndex]}</Text>
            <Text style={styles.wellNameArrow}>▼</Text>
            {isBackgroundSyncing && (
              <ActivityIndicator size="small" color="#60A5FA" style={styles.syncIndicator} />
            )}
          </TouchableOpacity>
          <Text style={styles.positionIndicator}>{currentIndex + 1} {t('homeExtra.of')} {wells.length}</Text>
        </View>

        {/* Right - settings button */}
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Swipeable well views - with memory optimization for Android */}
      <FlatList
        ref={flatListRef}
        data={wells}
        renderItem={renderWell}
        keyExtractor={(item) => item}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        initialScrollIndex={currentIndex}
        removeClippedSubviews={Platform.OS === 'android'}
        maxToRenderPerBatch={2}
        windowSize={3}
        initialNumToRender={1}
        updateCellsBatchingPeriod={100}
        extraData={currentIndex}
        directionalLockEnabled={true}
        alwaysBounceVertical={Platform.OS === 'ios'}
        alwaysBounceHorizontal={true}
        scrollEventThrottle={16}
        scrollEnabled={!sliderActive}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#60A5FA"
            colors={['#60A5FA']}
          />
        }
      />

      {/* Bottom nav - History | Pull | Summary */}
      <View style={styles.bottomNav}>
        <View style={styles.navSide}>
          <TouchableOpacity style={styles.navButton} onPress={() => router.push('/history')}>
            <Text style={styles.navIcon}>📋</Text>
            <Text style={styles.navLabel}>{t('nav.history')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.pullButton, isViewer && styles.pullButtonDisabled]}
          onPress={handlePullPress}
        >
          <Text style={[styles.pullButtonText, isViewer && styles.pullButtonTextDisabled]}>
            {isViewer ? t('homeExtra.viewOnly') : t('nav.pull')}
          </Text>
          {currentWellHasDraft && !isViewer && (
            <View style={styles.draftIndicator}>
              <Text style={styles.draftIndicatorIcon}>✏️</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.navSide}>
          <TouchableOpacity style={styles.navButton} onPress={handleSummaryPress}>
            <Text style={styles.navIcon}>📊</Text>
            <Text style={styles.navLabel}>{t('nav.summary')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Well picker modal - works for both platforms */}
      <Modal visible={showPicker} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={cancelPicker}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.pickerContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={cancelPicker}>
                <Text style={styles.modalCancel}>{t('homeExtra.cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t('homeExtra.selectWell')}</Text>
              <View style={{ width: 50 }} />
            </View>
              <View style={styles.androidWheelContainer}>
                {/* Fixed highlight bar in center (visual only) */}
                <View style={styles.androidWheelHighlight} pointerEvents="none" />
                <FlatList
                  ref={pickerListRef}
                  data={wells}
                  keyExtractor={(item) => item}
                  style={styles.androidWheelList}
                  contentContainerStyle={{ paddingVertical: 100 }}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={50}
                  decelerationRate="normal"
                  scrollEventThrottle={16}
                  onScroll={(e) => {
                    const index = Math.round(e.nativeEvent.contentOffset.y / 50);
                    const clampedIndex = Math.max(0, Math.min(index, wells.length - 1));
                    if (clampedIndex !== tempSelectedIndex) {
                      setTempSelectedIndex(clampedIndex);
                      // Play tick on scroll if index changed
                      if (clampedIndex !== lastTickIndex.current) {
                        playTick();
                        lastTickIndex.current = clampedIndex;
                      }
                    }
                    setPickerScrolling(true);
                  }}
                  onMomentumScrollEnd={() => {
                    setPickerScrolling(false);
                  }}
                  initialScrollIndex={currentIndex}
                  getItemLayout={(_, index) => ({
                    length: 50,
                    offset: 50 * index,
                    index,
                  })}
                  renderItem={({ item, index }) => {
                    // Check if this is first well in a new route
                    const route = wellConfigMap?.[item]?.route || '';
                    const routeColor = getRouteColor(route);
                    const prevWell = index > 0 ? wells[index - 1] : null;
                    const prevRoute = prevWell ? (wellConfigMap?.[prevWell]?.route || '') : '';
                    const isFirstInRoute = route !== prevRoute;

                    return (
                      <Pressable
                        style={styles.androidWheelRow}
                        onPress={() => {
                          if (index === tempSelectedIndex) {
                            // Tap on highlighted well - select it and close
                            previousIndex.current = currentIndex;
                            setCurrentIndex(tempSelectedIndex);
                            flatListRef.current?.scrollToIndex({ index: tempSelectedIndex, animated: true });
                            setShowPicker(false);
                          } else {
                            // Tap on non-highlighted well - scroll to center it
                            pickerListRef.current?.scrollToIndex({ index, animated: true });
                            playTick();
                          }
                        }}
                      >
                        {/* Route name above first well in route */}
                        {isFirstInRoute && route && (
                          <Text style={[styles.pickerRouteName, { color: routeColor }]}>
                            {route}
                          </Text>
                        )}
                        <Text style={[
                          styles.androidWheelText,
                          index === tempSelectedIndex && styles.androidWheelTextSelected,
                        ]}>
                          {item}
                        </Text>
                      </Pressable>
                    );
                  }}
                />
              </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Confirmation alert */}
      <alert.AlertComponent />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05060B',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#05060B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#05060B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    width: wp('60%'),
    height: hp('15%'),
    marginBottom: spacing.xl,
  },
  splashSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  splashSyncText: {
    color: '#D4A84B',
    fontSize: hp('2%'),
    marginLeft: spacing.sm,
    fontWeight: '500',
  },
  syncingText: {
    color: '#9CA3AF',
    fontSize: hp('2%'),
    marginTop: spacing.md,
  },
  syncingSubtext: {
    color: '#6B7280',
    fontSize: hp('1.6%'),
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  setupTitle: {
    color: '#F9FAFB',
    fontSize: hp('2.8%'),
    fontWeight: '700',
    marginBottom: spacing.xl,
  },
  setupStepsContainer: {
    alignItems: 'flex-start',
  },
  setupStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  setupCheckmark: {
    color: '#10B981',
    fontSize: hp('2.4%'),
    fontWeight: '700',
    width: 32,
    textAlign: 'center',
  },
  setupSpinner: {
    width: 32,
  },
  setupPending: {
    color: '#4B5563',
    fontSize: hp('2.4%'),
    width: 32,
    textAlign: 'center',
  },
  setupStepText: {
    color: '#F9FAFB',
    fontSize: hp('2%'),
    marginLeft: spacing.sm,
  },
  setupStepDone: {
    color: '#9CA3AF',
  },
  setupStepPending: {
    color: '#6B7280',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: hp('7%'),
    paddingBottom: spacing.sm,
    paddingHorizontal: wp('5%'),
  },
  headerSpacer: {
    width: hp('2.8%'), // Match settings icon size for balance
  },
  headerCenter: {
    alignItems: 'center',
  },
  routeName: {
    fontSize: hp('1.5%'),
    fontWeight: '600',
    marginBottom: 2,
  },
  settingsButton: {
    padding: spacing.xs,
  },
  settingsIcon: {
    fontSize: hp('2.8%'),
    color: '#9CA3AF',
  },
  wellNameButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wellName: {
    fontSize: hp('2.8%'),
    fontWeight: '700',
    color: '#F9FAFB',
  },
  wellNameArrow: {
    position: 'absolute',
    right: -20,
    fontSize: hp('1.4%'),
    color: '#6B7280',
  },
  syncIndicator: {
    position: 'absolute',
    right: -45,
  },
  positionIndicator: {
    fontSize: hp('1.5%'),
    color: '#6B7280',
    marginTop: 2,
  },
  wellView: {
    flex: 1,
    width: SCREEN_WIDTH,
    justifyContent: 'space-between',
  },
  topSection: {
    alignItems: 'center',
    paddingTop: isTablet ? spacing.md : SCREEN_HEIGHT * 0.01,
  },
  tankSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tankOuter: {
    width: TANK_WIDTH,
    height: TANK_HEIGHT,
    position: 'relative',
    marginLeft: -TANK_WIDTH * 0.08,  // Shift left to visually center interior (flange on right)
  },
  tankFrame: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  tankInterior: {
    position: 'absolute',
    left: INTERIOR_LEFT,
    right: INTERIOR_RIGHT,
    top: INTERIOR_TOP,
    bottom: INTERIOR_BOTTOM,
    overflow: 'hidden',
  },
  waterWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'flex-end',
  },
  tankWater: {
    backgroundColor: '#2563EB',
    width: '100%',
  },
  tankBadge: {
    position: 'absolute',
    bottom: INTERIOR_BOTTOM + 10,  // FIXED: was top, should be bottom
    right: INTERIOR_RIGHT - 6,
    backgroundColor: '#2563EB',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  tankBadgeText: {
    color: 'white',
    fontSize: scaledFont(0.013),
    fontWeight: '700',
  },
  bblsAvailableContainer: {
    position: 'absolute',
    bottom: TANK_HEIGHT * 0.06,
    left: 15,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  bblsAvailableText: {
    color: '#10B981',
    fontSize: scaledFont(0.016),
    fontWeight: '600',
  },
  downOverlay: {
    position: 'absolute',
    top: TANK_HEIGHT * 0.05,
    left: TANK_WIDTH * 0.14,  // Nudge right for OCD
    width: TANK_WIDTH * 0.75,
    height: TANK_HEIGHT * 0.8,
    opacity: 1.0,
    zIndex: 10,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 6, 11, 0.8)',
    zIndex: 15,
  },
  loadingOverlayText: {
    color: '#9CA3AF',
    fontSize: scaledFont(0.016),
    marginTop: 8,
  },
  numberContainer: {
    position: 'absolute',
    left: 15,
    right: 0,
    alignItems: 'center',
    zIndex: 5,  // Above downOverlay
  },
  tankNumber: {
    color: 'white',
    fontSize: scaledFont(0.028),
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  // Waiting line - shows below tank when waiting for response
  waitingLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  waitingText: {
    marginLeft: spacing.sm,
    fontSize: Math.round(hp('1.7%')),
    color: '#9CA3AF',
  },
  statsSection: {
    alignItems: 'center',
    marginTop: isTablet ? spacing.xs : SCREEN_HEIGHT * 0.005,
    marginBottom: 0,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
    width: '100%',
  },
  statLeft: {
    flex: 1,
    textAlign: 'right',
    paddingRight: 8,
    fontSize: scaledFont(0.018),
    color: '#9CA3AF',
  },
  statRight: {
    flex: 1,
    textAlign: 'left',
    paddingLeft: 8,
    fontSize: scaledFont(0.018),
    color: '#9CA3AF',
  },
  statDivider: {
    width: 20,
    textAlign: 'center',
    fontSize: scaledFont(0.018),
    color: '#4B5563',
  },
  lastPullContainer: {
    alignItems: 'center',
    marginTop: isTablet ? spacing.xs : SCREEN_HEIGHT * 0.008,
  },
  lastPullLabel: {
    fontSize: scaledFont(0.013),
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 2,
  },
  lastPullInfo: {
    fontSize: scaledFont(0.015),
    color: '#6B7280',
    textAlign: 'center',
  },
  sliderContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginTop: isTablet ? spacing.sm : SCREEN_HEIGHT * 0.012,
    paddingBottom: isTablet ? spacing.lg : SCREEN_HEIGHT * 0.02,
  },
  sliderInfoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: isTablet ? 55 : SCREEN_HEIGHT * 0.065, // Slightly tighter to reduce void
    marginBottom: spacing.xs,
  },
  sliderInfoInner: {
    alignItems: 'center',
  },
  sliderValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  sliderValue: {
    fontSize: scaledFont(0.030),
    color: '#E5E7EB',  // Brighter white-gray for more prominence
    fontWeight: '700',  // Bolder
  },
  sliderBbls: {
    fontSize: scaledFont(0.026),
    color: '#F59E0B', // Amber/orange for "taking" BBLs
    fontWeight: '700',  // Bolder
  },
  sliderRowContainer: {
    position: 'relative',
    width: '100%',
    alignItems: isTablet ? 'center' : undefined, // Center the constrained slider on tablets
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: isTablet ? '70%' : '100%', // Constrain slider width on tablets
  },
  sliderWrapper: {
    flex: 1,
  },
  slider: {
    flex: 1,
    height: Platform.OS === 'android' ? 54 : 48,
    marginHorizontal: 8,
  },
  sliderThumb: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
  },
  // Slider labels - separate arrow and word for proper marker alignment
  sliderArrowLeft: {
    fontSize: scaledFont(0.014),
    color: '#6B7280',
    width: 16,
    textAlign: 'center',
  },
  sliderArrowRight: {
    fontSize: scaledFont(0.014),
    color: '#6B7280',
    width: 16,
    textAlign: 'center',
  },
  sliderEndWord: {
    fontSize: scaledFont(0.014),
    color: '#6B7280',
    width: 50, // Wider to fit Spanish translations (Extraer/Llenar)
    textAlign: 'center',
  },
  // Slider level markers row - aligned with Pull/Fill words (not arrows)
  sliderMarkersRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: isTablet ? '70%' : '100%',
    marginBottom: 2,
  },
  // Invisible spacer to match arrow width
  sliderMarkerArrowLeft: {
    fontSize: scaledFont(0.011),
    color: 'transparent',
    width: 16,
  },
  sliderMarkerArrowRight: {
    fontSize: scaledFont(0.011),
    color: 'transparent',
    width: 16,
  },
  sliderMarkerLeft: {
    fontSize: scaledFont(0.011),
    color: '#6B7280',
    width: 50, // Same as sliderEndWord
    textAlign: 'center',
  },
  // Yellow/amber color when left marker IS the allowed bottom
  sliderMarkerAllowedBottom: {
    color: '#F59E0B',
    fontWeight: '600',
  },
  // Container for the positioned allowed bottom marker - spans slider track area
  // Must account for thumb radius (22px) on each side so marker aligns with thumb center
  sliderMarkerTrackArea: {
    flex: 1, // Takes the middle space (same as sliderWrapper)
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginHorizontal: 8, // Same as slider marginHorizontal
    paddingHorizontal: 22, // Thumb radius - track is inset by this amount
  },
  sliderMarkerPositioned: {
    fontSize: scaledFont(0.011),
    color: '#F59E0B', // Amber for allowed bottom marker
    fontWeight: '600',
    marginLeft: -4, // Center the text on the flex position
    marginBottom: -3, // Move down so thumb fully covers it
  },
  sliderMarkerRight: {
    fontSize: scaledFont(0.011),
    color: '#6B7280',
    width: 50, // Same as sliderEndWord
    textAlign: 'center',
  },
  sliderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  lockIcon: {
    fontSize: 18,
  },
  unlockHint: {
    fontSize: scaledFont(0.013),
    color: '#6B7280',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  unlockHintHidden: {
    opacity: 0,
  },
  // Next Pull label and time (shown in sliderInfoContainer when locked)
  nextPullLabel: {
    fontSize: scaledFont(0.014),
    color: '#6B7280',
    marginBottom: 2,
  },
  nextPullTime: {
    fontSize: scaledFont(0.026),
    color: '#60A5FA',
    fontWeight: '700',
  },
  nextPullReady: {
    color: '#10B981',
  },
  readyAt: {
    fontSize: scaledFont(0.018),
    color: '#60A5FA',
    fontWeight: '600',
    marginTop: isTablet ? spacing.xs : SCREEN_HEIGHT * 0.008,
    width: '100%',
    textAlign: 'center',
  },
  readyAtNextLoad: {
    color: '#10B981',  // Green when showing "next load ready" time
  },
  sliderDisabled: {
    opacity: 0.5,
  },
  textDisabled: {
    color: '#4B5563',
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: isTablet ? spacing.md : SCREEN_HEIGHT * 0.015,
    paddingHorizontal: isTablet ? wp('15%') : spacing.md,
    paddingBottom: isTablet ? spacing.xl : SCREEN_HEIGHT * 0.06,
  },
  navSide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButton: {
    alignItems: 'center',
  },
  navIcon: {
    fontSize: Math.round(hp('2.5%')),
  },
  navLabel: {
    fontSize: Math.round(hp('1.2%')),
    color: '#9CA3AF',
    marginTop: 2,
  },
  pullButton: {
    backgroundColor: '#C4A574',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 8,
    position: 'relative',
  },
  pullButtonDisabled: {
    backgroundColor: '#4B5563',
  },
  pullButtonText: {
    color: '#1F2937',
    fontSize: Math.round(hp('1.8%')),
    fontWeight: '700',
  },
  pullButtonTextDisabled: {
    color: '#9CA3AF',
  },
  draftIndicator: {
    position: 'absolute',
    top: -10,
    right: -8,
  },
  draftIndicatorIcon: {
    fontSize: 20,
    transform: [{ scaleX: -1 }], // Flip horizontally - pencil tip points left
  },
  // Picker modal - works for both platforms
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  pickerContainer: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    width: wp('80%'),
    maxHeight: hp('50%'),
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: wp('4%'),
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  modalTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalCancel: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  modalDone: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: '600',
  },
  androidWheelContainer: {
    height: 250,
    position: 'relative',
    overflow: 'hidden',
  },
  androidWheelHighlight: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    height: 50,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    zIndex: 1,
  },
  androidWheelList: {
    height: 250,
    zIndex: 2,
  },
  androidWheelRow: {
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  androidWheelText: {
    color: '#9CA3AF',
    fontSize: 18,
    textAlign: 'center',
  },
  androidWheelTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  pickerRouteName: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: -2,
  },
  // Empty state styles - shown when wells list is empty
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  emptyStateTitle: {
    color: '#F9FAFB',
    fontSize: hp('2.8%'),
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  emptyStateMessage: {
    color: '#9CA3AF',
    fontSize: hp('1.8%'),
    textAlign: 'center',
    lineHeight: hp('2.6%'),
    marginBottom: spacing.xl,
  },
  emptyStateButton: {
    backgroundColor: '#D4A84B',
    paddingHorizontal: spacing.xl * 2,
    paddingVertical: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.lg,
    minWidth: 120,
    alignItems: 'center',
  },
  emptyStateButtonText: {
    color: '#05060B',
    fontSize: hp('2%'),
    fontWeight: '700',
  },
  emptyStateSettingsLink: {
    paddingVertical: spacing.sm,
  },
  emptyStateSettingsText: {
    color: '#60A5FA',
    fontSize: hp('1.8%'),
    textDecorationLine: 'underline',
  },
});

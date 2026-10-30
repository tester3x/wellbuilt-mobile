import {formatRateDuration} from '../../src/utils/rateDisplay';
import {ProductionRateRow} from '../../components/ProductionRateRow';
import {SliderInfoSlot} from '../../components/SliderInfoSlot';
import {WellCardLayout} from '../../components/WellCardLayouts';
import {WellPagerCard,WellPanelScaleContext} from '../../components/WellPagerCard';
import { thresholdTime } from '@tester3x/water-hauling';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getFreshWaterSupply } from '../../src/services/freshWaterSupply';
import { tankViewport, tankSceneScale } from '../../src/ui/tankViewport';
import { wellPagerBuffer } from '../../src/ui/wellPagerBuffer';
import { wellContentWidth, foldablePhoneLayout, FOLD_PANEL_WIDTH, usesFoldPanel } from '../../src/ui/wellContentFrame';
import { resolveTankHeight, tankFillFraction } from '../../src/utils/tankHeight';
import { LevelTimeSlider as Slider } from '../../components/LevelTimeSlider';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  Dimensions,
  useWindowDimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  ViewToken,
} from 'react-native';
import { GestureHandlerRootView, TapGestureHandler, State } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  getStaticFeatureFlag,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useWellLevelTransition } from '../../src/hooks/useWellLevelTransition';
import { TankReadout } from '../../src/components/TankReadout';
import { useWellLevelDisplay } from '../../src/hooks/useWellLevelDisplay';
import type { SharedValue } from 'react-native-reanimated';
import { useTankFlip } from '../../src/hooks/useTankFlip';
import { TankFlipWater } from '../../src/components/TankFlipWater';
import { roamingFishPosition, movementFishFacing, floatingPosition, fishScatterDirections } from '../../src/ui/fluidWildlife';
import { TankInfoModal } from '../../src/components/TankInfoModal';
import type { TankConfig } from '../../src/services/tankInfo';
import { TankPelican } from '../../src/components/TankPelican';
import { backToSuite } from '../../src/services/hubNavigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MoreMenu, moreMenuStyles } from '../../src/components/MoreMenu';
import { MORE_MENU_TOKENS } from '../../src/constants/moreMenuTokens';
import {
  DUCK_FONT_SIZE,
  DUCK_LIFT_PX,
  DuckSpawn,
  FishermanLayout,
  PELICAN_FOOT_OVERLAP_PX,
  PELICAN_HEIGHT,
  PELICAN_MIN_SCALE,
  PELICAN_TOP_SAFE_MARGIN_PX,
  PELICAN_VISIT_MS,
  computeDuckBand,
  computeFishermanLayout,
  nextPelicanDelayMs,
  pelicanPerchX,
} from '../../src/ui/tankWildlife';
import { manualRefresh, onSyncStatusChange, startBackgroundSync, stopBackgroundSync, syncFromProcessedFolder, syncOnForeground } from '../../src/services/backgroundSync';
import { startingLevelFromSnapshot, estimatedSnapshotLevel } from '../../src/services/downSnapshot';
import {hasEstablishedWbmEntry} from '../../src/services/platformEntry';
import {getSessionGeneration} from '../../src/services/wbmSessionFence';
import { downNumberTopPx } from '../../src/ui/downNumberLayout';
// Response processing handled entirely by backgroundSync
// Drain animation plays for visual feedback; backgroundSync saves snapshot and clears pending
import { getWellConfig, WellConfig, loadWellConfig, fetchDriverRouteAssignment, scopedWellsForDisplay, lastWellConfigError, getBblPerFootSync } from '../../src/services/wellConfig';
import { readWellDisplayData } from '../../src/services/wellDisplayData';
import {
  LevelSnapshot,
  PendingPull,
  saveSliderPosition,
  WellPullRecord
} from '../../src/services/wellHistory';
import { getTankDimensions, hp, isTablet, spacing, wp } from '../../src/ui/layout';
import { useAppAlert } from '../../components/AppAlert';
import { debugLog, autoFlushIfNeeded } from '../../src/services/debugLog';
import { captureWellSelectionOwner, loadSelectedWells, saveSelectedWells } from '../../src/services/wellSelection';
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
// Server-first assigned catalogue with owner-bound offline fallback.
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
const INTERIOR_WIDTH = TANK_WIDTH - INTERIOR_LEFT - INTERIOR_RIGHT; // for alive-tank fish drift
// DEV ONLY — force a specific alive-tank egg for local Expo testing so rare
// spawns don't require reopening wells dozens of times. MUST stay null in commits.
const FORCE_EGG: 'fish' | 'fisherman' | 'duck' | null = null;
const NUMBER_OFFSET = isTablet ? TANK_HEIGHT * 0.025 : SCREEN_HEIGHT * 0.015;
const DOWN_NUMBER_TOP = downNumberTopPx(INTERIOR_HEIGHT, NUMBER_OFFSET);

// Responsive font sizing - tablets get scaled down to prevent oversized text
const scaledFont = (phoneSize: number): number => {
  if (isTablet) {
    // On tablets, use a maximum cap and reduce the multiplier
    return Math.round(Math.min(phoneSize * SCREEN_HEIGHT * 0.6, phoneSize * 800));
  }
  return Math.round(phoneSize * SCREEN_HEIGHT);
};

const clampFraction = (n: number) => Math.min(Math.max(n, 0), 1);

// Format the Last Pull date+time as "m/d/yy h:mm AM/PM". Prefers the ISO
// UTC timestamp (full minute/second precision, locale-independent) — falls
// back to parsing the local display string. Returns the raw dateTime as
// last resort so a malformed source surfaces instead of silently displaying
// "" or "Invalid Date".
//
// Display contract per WB M / dashboard parity:
//   5/6/26 11:01 AM, 5/6/26 11:00 AM, 12/3/26 4:55 PM
// Minutes always shown, including :00. Date always shown. The dashboard's
// CF strips seconds via a regex that can also strip minutes when the source
// already lacks seconds, so the local string we receive may have been over-
// truncated to "11 AM" or to a date-only fragment. This formatter does not
// trust the upstream string and re-derives from UTC when possible.
const formatLastPullTime = (dateTime: string, dateTimeUTC?: string): string => {
  const candidates = [dateTimeUTC, dateTime].filter((s): s is string => !!s);
  for (const s of candidates) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const yy = d.getFullYear() % 100;
      let h = d.getHours();
      const m = d.getMinutes();
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${month}/${day}/${String(yy).padStart(2, '0')} ${h}:${String(m).padStart(2, '0')} ${ap}`;
    }
  }
  return dateTime;
};

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
  entryPrepared: boolean;
  cardWidth?: number;
  viewportHeight?: number;
  wideLayout?: boolean;
  entryFraction: number; // Captured visible fraction of the departing well (0-1)
  registerFill?: (well: string, fill: SharedValue<number>) => () => void;
  refreshTrigger?: number; // Triggers data reload after sync
  onSliderActiveChange?: (active: boolean, wellName: string) => void; // Block FlatList scroll during slider use
  loadBbls?: number; // Load size in bbls for "next load ready" calculation
  onTankDoubleTap?: (wellName: string) => void; // Navigate to this tank's performance
  onTankLongPress?: (wellName: string) => void; // Hide this well from My Wells
  showOvernightBbls?: boolean; // Global toggle for overnight vs segment bbls/day
  onToggleOvernightBbls?: () => void; // Toggle handler (persists to AsyncStorage)
}

const WellView = React.memo(function WellView({ wellName, isActive, entryPrepared, cardWidth = SCREEN_WIDTH, viewportHeight = SCREEN_HEIGHT, wideLayout = false, entryFraction, registerFill, refreshTrigger, onSliderActiveChange, loadBbls = 140, onTankDoubleTap, onTankLongPress, showOvernightBbls = false, onToggleOvernightBbls }: WellViewProps) {
  const { t } = useTranslation();
  useEffect(()=>{
    console.log('[WellPager] mount',wellName);
    return ()=>console.log('[WellPager] unmount',wellName);
  },[wellName]);
  const [sliderFeet, setSliderFeet] = useState(10.5);
  const [deliveryAt,setDeliveryAt]=useState<Date | null>(null);
  const [deliveryPicker,setDeliveryPicker]=useState<'date'|'time'|null>(null);
  const [deliveryBase,setDeliveryBase]=useState<{feet:number|null;rate:number|null;isDown:boolean}|null>(null);
  const [wellConfig, setWellConfig] = useState<WellConfig | null>(null);
  const tankHeightFeet = resolveTankHeight(wellConfig?.tankHeight);
  useEffect(() => { setSliderFeet(previous => Math.min(previous, tankHeightFeet)); }, [tankHeightFeet]);
  const [showTankInfo, setShowTankInfo] = useState(false);
  const [pullRecord, setPullRecord] = useState<WellPullRecord | null>(null);
  // Flow rate now stored in levelSnapshot (not separately cached) to prevent stale values
  const [levelSnapshot, setLevelSnapshot] = useState<LevelSnapshot | null>(null);
  const [lastPullInfo, setLastPullInfo] = useState<{dateTime: string, dateTimeUTC?: string, bbls: number, topLevel?: string, bottomLevel?: string} | null>(null);
  const lastPullWellRef = useRef(wellName);
  const [targetFraction, setTargetFraction] = useState<number | null>(null);
  const [drainCompleteSignal, setDrainCompleteSignal] = useState(0); // Triggers live update effect after drain finishes
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [sliderUIActive, setSliderUIActive] = useState(false); // Controls slider level/datetime visibility
  const [sliderLocked, setSliderLocked] = useState(true); // Slider locked state
  const [sliderPeeking, setSliderPeeking] = useState(false); // Tap to peek values without unlocking
  const [showTankMath, setShowTankMath] = useState(false); // Tap first metrics row → peek bbl/in • bbl/ft (~4s, all wells)
  // showOvernightBbls is now a prop from MainScreen (global toggle)
  const [tankSlotHeight, setTankSlotHeight] = useState(0);
  const [tankSlotWidth,setTankSlotWidth] = useState(cardWidth);
  const panelScale=useContext(WellPanelScaleContext);
  const fittedFold=usesFoldPanel(cardWidth,wideLayout);
  const contentWidth=fittedFold ? FOLD_PANEL_WIDTH : wellContentWidth(cardWidth);
  const portraitTankHeight=foldablePhoneLayout ? contentWidth*0.70*1.2 : cardWidth>=600 ? viewportHeight*0.42 : cardWidth*0.70*1.2;
  const tankScale=fittedFold ? portraitTankHeight/TANK_HEIGHT : foldablePhoneLayout ? (tankSlotHeight>0 ? Math.min(portraitTankHeight,tankSlotHeight) : portraitTankHeight)/TANK_HEIGHT : wideLayout ? tankSceneScale(tankSlotWidth,tankSlotHeight,TANK_WIDTH,TANK_HEIGHT,true) : (tankSlotHeight>0 ? Math.min(portraitTankHeight,tankSlotHeight) : portraitTankHeight)/TANK_HEIGHT;
  const sceneScale=Math.max(0.01,tankScale);
  const styles=useMemo(()=>foldablePhoneLayout ? {
    ...portraitStyles(contentWidth,contentWidth*2.2,sceneScale),
    tankBadge:fittedFold?{...baseWellStyles.tankBadge,width:18/sceneScale,height:18/sceneScale,borderRadius:9/sceneScale}:baseWellStyles.tankBadge,
    tankBadgeText:fittedFold?{...baseWellStyles.tankBadgeText,fontSize:14/sceneScale,lineHeight:18/sceneScale}:baseWellStyles.tankBadgeText,
    sliderRowContainer:{...baseWellStyles.sliderRowContainer,flexShrink:0},
  } : wideLayout ? {
    ...wideWellStyles,
    tankNumber:{...wideWellStyles.tankNumber,fontSize:24/sceneScale},
    tankUnavailableLabel:{...wideWellStyles.tankUnavailableLabel,fontSize:15/sceneScale},
    bblsAvailableText:{...wideWellStyles.bblsAvailableText,fontSize:14/sceneScale},
    tankInfoTouchTarget:{...wideWellStyles.tankInfoTouchTarget,top:INTERIOR_TOP-18/sceneScale,right:INTERIOR_RIGHT-19/sceneScale+TANK_WIDTH*0.08,width:44/sceneScale,height:44/sceneScale},
    tankInfoBadge:{...wideWellStyles.tankInfoBadge,width:18/sceneScale,height:18/sceneScale,borderRadius:9/sceneScale},
    tankInfoBadgeText:{...wideWellStyles.tankInfoBadgeText,fontSize:15/sceneScale},
  } : portraitStyles(cardWidth,viewportHeight,sceneScale),[contentWidth,sceneScale,fittedFold,wideLayout,cardWidth,viewportHeight]);
  const sliderInactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tankMathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Auto-revert tank-math peek
  const lastTapTimeRef = useRef<number>(0); // For double-tap detection on slider
  const lastTankTapTimeRef = useRef<number>(0); // For double-tap detection on tank
  const sliderOpacity = useSharedValue(0); // For fade animation

  // Slider timing constants
  const SLIDER_LOCK_DELAY = 5000; // 5 seconds of inactivity to lock
  const DOUBLE_TAP_DELAY = 300; // Max ms between taps for double-tap
  const PEEK_DURATION = 3000; // 3 seconds to show values on single tap

  // Clear the tank-math peek timer on unmount
  useEffect(() => () => { if (tankMathTimerRef.current) clearTimeout(tankMathTimerRef.current); }, []);
  
  // Pending pull / waiting state
  const [pendingPull, setPendingPull] = useState<PendingPull | null>(null);
  const wellDown = !!(pendingPull?.wellDown || levelSnapshot?.isDown);
  // Unlocked is not dragging. Only the slider responder may claim the pager;
  // hiding, locking, rotating or unmounting a card must release its claim.
  useEffect(() => {
    if (!isActive || sliderLocked || wellDown) onSliderActiveChange?.(false, wellName);
    return () => onSliderActiveChange?.(false, wellName);
  }, [wideLayout, isActive, sliderLocked, wellDown, wellName, onSliderActiveChange]);
  // Removed: const [isWaiting, setIsWaiting] = useState(false);
  // "Waiting for WellBuilt..." spinner removed - Cloud Functions handle everything now
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // REMOVED: const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null); // No more polling!
  const liveUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animationStartTimeRef = useRef<number>(0); // Track when drop animation started
  const drainAnimationActive = useRef(false); // Prevents live updates from fighting drain animation
  // Removed: waitingForResponseRef - no longer waiting for responses

  // MUST declare waterFraction before effects that use it
  const waterFraction = useSharedValue(entryFraction);
  useEffect(() => registerFill?.(wellName, waterFraction), [registerFill, wellName, waterFraction]);

  // ── Alive-tank easter egg (cosmetic only — never touches tank math) ──
  // FLIP water runs in the visible tank. A rare hidden critter is decided ONCE
  // per mount and kept stable for the session (no rerolling on refresh); each
  // fish also gets randomized depth / start / range / speed at the same time.
  const wavePhase = useSharedValue(0); // 0↔1 slow loop → bob/tug breathing
  const fishScatter = useSharedValue(0);
  const fishEscape = useSharedValue([{travel:-1,depth:0.18},{travel:1,depth:-0.18},{travel:-1,depth:0.18}]);
  const swim = useSharedValue(0);      // 0→1 continuous loop → fish/duck sine drift
  const TWO_PI = Math.PI * 2;
  const aliveEggRef = useRef<{
    kind: 'none' | 'fish' | 'fisherman' | 'duck';
    fishCount: number;
    fish: { topPct: number; leftPct: number; freq: number; phase: number; rangePx: number }[];
    duck: DuckSpawn & { phase: number };
    fisher: FishermanLayout;
  } | null>(null);
  if (aliveEggRef.current === null) {
    const r = Math.random();
    let kind: 'none' | 'fish' | 'fisherman' | 'duck' = 'none';
    if (r < 0.88) kind = 'none';            // 88% nothing
    else if (r < 0.96) kind = 'fish';       // 8%
    else if (r < 0.998) kind = 'duck';      // was fisherman+duck; fisherman disabled (Reanimated UI crash)
    else kind = 'none';
    if (FORCE_EGG && FORCE_EGG !== 'fisherman') kind = FORCE_EGG;
    // Stable per-fish seeds; active paths roam the full available water.
    const mkFish = () => {
      const onLeft = Math.random() < 0.5;
      const leftPct = onLeft ? 8 + Math.random() * 24 : 58 + Math.random() * 26; // 8–32% or 58–84%, never centre
      return {
        topPct: 12 + Math.random() * 76,                          // reduced-motion resting depth
        leftPct,
        freq: Math.random() < 0.5 ? 1 : 2,                        // slight speed variance
        phase: Math.random() * TWO_PI,                            // random start position + direction
        rangePx: INTERIOR_WIDTH * (0.12 + Math.random() * 0.16),  // ~12–28% travel
      };
    };
    aliveEggRef.current = {
      kind,
      fishCount: kind === 'fish' ? 1 + Math.floor(Math.random() * 3) : 0,
      fish: [mkFish(), mkFish(), mkFish()],
      // Duck: side band + jittered start + random phase — decided once, so
      // every tank's duck starts somewhere different (never synchronized)
      // yet stays inside its band and out of the level-text column.
      duck: {
        ...computeDuckBand(INTERIOR_WIDTH, Math.random() < 0.5, Math.random()),
        phase: Math.random() * TWO_PI,
      },
      // Fisherman: seated on the rim at a jittered side spot; the pole tip
      // (where the line hangs) is clamped out of the center column.
      fisher: computeFishermanLayout(INTERIOR_WIDTH, Math.random() < 0.5, Math.random()),
    };
  }
  const aliveEgg = aliveEggRef.current;

  // Reduced-motion (OS accessibility setting): wildlife and the ripple
  // stay correctly placed/afloat but stationary — no swim, no bob, no
  // drift, no pelican flight.
  const reducedMotion = useReducedMotion();
  useWellLevelTransition({ fill: waterFraction, target: targetFraction, active: isActive,
    entryFraction, draining: drainAnimationActive.current, reducedMotion, prepared: entryPrepared, layoutKey:`${cardWidth}:${viewportHeight}:${wideLayout}` });

  // App lifecycle: when the app goes inactive/background, EVERY wildlife
  // loop and timer is cancelled (no suspended pelican timeout can fire
  // late); returning to the foreground starts exactly one fresh loop /
  // one fresh bounded schedule — missed visits are never replayed.
  const [appForeground, setAppForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  const sceneActive = isActive && appForeground;
  const displayFeet = useWellLevelDisplay(waterFraction, tankHeightFeet, sceneActive, entryFraction, entryPrepared, 1000 / 6);
  const fishSceneActiveRef = useRef(false);
  const fluidInverted = useSharedValue(false);
  const fluidOrientation = useSharedValue(0);
  const fluidOffsets = useTankFlip(INTERIOR_WIDTH, INTERIOR_HEIGHT, waterFraction, sceneActive, reducedMotion, fluidInverted, fluidOrientation);

  // Breathing loop (bob/tug). Cancel-before-restart — never duplicates.
  useEffect(() => {
    if (!sceneActive || reducedMotion) { cancelAnimation(wavePhase); return; }
    wavePhase.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(wavePhase);
  }, [sceneActive, reducedMotion, wavePhase]);


  // Swim sine loop — shared by fish AND the surface duck. Continuous
  // phase, linear + non-reversing so sin() stays smooth across the wrap.
  // ONE loop per screen: the effect cancels before every (re)start, so
  // background/foreground and navigation can never stack duplicates.
  useEffect(() => {
    const needsSwim =
      sceneActive && !reducedMotion && (aliveEgg.kind === 'fish' || aliveEgg.kind === 'duck');
    if (!needsSwim) { cancelAnimation(swim); return; }
    swim.value = 0;
    swim.value = withRepeat(withTiming(1, { duration: aliveEgg.kind === 'fish' ? 18000 : 9000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(swim);
  }, [sceneActive, aliveEgg.kind, reducedMotion, swim]);

  useEffect(() => {
    fishSceneActiveRef.current = sceneActive && !reducedMotion;
    if (!sceneActive || reducedMotion) { cancelAnimation(fishScatter); fishScatter.value = 0; }
    return () => { fishSceneActiveRef.current = false; cancelAnimation(fishScatter); fishScatter.value = 0; };
  }, [sceneActive, reducedMotion, fishScatter]);

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

  // Response processing handled entirely by backgroundSync
  // Drain animation plays for visual feedback; backgroundSync saves snapshot and clears pending

  // Load data and check for pending pull on mount/refresh
  useEffect(() => {
    // Preload the existing pager buffer, independently of the smaller animation
    // preparation range. A quick fling can reach a neighbour before reads finish
    // if data loading waits for the selection/viewability threshold.
    let isMounted = true;
    const loadData = async () => {
      try {
        // Keep the same well's accepted details visible during a refresh.
        // Clearing them on every sync collapses this row and flashes the layout.
        // A different well must never inherit the previous well's details.
        if (lastPullWellRef.current !== wellName) {
          lastPullWellRef.current = wellName;
          setLastPullInfo(null);
        }
        // Don't clear levelSnapshot here - it causes flickering. Instead rely on proper loading.

        // Load well config - MUST await since it's async
        const config = await getWellConfig(wellName);
        if (!isMounted) return;
        const { snapshot, pending, pull, slider: savedSliderPos } = await readWellDisplayData(wellName, config);
        if (!isMounted) return;
        setWellConfig(config);
        const tankHeightFeet = resolveTankHeight(config?.tankHeight);

        // Pre-check for pending pull BEFORE setting levelSnapshot.
        // setLevelSnapshot triggers the live update useEffect — if there's a pending pull,
        // we need drainAnimationActive=true BEFORE that effect runs, otherwise
        // the live update starts a competing 500ms animation (the "double animation" bug).
        if (pending) {
          drainAnimationActive.current = true;
        }

        setLevelSnapshot(snapshot);
        if (snapshot?.unavailable) {
          setLastPullInfo(null);
          setIsLoadingInitial(false);
          return;
        }

        // Load last pull record
        setPullRecord(pull);

        // Calculate bblsPerFoot for level calculations — use the Dashboard-saved
        // effective bbl/ft (same source of truth as Record Load), not 20×tanks.
        const bblsPerFoot = getBblPerFootSync(wellName);

        // Build lastPullInfo - prefer snapshot data from VBA (has levels directly)
        let lastPullDateTime = '';
        // ISO UTC counterpart — preferred input for the h:mm AM/PM display
        // formatter because the local string can be over-truncated upstream.
        let lastPullDateTimeUTC: string | undefined;
        let lastPullBbls = 0;
        let lastPullTopLevel: string | undefined;
        let lastPullBottomLevel: string | undefined;

        // Priority 1: Use levels from snapshot (VBA sends them directly now)
        if (snapshot?.lastPullDateTime) {
          lastPullDateTime = snapshot.lastPullDateTime;
          lastPullDateTimeUTC = snapshot.lastPullDateTimeUTC;
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
            dateTimeUTC: lastPullDateTimeUTC,
            bbls: lastPullBbls,
            topLevel: lastPullTopLevel,
            bottomLevel: lastPullBottomLevel,
          });
        } else {
          // Clear only after an accepted read actually has no last pull.
          setLastPullInfo(null);
        }

        // Load persisted slider position (keeps driver's last setting)
        setSliderFeet(Math.min(savedSliderPos, tankHeightFeet));

        // Use pending pull from pre-check above (already fetched before setLevelSnapshot)
        if (pending) {
          setPendingPull(pending);

          // Always start drain animation — backgroundSync handles the response:
          // 1. Saves snapshot (saveLevelSnapshot)
          // 2. Clears pending pull (clearPendingPull)
          // 3. Notifies listeners → refreshTrigger bumps → loadData re-runs
          // On re-run, pending is null → falls into else branch below
          const bblPerFoot = getBblPerFootSync(wellName);
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
              clampFraction(topLevel / tankHeightFeet),
              { duration: remainingMs, easing: Easing.linear }
            );
          } else {
            // Normal pull: animate drain from top level down to estimated bottom
            const animationProgress = Math.min(elapsedMs / DROP_ANIMATION_MS, 1);
            const currentAnimatedLevel = topLevel - (animationProgress * (topLevel - targetLevel));
            waterFraction.value = clampFraction(currentAnimatedLevel / tankHeightFeet);
            waterFraction.value = withTiming(
              clampFraction(targetLevel / tankHeightFeet),
              { duration: remainingMs, easing: Easing.linear }
            );
          }

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
          if (snapshot) {
            const flowMins = snapshot.flowRateMinutes ?? config?.avgFlowRateMinutes ?? 0;
            const currentLevel = estimatedSnapshotLevel(snapshot, flowMins, Date.now(), tankHeightFeet);
            setTargetFraction(tankFillFraction(currentLevel, tankHeightFeet));
          }
          setIsLoadingInitial(false);
        } else {
          // Normal path: no drain animation, no pending pull
          // Calculate estimated current level from snapshot
          const flowMins = snapshot?.flowRateMinutes ?? config?.avgFlowRateMinutes ?? 0;

          if (snapshot && (startingLevelFromSnapshot(snapshot) > 0 || snapshot.isDown)) {
            const currentLevel = estimatedSnapshotLevel(snapshot, flowMins, Date.now(), tankHeightFeet);

            const fraction = tankFillFraction(currentLevel, tankHeightFeet);

            // The transition hook owns ordinary water-height updates. Loading
            // or refreshing a snapshot must not replace an entry animation.
            setTargetFraction(fraction);
          }
          setIsLoadingInitial(false);
        }
      } catch (error) {
        console.error(`[WellView] Failed to load well data for "${wellName}":`, error);
      } finally {
        if (isMounted) {
          setIsLoadingInitial(false);
        }
      }
    };
    
    // Safety watchdog: ensure initial loading overlay does not hang forever
    const safetyTimer = setTimeout(() => {
      if (isMounted) {
        setIsLoadingInitial(false);
      }
    }, 5000);

    loadData();

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
    };
  }, [wellName, refreshTrigger, waterFraction]);

  // Live level update based on flow rate (now stored in levelSnapshot)
  // Formula matches dashboard: currentLevel = bottomLevel + (minutesSincePull / flowRateMinutes)
  // - levelFeet = bottom level after last pull (from lastPullBottomLevel or currentLevel)
  // - timestamp = time of last pull (from lastPullDateTimeUTC)
  // - flowRateMinutes = minutes per foot of rise (AFR)
  useEffect(() => {
    if (!levelSnapshot || levelSnapshot.unavailable) {
      return;
    }

    // Don't run live updates while drain animation is active (ref avoids re-render cycles)
    if (drainAnimationActive.current) return;

    const flowMins = levelSnapshot.flowRateMinutes ?? 0;

    // Calculate current estimated level
    // Use lastPullBottomLevelFeet if available (more precise), fallback to levelFeet
    const updateEstimate = () => {
      // Skip if drain animation started since this effect was set up
      if (drainAnimationActive.current) return;
      const currentLevel = estimatedSnapshotLevel({ ...levelSnapshot, isDown: wellDown }, flowMins, Date.now(), tankHeightFeet);
      const fraction = tankFillFraction(currentLevel, tankHeightFeet);

      // Queue the newest target without interrupting an entering well.
      setTargetFraction(fraction);
    };

    // Initial update
    updateEstimate();

    // A frozen/no-flow tank still needs its graphic rescaled after a height edit.
    if (wellDown || flowMins <= 0) return;

    // Periodic updates
    liveUpdateRef.current = setInterval(updateEstimate, LIVE_UPDATE_MS);

    return () => {
      if (liveUpdateRef.current) {
        clearInterval(liveUpdateRef.current);
        liveUpdateRef.current = null;
      }
    };
  }, [levelSnapshot, wellDown, waterFraction, drainCompleteSignal, tankHeightFeet]);

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

  const unlockSlider = useCallback(() => {
    if (wellDown) return;
    setSliderLocked(false);
    setSliderPeeking(false);
    activateSliderUI();
    resetSliderLockTimer();
    lastTapTimeRef.current = 0;
  }, [wellDown, activateSliderUI, resetSliderLockTimer]);

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

  useEffect(()=>{
    if (wellConfig?.routeType !== 'freshwater' || !wellConfig.inventoryGroupId || !deliveryAt) {setDeliveryBase(null);return;}
    let cancelled=false; setDeliveryBase({feet:null,rate:null,isDown:false});
    getFreshWaterSupply(wellConfig.inventoryGroupId,deliveryAt.toISOString()).then(supply=>{
      if(!cancelled) setDeliveryBase({feet:supply.status?.projectedFeet ?? null,rate:supply.status?.dailyUseBbl ?? null,isDown:supply.status?.isDown === true});
    }).catch(()=>{if(!cancelled)setDeliveryBase({feet:null,rate:null,isDown:false});});
    return ()=>{cancelled=true;};
  },[deliveryAt,wellConfig]);
  useEffect(()=>{if(wellConfig?.routeType === 'freshwater')setSliderFeet(0);},[wellName,wellConfig?.routeType]);
  const planningFeet = deliveryAt ? deliveryBase?.feet ?? null : levelSnapshot?.unavailable ? null : displayFeet;
  const planningRate = deliveryAt ? deliveryBase?.rate ?? null : levelSnapshot?.dailyBbl ?? null;
  const planningDown = deliveryAt ? deliveryBase?.isDown === true : wellDown;
  const planningTime = deliveryAt ?? new Date();
  // Handle slider changes with custom snapping
  // Above current: standard 3" grid (10'0", 10'3", 10'6"...)
  // Below current: 3" grid based on current level (auto-adjusts as tank fills)
  const handleSliderChange = useCallback((value: number) => {
    if (wellConfig?.routeType === 'freshwater') {
      const feet=Math.max(0,Math.min(tankHeightFeet-(planningFeet ?? tankHeightFeet),Math.round(value*60)/60));
      setSliderFeet(feet); return;
    }
    // Calculate dynamic slider minimum
    const literalLoadLine = wellConfig?.loadLine ?? 1.33;
    const allowedBottom = wellConfig?.allowedBottom ?? 3;
    const sliderMin = allowedBottom < literalLoadLine ? allowedBottom : literalLoadLine;

    // Use current displayed level as reference (auto-updates as tank fills)
    const reference = Math.max(sliderMin, Math.min(tankHeightFeet, displayFeet));
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
    snappedValue = Math.max(sliderMin, Math.min(tankHeightFeet, snappedValue));

    setSliderFeet(snappedValue);

    // Save slider position to storage (persists across app restarts)
    saveSliderPosition(wellName, snappedValue);
  }, [displayFeet, wellName, wellConfig, tankHeightFeet, planningFeet]);

  // Handle slider drag start - activate UI, cancel lock timer, and notify parent
  const handleSliderStart = useCallback(() => {
    // Cancel lock timer while sliding
    if (sliderLockTimerRef.current) {
      clearTimeout(sliderLockTimerRef.current);
      sliderLockTimerRef.current = null;
    }
    activateSliderUI();
    onSliderActiveChange?.(true, wellName);
  }, [activateSliderUI, onSliderActiveChange, wideLayout, wellName]);

  // Handle slider drag end - start lock timer and notify parent
  const handleSliderEnd = useCallback(() => {
    resetSliderLockTimer();
    onSliderActiveChange?.(false, wellName);
  }, [resetSliderLockTimer, onSliderActiveChange, wideLayout, wellName]);

  // Animated style for slider level/datetime fade
  const sliderInfoStyle = useAnimatedStyle(() => ({
    opacity: sliderOpacity.value,
  }));

  // Calculate display values
  const numTanks = wellConfig?.numTanks ?? 1;
  
  // BBLs per foot — Dashboard-saved effective bbl/ft (override or derived from
  // capacity/height/activeTanks), same source of truth as Record Load.
  const bblsPerFoot = getBblPerFootSync(wellName);
  
  // Calculate BBLs available (from current level down to load line)
  const loadLine = wellConfig?.loadLine ?? 0;
  
  // Flow rate display (now from levelSnapshot, not separately cached)
  const flowRate = levelSnapshot?.flowRate ?? wellConfig?.avgFlowRate ?? 'N/A';
  const flowMins = levelSnapshot?.flowRateMinutes ?? wellConfig?.avgFlowRateMinutes ?? 0;
  
  const oneInchFlow = calculateOneInchFlow(flowMins);
  
  // ON is a shared display preference; unavailable wells retain AFR with a lock.
  const afrBblsPerDay = flowMins > 0 ? Math.round((60 / flowMins) * bblsPerFoot * 24) : 0;

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
    readyAtText = t('common.offline');
  } else if (wellConfig?.routeType === 'freshwater') {
    const after=planningFeet == null ? null : planningFeet+Math.min(sliderFeet,tankHeightFeet-planningFeet);
    const minimum=wellConfig.allowedBottom;
    const at=after == null || minimum == null ? null : thresholdTime('freshwater',after,planningTime.toISOString(),planningRate,bblsPerFoot,minimum,planningDown);
    readyAtText=planningDown ? 'Consumption paused' : at ? 'To '+formatFeetInches(minimum!)+' @ '+formatDateTimeSuffix(new Date(at),t('well.today'),t('well.tomorrow')) : 'Forecast unavailable';
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
    const levelAtTime = Math.min(sliderFeet + feetGained, tankHeightFeet);
    const futureTime = new Date(Date.now() + hoursForward * 60 * 60 * 1000);

    // Display: "→ 12' 3" @ 7:00 AM"
    readyAtText = `→ ${formatFeetInches(levelAtTime)} @ ${formatDateTimeSuffix(futureTime, t('well.today'), t('well.tomorrow'))}`;
  }

  // Calculate "Next Pull Ready" - when well reaches ready level, and how many loads available
  // Uses same logic as summary screen: readyLevel = allowedBottom + (loadBbls / bblsPerFoot)
  const calculateNextPullReady = (): { text: string; isReady: boolean; loads: number } => {
    if (wellConfig?.routeType === 'freshwater') {
      const minimum=wellConfig.allowedBottom;
      const at=planningFeet == null || minimum == null ? null : thresholdTime('freshwater',planningFeet,planningTime.toISOString(),planningRate,bblsPerFoot,minimum,planningDown);
      return {text:planningDown ? 'Consumption paused' : at ? formatDateTime(new Date(at),t('well.today'),t('well.tomorrow')) : 'Forecast unavailable',isReady:planningFeet != null && minimum != null && planningFeet<=minimum,loads:0};
    }
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

      if (loads === 1) {
        return {
          text: t('well.readyWithLoads_one', { count: loads }),
          isReady: true,
          loads: 1,
        };
      }
      if (loads > 1) {
        return {
          text: t('well.readyWithLoads_other', { count: loads }),
          isReady: true,
          loads,
        };
      }
      return { text: t('well.ready'), isReady: true, loads: 1 };
    }

    // Not ready yet - calculate when
    if (flowMins <= 0) {
      return { text: t('well.noFlowData'), isReady: false, loads: 0 };
    }

    const feetToGrow = readyLevel - currentLevel;
    const minutesToReady = feetToGrow * flowMins;
    const readyAt = new Date(Date.now() + minutesToReady * 60 * 1000);

    return { text: formatDateTime(readyAt, t('well.today'), t('well.tomorrow')), isReady: false, loads: 0 };
  };

  const nextPullReady = calculateNextPullReady();

  // Wildlife follows the canonical waterline; only the fluid surface sloshes.
  const aliveLayerStyle = useAnimatedStyle(() => ({ top: 0, height: INTERIOR_HEIGHT }));
  // (former floatBobStyle removed — the duck's bob now lives in
  // the surface duck and disabled fisherman scene have their own styles)
  // Fish: movement (sine translateX) on the outer wrapper, facing (scaleX, from
  // the sign of the velocity = cos of the same phase) on the inner glyph — so
  // the flip can never affect position. 🐟 faces left, so flip to -1 (face right)
  // while moving right. Per-fish freq/phase/range come from the stable ref.
  const fa = aliveEgg.fish[0], fb = aliveEgg.fish[1], fc = aliveEgg.fish[2];
  const fishMoveA = useAnimatedStyle(() => {
    if (!sceneActive || aliveEgg.kind !== 'fish') return { opacity: 0 };
    const p = roamingFishPosition(INTERIOR_WIDTH, INTERIOR_HEIGHT, waterFraction.value, fluidOffsets.value, fluidInverted.value, fluidOrientation.value, swim.value, aliveEgg.fish[0], fishEscape.value[0], fishScatter.value, reducedMotion);
    return { ...p, left: p.left - 17, top: p.top - 17 };
  });
  const fishMoveB = useAnimatedStyle(() => {
    if (!sceneActive || aliveEgg.kind !== 'fish') return { opacity: 0 };
    const p = roamingFishPosition(INTERIOR_WIDTH, INTERIOR_HEIGHT, waterFraction.value, fluidOffsets.value, fluidInverted.value, fluidOrientation.value, swim.value, aliveEgg.fish[1], fishEscape.value[1], fishScatter.value, reducedMotion);
    return { ...p, left: p.left - 17, top: p.top - 17 };
  });
  const fishMoveC = useAnimatedStyle(() => {
    if (!sceneActive || aliveEgg.kind !== 'fish') return { opacity: 0 };
    const p = roamingFishPosition(INTERIOR_WIDTH, INTERIOR_HEIGHT, waterFraction.value, fluidOffsets.value, fluidInverted.value, fluidOrientation.value, swim.value, aliveEgg.fish[2], fishEscape.value[2], fishScatter.value, reducedMotion);
    return { ...p, left: p.left - 17, top: p.top - 17 };
  });
  const fishFacing = useSharedValue([-1, -1, -1]);
  useAnimatedReaction(
    () => !sceneActive || aliveEgg.kind !== 'fish' ? null : ({
      angle: fluidOrientation.value,
      positions: [fa, fb, fc].map((fish, i) => roamingFishPosition(
        INTERIOR_WIDTH, INTERIOR_HEIGHT, waterFraction.value, fluidOffsets.value,
        fluidInverted.value, fluidOrientation.value, swim.value, fish,
        fishEscape.value[i], fishScatter.value, reducedMotion,
      )),
    }),
    (current, previous) => {
      if (!current || !previous || Math.abs(current.angle - previous.angle) > 0.02) return;
      fishFacing.value = current.positions.map((position, i) =>
        position.opacity && previous.positions[i].opacity
          ? movementFishFacing(previous.positions[i], position, current.angle, fishFacing.value[i])
          : fishFacing.value[i]);
    },
  );
  const fishFaceA = useAnimatedStyle(() => ({ transform: [{ scaleX: fishFacing.value[0] }] }));
  const fishFaceB = useAnimatedStyle(() => ({ transform: [{ scaleX: fishFacing.value[1] }] }));
  const fishFaceC = useAnimatedStyle(() => ({ transform: [{ scaleX: fishFacing.value[2] }] }));
  // Water-level gate — no critter in an empty/near-empty tank; fish need depth.
  const aliveWaterPct = clampFraction(displayFeet / tankHeightFeet);
  const showFish = aliveEgg.kind === 'fish' && aliveWaterPct > 0.2;
  const showFloat = aliveEgg.kind === 'duck' && aliveWaterPct > 0.12;

  // ── Duck (surface lane): swims its side band, flips at turnarounds,
  // bobs with the ripple, and its glyph is clamped so it stays fully
  // inside the tank even when nearly full. Reduced motion → floats still.
  const duck = aliveEgg.duck;
  // Facing = sign of horizontal velocity (cos of the same phase); flip on
  // the inner glyph only so it can never affect position. 🦆 faces left.
  const duckFaceStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: !reducedMotion && Math.cos(swim.value * TWO_PI + duck.phase) >= 0 ? -1 : 1 }],
  }));
  const duckSurfaceStyle = useAnimatedStyle(() => {
    const x = duck.basePx + (reducedMotion ? 0 : Math.sin(swim.value * TWO_PI + duck.phase) * duck.rangePx);
    const samples = fluidOffsets.value;
    const sample = Math.max(0, Math.min(samples.length - 1, x / INTERIOR_WIDTH * samples.length - 0.5));
    const a = Math.floor(sample), b = Math.min(samples.length - 1, a + 1);
    const localOffset = (samples[a] || 0) + ((samples[b] || 0) - (samples[a] || 0)) * (sample - a);
    const baseTop = INTERIOR_HEIGHT * (1 - waterFraction.value);
    const waterTop = fluidInverted.value ? INTERIOR_HEIGHT * waterFraction.value + localOffset : baseTop - localOffset;
    const wt = Number.isFinite(waterTop) ? Math.max(0, waterTop) : 0;
    const lift = Math.min(DUCK_LIFT_PX, wt);
    return { top: waterTop - baseTop - lift };
  });

  // ── Pelican (above-the-number lane): occasional visitor on a bounded
  // random schedule; perches with its feet on the number's top edge —
  // entirely above the digits, never covering them. ONE timer chain per
  // screen (ref-held) → never multiple pelicans; fully cleaned up on
  // blur/unmount. Reduced motion: stationary perch, no flight animation.
  const [pelicanVisit, setPelicanVisit] = useState<{ side: 'left' | 'right'; jitter: number } | null>(null);
  const pelicanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pelicanIn = useSharedValue(0);
  useEffect(() => {
    // Gated on sceneActive: backgrounding cancels the schedule outright —
    // a suspended timeout can never fire late, and foregrounding starts
    // ONE fresh bounded schedule (missed visits are not replayed).
    if (!sceneActive) { setPelicanVisit(null); return; }
    let cancelled = false;
    const scheduleNext = () => {
      pelicanTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setPelicanVisit({ side: Math.random() < 0.5 ? 'left' : 'right', jitter: Math.random() });
        pelicanTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          setPelicanVisit(null);
          scheduleNext();
        }, PELICAN_VISIT_MS);
      }, nextPelicanDelayMs(Math.random()));
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (pelicanTimerRef.current) { clearTimeout(pelicanTimerRef.current); pelicanTimerRef.current = null; }
      setPelicanVisit(null);
    };
  }, [sceneActive]);
  useEffect(() => {
    if (!pelicanVisit) { pelicanIn.value = 0; return; }
    if (reducedMotion) { pelicanIn.value = 1; return; } // stationary perch
    pelicanIn.value = 0;
    pelicanIn.value = withTiming(1, { duration: 550, easing: Easing.out(Easing.ease) });
    return () => cancelAnimation(pelicanIn);
  }, [pelicanVisit, reducedMotion, pelicanIn]);
  const pelicanStyle = useAnimatedStyle(() => {
    // Track the SAME clamped waterline math the number uses so the feet
    // stay aligned with the number's top edge at every level — then apply
    // the SAFE clamp: keep the whole bird below the interior-top margin,
    // scaling it down (bottom-anchored, feet stay on the number) when the
    // number rides high; skip the visit entirely (opacity 0) when even
    // the minimum scale cannot fit (smallest Fold-cover geometry).
    const waterTop = INTERIOR_HEIGHT * (1 - waterFraction.value);
    const clampedTop = Math.max(INTERIOR_HEIGHT * 0.15, Math.min(INTERIOR_HEIGHT * 0.75, waterTop));
    const numberTop = clampedTop - NUMBER_OFFSET;
    const available = numberTop + PELICAN_FOOT_OVERLAP_PX - PELICAN_TOP_SAFE_MARGIN_PX;
    const scale = Math.min(1, available / PELICAN_HEIGHT);
    const fits = scale >= PELICAN_MIN_SCALE;
    return {
      // Box top: with the bottom-anchored scale below, the VISUAL top is
      // numberTop + overlap·scale − height·scale ≥ the safe margin.
      top: numberTop + PELICAN_FOOT_OVERLAP_PX * scale - PELICAN_HEIGHT,
      opacity: fits ? pelicanIn.value : 0,
      transform: [
        { translateY: (1 - pelicanIn.value) * -8 }, // tiny settle-in "flight"
        { scale: Math.min(1, Math.max(scale, PELICAN_MIN_SCALE)) },
      ],
    };
  });
  
  // Number floats half in/half out of water - positioned from TOP of interior
  const numberStyle = useAnimatedStyle(() => {
    if (wellDown) {
      return { transform: [{ translateY: DOWN_NUMBER_TOP }] };
    }
    // Water surface is at this distance from TOP of interior
    const waterTop = INTERIOR_HEIGHT * (1 - waterFraction.value);
    // Clamp so number stays visible even at very low/high levels
    const clampedTop = Math.max(INTERIOR_HEIGHT * 0.15, Math.min(INTERIOR_HEIGHT * 0.75, waterTop));
    // Offset to center the number on the water line (half above, half below)
    return { transform: [{ translateY: clampedTop - NUMBER_OFFSET }] };
  });
  
  // Waiting message
  // Removed: waitingMessage - no longer showing waiting UI

  // Handle tank tap - double-tap navigates to performance screen
  const handleNormalTankTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTankTapTimeRef.current;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
      // Double-tap detected - navigate to performance
      if (onTankDoubleTap) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onTankDoubleTap(wellName);
      }
      lastTankTapTimeRef.current = 0; // Reset to prevent triple-tap
    } else {
      // First tap - just record the time
      lastTankTapTimeRef.current = now;
    }
  }, [onTankDoubleTap, wellName]);

  // Handle tank long press - hide well from My Wells
  const handleTankLongPress = useCallback(() => {
    if (onTankLongPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      onTankLongPress(wellName);
    }
  }, [onTankLongPress, wellName]);

  const fishTouchedRef = useRef(false);
  const tankTouchOffset = useRef({ x: INTERIOR_LEFT, y: INTERIOR_TOP });
  const handleFishTouch = (x: number, y: number) => {
    if (!showFish || reducedMotion || !fishSceneActiveRef.current) return;
    const angle = fluidOrientation.value;
    const positions = aliveEgg.fish.slice(0, aliveEgg.fishCount).map((f, i) => roamingFishPosition(
      INTERIOR_WIDTH, INTERIOR_HEIGHT, waterFraction.value, fluidOffsets.value, fluidInverted.value, angle,
      swim.value, f, fishEscape.value[i], fishScatter.value,
    ));
    const directions = fishScatterDirections(positions, x - tankTouchOffset.current.x, y - tankTouchOffset.current.y, angle, 42, INTERIOR_WIDTH, INTERIOR_HEIGHT);
    if (!directions) return;
    fishTouchedRef.current = true;
    lastTankTapTimeRef.current = 0;
    cancelAnimation(fishScatter);
    fishEscape.value = [...directions, ...fishEscape.value.slice(directions.length)];
    fishScatter.value = 0;
    fishScatter.value = withSequence(
      withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }),
      withDelay(180, withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) })),
    );
  };

  const tankPanel=(
<View style={[styles.tankSection,fittedFold ? {height:portraitTankHeight,flexGrow:0,flexShrink:0} : foldablePhoneLayout ? {flexBasis:portraitTankHeight,maxHeight:portraitTankHeight,flexShrink:1,minHeight:0} : !wideLayout && {height:portraitTankHeight,flexShrink:1,minHeight:0}]} onLayout={event => {
          const {height,width} = event.nativeEvent.layout;
          setTankSlotWidth(previous=>Math.abs(previous-width)>0.5 ? width : previous);
          setTankSlotHeight(previous => Math.abs(previous-height)>0.5 ? height : previous);
        }}>
        <View style={{position:'absolute',width:foldablePhoneLayout||!wideLayout?TANK_WIDTH*0.92:TANK_WIDTH,height:TANK_HEIGHT,
          left:'50%',top:'50%',marginLeft:-(foldablePhoneLayout||!wideLayout?TANK_WIDTH*0.92:TANK_WIDTH)/2,marginTop:-TANK_HEIGHT/2,
          opacity:foldablePhoneLayout||!wideLayout||tankSlotHeight>0 ? 1 : 0,transform:[{scale:tankScale}]}}>
        <Pressable onPressIn={event => { fishTouchedRef.current = false; handleFishTouch(event.nativeEvent.locationX, event.nativeEvent.locationY); }}
          onPress={() => { if (!fishTouchedRef.current) handleNormalTankTap(); }}
          onLongPress={() => { if (!fishTouchedRef.current) handleTankLongPress(); }} delayLongPress={500}>
        <View pointerEvents="none" style={styles.tankOuter} onLayout={event => { const { x, y } = event.nativeEvent.layout; tankTouchOffset.current = { x: x + INTERIOR_LEFT, y: y + INTERIOR_TOP }; }}>
          {/* Tank count badge - at BOTTOM right */}
          <View style={styles.tankBadge}>
            <Text style={styles.tankBadgeText}>{numTanks}</Text>
          </View>
          <View style={styles.tankInterior}>
            <View style={styles.waterWrapper}>
              <TankFlipWater width={INTERIOR_WIDTH} height={INTERIOR_HEIGHT} fill={waterFraction} offsets={fluidOffsets} inverted={fluidInverted} renderScale={tankScale*panelScale} />
            </View>

            {/* Fish use the current fluid geometry to remain submerged under tilt. */}
            <Animated.View pointerEvents="none" style={[styles.aliveLayer, aliveLayerStyle]}>
              {showFish && (
                <>
                  <Animated.View style={[styles.aliveFishWrap, fishMoveA]}>
                    <View style={styles.fishTouchTarget}>
                      <Animated.Text pointerEvents="none" style={[styles.aliveFishGlyph, fishFaceA]}>🐟</Animated.Text>
                    </View>
                  </Animated.View>
                  {aliveEgg.fishCount > 1 && (
                    <Animated.View style={[styles.aliveFishWrap, fishMoveB]}>
                      <View style={styles.fishTouchTarget}>
                      <Animated.Text pointerEvents="none" style={[styles.aliveFishGlyph, fishFaceB]}>🐟</Animated.Text>
                    </View>
                    </Animated.View>
                  )}
                  {aliveEgg.fishCount > 2 && (
                    <Animated.View style={[styles.aliveFishWrap, fishMoveC]}>
                      <View style={styles.fishTouchTarget}>
                      <Animated.Text pointerEvents="none" style={[styles.aliveFishGlyph, fishFaceC]}>🐟</Animated.Text>
                    </View>
                    </Animated.View>
                  )}
                </>
              )}
            </Animated.View>

            {/* Surface layer — NOT clipped (so the wave crests show ABOVE the flat
                blue edge; an overflow-hidden layer was eating them). Holds the
                any floating critter, placed OFF-CENTRE so it never
                sits behind the level text. Clipped only by the tank interior. */}
            <Animated.View pointerEvents="none" style={[styles.aliveSurfaceLayer, aliveLayerStyle]}>
              {showFloat && aliveEgg.kind === 'duck' && (
                // Rendered AFTER the water fill (later sibling ⇒ above the
                // blue layer). Belly just in the waterline, most of the
                // body above it; band + clamp keep it inside the tank.
                <Animated.View
                  pointerEvents="none"
                  style={[styles.aliveDuckWrap, duckSurfaceStyle]}
                >
                  <Animated.Text
                    accessible={false}
                    importantForAccessibility="no"
                    style={[styles.aliveDuckGlyph, duckFaceStyle]}
                  >🦆</Animated.Text>
                </Animated.View>
              )}
            </Animated.View>

            {/* Fisherman/hooked-fish decoration is disabled: its Reanimated
                worklets crashed the Android release UI thread (no React
                error screen — the app closed). Optional wildlife must never
                block WellView. */}

            {/* Pelican — occasional visitor perched on the level number's
                top edge; entirely above the digits, never covering them. */}
            {pelicanVisit && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.pelicanWrap,
                  { left: pelicanPerchX(INTERIOR_WIDTH, pelicanVisit.side, pelicanVisit.jitter) },
                  pelicanStyle,
                ]}
              >
                <TankPelican facingRight={pelicanVisit.side === 'left'} />
              </Animated.View>
            )}

            <Animated.View pointerEvents="none" style={[styles.numberContainer, numberStyle]}>
              <TankReadout fill={waterFraction} height={tankHeightFeet} kind="level" entryFraction={entryFraction} active={sceneActive} prepared={entryPrepared}
                unavailable={levelSnapshot?.unavailable ? t('common.unavailable') : null}
                style={levelSnapshot?.unavailable ? styles.tankUnavailableLabel : styles.tankNumber} />
            </Animated.View>
          </View>
          <View pointerEvents="none" style={styles.tankFrame}>
            <Image source={WellBuiltTankFrame} style={{ width: '100%', height: '100%' }} resizeMode="stretch" />
          </View>
          
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
            <TankReadout fill={waterFraction} height={tankHeightFeet} kind="bbl" entryFraction={entryFraction} active={sceneActive} prepared={entryPrepared}
              loadLine={loadLine} bblPerFoot={bblsPerFoot} unit={t('units.bbl')}
              unavailable={levelSnapshot?.unavailable ? '-- '+t('units.bbl') : null} style={styles.bblsAvailableText} />
          </View>
        </View>
        </Pressable>
        {/* Sibling of the tank Pressable: never bubbles into its double/long press. */}
        <Pressable testID="tank-info-button" accessibilityRole="button" accessibilityLabel={t('tankInfo.open')}
          style={styles.tankInfoTouchTarget}
          onPressIn={() => { lastTankTapTimeRef.current = 0; }}
          onPress={() => { lastTankTapTimeRef.current = 0; setShowTankInfo(true); }}>
          <View style={styles.tankInfoBadge}><Text style={styles.tankInfoBadgeText}>i</Text></View>
        </Pressable>
        </View>
        {showTankInfo && isActive && <TankInfoModal wellName={wellName}
          fallback={(wellConfig || {}) as unknown as TankConfig}
          onClose={() => { lastTankTapTimeRef.current = 0; setShowTankInfo(false); }}
          onSaved={() => { void (async () => {
            try { await loadWellConfig(true); setWellConfig(await getWellConfig(wellName)); }
            catch { /* Confirmed info stays cached; normal catalogue refresh retries. */ }
          })(); }} />}
      </View>
  );
  const statisticsPanel=(<>
{/* Quick stats */}
      <View style={styles.statsSection}>
        <Pressable
          onPress={() => {
            // Tap to peek effective tank math (bbl/in • bbl/ft); tap again to
            // switch back immediately. Auto-reverts to time/in • time/ft after
            // ~4s if left open. Available on all wells.
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            // Always clear any pending revert first — no stacked timers.
            if (tankMathTimerRef.current) {
              clearTimeout(tankMathTimerRef.current);
              tankMathTimerRef.current = null;
            }
            if (showTankMath) {
              // Already open → dismiss immediately.
              setShowTankMath(false);
            } else {
              // Open + start a fresh ~4s auto-revert.
              setShowTankMath(true);
              tankMathTimerRef.current = setTimeout(() => setShowTankMath(false), 4000);
            }
          }}
        >
          <View style={styles.statsRow}>
            {showTankMath ? (
              <>
                <Text style={styles.statLeft}>{(bblsPerFoot / 12).toFixed(2)} {t('units.bbl')}{t('units.perInch')}</Text>
                <Text style={styles.statDivider}>•</Text>
                <Text style={styles.statRight}>{bblsPerFoot.toFixed(1)} {t('units.bbl')}{t('units.perFoot')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.statLeft}>{oneInchFlow}{t('units.perInch')}</Text>
                <Text style={styles.statDivider}>•</Text>
                <Text style={styles.statRight}>{wellConfig?.routeType === 'freshwater' ? formatRateDuration(flowMins) : formatFlowRate(flowRate)}{t('units.perFoot')}</Text>
              </>
            )}
          </View>
        </Pressable>
        <ProductionRateRow
          afrDaily={afrBblsPerDay}
          overnightDaily={levelSnapshot?.overnightBblsDay}
          estimated={levelSnapshot?.overnightEstimatedTime}
          freshwater={wellConfig?.routeType === 'freshwater'}
          consumptionDaily={levelSnapshot?.dailyBbl}
          showOvernight={showOvernightBbls}
          onToggle={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggleOvernightBbls?.();
          }}
          styles={styles}
          hourUnit={`${t('units.bbl')}${t('units.perHour')}`}
          dayUnit={`${t('units.bbl')}${t('units.perDay')}`}
          accessibilityLabel={t('well.toggleOvernight')}
          lockedHint={t('well.overnightUnavailable')}
        />

        {/* Last pull info - below stats, two lines for readability */}
        {lastPullInfo && lastPullInfo.dateTime && (
          <View style={styles.lastPullContainer}>
            <Text style={styles.lastPullLabel}>{t('well.lastPull')}</Text>
            <Text style={styles.lastPullInfo}>
              {formatLastPullTime(lastPullInfo.dateTime, lastPullInfo.dateTimeUTC)}
              {lastPullInfo.topLevel && lastPullInfo.bottomLevel
                ? ` • ${lastPullInfo.topLevel} → ${lastPullInfo.bottomLevel}`
                : ''}
              {lastPullInfo.bbls ? ` • ${lastPullInfo.bbls} ${t('units.bbl')}` : ''}
            </Text>
          </View>
        )}
      </View>
  </>);
  const deliveryPanel=(
wellConfig?.routeType === 'freshwater' && <View style={{alignItems:'center',paddingHorizontal:12}}>
        <TouchableOpacity onPress={()=>setDeliveryPicker('date')}><Text style={styles.nextPullLabel}>Assumed delivery: {deliveryAt ? formatDateTime(deliveryAt) : 'Now'} (change)</Text></TouchableOpacity>
        {deliveryAt && <TouchableOpacity onPress={()=>setDeliveryAt(null)}><Text style={styles.nextPullLabel}>Use now</Text></TouchableOpacity>}
        {deliveryPicker && <DateTimePicker value={deliveryAt ?? new Date()} mode={deliveryPicker} onChange={(event,date)=>{
          const mode=deliveryPicker;setDeliveryPicker(null);
          if(event.type==='set' && date){setDeliveryAt(date);if(mode==='date')setDeliveryPicker('time');}
        }}/>}
      </View>
  );
  const planningPanel=(
(() => {
        // Calculate slider minimum: use loadLine (1.33') or allowedBottom if lower
        const literalLoadLine = wellConfig?.routeType === 'freshwater' ? 0 : wellConfig?.loadLine ?? 1.33;
        const allowedBottom = wellConfig?.allowedBottom ?? 3;
        // If allowedBottom < literal load line, use allowedBottom only
        // Otherwise use literal load line as minimum, with allowedBottom marker if higher
        const sliderMin = allowedBottom < literalLoadLine ? allowedBottom : literalLoadLine;
        const showAllowedBottomMarker = wellConfig?.routeType !== 'freshwater' && allowedBottom > literalLoadLine;

        // Calculate position of allowedBottom marker as percentage of slider range
        // Account for the slider track width (excluding Pull/Fill labels which are 50px each)
        const sliderRange = tankHeightFeet - sliderMin;
        const allowedBottomPercent = ((allowedBottom - sliderMin) / sliderRange) * 100;

        // Color coding for ready time text (not level - keep level white for consistency):
        // - Green: safe range (slider above allowedBottom but below ready level - normal pull)
        // - Blue: above ready level (fill side)
        // - Red: below allowedBottom (danger zone)
        const readyLevel = allowedBottom + (loadBbls / bblsPerFoot);
        let readyTimeColor = '#60A5FA'; // Default blue
        if (!wellDown && !sliderLocked && wellConfig?.routeType !== 'freshwater') {
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
            <SliderInfoSlot showPrimary={showNextPull} style={styles.sliderInfoContainer}
              primary={(
                <>
                  <Text style={styles.nextPullLabel}>{wellConfig?.routeType === 'freshwater' ? 'Minimum '+(wellConfig.allowedBottom==null?'unknown':formatFeetInches(wellConfig.allowedBottom))+' (no delivery)' : t('well.nextPull', 'Next Load')}</Text>
                  <Text style={[
                    styles.nextPullTime,
                    nextPullReady.isReady && styles.nextPullReady
                  ]}>
                    {nextPullReady.text}
                  </Text>
                </>
              )}
              secondary={(
                <Animated.View style={[styles.sliderInfoInner, sliderInfoStyle]}>
                  <View style={styles.sliderValueRow}>
                    <Text style={[styles.sliderValue, wellDown && styles.textDisabled]}>{wellConfig?.routeType === 'freshwater' ? planningFeet == null ? 'Unknown' : formatFeetInches(planningFeet+Math.min(sliderFeet,tankHeightFeet-planningFeet)) : formatFeetInches(sliderFeet)}</Text>
                    {wellConfig?.routeType === 'freshwater' && <Text style={styles.sliderBbls}> +{Math.round(Math.min(sliderFeet,tankHeightFeet-(planningFeet ?? tankHeightFeet))*bblsPerFoot)} BBL</Text>}
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
            />

            <View style={styles.sliderRowContainer}>
              {/* Level markers row - above slider, aligned with Pull/Fill words (not arrows) */}
              <View style={styles.sliderMarkersRow}>
                <Text style={styles.sliderMarkerArrowLeft}>←</Text>
                <Text style={[
                  styles.sliderMarkerLeft,
                  !showAllowedBottomMarker && styles.sliderMarkerAllowedBottom
                ]}>{wellConfig?.routeType === 'freshwater' ? '0 BBL' : formatFeetInches(sliderMin)}</Text>
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
                <Text style={styles.sliderMarkerRight}>{wellConfig?.routeType === 'freshwater' ? Math.floor((tankHeightFeet-(planningFeet ?? tankHeightFeet))*bblsPerFoot)+' BBL' : formatFeetInches(tankHeightFeet)}</Text>
                <Text style={styles.sliderMarkerArrowRight}>→</Text>
              </View>

              <View style={styles.sliderRow}>
                <Text style={[styles.sliderArrowLeft, wellDown && styles.textDisabled]}>←</Text>
                <Text style={[styles.sliderEndWord, wellDown && styles.textDisabled]}>{wellConfig?.routeType === 'freshwater' ? 'Less' : t('well.pull')}</Text>
                <View style={styles.sliderWrapper} pointerEvents={sliderLocked ? "none" : "auto"}>
                  <Slider
                    layoutScale={panelScale}
                    containerStyle={styles.slider}
                    dragGain={wideLayout ? 1 : undefined}
                    trackClickable={!wideLayout}
                    thumbTouchSize={wideLayout ? {width:44,height:54} : undefined}
                    minimumValue={wellConfig?.routeType === 'freshwater' ? 0 : sliderMin}
                    maximumValue={wellConfig?.routeType === 'freshwater' ? Math.max(0.001,tankHeightFeet-(planningFeet ?? tankHeightFeet)) : tankHeightFeet}
                    step={0.01}
                    value={wellConfig?.routeType === 'freshwater' ? Math.min(sliderFeet,tankHeightFeet-(planningFeet ?? tankHeightFeet)) : sliderFeet}
                    onValueChange={(val) => handleSliderChange(Array.isArray(val) ? val[0] : val)}
                    onSlidingStart={handleSliderStart}
                    onSlidingComplete={val => { handleSliderChange(Array.isArray(val) ? val[0] : val); handleSliderEnd(); }}
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
                <Text style={[styles.sliderEndWord, wellDown && styles.textDisabled]}>{wellConfig?.routeType === 'freshwater' ? 'Deliver' : t('well.fill')}</Text>
                <Text style={[styles.sliderArrowRight, wellDown && styles.textDisabled]}>→</Text>
                {/* Overlay to capture taps when locked - covers full slider row */}
                {sliderLocked && (
                  <Pressable
                    onPress={wideLayout ? unlockSlider : handleSliderTrackTap}
                    accessibilityRole="button"
                    accessibilityLabel={wideLayout ? 'Unlock slider for '+wellName : t('slider.unlockHint', 'Tap to peek  •  Double tap to unlock')}
                    style={styles.sliderOverlay}
                  />
                )}
              </View>
            </View>
            {/* Unlock hint - always visible when locked to prevent layout jumping */}
            <Text style={[styles.unlockHint, !sliderLocked && styles.unlockHintHidden]}>
              {wideLayout ? 'Tap the lock or track to unlock' : t('slider.unlockHint', 'Tap to peek  •  Double tap to unlock')}
            </Text>
          </View>
        );
      })()
  );
  const panels={tank:tankPanel,statistics:statisticsPanel,delivery:deliveryPanel,planning:planningPanel,rootStyle:styles.wellView,topStyle:styles.topSection};
  return <WellCardLayout {...panels} wideLayout={wideLayout} fixedPanel={fittedFold} contentWidth={foldablePhoneLayout ? contentWidth : undefined}/>;

});

// Main screen
export default function MainScreen() {
  useEffect(()=>{
    if(typeof getStaticFeatureFlag==='function')console.log('[WellRenderFastProps]',getStaticFeatureFlag('ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS'));
  },[]);
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const reportedWindow=useWindowDimensions();
  const [foldWindow,setFoldWindow]=useState<{width:number;height:number}|null>(null);
  // Android's window event may lag the actual root after unfolding/resuming.
  // Measure the root even during startup, before mounting any pager cells.
  const windowSize=foldablePhoneLayout && foldWindow ? foldWindow : reportedWindow;
  const handleRootLayout=useCallback((event: {nativeEvent:{layout:{width:number;height:number}}})=>{
    if(!foldablePhoneLayout)return;
    const {width,height}=event.nativeEvent.layout;
    if(width<=0 || height<=0)return;
    setFoldWindow(previous=>previous && Math.abs(previous.width-width)<0.5 && Math.abs(previous.height-height)<0.5 ? previous : {width,height});
  },[]);
  const {columns,cardWidth,viewportHeight}=tankViewport(windowSize.width,windowSize.height);
  const styles=foldablePhoneLayout ? portraitStyles(wellContentWidth(cardWidth),wellContentWidth(cardWidth)*2.2) : columns===1 ? portraitStyles(windowSize.width,windowSize.height) : landscapeScreenStyles;
  const [visibleWellIndices,setVisibleWellIndices]=useState<number[]>([]);
  const [focusedIndex,setFocusedIndex]=useState<number|null>(null);
  const pickerListRef = useRef<FlatList>(null);

  // Track levels for ALL wells, not just the active one
  const wellLevels = useRef<{ [wellName: string]: SharedValue<number> }>({});
  const [entryFraction, setEntryFraction] = useState(0);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  // A resize is not a swipe. Deliver the new width and matching native offset
  // together, and ignore intermediate viewability at the previous pixel offset.
  const pagerViewport=useMemo(()=>({width:cardWidth,columns}),[cardWidth,columns]);
  const [pagerAlignRevision,setPagerAlignRevision]=useState(0);
  const previousPagerViewport=useRef(pagerViewport);
  const pagerResizing=useRef(false);
  const pagerInteraction=useRef(false);
  const viewportChanged=previousPagerViewport.current!==pagerViewport;
  const selectionCatalogueRef = useRef<{
    owner: Awaited<ReturnType<typeof captureWellSelectionOwner>>;
    eligible: string[];
  } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showMore, setShowMore] = useState(false); // WB-M "More" sheet (Route Me / Summary / Switch Apps)
  const [tempSelectedIndex, setTempSelectedIndex] = useState(0);
  const [wellSearch, setWellSearch] = useState('');
  const wellSearchQuery = wellSearch.trim().toLocaleLowerCase();
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
  const [wellRefreshes, setWellRefreshes] = useState<Record<string, number>>({});
  const [pickerScrolling, setPickerScrolling] = useState(false);
  const [sliderActive, setSliderActive] = useState(false);
  const activeSliders = useRef(new Set<string>());
  const handleSliderActiveChange = useCallback((active:boolean,wellName:string) => {
    if (active) activeSliders.current.add(wellName);
    else activeSliders.current.delete(wellName);
    setSliderActive(activeSliders.current.size > 0);
  }, []);
  const [wells, setWells] = useState<string[]>([]);
  const wellCatalogueRef=useRef(wells);
  wellCatalogueRef.current=wells;
  // Align the committed catalogue/geometry/explicit selection together. Ordinary
  // visibility updates during a drag must NOT snap native scrolling mid-gesture.
  // The latest selection is sampled only for these alignment requests.
  const pagerSelectionRef=useRef({index:currentIndex,columns});
  pagerSelectionRef.current={index:currentIndex,columns};
  const pagerContentOffset=useMemo(()=>({x:cardWidth*pagerSelectionRef.current.index,y:0}),[cardWidth,wells,pagerAlignRevision]);
  useLayoutEffect(()=>{
    const {index,columns}=pagerSelectionRef.current;
    pagerResizing.current=true;
    pagerInteraction.current=false;
    previousPagerViewport.current=pagerViewport;
    if(columns===1)setFocusedIndex(null);
    setVisibleWellIndices(Array.from({length:columns},(_,i)=>index+i).filter(i=>i<wells.length));
    flatListRef.current?.scrollToOffset({offset:pagerContentOffset.x,animated:false});
  },[pagerViewport,wells,pagerContentOffset]);
  const pagerWidthRange=useRef({min:cardWidth,max:cardWidth});
  const pagerBuffer=wellPagerBuffer(currentIndex,wells.length,windowSize.width,windowSize.height,pagerWidthRange.current);
  pagerWidthRange.current=pagerBuffer.widths;
  const actionIndex=Math.max(0,Math.min(focusedIndex ?? currentIndex,wells.length-1));
  const visibleWellRef = useRef({ well: wells[currentIndex], index: currentIndex });
  visibleWellRef.current = { well: wells[currentIndex], index: currentIndex };
  const homeStartedAt=useRef(Date.now());
  const reportedHome=useRef(false);
  useEffect(()=>{
    if(!isInitialSyncing && wells.length>0 && !reportedHome.current){
      reportedHome.current=true;
      console.info('WBPERF_SPAN '+JSON.stringify({app:'mobile',category:'render',name:'home.content',durationMs:Math.max(0,Date.now()-homeStartedAt.current)}));
    }
  },[isInitialSyncing,wells.length]);
  const [wellConfigMap, setWellConfigMap] = useState<WellConfigMap | null>(null); // For route info
  const [loadBbls, setLoadBbls] = useState(140); // Load size from Summary screen
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false); // Sync indicator
  const [currentWellHasDraft, setCurrentWellHasDraft] = useState(false); // Draft indicator for Pull button
  const [isViewer, setIsViewer] = useState(false); // Viewer-only mode (can't submit pulls)
  const [appForegroundCount, setAppForegroundCount] = useState(0); // Foreground and visible-screen catalogue refresh generation
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
            setPagerAlignRevision(n=>n+1);
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

  // Restore owner-bound cached content before background synchronization.
  useEffect(() => {
    let cancelled = false;
    const initSync = async () => {
      console.log('[Main] ====== SETUP FLOW STARTED ======');
      console.log('[Main] Platform:', Platform.OS);

      // Firebase doesn't need OAuth - skip auth step
      console.log('[Main] Using Firebase - no auth needed');
      setSetupSteps(s => ({ ...s, auth: 'done' }));

      // Check if first install or returning user (cold/warm start)
      // The old global has-synced flag is not account evidence. This read
      // installs only the current SDK owner's fenced durable bootstrap.
      const generation = getSessionGeneration();
      const hasData = await hasEstablishedWbmEntry()
        && await AsyncStorage.getItem('@wellbuilt_has_synced') === 'true';
      if (cancelled || generation !== getSessionGeneration()) return;
      if (hasData) {
        setIsFreshInstall(false);
        setIsInitialSyncing(false);
        setRefreshTrigger(prev => prev + 1);
        startBackgroundSync();
        // Cached content is already usable; cloud sync must not gate it.
        void syncFromProcessedFolder().then(() => {
          if (!cancelled && generation === getSessionGeneration()) setRefreshTrigger(prev => prev + 1);
        }).catch(() => { console.info('[Main] Background refresh deferred; cached data retained'); });
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
        const filteredConfig = scopedWellsForDisplay(config, assignment);
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
    
    initSync().catch((err: unknown) => {
      const name = err instanceof Error ? err.name : 'Error';
      const msg = err instanceof Error ? err.message : '';
      console.log('[Main] initSync failed', name, /token|passcode|bearer/i.test(msg) ? '' : String(msg).slice(0, 80));
      setIsInitialSyncing(false);
    });
    
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      console.log('[Main] AppState changed to:', nextAppState);
      if (nextAppState === 'active') {
        startBackgroundSync();
        void syncOnForeground();
        // Re-trigger well load — covers returning from dead zone while backgrounded
        setAppForegroundCount(prev => prev + 1);
      } else {
        stopBackgroundSync();
        // Auto-flush debug logs to Firebase when app goes to background
        autoFlushIfNeeded();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
      stopBackgroundSync();
    };
  }, []);

  // Subscribe to background sync status for UI indicator
  useEffect(() => {
    const unsubscribe = onSyncStatusChange((syncing, changedWells) => {
      setIsBackgroundSyncing(syncing);
      // A single changed packet must not reload every mounted well card.
      if (!syncing && changedWells.length) {
        setWellRefreshes(previous => {
          const next = { ...previous };
          for (const name of new Set(changedWells)) next[name] = (next[name] || 0) + 1;
          return next;
        });
      }
    });
    return unsubscribe;
  }, []);

  // Trigger refresh when screen comes into focus (returning from record.tsx, summary, or settings)
  // Also refresh on foreground and the visible-screen catalogue cadence, not on swipes.
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

      let cancelled = false;
      const generation = getSessionGeneration();
      const isCurrentLoad = () => !cancelled && generation === getSessionGeneration();

      // Load wells from config and filter by selections
      // This handles: returning from Settings (well selection changed),
      // returning from Summary (jump to well), fresh install
      const loadSelectedWellsAndJump = async () => {
        // STEP 1: Instantly load cached wells so the screen is never blank.
        // This runs BEFORE any async fetch — driver sees their wells immediately.
        let usedCache = false;
        try {
          const cachedWells = await AsyncStorage.getItem(STORAGE_KEY_LAST_GOOD_WELLS);
          if (!isCurrentLoad()) return;
          if (cachedWells) {
            const parsed = JSON.parse(cachedWells) as string[];
            if (parsed.length > 0 && wellCatalogueRef.current.length === 0) {
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
        let catalogueResolved = false;
        let config: WellConfigMap | null = null;
        let allWellNames: string[] = [];
        let filteredWells: string[] = [];

        try {
          const selectionOwner = await captureWellSelectionOwner();
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

          // Fetch the latest assigned catalogue, with durable offline fallback.
          config = await fetchWellConfigMap();
          if (!isCurrentLoad()) return;
          setWellConfigMap(config); // Save for route info display
          allWellNames = config ? Object.keys(config) : [];

          // RECOVERY: If config cache is empty/corrupt, force refresh from Firebase
          if (allWellNames.length === 0) {
            console.log('[Main] Config cache empty — force refreshing from Firebase');
            config = await fetchWellConfigMap(true);
            setWellConfigMap(config);
            allWellNames = config ? Object.keys(config) : [];
          }

          // Filter wells by driver's route assignment FIRST, then by user selections
          const assignment = await fetchDriverRouteAssignment();
          const assignedConfig = scopedWellsForDisplay(config!, assignment);
          const assignedWellNames = Object.keys(assignedConfig);
          console.log('[Main] Route assignment filter:', assignedWellNames.length, 'of', allWellNames.length, 'wells', assignment.status);

          filteredWells = await loadSelectedWells(selectionOwner, assignedWellNames);
          catalogueResolved = true;
          if (!isCurrentLoad()) return;
          selectionCatalogueRef.current = { owner: selectionOwner, eligible: assignedWellNames };

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
          if (!isCurrentLoad() || (e instanceof Error && e.message === 'selection_session_changed')) return;
          console.error('[Main] CRITICAL: loadSelectedWellsAndJump crashed, attempting recovery:', e);
          debugLog(`Well load CRASHED: ${e}. Attempting recovery...`, 'error');
          try {
            if (!config) {
              config = await fetchWellConfigMap();
              setWellConfigMap(config);
            }
            if (config) {
              const owner = await captureWellSelectionOwner();
              const assignment = await fetchDriverRouteAssignment();
              filteredWells = await loadSelectedWells(owner, Object.keys(scopedWellsForDisplay(config, assignment)));
              catalogueResolved = true;
              console.log('[Main] Recovery: loaded', filteredWells.length, 'wells from config fallback');
              debugLog(`Well recovery: loaded ${filteredWells.length} wells from config fallback`, 'warn');
            }
          } catch (recoveryError) {
            console.error('[Main] Recovery also failed:', recoveryError);
            debugLog(`Well recovery FAILED: ${recoveryError}`, 'error');
          }
        }

        // LAST RESORT: Load the last known good well list from previous session
        if (!catalogueResolved && filteredWells.length === 0) {
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

        if (!isCurrentLoad()) return;
        if (catalogueResolved && filteredWells.length === 0) {
          setWells([]);
          setCurrentIndex(0);
          await AsyncStorage.setItem(STORAGE_KEY_LAST_GOOD_WELLS, '[]');
          return;
        }

        // Set wells — if we got results, update the list (replaces instant cache if it was used)
        if (filteredWells.length > 0) {
          console.log('[Main] Loaded', filteredWells.length, 'wells');
          const previousVisible = visibleWellRef.current;
          const retained = filteredWells.indexOf(previousVisible.well || '');
          setWells(previous => previous.length === filteredWells.length
            && previous.every((well, i) => well === filteredWells[i]) ? previous : filteredWells);
          setCurrentIndex(prev => retained >= 0 ? retained : Math.min(prev, filteredWells.length - 1));
          if (retained >= 0 && retained !== previousVisible.index) setPagerAlignRevision(n=>n+1);

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
              setPagerAlignRevision(n=>n+1);
            }
          }
        } catch (e) {
          console.log('[Main] Error handling jump-to-well:', e);
        }
      };
      loadSelectedWellsAndJump();

      // Refresh the assigned catalogue while this screen remains visible too.
      const catalogueTimer = setInterval(() => {
        if (AppState.currentState === 'active') setAppForegroundCount(n => n + 1);
      }, 60_000);

      // Cleanup: cancel retry timer when focus changes
      return () => {
        cancelled = true;
        clearInterval(catalogueTimer);
        if (wellRetryTimer.current) {
          clearTimeout(wellRetryTimer.current);
          wellRetryTimer.current = null;
        }
      };
    }, [isInitialSyncing, appForegroundCount])
  );

  // Recheck on return from Record, even when the selected well has not changed.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setCurrentWellHasDraft(false);
    if (wells.length > 0 && actionIndex >= 0 && actionIndex < wells.length) {
      const key = getDraftKey(wells[actionIndex]);
      AsyncStorage.getItem(key).then(draftJson => {
        if (cancelled) return;
        try {
          const draft = draftJson ? JSON.parse(draftJson) : null;
          const ageMs = draft ? Date.now() - draft.savedAt : Infinity;
          setCurrentWellHasDraft(!!draft && ageMs >= 0 && ageMs < 4 * 60 * 60 * 1000 && !!(draft.level || draft.barrels));
        } catch {
          setCurrentWellHasDraft(false);
        }
      }).catch(() => { if (!cancelled) setCurrentWellHasDraft(false); });
    }
    return () => { cancelled = true; };
  }, [wells, actionIndex]));

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
        'Your account is view-only. Contact an admin to enable load submissions.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (wells.length > 0) {
      router.push({
        pathname: '/record',
        params: { wellName: wells[actionIndex] },
      });
    }
  }, [router, wells, actionIndex, isViewer, alert, t]);

  // Navigate to settings
  const handleSettingsPress = useCallback(() => {
    router.push('/settings');
  }, [router]);

  // Navigate to summary
  const handleSummaryPress = useCallback(() => {
    router.push('/summary');
  }, [router]);

  // Freeze the actual displayed frame, not the destination's preloaded level.
  const captureTransitionStart = useCallback((fromIndex=currentIndex) => {
    const fraction = wellLevels.current[wells[fromIndex]]?.value;
    console.log('[WellSwipeOrigin]', {fromIndex,selectedIndex:currentIndex,well:wells[fromIndex],fraction});
    if (Number.isFinite(fraction)) setEntryFraction(Math.max(0, Math.min(1, fraction)));
  }, [wells, currentIndex]);

  // Handle well change from swipe
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if(!pagerInteraction.current || viewportChanged || pagerResizing.current)return;
    setVisibleWellIndices(viewableItems.flatMap(item=>item.index==null?[]:[item.index]));
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      // Layout/viewability can fire without a swipe. Keep the touched right card
      // selected until it actually leaves the visible pair.
      setFocusedIndex(previous => previous !== null && viewableItems.some(item=>item.index===previous) ? previous : null);
      const newIndex = viewableItems[0].index;
      // Entry fraction was frozen once at drag start, before any threshold changes.
      if (newIndex !== currentIndex) {
        console.log('[Main] Swipe: currentIndex', currentIndex, '→', newIndex);
      }
      setCurrentIndex(newIndex);
    }
  }, [currentIndex, viewportChanged]);

  const handlePagerDrag=useCallback((event?:{nativeEvent:{contentOffset:{x:number}}})=>{
    pagerInteraction.current=true;
    pagerResizing.current=false;
    const offset=event?.nativeEvent.contentOffset.x;
    const fromIndex=typeof offset==='number' && Number.isFinite(offset)
      ? Math.max(0,Math.min(wells.length-1,Math.round(offset/cardWidth))) : currentIndex;
    captureTransitionStart(fromIndex);
  },[captureTransitionStart,wells.length,cardWidth,currentIndex]);

  const handlePagerPosition=useCallback((event:{nativeEvent:{contentOffset:{x:number}}})=>{
    if(!pagerInteraction.current || pagerResizing.current || !wells.length)return;
    const offset=event.nativeEvent.contentOffset.x;
    if(!Number.isFinite(offset))return;
    const index=Math.max(0,Math.min(wells.length-1,Math.round(offset/cardWidth)));
    setCurrentIndex(index);
    setVisibleWellIndices(Array.from({length:columns},(_,i)=>index+i).filter(i=>i<wells.length));
    setFocusedIndex(previous=>previous!==null && previous>=index && previous<index+columns ? previous : null);
  },[wells.length,cardWidth,columns]);
  const handlePagerSettled=useCallback((event:{nativeEvent:{contentOffset:{x:number}}})=>{
    handlePagerPosition(event);
    pagerInteraction.current=false;
  },[handlePagerPosition]);

  const matchingPickerWells = wells.filter(name => name.toLocaleLowerCase().includes(wellSearchQuery));

  // Open picker for well selection
  const openPicker = (index=currentIndex) => {
    pagerInteraction.current=false;
    pagerResizing.current=false;
    setWellSearch('');
    setTempSelectedIndex(index);
    lastTickIndex.current = index;
    setPickerScrolling(false);
    setShowPicker(true);
  };

  const confirmPicker = () => {
    // Save current as previous before changing
    if (tempSelectedIndex !== currentIndex) {
      captureTransitionStart();
    }
    setCurrentIndex(tempSelectedIndex);
    setPagerAlignRevision(n=>n+1);
    setShowPicker(false);
  };

  const cancelPicker = () => {
    setTempSelectedIndex(currentIndex);
    setShowPicker(false);
  };

  // Capture the exact drawn UI-thread fraction only when a gesture begins.
  const registerWellFill = useCallback((wellName: string, fill: SharedValue<number>) => {
    wellLevels.current[wellName] = fill;
    return () => { if(wellLevels.current[wellName]===fill)delete wellLevels.current[wellName]; };
  }, []);

  // Navigate to current well's performance detail on tank double-tap
  const handleTankDoubleTap = useCallback((targetWell?:string) => {
    const currentWell = targetWell || wells[currentIndex];
    if (currentWell) {
      router.push({
        pathname: '/performance-detail',
        params: { wellName: currentWell },
      });
    }
  }, [router, wells, currentIndex]);

  // Hide well from My Wells on tank long-press
  const handleTankLongPress = useCallback((targetWell?:string) => {
    const currentWell = targetWell || wells[currentIndex];
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
              const catalogue = selectionCatalogueRef.current;
              if (!catalogue) return;
              const selected = await loadSelectedWells(catalogue.owner, catalogue.eligible);
              const newWells = selected.filter(w => w !== currentWell);
              await saveSelectedWells(catalogue.owner, catalogue.eligible, newWells);
              // Update local wells list - remove the current well
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
            } catch (error) {
              console.error('[Main] Error hiding well:', error);
            }
          },
        },
      ]
    );
  }, [wells, currentIndex, alert, t]);

  const renderPortraitWell = useCallback(({ item, index }: {item:string;index:number}) => (
    <WellPagerCard width={cardWidth} wideLayout={false}>
      <WellView wellName={item} cardWidth={cardWidth} viewportHeight={viewportHeight} wideLayout={false}
        isActive={index===currentIndex} entryPrepared={index>=currentIndex-columns && index<currentIndex+2*columns} entryFraction={entryFraction}
        registerFill={registerWellFill} refreshTrigger={refreshTrigger+(wellRefreshes[item] || 0)}
        onSliderActiveChange={handleSliderActiveChange} loadBbls={loadBbls}
        onTankDoubleTap={handleTankDoubleTap} onTankLongPress={handleTankLongPress}
        showOvernightBbls={showOvernightBbls} onToggleOvernightBbls={handleToggleOvernightBbls}/>
    </WellPagerCard>
  ),[cardWidth,viewportHeight,currentIndex,columns,entryFraction,registerWellFill,refreshTrigger,wellRefreshes,handleSliderActiveChange,loadBbls,handleTankDoubleTap,handleTankLongPress,showOvernightBbls,handleToggleOvernightBbls]);
  const renderLandscapeWell = useCallback(({ item, index }: { item: string; index: number }) => (
    <WellPagerCard width={cardWidth} wideLayout={true} onFocus={()=>setFocusedIndex(index)} header={
      <TouchableOpacity onPress={()=>{setFocusedIndex(index);openPicker(index);}} style={{alignItems:'center',padding:8}}>
        <Text style={[foldablePhoneLayout ? styles.routeName : {fontSize:12},{color:getRouteColor(wellConfigMap?.[item]?.route || '')}]} numberOfLines={1}>{wellConfigMap?.[item]?.route || '\u00a0'}</Text>
        <Text style={foldablePhoneLayout ? styles.wellName : {color:'#F9FAFB',fontSize:22,fontWeight:'700'}} numberOfLines={1}>{wellConfigMap?.[item]?.displayName || item}</Text>
        <Text style={foldablePhoneLayout ? styles.operatorName : {color:'#9CA3AF',fontSize:12}} numberOfLines={1}>{wellConfigMap?.[item]?.operator || '\u00a0'}</Text>
      </TouchableOpacity>}>
      <WellView wellName={item} cardWidth={cardWidth} viewportHeight={viewportHeight} wideLayout={true}
        isActive={index===currentIndex || index===currentIndex+1}
        entryPrepared={index>=currentIndex-columns && index<currentIndex+2*columns}
        entryFraction={entryFraction} registerFill={registerWellFill}
        refreshTrigger={refreshTrigger+(wellRefreshes[item] || 0)} onSliderActiveChange={handleSliderActiveChange} loadBbls={loadBbls}
        onTankDoubleTap={handleTankDoubleTap} onTankLongPress={handleTankLongPress}
        showOvernightBbls={showOvernightBbls} onToggleOvernightBbls={handleToggleOvernightBbls}/>
    </WellPagerCard>
  ),[cardWidth,viewportHeight,columns,currentIndex,handleSliderActiveChange,visibleWellIndices,actionIndex,wellConfigMap,entryFraction,registerWellFill,refreshTrigger,wellRefreshes,loadBbls,handleTankDoubleTap,handleTankLongPress,showOvernightBbls,handleToggleOvernightBbls]);
  const renderWell = columns===1 ? renderPortraitWell : renderLandscapeWell;
  const getItemLayout=(_:unknown,index:number)=>({length:cardWidth,offset:cardWidth*index,index});

  if (!isReady) {
    return (
      <View style={styles.loadingContainer} onLayout={handleRootLayout}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  // Initial sync overlay - show different UI based on fresh install vs cold/warm start
  if (isInitialSyncing) {
    // COLD/WARM START - Simple splash with logo
    if (!isFreshInstall) {
      return (
        <View style={styles.splashContainer} onLayout={handleRootLayout}>
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
      <View style={styles.loadingContainer} onLayout={handleRootLayout}>
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
      <View style={styles.container} collapsable={false} onLayout={handleRootLayout}>
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateIcon}>⚠️</Text>
          <Text style={styles.emptyStateTitle}>{t('homeExtra.noWellsLoaded')}</Text>
          <Text style={styles.emptyStateMessage}>
            {lastWellConfigError
              ? `well_config_unavailable:${lastWellConfigError}`
              : t('homeExtra.noWellsMessage')}
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

        {/* Keep bottom nav accessible so user can still navigate (History | Pull | More) */}
        <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) + (columns===1 && windowSize.width>=600 && !foldablePhoneLayout ? windowSize.height*0.02 : 6) }]}>
          <View style={styles.navSide}>
            <TouchableOpacity style={styles.navButton} onPress={() => router.push('/history')}>
              <Text style={styles.navIcon}>📋</Text>
              <Text style={styles.navLabel}>{t('nav.history')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.navSide}>
            <TouchableOpacity style={styles.navButton} disabled>
              <Text style={[styles.navIcon, styles.navIconDisabled]}>🛢️</Text>
              <Text style={[styles.navLabel, styles.navLabelDisabled]}>{t('homeExtra.pull')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.navSide}>
            <TouchableOpacity
              style={styles.navButton}
              onPress={() => setShowMore(true)}
              accessibilityRole="button"
              accessibilityLabel="•••"
            >
              <Text style={styles.navDots}>•••</Text>
            </TouchableOpacity>
          </View>
        </View>
        <MoreMenu
          visible={showMore}
          onClose={() => setShowMore(false)}
          onRouteMe={() => router.push('/route-me')}
          onFreshWater={() => router.push('/fresh-water')}
          onSummary={handleSummaryPress}
          onBackToSuite={() => { void backToSuite(); }}
          bottomInset={insets.bottom}
        />
      </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.container} collapsable={false} onLayout={handleRootLayout}>
      {/* Independent portrait header and landscape toolbar; never mounted together. */}
      {columns===1 ? <>
      {/* Header with tappable well name and settings */}
      <View style={styles.header}>
        {/* Empty spacer for balance */}
        <View style={styles.headerSpacer} />

        {/* Center - route name and well name */}
        <View style={styles.headerCenter}>
          {/* Route name - smaller, in route color */}
          {/* Reserve both metadata rows while the catalogue loads. Adding
              them later resizes the tank area immediately after the spinner. */}
          <Text style={[
            styles.routeName,
            { color: getRouteColor(wellConfigMap?.[wells[currentIndex]]?.route || '') }
          ]} numberOfLines={1}>
            {wellConfigMap?.[wells[currentIndex]]?.route || '\u00a0'}
          </Text>
          <TouchableOpacity onPress={()=>openPicker(currentIndex)} style={styles.wellNameButton}>
            <Text style={styles.wellName}>{wellConfigMap?.[wells[currentIndex]]?.displayName || wells[currentIndex]}</Text>
            <Text style={styles.wellNameArrow}>▼</Text>
            {isBackgroundSyncing && (
              <ActivityIndicator size="small" color="#60A5FA" style={styles.syncIndicator} />
            )}
          </TouchableOpacity>
          <Text style={styles.operatorName} numberOfLines={1}>
            {wellConfigMap?.[wells[currentIndex]]?.operator || '\u00a0'}
          </Text>
          <Text style={styles.positionIndicator}>{currentIndex + 1} {t('homeExtra.of')} {wells.length}</Text>
        </View>

        {/* Right - settings button */}
        <TouchableOpacity accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      </> : <>
      <View style={[styles.header,{paddingTop:Math.max(insets.top,8),paddingBottom:4}]}>
        <Text style={{color:'#F9FAFB',fontSize:16}}>Wells</Text>
        <TouchableOpacity accessibilityLabel="Settings" onPress={()=>router.push('/settings')} style={styles.settingsButton}><Text style={styles.settingsIcon}>⚙</Text></TouchableOpacity>
      </View>

      </>}

      {/* Swipeable well views - with memory optimization for Android */}
      <FlatList
        ref={flatListRef}
        data={wells}
        renderItem={renderWell}
        keyExtractor={(item) => item}
        horizontal
        pagingEnabled
        testID="well-pager"
        snapToInterval={cardWidth}
        decelerationRate="fast"
        style={{flex:1,minHeight:0}}
        showsHorizontalScrollIndicator={false}
        contentOffset={pagerContentOffset}
        onScrollBeginDrag={handlePagerDrag}
        onScrollEndDrag={handlePagerPosition}
        onMomentumScrollEnd={handlePagerSettled}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        initialScrollIndex={Math.min(currentIndex, Math.max(0, wells.length - 1))}
        removeClippedSubviews={false}
        maxToRenderPerBatch={pagerBuffer.maxToRenderPerBatch}
        windowSize={pagerBuffer.windowSize}
        initialNumToRender={2}
        updateCellsBatchingPeriod={16}
        extraData={[currentIndex,focusedIndex,visibleWellIndices,cardWidth,showOvernightBbls]}
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

      {/* Bottom nav - History | Pull | More (Summary now lives in the More sheet) */}
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) + (columns===1 && windowSize.width>=600 && !foldablePhoneLayout ? windowSize.height*0.02 : 6) }]}>
        <View style={styles.navSide}>
          <TouchableOpacity style={styles.navButton} onPress={() => router.push('/history')}>
            <Text style={styles.navIcon}>📋</Text>
            <Text style={styles.navLabel}>{t('nav.history')}</Text>
          </TouchableOpacity>
        </View>

        {/* Pull — primary accent, but a normal-sized icon button matching the bar. */}
        <View style={styles.navSide}>
          <TouchableOpacity style={styles.navButton} onPress={handlePullPress} disabled={isViewer}>
            <Text style={[styles.navIcon, styles.navIconAccent, isViewer && styles.navIconDisabled]}>🛢️</Text>
            <Text style={[styles.navLabel, styles.navLabelAccent, isViewer && styles.navLabelDisabled]}>
              {isViewer ? t('homeExtra.viewOnly') : t('nav.pull')}
            </Text>
            {columns>1 && <Text numberOfLines={1} style={{fontSize:12,color:'#C4A574',maxWidth:cardWidth-24}}>{wellConfigMap?.[wells[actionIndex]]?.displayName || wells[actionIndex]}</Text>}
            {currentWellHasDraft && !isViewer && (
              <View style={styles.draftIndicator}>
                <Text style={styles.draftIndicatorIcon}>✏️</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.navSide}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => setShowMore(true)}
            accessibilityRole="button"
            accessibilityLabel="•••"
          >
            <Text style={styles.navDots}>•••</Text>
          </TouchableOpacity>
        </View>
      </View>

      <MoreMenu
        visible={showMore}
        onClose={() => setShowMore(false)}
        onRouteMe={() => router.push('/route-me')}
        onFreshWater={() => router.push('/fresh-water')}
        onSummary={handleSummaryPress}
        onBackToSuite={() => { void backToSuite(); }}
        bottomInset={insets.bottom}
      />

      {/* Well picker modal - works for both platforms */}
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={cancelPicker}>
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
              <View style={styles.wellSearchContainer}>
                <Ionicons name="search" size={20} color="#9CA3AF" />
                <TextInput
                  style={styles.wellSearchInput}
                  value={wellSearch}
                  onChangeText={setWellSearch}
                  placeholder={t('historyExtra.searchWells')}
                  accessibilityLabel={t('historyExtra.searchWells')}
                  placeholderTextColor="#9CA3AF"
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {wellSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setWellSearch('')} accessibilityLabel={t('homeExtra.cancel')}>
                    <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
              {wellSearchQuery ? (
                <FlatList
                  data={matchingPickerWells}
                  keyExtractor={item => item}
                  style={styles.androidWheelList}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={<Text style={styles.wellSearchEmpty}>{t('historyExtra.noWellsFound')}</Text>}
                  renderItem={({item}) => (
                    <Pressable style={styles.androidWheelRow} onPress={() => {
                      const originalIndex = wells.indexOf(item);
                      if (originalIndex < 0) return;
                      captureTransitionStart();
                      setCurrentIndex(originalIndex);
                      setPagerAlignRevision(n=>n+1);
                      setShowPicker(false);
                    }}>
                      <Text style={[styles.androidWheelText, item === wells[currentIndex] && styles.androidWheelTextSelected]}>{item}</Text>
                    </Pressable>
                  )}
                />
              ) : (
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
                  initialScrollIndex={Math.min(currentIndex, Math.max(0, wells.length - 1))}
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
                            captureTransitionStart();
                            setCurrentIndex(tempSelectedIndex);
                            setPagerAlignRevision(n=>n+1);
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
              )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Confirmation alert */}
      <alert.AlertComponent />
    </View>
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
  operatorName: {
    color: '#9CA3AF',
    fontSize: hp('1.2%'),
    maxWidth: SCREEN_WIDTH - 96,
    marginTop: 1,
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
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    paddingTop: isTablet ? spacing.md : SCREEN_HEIGHT * 0.01,
  },
  tankSection: {
    flex: 1,
    minHeight: 0,
    width: '100%',
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
  // Full-interior wildlife layers; shared fluid geometry places each animal.
  aliveLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  aliveSurfaceLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  aliveFishWrap: {
    width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
    position: 'absolute',
  },
  fishTouchTarget: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  aliveFishGlyph: {
    fontSize: 11,
    opacity: 0.3,
  },
  // Duck follows the gravity-aligned fluid interface; its
  // vertical offset is animated (duckSurfaceStyle) so a nearly-full tank
  // can never push it out of the interior. Bigger + near-opaque so it
  // reads as FLOATING, not drowning (the old 13px/0.4 float sank into
  // the blue visually).
  aliveDuckWrap: {
    width: DUCK_FONT_SIZE, height: DUCK_FONT_SIZE, alignItems: 'center', justifyContent: 'center',
    position: 'absolute',
  },
  aliveDuckGlyph: {
    fontSize: DUCK_FONT_SIZE,
    opacity: 0.9,
  },
  // Fisherman scene — anchored to the interior (rim at top), not to the
  // water layer. Never clipped by the water height.
  fishermanLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  fishermanSeat: {
    position: 'absolute',
    top: -2, // seated ON the rim edge
  },
  fishingLine: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  hookedFishWrap: {
    position: 'absolute',
  },
  pelicanWrap: {
    position: 'absolute',
    // Bottom-anchored scaling: when the safe clamp shrinks the pelican,
    // its FEET stay on the number's top edge and only the body shrinks.
    transformOrigin: 'center bottom',
  },
  tankInfoTouchTarget: {
    position: 'absolute', top: INTERIOR_TOP - 18, right: INTERIOR_RIGHT - 19,
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  tankInfoBadge: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center',
  },
  tankInfoBadgeText: { color: '#fff', fontSize: 15, fontWeight: '700' },
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
    // This text shares the badge's scene transform: keep its size relative to
    // the 18dp badge, never to the launch window or the tablet font clamp.
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
    textAlign: 'center',
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
    top: 0,
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
  // Unavailable is 11 glyphs vs ~5 for "12'3\"". Same tankNumber size overflowed
  // the interior (S24 / Z Fold cover) and clipped to "Unavailabl". 0.016 leaves
  // margin after numberContainer's left:15 inset. Numeric level font unchanged.
  tankUnavailableLabel: {
    color: 'white',
    fontSize: scaledFont(0.016),
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
    flexShrink: 0,
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
    flexShrink: 0,
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
    width: '100%',
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
    height: 54,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    width: isTablet ? '70%' : '100%', // Constrain slider width on tablets
  },
  sliderWrapper: {
    flex: 1,
    height: 54,
  },
  slider: {
    height: 54,
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
    paddingBottom: isTablet ? spacing.xl : 16,
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
  // Pull is the primary action — accent color, but the SAME icon-button size as the
  // rest of the bar (no oversized control).
  navIconAccent: { color: '#C4A574' },
  navLabelAccent: { color: '#C4A574', fontWeight: '700' },
  navIconDisabled: { opacity: 0.4 },
  navLabelDisabled: { color: '#6B7280' },
  navDots: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  moreBackdrop: MORE_MENU_TOKENS.backdrop,
  moreMenuPopup: MORE_MENU_TOKENS.popup,
  moreMenuItem: MORE_MENU_TOKENS.item,
  moreMenuLabel: MORE_MENU_TOKENS.label,
  moreMenuDivider: MORE_MENU_TOKENS.divider,
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
  wellSearchContainer: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 12,
    marginVertical: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#111827',
  },
  wellSearchInput: {flex: 1, color: 'white', minHeight: 44, paddingHorizontal: 8, fontSize: 16},
  wellSearchEmpty: {color: '#9CA3AF', textAlign: 'center', padding: 24},
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

const baseWellStyles = styles;
const landscapeScreenStyles = {
  ...baseWellStyles,
  header:{...baseWellStyles.header,paddingHorizontal:20},
  settingsIcon:{...baseWellStyles.settingsIcon,fontSize:24},
  bottomNav:{...baseWellStyles.bottomNav,paddingTop:8,paddingHorizontal:16},
  navIcon:{...baseWellStyles.navIcon,fontSize:24},
  navLabel:{...baseWellStyles.navLabel,fontSize:12},
};

// Wide cards use readable, fixed control sizes, independent of launch orientation.
// Tank graphics alone shrink into the remaining slot; phone styles stay unchanged.
const wideWellStyles = {
  ...styles,
  topSection: {...styles.topSection,paddingTop:4},
  statsSection: {...styles.statsSection,marginTop:4},
  statLeft: {...styles.statLeft,fontSize:14},
  statRight: {...styles.statRight,fontSize:14},
  statDivider: {...styles.statDivider,fontSize:14},
  lastPullContainer: {...styles.lastPullContainer,marginTop:4},
  lastPullLabel: {...styles.lastPullLabel,fontSize:12},
  lastPullInfo: {...styles.lastPullInfo,fontSize:13},
  sliderContainer: {...styles.sliderContainer,paddingHorizontal:12,marginTop:6,paddingBottom:8},
  sliderInfoContainer: {...styles.sliderInfoContainer,minHeight:58,marginBottom:4},
  sliderRow: {...styles.sliderRow,width:'100%' as const},
  sliderMarkersRow: {...styles.sliderMarkersRow,width:'100%' as const},
  sliderArrowLeft: {...styles.sliderArrowLeft,fontSize:13,width:14},
  sliderArrowRight: {...styles.sliderArrowRight,fontSize:13,width:14},
  sliderEndWord: {...styles.sliderEndWord,fontSize:13,width:46},
  sliderMarkerArrowLeft: {...styles.sliderMarkerArrowLeft,width:14},
  sliderMarkerArrowRight: {...styles.sliderMarkerArrowRight,width:14},
  sliderMarkerLeft: {...styles.sliderMarkerLeft,fontSize:11,width:46},
  sliderMarkerRight: {...styles.sliderMarkerRight,fontSize:11,width:46},
  sliderMarkerPositioned: {...styles.sliderMarkerPositioned,fontSize:11},
  sliderValue: {...styles.sliderValue,fontSize:22},
  sliderBbls: {...styles.sliderBbls,fontSize:18},
  nextPullLabel: {...styles.nextPullLabel,fontSize:12},
  nextPullTime: {...styles.nextPullTime,fontSize:22},
  readyAt: {...styles.readyAt,fontSize:14,marginTop:4},
  unlockHint: {...styles.unlockHint,fontSize:12,marginTop:8},
};

/** Original pre-dual-card portrait layout (81efeb3), evaluated with the current
 * portrait window. Never imports landscape's font/track sizing into portrait.
 */
function portraitStyles(width:number,height:number,renderScale?:number) {
  const tablet=width>=600;
  const scale=renderScale ?? (tablet?height*0.42:width*0.70*1.2)/TANK_HEIGHT;
  const font=(fraction:number)=>Math.round(tablet?Math.min(fraction*height*0.6,fraction*800):fraction*height);
  return {
    ...baseWellStyles,
    tankNumber:{...baseWellStyles.tankNumber,fontSize:font(0.028)/scale},
    tankUnavailableLabel:{...baseWellStyles.tankUnavailableLabel,fontSize:font(0.016)/scale},
    bblsAvailableText:{...baseWellStyles.bblsAvailableText,fontSize:font(0.016)/scale},
    tankInfoTouchTarget:{...baseWellStyles.tankInfoTouchTarget,top:INTERIOR_TOP-18/scale,right:INTERIOR_RIGHT-19/scale,width:44/scale,height:44/scale},
    tankInfoBadge:{...baseWellStyles.tankInfoBadge,width:18/scale,height:18/scale,borderRadius:9/scale},
    tankInfoBadgeText:{...baseWellStyles.tankInfoBadgeText,fontSize:15/scale},
    header:{...baseWellStyles.header,paddingTop:height*0.07,paddingBottom:height*0.01,paddingHorizontal:width*0.05},
    headerSpacer:{width:height*0.028},
    routeName:{...baseWellStyles.routeName,fontSize:height*0.015},
    wellName:{...baseWellStyles.wellName,fontSize:height*0.028},
    operatorName:{...baseWellStyles.operatorName,fontSize:height*0.012,maxWidth:width-96},
    wellNameArrow:{...baseWellStyles.wellNameArrow,fontSize:height*0.014},
    positionIndicator:{...baseWellStyles.positionIndicator,fontSize:height*0.015},
    settingsIcon:{...baseWellStyles.settingsIcon,fontSize:height*0.028},
    wellView:{...baseWellStyles.wellView,width,justifyContent:'space-between' as const},
    topSection:{alignItems:'center' as const,paddingTop:height*(tablet?0.02:0.01)},
    tankSection:{alignItems:'center' as const,justifyContent:'center' as const,width:'100%' as const,marginBottom:height*0.01},
    statsSection:{...baseWellStyles.statsSection,marginTop:height*0.005},
    statLeft:{...baseWellStyles.statLeft,fontSize:font(0.018)},
    statRight:{...baseWellStyles.statRight,fontSize:font(0.018)},
    statDivider:{...baseWellStyles.statDivider,fontSize:font(0.018)},
    lastPullContainer:{...baseWellStyles.lastPullContainer,marginTop:height*(tablet?0.005:0.008)},
    lastPullLabel:{...baseWellStyles.lastPullLabel,fontSize:font(0.013)},
    lastPullInfo:{...baseWellStyles.lastPullInfo,fontSize:font(0.015)},
    sliderContainer:{...baseWellStyles.sliderContainer,paddingHorizontal:height*0.02,marginTop:height*(tablet?0.01:0.012),paddingBottom:height*(tablet?0.03:0.02)},
    sliderInfoContainer:{...baseWellStyles.sliderInfoContainer,minHeight:64,marginBottom:height*0.005},
    sliderRow:{...baseWellStyles.sliderRow,width:(tablet?'70%':'100%') as '70%'|'100%'},
    sliderMarkersRow:{...baseWellStyles.sliderMarkersRow,width:(tablet?'70%':'100%') as '70%'|'100%'},
    sliderArrowLeft:{...baseWellStyles.sliderArrowLeft,fontSize:font(0.014)},
    sliderArrowRight:{...baseWellStyles.sliderArrowRight,fontSize:font(0.014)},
    sliderEndWord:{...baseWellStyles.sliderEndWord,fontSize:font(0.014)},
    sliderMarkerLeft:{...baseWellStyles.sliderMarkerLeft,fontSize:font(0.011)},
    sliderMarkerRight:{...baseWellStyles.sliderMarkerRight,fontSize:font(0.011)},
    sliderMarkerPositioned:{...baseWellStyles.sliderMarkerPositioned,fontSize:font(0.011)},
    sliderValue:{...baseWellStyles.sliderValue,fontSize:font(0.030)},
    sliderBbls:{...baseWellStyles.sliderBbls,fontSize:font(0.026)},
    nextPullLabel:{...baseWellStyles.nextPullLabel,fontSize:font(0.014)},
    nextPullTime:{...baseWellStyles.nextPullTime,fontSize:font(0.026)},
    readyAt:{...baseWellStyles.readyAt,fontSize:font(0.018),marginTop:height*(tablet?0.005:0.008)},
    unlockHint:{...baseWellStyles.unlockHint,fontSize:font(0.013),marginTop:8},
    navIcon:{...baseWellStyles.navIcon,fontSize:Math.round(height*0.025)},
    navLabel:{...baseWellStyles.navLabel,fontSize:Math.round(height*0.012)},
    bottomNav:{...baseWellStyles.bottomNav,paddingTop:height*(tablet?0.02:0.015),paddingHorizontal:tablet?width*0.15:height*0.02},
  };
}

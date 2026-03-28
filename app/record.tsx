import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from '../components/AppAlert';
import { useDispatch } from '../src/contexts/DispatchContext';
import { isCurrentUserViewer } from '../src/services/driverAuth';
import { smartUploadTankPacket, smartUploadEditPacket, getQueueCount } from '../src/services/packetQueue';
import { addPullToHistory, updatePullHistoryEntry } from '../src/services/pullHistory';
import { getBblPerFoot, getWellConfig, loadWellConfig } from '../src/services/wellConfig';
import { getLevelSnapshot, savePendingPull, saveWellPull, saveLevelSnapshot } from '../src/services/wellHistory';
import { hp, spacing, wp } from '../src/ui/layout';

// Key prefix for persisting draft form data (per-well)
const DRAFT_STORAGE_PREFIX = 'wellbuilt_draft_';

// Get storage key for a specific well
const getDraftKey = (wellName: string) => `${DRAFT_STORAGE_PREFIX}${wellName.replace(/\s+/g, '_')}`;


// Parse level input - handles multiple formats:
// "6.4" → 6.4 feet (decimal feet - for quick entry)
// "6 4" → 6' 4" (space separated, integer inches)
// "6 4.5" → 6' 4.5" (space separated, fractional inches for precision)
// "6'4" or "6'4\"" → 6' 4"
// "6'4.5" → 6' 4.5" (fractional inches)
// "6" → 6' 0"
const parseLevel = (input: string): number | null => {
  // Keep ONLY digits, dots, and spaces. Everything else (quotes, backticks, primes,
  // smart quotes, unicode symbols, whatever iOS/OneUI invents next) becomes a space.
  // This makes parsing immune to any keyboard symbol variation.
  const stripped = input
    .replace(/[^\d.\s]/g, ' ')  // anything that isn't a digit, dot, or space → space
    .replace(/\s+/g, ' ')       // collapse multiple spaces
    .trim();

  if (!stripped) return null;

  // Check for space-separated feet and inches: "10 4" or "10 4.5"
  const spaceMatch = stripped.match(/^(\d+)\s+(\d+(?:\.\d+)?)$/);
  if (spaceMatch) {
    const ft = parseInt(spaceMatch[1], 10);
    const inch = parseFloat(spaceMatch[2]);
    return ft + inch / 12;
  }

  // Check for pure decimal with no space: 6.4 means 6.4 feet (decimal feet)
  // This is different from "6 4" which means 6 feet 4 inches
  if (stripped.includes('.') && !stripped.includes(' ')) {
    const val = parseFloat(stripped);
    return isNaN(val) ? null : val;
  }

  // Plain number - treat as feet only: 6 → 6' 0"
  const val = parseInt(stripped, 10);
  return isNaN(val) ? null : val;
};

// Format level for display - floors to whole inches
// Always floor so timestamp backdating math works correctly
// Driver sees conservative level, math uses precise timestamp adjustment
const formatLevelDisplay = (feet: number): string => {
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
};

// Format hint based on current input - shows floored display value
// Driver sees what they'll see everywhere else in the app
const getLevelHint = (input: string, defaultHint: string, invalidHint: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return defaultHint;

  const parsed = parseLevel(trimmed);
  if (parsed === null) return invalidHint;

  // Show the floored display value (what they'll see everywhere)
  return `= ${formatLevelDisplay(parsed)}`;
};

// Format feet to display string (alias for consistency)
const formatFeetInches = formatLevelDisplay;

// Format level as input string (feet inches with space)
// Always floor to match display everywhere
const formatLevelForInput = (feet: number): string => {
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft} ${inches}`;
};

// Parse datetime string like "12/13/2025 5:30 PM" to Date
const parseDateTimeString = (dateTimeStr: string): Date => {
  // Try standard Date parse first
  const standardDate = new Date(dateTimeStr);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  // Parse "MM/DD/YYYY h:mm AM/PM" format manually
  const match = dateTimeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    const [, month, day, year, hour, minute, ampm] = match;
    let hours = parseInt(hour, 10);
    const minutes = parseInt(minute, 10);

    // Convert 12-hour to 24-hour
    if (ampm.toUpperCase() === 'PM' && hours !== 12) {
      hours += 12;
    } else if (ampm.toUpperCase() === 'AM' && hours === 12) {
      hours = 0;
    }

    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,  // JS months are 0-indexed
      parseInt(day, 10),
      hours,
      minutes,
      0,
      0
    );

    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fallback to now if parsing fails
  console.warn('[Record] Failed to parse dateTime:', dateTimeStr);
  return new Date();
};

const FULL_TANK_FEET = 20;

// Draft data structure for persisting form state (per-well)
interface DraftData {
  dateTime: string; // ISO string
  level: string;
  barrels: string;
  wellDown: boolean;
  savedAt: number; // timestamp
}

export default function RecordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const wellName = String(params.wellName || "");
  const { initiateSendQueue } = useDispatch();

  // Edit mode params
  const isEditMode = params.editMode === 'true';
  const editId = String(params.editId || "");
  const editDateTime = String(params.editDateTime || "");
  const editLevel = String(params.editLevel || "");
  const editBbls = String(params.editBbls || "");
  const editWellDown = params.editWellDown === 'true';
  const editPacketTimestamp = String(params.editPacketTimestamp || "");

  const [dateTime, setDateTime] = useState(() =>
    isEditMode && editDateTime ? parseDateTimeString(editDateTime) : new Date()
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDateTime, setTempDateTime] = useState(() =>
    isEditMode && editDateTime ? parseDateTimeString(editDateTime) : new Date()
  );

  const [level, setLevel] = useState('');
  const [barrels, setBarrels] = useState('');
  const [wellDown, setWellDown] = useState(false);
  const [isAlreadyDown, setIsAlreadyDown] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Custom alert hook
  const alert = useAppAlert();

  // Status display data
  const [estLevel, setEstLevel] = useState<string | null>(null);
  const [estLevelFeet, setEstLevelFeet] = useState<number | null>(null); // Raw feet value for packet
  const [estBbls, setEstBbls] = useState<number | null>(null);
  const [flowRate, setFlowRate] = useState<string | null>(null);
  const [flowRateMinutes, setFlowRateMinutes] = useState<number>(0); // Minutes per foot for timestamp backdating
  const [lastPullInfo, setLastPullInfo] = useState<string | null>(null);
  const [bblPerFoot, setBblPerFoot] = useState<number>(20); // Default to 1 tank

  // Base data for time-adjusted level estimation (backward flow rate)
  // Stored on load, recalculated when driver changes time picker
  const baseTimestampRef = useRef<number>(0);
  const baseLevelFeetRef = useRef<number>(0);
  const loadLineRef = useRef<number>(0);
  const wellIsDownRef = useRef<boolean>(false);

  const levelRef = useRef<TextInput>(null);
  const barrelsRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const barrelsInputY = useRef<number>(0);
  const isBarrelsFocused = useRef<boolean>(false);
  const hasDraftLoaded = useRef<boolean>(false);

  // Redirect viewers away - they can't record pulls
  useEffect(() => {
    const checkViewer = async () => {
      const viewer = await isCurrentUserViewer();
      if (viewer) {
        console.log('[Record] Viewer detected, redirecting back');
        router.back();
      }
    };
    checkViewer();
  }, [router]);

  // Save draft to storage (debounced) - per-well key
  const saveDraft = useCallback(async () => {
    if (isEditMode || !wellName) return; // Don't save drafts in edit mode

    const draft: DraftData = {
      dateTime: dateTime.toISOString(),
      level,
      barrels,
      wellDown,
      savedAt: Date.now(),
    };

    try {
      const key = getDraftKey(wellName);
      await AsyncStorage.setItem(key, JSON.stringify(draft));
      console.log('[Record] Draft saved for', wellName);
    } catch (err) {
      console.warn('[Record] Failed to save draft:', err);
    }
  }, [wellName, dateTime, level, barrels, wellDown, isEditMode]);

  // Clear draft from storage for this well
  const clearDraft = useCallback(async () => {
    if (!wellName) return;
    try {
      const key = getDraftKey(wellName);
      await AsyncStorage.removeItem(key);
      console.log('[Record] Draft cleared for', wellName);
    } catch (err) {
      console.warn('[Record] Failed to clear draft:', err);
    }
  }, [wellName]);

  // Clear form and draft - show custom modal
  const handleClear = useCallback(() => {
    alert.show(
      "Clear Form",
      "Are you sure you want to clear all entered data?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setLevel('');
            setBarrels('');
            setDateTime(new Date());
            setWellDown(isAlreadyDown); // Keep well down if it was already down
            await clearDraft();
          }
        }
      ]
    );
  }, [isAlreadyDown, clearDraft, alert]);

  // Load draft on mount (only for new pulls, not edits) - per-well key
  useEffect(() => {
    const loadDraft = async () => {
      if (isEditMode || hasDraftLoaded.current || !wellName) return;
      hasDraftLoaded.current = true;

      try {
        const key = getDraftKey(wellName);
        const draftJson = await AsyncStorage.getItem(key);
        if (!draftJson) return;

        const draft: DraftData = JSON.parse(draftJson);

        // Only restore if draft is less than 4 hours old
        const ageMs = Date.now() - draft.savedAt;
        const maxAgeMs = 4 * 60 * 60 * 1000; // 4 hours

        if (ageMs < maxAgeMs) {
          console.log('[Record] Restoring draft for', wellName);
          if (draft.level) setLevel(draft.level);
          if (draft.barrels) setBarrels(draft.barrels);
          if (draft.dateTime) setDateTime(new Date(draft.dateTime));
          if (draft.wellDown) setWellDown(draft.wellDown);
        } else {
          // Draft too old
          console.log('[Record] Draft expired for', wellName, ', clearing');
          await clearDraft();
        }
      } catch (err) {
        console.warn('[Record] Failed to load draft:', err);
      }
    };

    loadDraft();
  }, [wellName, isEditMode, clearDraft]);

  // Auto-save draft when form changes (debounced)
  useEffect(() => {
    if (isEditMode || !hasDraftLoaded.current) return;

    // Only save if there's something to save
    if (!level && !barrels) return;

    const timer = setTimeout(() => {
      saveDraft();
    }, 500); // Debounce 500ms

    return () => clearTimeout(timer);
  }, [level, barrels, dateTime, wellDown, saveDraft, isEditMode]);

  // Initialize edit mode values
  useEffect(() => {
    if (isEditMode) {
      // Pre-fill with edit values
      if (editDateTime) {
        setDateTime(parseDateTimeString(editDateTime));
      }
      if (editLevel) {
        const levelNum = parseFloat(editLevel);
        if (!isNaN(levelNum)) {
          setLevel(formatLevelForInput(levelNum));
        }
      }
      if (editBbls) {
        setBarrels(editBbls);
      }
      setWellDown(editWellDown);
    }
  }, [isEditMode, editDateTime, editLevel, editBbls, editWellDown]);

  // Handle barrels input focus - scroll to show it when focused
  const handleBarrelsFocus = () => {
    console.log('[Record] Barrels input focused, Y:', barrelsInputY.current);
    isBarrelsFocused.current = true;
    // Slight delay to let keyboard animation start
    setTimeout(() => {
      // Scroll enough to show barrels section + bottom hint + submit button above keyboard
      // Need extra scroll to account for the hint appearing when user types
      const scrollOffset = 180;
      console.log('[Record] Scrolling to:', scrollOffset);
      scrollViewRef.current?.scrollTo({ y: scrollOffset, animated: true });
    }, 100);
  };

  const handleBarrelsBlur = () => {
    console.log('[Record] Barrels input blurred');
    isBarrelsFocused.current = false;
  };

  // Handle keyboard hide - scroll back to top
  useEffect(() => {
    const keyboardDidHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        console.log('[Record] Keyboard hidden, scrolling to top');
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    );

    return () => {
      keyboardDidHide.remove();
    };
  }, []);

  // Load well status data (only for new pulls, not edits)
  useEffect(() => {
    const loadWellData = async () => {
      if (!wellName) return;

      await loadWellConfig();
      const config = await getWellConfig(wellName);
      const snapshot = await getLevelSnapshot(wellName);

      // Set bblPerFoot from config
      const numTanks = config?.numTanks ?? 1;
      const bblPerFt = numTanks * 20;
      setBblPerFoot(bblPerFt);

      // Skip status display for edit mode - we're editing existing data
      if (isEditMode) return;

      // Check if well is already down
      if (snapshot?.isDown) {
        setWellDown(true);
        setIsAlreadyDown(true);
      }

      // Get flow rate from snapshot (now stored with level, not separately cached)
      const flowMins = snapshot?.flowRateMinutes ?? config?.avgFlowRateMinutes ?? 0;
      setFlowRateMinutes(flowMins);
      if (snapshot?.flowRate) {
        setFlowRate(snapshot.flowRate);
      } else if (config?.avgFlowRate) {
        setFlowRate(config.avgFlowRate);
      }

      // Store base data for time-adjusted level estimation
      const loadLine = config?.loadLine ?? 0;
      loadLineRef.current = loadLine;
      wellIsDownRef.current = !!snapshot?.isDown;

      let baseLvl = 0;
      let baseTs = 0;

      if (snapshot && snapshot.timestamp > 0) {
        baseLvl = snapshot.levelFeet;
        baseTs = snapshot.timestamp;
      }

      baseLevelFeetRef.current = baseLvl;
      baseTimestampRef.current = baseTs;

      // Calculate initial estimated level (for current time = now)
      if (baseTs > 0 && flowMins > 0 && !snapshot?.isDown) {
        const minutesElapsed = (dateTime.getTime() - baseTs) / (1000 * 60);
        let estimatedLevel = baseLvl + (minutesElapsed / flowMins);
        estimatedLevel = Math.max(0, Math.min(estimatedLevel, FULL_TANK_FEET));
        setEstLevel(formatFeetInches(estimatedLevel));
        setEstLevelFeet(estimatedLevel);

        const bbls = Math.max(Math.round((estimatedLevel - loadLine) * bblPerFt), 0);
        setEstBbls(bbls);
      } else if (baseLvl > 0) {
        setEstLevel(formatFeetInches(baseLvl));
        setEstLevelFeet(baseLvl);
        const bbls = Math.max(Math.round((baseLvl - loadLine) * bblPerFt), 0);
        setEstBbls(bbls);
      }

      // Last pull info
      if (snapshot?.lastPullDateTime) {
        const pullStr = snapshot.lastPullBbls
          ? `${snapshot.lastPullDateTime} • ${snapshot.lastPullBbls} bbl`
          : snapshot.lastPullDateTime;
        setLastPullInfo(pullStr);
      }
    };

    loadWellData();
  }, [wellName, isEditMode]);

  // Recalculate estimated level when driver changes date/time picker (backward flow rate)
  // Uses stored base data + flow rate to estimate tank level at any selected time
  useEffect(() => {
    if (isEditMode) return;
    const baseTs = baseTimestampRef.current;
    const baseLvl = baseLevelFeetRef.current;
    if (baseTs === 0 || flowRateMinutes === 0 || wellIsDownRef.current) return;

    const minutesElapsed = (dateTime.getTime() - baseTs) / (1000 * 60);
    let estimatedLevel = baseLvl + (minutesElapsed / flowRateMinutes);
    estimatedLevel = Math.max(0, Math.min(estimatedLevel, FULL_TANK_FEET));
    setEstLevel(formatFeetInches(estimatedLevel));
    setEstLevelFeet(estimatedLevel);

    const bbls = Math.max(Math.round((estimatedLevel - loadLineRef.current) * bblPerFoot), 0);
    setEstBbls(bbls);
  }, [dateTime, flowRateMinutes, bblPerFoot, isEditMode]);

  const formatDateLabel = (d: Date) => d.toLocaleDateString('en-US');
  const formatTimeLabel = (d: Date) => {
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };
  // Local display string (for legacy/display)
  const formatPacketDateTime = (d: Date) => `${d.toLocaleDateString('en-US')} ${formatTimeLabel(d)}`;
  // ISO 8601 UTC timestamp (for calculations) - THE industry standard
  const formatPacketDateTimeUTC = (d: Date) => d.toISOString();

  // iOS date/time picker handlers
  const handleIOSDateChange = (_event: any, selected?: Date) => {
    if (selected) setTempDateTime(selected);
  };

  const confirmDatePicker = () => {
    const newDate = new Date(dateTime);
    newDate.setFullYear(tempDateTime.getFullYear(), tempDateTime.getMonth(), tempDateTime.getDate());
    setDateTime(newDate);
    setShowDatePicker(false);
  };

  const confirmTimePicker = () => {
    const newDate = new Date(dateTime);
    newDate.setHours(tempDateTime.getHours(), tempDateTime.getMinutes(), 0, 0);
    setDateTime(newDate);
    setShowTimePicker(false);
  };

  // Android date/time picker handlers
  const handleChangeDate = (_event: any, selected?: Date) => {
    setShowDatePicker(false);
    if (!selected) return;
    const newDate = new Date(dateTime);
    newDate.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    setDateTime(newDate);
  };

  const handleChangeTime = (_event: any, selected?: Date) => {
    setShowTimePicker(false);
    if (!selected) return;
    const newDate = new Date(dateTime);
    newDate.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setDateTime(newDate);
  };

  const handleSubmit = async () => {
    if (!wellName) {
      alert.show("Error", "No well selected");
      return;
    }

    const tankLevelFeet = parseLevel(level);
    if (tankLevelFeet === null && !wellDown) {
      alert.show(t('record.errorMissingDataTitle'), t('record.errorMissingLevel'));
      return;
    }
    if (!barrels && !wellDown) {
      alert.show(t('record.errorMissingDataTitle'), t('record.errorMissingBarrels'));
      return;
    }

    try {
      setIsSending(true);

      const bblsTakenNum = parseFloat(barrels) || 0;
      const rawLevelFeet = tankLevelFeet ?? 0;

      // Floor the level to whole inches for VBA
      // e.g., 10' 2.5" (10.208333 ft) → 10' 2" (10.166666 ft)
      const rawLevelInches = rawLevelFeet * 12;
      const flooredInches = Math.floor(rawLevelInches + 0.0001); // epsilon for float precision
      const flooredLevelFeet = flooredInches / 12;

      // Calculate fractional inches lost by flooring
      const fractionalInchesLost = rawLevelInches - flooredInches;

      // Backdate timestamp by the fractional amount × flow rate
      // flowRateMinutes = minutes per FOOT, so divide by 12 for minutes per INCH
      // e.g., 0.5 inch × (120 min/ft ÷ 12) = 0.5 × 10 = 5 minutes backdate
      let adjustedDateTime = new Date(dateTime);
      if (flowRateMinutes > 0 && fractionalInchesLost > 0.001) {
        const minutesPerInch = flowRateMinutes / 12;
        const backdateMinutes = fractionalInchesLost * minutesPerInch;
        adjustedDateTime = new Date(dateTime.getTime() - backdateMinutes * 60 * 1000);
        console.log(`[Record] Level floored: ${rawLevelFeet.toFixed(4)} → ${flooredLevelFeet.toFixed(4)} ft`);
        console.log(`[Record] Timestamp backdated by ${backdateMinutes.toFixed(1)} minutes`);
      }

      const dateTimeString = formatPacketDateTime(adjustedDateTime);     // Local display string
      const dateTimeUTCString = formatPacketDateTimeUTC(adjustedDateTime); // ISO 8601 UTC
      const topLevel = flooredLevelFeet;

      if (isEditMode) {
        // --- EDIT MODE: Send edit packet (with offline queueing) ---
        const editResult = await smartUploadEditPacket({
          originalPacketTimestamp: editPacketTimestamp,
          originalPacketId: editId,
          wellName,
          dateTime: dateTimeString,           // Local display (legacy)
          dateTimeUTC: dateTimeUTCString,     // UTC for calculations
          tankLevelFeet: topLevel,
          bblsTaken: bblsTakenNum,
          wellDown,
        });

        // Update the entry in local history with new values
        await updatePullHistoryEntry(
          editId,
          dateTimeString,
          topLevel,
          bblsTakenNum,
          wellDown
        );

        // Calculate bottom level after pull (same as new pull logic)
        const bblPerFootEdit = await getBblPerFoot(wellName);
        const bottomLevelEdit = Math.max(topLevel - (bblsTakenNum / bblPerFootEdit), 0);

        // CRITICAL: Save level snapshot immediately for instant UI update
        // This is what the original pull does - the edit needs it too!
        // Use forceUpdate=true because edits may have older timestamps than the current snapshot
        // but we still want to show the corrected data immediately
        const lastPullTopLevelEdit = formatLevelDisplay(topLevel);
        const lastPullBottomLevelEdit = formatLevelDisplay(bottomLevelEdit);
        await saveLevelSnapshot(
          wellName,
          bottomLevelEdit,
          dateTimeUTCString,
          wellDown,
          dateTimeString,           // lastPullDateTime
          bblsTakenNum,             // lastPullBbls
          lastPullTopLevelEdit,     // lastPullTopLevel (tank level before pull)
          lastPullBottomLevelEdit,  // lastPullBottomLevel (tank level after pull)
          undefined,                // flowRate (not available yet - will come from response)
          undefined,                // flowRateMinutes (not available yet)
          dateTimeUTCString,        // lastPullDateTimeUTC - use for level calculations
          true                      // forceUpdate - skip timestamp check for edits
        );

        // Save pending pull for drain animation on main screen (same as new pull)
        // isEdit flag tells main screen to skip immediate response check (old response still exists)
        if (editResult.success) {
          await savePendingPull(wellName, {
            topLevel,
            bblsTaken: bblsTakenNum,
            packetTimestamp: editPacketTimestamp,
            packetId: editId,
            timestamp: Date.now(),
            wellDown,
            isEdit: true,
          });
        }

        // Create dispatch send queue for the edited pull (if enabled and configured)
        // Skip if zero bbls - just recording a level, not an actual pull
        if (bblsTakenNum > 0) {
          await initiateSendQueue({
            wellName,
            topLevel,
            bottomLevel: bottomLevelEdit,
            time: adjustedDateTime,  // Use backdated timestamp
            bbls: bblsTakenNum,
            isEdit: true,
          });
        }

        setIsSending(false);

        if (editResult.queued) {
          // Offline - show queued message with reason for debugging
          alert.show(
            "Edit Saved Locally",
            `System is offline. Your edit has been saved and will be submitted when connection is restored.\n\n(${editResult.error || 'unknown'})`,
            [{ text: "OK", onPress: () => router.back() }]
          );
        } else {
          // Online - go back immediately. The Cloud Function will process the edit
          // and increment incoming_version when done (~2-3s), which triggers the
          // app's version watcher to auto-sync and refresh the UI.
          router.back();
        }
      } else {
        // --- NEW PULL MODE: Send new packet (with offline queueing) ---
        const bblPerFoot = await getBblPerFoot(wellName);
        const levelAfterPull = Math.max(topLevel - (bblsTakenNum / bblPerFoot), 0);

        // Use smart upload - queues automatically if offline
        // Include predicted level (what driver saw on screen) for performance tracking
        const predictedLevelInches = estLevelFeet !== null ? Math.floor(estLevelFeet * 12) : undefined;
        const uploadResult = await smartUploadTankPacket({
          wellName,
          dateTime: dateTimeString,           // Local display (legacy)
          dateTimeUTC: dateTimeUTCString,     // UTC for calculations
          tankLevelFeet: topLevel,
          bblsTaken: bblsTakenNum,
          wellDown,
          predictedLevelInches,               // What driver saw - for performance tracking
        });

        // Generate local packet ID/timestamp for history tracking (even when queued)
        const localTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
        const packetTimestamp = uploadResult.packetTimestamp || localTimestamp;
        const packetId = uploadResult.packetId || `queued_${localTimestamp}_${wellName.replace(/\s+/g, '')}`;

        // Save to pull history for driver reference
        await addPullToHistory(
          wellName,
          dateTimeString,
          topLevel,
          bblsTakenNum,
          wellDown,
          packetTimestamp,
          packetId
        );

        // Save to local history for future level estimates
        await saveWellPull(wellName, levelAfterPull, bblsTakenNum, dateTimeString);

        // CRITICAL: Save level snapshot for offline level estimation
        // This allows the tank display to show accurate levels even when offline
        // Also update the lastPull info so the main screen shows correct "Last pull" display
        const lastPullTopLevel = formatFeetInches(topLevel);
        const lastPullBottomLevel = formatFeetInches(levelAfterPull);
        await saveLevelSnapshot(
          wellName,
          levelAfterPull,
          dateTimeUTCString,
          wellDown,
          dateTimeString,      // lastPullDateTime
          bblsTakenNum,        // lastPullBbls
          lastPullTopLevel,    // lastPullTopLevel (tank level before pull)
          lastPullBottomLevel, // lastPullBottomLevel (tank level after pull)
          undefined,           // flowRate (not available yet)
          undefined,           // flowRateMinutes (not available yet)
          dateTimeUTCString    // lastPullDateTimeUTC - use for level calculations
        );

        // Only save pending pull for animation if we actually sent to Firebase
        // (Don't show waiting animation for queued packets)
        if (uploadResult.success && uploadResult.packetTimestamp && uploadResult.packetId) {
          await savePendingPull(wellName, {
            topLevel,
            bblsTaken: bblsTakenNum,
            packetTimestamp: uploadResult.packetTimestamp,
            packetId: uploadResult.packetId,
            timestamp: Date.now(),
            wellDown,
          });
        }

        // Create dispatch send queue (if enabled and configured)
        // Skip if zero bbls - just recording a level, not an actual pull
        if (bblsTakenNum > 0) {
          const bottomLevel = Math.max(topLevel - (bblsTakenNum / bblPerFoot), 0);
          await initiateSendQueue({
            wellName,
            topLevel,
            bottomLevel,
            time: adjustedDateTime,  // Use backdated timestamp
            bbls: bblsTakenNum,
          });
        }

        setIsSending(false);

        // Clear draft after successful submission
        await clearDraft();

        if (uploadResult.queued) {
          // Offline - show queued message with queue count
          const queueCount = await getQueueCount();
          alert.show(
            "Pull Saved Locally",
            `System is offline. Your pull has been saved and will be submitted when connection is restored.${queueCount > 1 ? ` (${queueCount} pulls queued)` : ''}\n\n(${uploadResult.error || 'unknown'})`,
            [{ text: "OK", onPress: () => router.back() }]
          );
        } else {
          // Online - go back immediately, index.tsx will handle the waiting/animation
          // Dispatch button will appear globally if send queue was created
          router.back();
        }
      }

    } catch (error) {
      console.error('Upload failed', error);
      alert.show(t('record.errorGenericTitle'), error instanceof Error ? error.message : t('record.sendFailedFallback'));
      setIsSending(false);
    }
  };

  const levelHint = getLevelHint(level, t('record.tankLevelHint'), t('record.invalidFormat'));

  // Calculate bottom level after pull
  const getBottomLevelHint = (): string | null => {
    const tankLevel = parseLevel(level);
    const bblsTaken = parseFloat(barrels);
    if (tankLevel === null || isNaN(bblsTaken) || bblsTaken <= 0) return null;

    const feetPulled = bblsTaken / bblPerFoot;
    const bottomLevel = Math.max(tankLevel - feetPulled, 0);
    return formatFeetInches(bottomLevel);
  };

  const bottomLevelHint = getBottomLevelHint();

  // Title and button text based on mode
  const screenTitle = isEditMode ? t('recordExtra.editPull') : t('record.title');
  const submitButtonText = isEditMode
    ? (isSending ? t('recordExtra.sendingEdit') : t('recordExtra.saveEdit'))
    : (isSending ? t('record.buttonSubmitSending') : t('record.buttonSubmit'));

  return (
    <View style={{ flex: 1, backgroundColor: '#05060B' }}>
      {/* Fixed Header with back button */}
      <View style={[styles.fixedHeader, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={styles.backText}>{"←"}</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.title, isEditMode && styles.titleEdit]}>{screenTitle}</Text>
          <Text style={styles.wellNameDisplay}>{wellName}</Text>
        </View>

        {/* Spacer to balance the back button */}
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* Edit mode banner */}
        {isEditMode && (
          <View style={styles.editBanner}>
            <Text style={styles.editBannerText}>
              {t('recordExtra.editingPull', { dateTime: editDateTime })}
            </Text>
          </View>
        )}

        {/* Status display - like VBA form (only show for new pulls) */}
        {!isEditMode && (
          <View style={styles.statusBox}>
            {estLevel && (
              <Text style={styles.statusLine}>
                <Text style={styles.statusLabel}>{t('record.estimatedLevel')}  </Text>
                <Text style={styles.statusValue}>{estLevel}</Text>
                {estBbls !== null && <Text style={styles.statusValue}> - {estBbls} {t('recordExtra.bbl')}</Text>}
              </Text>
            )}
            {flowRate && (
              <Text style={styles.statusLine}>
                <Text style={styles.statusLabel}>{t('record.estimatedFlowRate')}  </Text>
                <Text style={styles.statusValue}>{flowRate}</Text>
              </Text>
            )}
            {lastPullInfo && (
              <Text style={styles.statusLine}>
                <Text style={styles.statusLabel}>{t('record.lastPull')}  </Text>
                <Text style={styles.statusValue}>{lastPullInfo}</Text>
              </Text>
            )}
          </View>
        )}

        {/* Well Down row with Clear button on left - below status card */}
        <View style={styles.wellDownRow}>
          {/* Clear button on left - always same width to prevent layout shift */}
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClear}
            activeOpacity={0.7}
            disabled={isEditMode || (!level && !barrels)}
          >
            <Text style={[
              styles.clearText,
              (isEditMode || (!level && !barrels)) && styles.clearTextHidden
            ]}>{t('record.clear')}</Text>
          </TouchableOpacity>

          {/* Well Down checkbox on right */}
          <TouchableOpacity
            style={styles.wellDownCorner}
            onPress={() => setWellDown(!wellDown)}
            activeOpacity={0.7}
          >
            <Text style={styles.wellDownLabel}>{t('record.wellIsDown') || 'Well Down'}</Text>
            <View style={[styles.checkbox, wellDown && styles.checkboxChecked]}>
              {wellDown && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </TouchableOpacity>
        </View>

        {/* Date / Time */}
        <View style={[styles.row, { marginBottom: spacing.md }]}>
          <View style={[styles.section, { flex: 1, marginRight: wp('2%') }]}>
            <Text style={styles.label}>{t('record.dateLabel')}</Text>
            <TouchableOpacity style={styles.input} onPress={() => {
              setTempDateTime(dateTime);
              setShowDatePicker(true);
            }}>
              <Text style={styles.inputText}>{formatDateLabel(dateTime)}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.section, { flex: 1 }]}>
            <Text style={styles.label}>{t('record.timeLabel')}</Text>
            <TouchableOpacity style={styles.input} onPress={() => {
              setTempDateTime(dateTime);
              setShowTimePicker(true);
            }}>
              <Text style={styles.inputText}>{formatTimeLabel(dateTime)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tank Level - Single Input with DEFAULT keyboard for space support */}
        <View style={styles.section}>
          <Text style={styles.label}>{t('record.tankLevelSection')}</Text>
          <TextInput
            ref={levelRef}
            style={styles.input}
            value={level}
            onChangeText={setLevel}
            keyboardType="default"
            placeholder={t('record.tankLevelPlaceholder') || "10 8 or 10.5"}
            placeholderTextColor="#6B7280"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => barrelsRef.current?.focus()}
            autoCapitalize="none"
            autoCorrect={false}
            selectTextOnFocus={isEditMode}
          />
          <Text style={styles.levelHint}>{levelHint}</Text>
        </View>

        {/* Barrels */}
        <View
          style={styles.section}
          onLayout={(e) => {
            barrelsInputY.current = e.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.label}>{t('record.barrelsTakenLabel')}</Text>
          <TextInput
            ref={barrelsRef}
            style={styles.input}
            value={barrels}
            onChangeText={setBarrels}
            keyboardType="number-pad"
            placeholder="140"
            placeholderTextColor="#6B7280"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            onFocus={handleBarrelsFocus}
            onBlur={handleBarrelsBlur}
            selectTextOnFocus={isEditMode}
          />
          <Text style={styles.bottomLevelHint}>
            {bottomLevelHint ? `Bottom: ${bottomLevelHint}` : ' '}
          </Text>
        </View>
      </ScrollView>

      {/* Fixed footer with submit button */}
      <View style={styles.buttonBlock}>
        <TouchableOpacity
          style={[
            styles.button,
            isEditMode && styles.buttonEdit,
            isSending && styles.buttonDisabled
          ]}
          onPress={handleSubmit}
          disabled={isSending}
        >
          <Text style={styles.buttonText}>{submitButtonText}</Text>
        </TouchableOpacity>

        {/* Cancel button for edit mode */}
        {isEditMode && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => router.back()}
          >
            <Text style={styles.cancelButtonText}>{t('recordExtra.cancel')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* iOS Date Picker Modal */}
      {Platform.OS === 'ios' && showDatePicker && (
        <Modal transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.modalCancel}>{t('recordExtra.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmDatePicker}>
                  <Text style={styles.modalDone}>{t('recordExtra.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDateTime}
                mode="date"
                display="spinner"
                onChange={handleIOSDateChange}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* iOS Time Picker Modal */}
      {Platform.OS === 'ios' && showTimePicker && (
        <Modal transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                  <Text style={styles.modalCancel}>{t('recordExtra.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmTimePicker}>
                  <Text style={styles.modalDone}>{t('recordExtra.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDateTime}
                mode="time"
                display="spinner"
                onChange={handleIOSDateChange}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Android Date/Time Pickers */}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker value={dateTime} mode="date" display="calendar" onChange={handleChangeDate} />
      )}
      {Platform.OS === 'android' && showTimePicker && (
        <DateTimePicker value={dateTime} mode="time" display="clock" onChange={handleChangeTime} />
      )}

      {/* Custom Alert Modal */}
      <alert.AlertComponent />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: {
    paddingTop: spacing.sm,
    paddingHorizontal: wp('5%'),
    paddingBottom: hp('30%'),  // Extra padding for keyboard scrolling
  },
  // Fixed header at top
  fixedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    // paddingTop is applied dynamically via insets.top
    paddingHorizontal: wp('5%'),
    paddingBottom: spacing.sm,
    backgroundColor: '#05060B',
  },
  backButton: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: hp('2.4%'),
    color: '#9CA3AF',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  clearButton: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  clearText: {
    fontSize: hp('1.6%'),
    color: '#EF4444',
    fontWeight: '500',
  },
  clearTextHidden: {
    opacity: 0, // Hidden but still takes up space
  },
  headerPlaceholder: {
    width: wp('8%'), // Balance the back button
  },
  title: { fontSize: hp('2.2%'), color: 'white', fontWeight: '700' },
  titleEdit: { color: '#F59E0B' },
  wellNameDisplay: {
    fontSize: hp('1.4%'),
    color: '#60A5FA',
    fontWeight: '600',
    marginTop: 2,
  },
  wellDownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  wellDownCorner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wellDownLabel: {
    color: '#DC2626',
    fontSize: hp('1.4%'),
    marginRight: 8,
    fontWeight: '500',
  },
  editBanner: {
    backgroundColor: '#92400E',
    borderRadius: hp('0.8%'),
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  editBannerText: {
    color: '#FEF3C7',
    fontSize: hp('1.5%'),
    textAlign: 'center',
  },
  statusBox: {
    backgroundColor: '#111827',
    borderRadius: hp('1%'),
    borderWidth: 1,
    borderColor: '#374151',
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  statusLine: {
    marginBottom: spacing.xs,
  },
  statusLabel: {
    color: '#9CA3AF',
    fontSize: hp('1.6%'),
  },
  statusValue: {
    color: '#F9FAFB',
    fontSize: hp('1.6%'),
    fontWeight: '600',
  },
  section: { marginBottom: spacing.md },
  label: {
    fontSize: hp('1.7%'),
    color: '#9CA3AF',
    marginBottom: spacing.xs / 2
  },
  input: {
    backgroundColor: '#111827',
    color: 'white',
    fontSize: hp('1.9%'),
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp('1%'),
    borderWidth: 1,
    borderColor: '#374151'
  },
  inputText: { color: 'white', fontSize: hp('1.9%') },
  row: { flexDirection: 'row' },
  levelHint: {
    fontSize: hp('1.5%'),
    color: '#10B981',
    marginTop: spacing.xs / 2,
    marginLeft: spacing.sm,
  },
  bottomLevelHint: {
    fontSize: hp('1.5%'),
    color: '#10B981',
    marginTop: spacing.xs / 2,
    marginLeft: spacing.sm,
  },
  button: {
    backgroundColor: '#2563EB',
    paddingVertical: spacing.md,
    borderRadius: hp('1.5%'),
    alignItems: 'center',
    marginTop: spacing.md
  },
  buttonEdit: {
    backgroundColor: '#D97706',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: 'white', fontSize: hp('2%'), fontWeight: '600' },
  buttonBlock: {
    paddingTop: spacing.md,
    paddingBottom: hp('8%'),  // Extra padding to clear Android navigation bar
    paddingHorizontal: wp('5%'),
    backgroundColor: '#05060B',
  },
  cancelButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cancelButtonText: {
    color: '#9CA3AF',
    fontSize: hp('1.8%'),
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#1F2937',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  modalCancel: {
    color: '#9CA3AF',
    fontSize: hp('2%'),
  },
  modalDone: {
    color: '#2563EB',
    fontSize: hp('2%'),
    fontWeight: '600',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#374151',
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  checkmark: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
});
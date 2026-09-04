import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from '../components/AppAlert';
import { useDispatch } from '../src/contexts/DispatchContext';
import { isCurrentUserViewer } from '../src/services/driverAuth';
import { smartUploadTankPacket } from '../src/services/packetQueue';
import { showSyncToast } from '../src/components/SyncToast';
import { submitPullEdit } from '../src/services/editDelivery';
import { mintPacketId } from '../src/services/firebase';
import { evaluatePullTime } from '../src/services/pullTimeGuard';
import { addPullToHistory, updatePullHistoryEntry } from '../src/services/pullHistory';
import { getBblPerFoot, getWellConfig, loadWellConfig } from '../src/services/wellConfig';
import { getLevelSnapshot, savePendingPull, saveWellPull, saveLevelSnapshot } from '../src/services/wellHistory';
import { hp, spacing, wp } from '../src/ui/layout';
import { resolveWellDownForSubmit } from '../src/utils/wellDownAuthority';
import { finalizeEdit } from '../src/domain/wbmEditForm';
import { formatAppDate, formatAppTime } from '../src/i18n/format';
import { WellBuiltBusyOverlay } from '../src/components/WellBuiltBusyOverlay';
import { startSubmitTrace, type SubmitOutcome } from '../src/telemetry/submitTiming';
import {
  MeasurementKeypadDismissOverlay,
  MeasurementKeypadProvider,
  MeasurementKeypadSlot,
  useMeasurementKeypad,
} from '../src/contexts/MeasurementKeypadContext';
import LevelFieldInput, { type LevelFieldInputHandle } from '../src/components/LevelFieldInput';
import {
  computeBottomLevelHint,
  formatFeetInches,
  formatLevelDisplay,
  formatLevelForInput,
  getLevelHint,
  getRecordLoadBlockReason,
  isRecordLoadSubmitReady,
  liveMeasurementValue,
  parseLevel,
} from '../src/utils/recordLoadHints';

// Stable field keys for the two Record Load measurement fields.
const LEVEL_FIELD_KEY = 'record-tank-level';
const BBLS_FIELD_KEY = 'record-bbls-taken';

// Key prefix for persisting draft form data (per-well)
const DRAFT_STORAGE_PREFIX = 'wellbuilt_draft_';

// Get storage key for a specific well
const getDraftKey = (wellName: string) => `${DRAFT_STORAGE_PREFIX}${wellName.replace(/\s+/g, '_')}`;


// Level parse/format helpers live in src/utils/recordLoadHints.ts (extracted
// verbatim so live-draft hint derivation is unit-testable).

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

// Minute-precision key for comparing displayed timestamps. The picker only
// exposes minute granularity, so two Dates that differ only in seconds/ms
// represent the same user-intended minute and must compare equal.
const formatMinuteKey = (d: Date): string => {
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const FULL_TANK_FEET = 20;

// Draft data structure for persisting form state (per-well)
interface DraftData {
  dateTime: string; // ISO string
  level: string;
  barrels: string;
  wellDown: boolean;
  // Whether the driver explicitly toggled Well Down in this draft. Persisted so
  // an explicit online/down assertion survives a draft restore (an untouched
  // draft must NOT resurrect as a manufactured status command). Optional for
  // backward-compat with drafts written before this field existed.
  wellDownTouched?: boolean;
  savedAt: number; // timestamp
}

function RecordScreenInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keypad = useMeasurementKeypad();
  const params = useLocalSearchParams();
  const wellName = String(params.wellName || "");
  const { initiateSendQueue } = useDispatch();

  // Edit mode params
  const isEditMode = params.editMode === 'true';
  const editId = String(params.editId || "");
  const editDateTime = String(params.editDateTime || "");
  const editDateTimeUTC = String(params.editDateTimeUTC || "");
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
  // Synchronous one-operation-per-tap guard (independent of the isSending render
  // state) so a duplicate submit can never start while one is awaiting the network.
  const submitInFlightRef = useRef(false);

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

  const barrelsFieldRef = useRef<LevelFieldInputHandle>(null);
  // Live Well Down state, readable synchronously at submit time. THE fix for
  // the lost down->online transition: the custom keypad's Done handler is a
  // closure captured when the measurement field was ACTIVATED — before the
  // driver unchecks Well Down — so reading `wellDown` from React state there
  // yields the pre-toggle value. handleSubmit reads these refs instead, so the
  // driver's explicit toggle (including an explicit `false`) always wins.
  const wellDownRef = useRef(false);
  // True once the driver explicitly taps the checkbox. Seeding from canonical
  // status is NOT a touch — an untouched submit preserves canonical status.
  const wellDownTouchedRef = useRef(false);
  // Canonical well status at form open (snapshot.isDown). An untouched submit
  // sends this value so the backend computes a non-transition.
  const canonicalWellDownRef = useRef(false);
  const committedBarrelsRef = useRef('');
  // Committed tank level, readable synchronously at submit time (mirror of
  // committedBarrelsRef): a level flushed from the active keypad draft must
  // count immediately, before React state has re-rendered.
  const committedLevelRef = useRef('');
  const barrelsInputY = useRef<number>(0);
  const hasDraftLoaded = useRef<boolean>(false);
  // Original displayed minute when entering edit mode. If the user submits
  // without changing the displayed minute we suppress dateTimeUTC/dateTime in
  // the edit packet so the Cloud Function preserves the original timestamp
  // instead of recomputing flow against a minute-truncated rewrite.
  const originalEditMinuteRef = useRef<string>('');

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
      wellDownTouched: wellDownTouchedRef.current,
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
      t('record.clearFormTitle'),
      t('record.clearFormBody'),
      [
        { text: t('common.cancel'), style: "cancel" },
        {
          text: t('record.clear'),
          style: "destructive",
          onPress: async () => {
            setLevel('');
            setBarrels('');
            setDateTime(new Date());
            // Clear returns Well Down to canonical status — an untouched state,
            // NOT an explicit assertion. Reset the touch flag + ref so a later
            // untouched submit preserves canonical rather than manufacturing a
            // transition from a leftover toggle.
            wellDownTouchedRef.current = false;
            wellDownRef.current = isAlreadyDown;
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
          // Restore Well Down by EXPLICIT boolean presence — never truthiness
          // (an explicit `false` must survive a draft restore). The seed in
          // loadWellData is guarded by wellDownTouchedRef, so restoring touch
          // here prevents the async canonical seed from clobbering it.
          if (typeof draft.wellDown === 'boolean') {
            const touched =
              draft.wellDownTouched === true ||
              // Legacy drafts (no touch flag): a checked box the driver could
              // see is treated as an explicit down assertion; unchecked is not.
              (draft.wellDownTouched === undefined && draft.wellDown === true);
            wellDownTouchedRef.current = touched;
            wellDownRef.current = draft.wellDown;
            setWellDown(draft.wellDown);
          }
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
        const parsed = parseDateTimeString(editDateTime);
        setDateTime(parsed);
        originalEditMinuteRef.current = formatMinuteKey(parsed);
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

  // Native-keyboard-aware scroll machinery removed: both measurement fields
  // now use the custom keypad (showSoftInputOnFocus=false), so the native soft
  // keyboard never opens on this screen and there is no overlap to correct.

  // Load well status data (only for new pulls, not edits)
  useEffect(() => {
    const loadWellData = async () => {
      if (!wellName) return;

      await loadWellConfig();
      const config = await getWellConfig(wellName);
      const snapshot = await getLevelSnapshot(wellName);

      // Effective bbl/ft — consume the Dashboard-saved well_config.bblPerFoot
      // (override if set, else derived from capacity/height/activeTanks) via the
      // SAME helper the save path uses, so the displayed bottom matches what gets
      // persisted. Falls back to legacy 20×tanks only when well_config has no
      // bblPerFoot. Previously hardcoded numTanks×20, which ignored the saved
      // value (e.g. GS3 showed 40 instead of 60 bbl/ft).
      const bblPerFt = await getBblPerFoot(wellName);
      setBblPerFoot(bblPerFt);

      // Skip status display for edit mode - we're editing existing data
      if (isEditMode) return;

      // Canonical status at form open — an untouched submit preserves this
      // exact value (so the backend computes a non-transition).
      canonicalWellDownRef.current = !!snapshot?.isDown;

      // Seed the checkbox from canonical status. This async load can resolve
      // AFTER the driver has already interacted, so it must never clobber an
      // explicit toggle (e.g. a driver who unchecked a down well before the
      // snapshot arrived). Seeding is not itself an authoritative command.
      if (snapshot?.isDown) {
        setIsAlreadyDown(true);
        if (!wellDownTouchedRef.current) {
          wellDownRef.current = true;
          setWellDown(true);
        }
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
          ? `${snapshot.lastPullDateTime} • ${snapshot.lastPullBbls} ${t('units.bbl')}`
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

  // Field-test fix: once the pull is DURABLY stored (queued or uploaded +
  // history written), the form must clear immediately — before any
  // feedback, independent of toast dismissal or network state — so two
  // consecutive offline pulls can never inherit stale values. Never called
  // on a storage failure (the catch path keeps the driver's entries).
  const resetFormAfterDurableSave = () => {
    setLevel('');
    setBarrels('');
    // The submitted pull is durably stored; reset Well Down to an untouched,
    // non-asserting baseline so a subsequent pull on this screen instance does
    // not inherit the just-submitted toggle as a fresh explicit command.
    wellDownTouchedRef.current = false;
    wellDownRef.current = false;
    setWellDown(false);
    const now = new Date();
    setDateTime(now);
    setTempDateTime(now);
  };

  const handleSubmit = async (committed?: { barrels?: string; level?: string }) => {
    // Privacy-safe phase timing (operational metadata only — no identity/values).
    const trace = startSubmitTrace(isEditMode ? 'edit' : 'create');
    trace.mark('tap');
    let submitOutcome: SubmitOutcome = 'failure';
    const barrelsValue = committed?.barrels ?? committedBarrelsRef.current ?? barrels;
    const levelValue = committed?.level ?? committedLevelRef.current ?? level;

    // Resolve Well Down from LIVE refs, not from this closure's captured state.
    // The keypad Done handler is a closure frozen at field-activation time
    // (before the driver toggles the box), so reading `wellDown` state here
    // loses an explicit down->online (or online->down) transition. New pulls
    // resolve through the authority helper: a touched box sends the driver's
    // value; an untouched box sends canonical (a deliberate non-transition).
    // Edit mode carries exactly the checkbox value the driver sees (the edit
    // contract handles authority server-side); still read from the ref so it
    // is never stale.
    // Pull path: resolve BOTH the explicit boolean and whether this pull asserts
    // authority. An UNTOUCHED box asserts NO authority (wellDownIsAuthoritative
    // false) so the server preserves canonical status even if it changed while
    // the form was open. Edit mode carries the checkbox value; authority is
    // handled by the edit contract server-side.
    const wellDownResolution = isEditMode
      // Edit path: an UNTOUCHED checkbox must NOT assert authority — it carries
      // the ORIGINAL value non-authoritatively so the server preserves canonical.
      // Only an explicit change (incl. to false) is authoritative. Toggling away
      // and back to the original is not a change.
      ? (() => {
          const original = editWellDown === true;
          const next = wellDownRef.current === true;
          const changed = wellDownTouchedRef.current && next !== original;
          return { wellDown: changed ? next : original, wellDownIsAuthoritative: changed };
        })()
      : resolveWellDownForSubmit({
          canonicalIsDown: canonicalWellDownRef.current,
          checkboxWellDown: wellDownRef.current,
          touched: wellDownTouchedRef.current,
        });
    const wellDownFinal = wellDownResolution.wellDown;
    const wellDownAuthoritativeFinal = wellDownResolution.wellDownIsAuthoritative;

    // ONE required-field validation authority, shared with the keypad's Done
    // gate (getRecordLoadBlockReason) — same checks, same order as always.
    // Uses the resolved value so submit and the Done gate agree on whether a
    // down well may skip level/barrels.
    const blocked = getRecordLoadBlockReason({
      wellName,
      level: levelValue,
      barrels: barrelsValue,
      wellDown: wellDownFinal,
    });
    if (blocked === 'no_well') {
      alert.show(t('common.error'), t('record.errorNoWell'));
      return;
    }
    if (blocked === 'missing_level') {
      alert.show(t('record.errorMissingDataTitle'), t('record.errorMissingLevel'));
      return;
    }
    if (blocked === 'missing_barrels') {
      alert.show(t('record.errorMissingDataTitle'), t('record.errorMissingBarrels'));
      return;
    }
    const tankLevelFeet = parseLevel(levelValue);
    trace.mark('validation');

    // One operation per tap: block a duplicate submit (keypad Done re-fire, edit
    // Save double-tap) during the network await. The guard is set before the
    // first await; existing idempotency/durable-queue behavior stays authoritative.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    try {
      setIsSending(true);

      const bblsTakenNum = parseFloat(barrelsValue) || 0;
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

      // GS3 7/21/2026 hard stop: a future-dated pull (11:07 PM entered for
      // 11:07 AM) became the server's stale-guard watermark and later real
      // pulls were silently deleted. Validate the FINALIZED UTC value — the
      // exact string every downstream write would carry — BEFORE any side
      // effect on either path: no upload, no queue, no Pull History, no
      // snapshots, no dispatch message. "Use current time" only updates the
      // form; the driver reviews and submits again — never a silent submit.
      const timeGate = evaluatePullTime(dateTimeUTCString, Date.now());
      if (!timeGate.ok) {
        setIsSending(false);
        alert.show(t('record.futureTimeTitle'), timeGate.message, [
          { text: t('record.futureTimeFix'), style: 'cancel' },
          {
            text: t('record.futureTimeUseCurrent'),
            onPress: () => {
              const now = new Date();
              setDateTime(now);
              setTempDateTime(now);
            },
          },
        ]);
        return;
      }

      if (isEditMode) {
        // --- EDIT MODE: Send edit packet (with offline queueing) ---
        // Suppress timestamp rewrite when the user did not change the displayed
        // minute. CF treats empty dateTimeUTC/dateTime as "preserve original"
        // via `data.dateTimeUTC || origPacket.dateTimeUTC`, so a no-op edit
        // leaves the original packet timestamp (and all derived flow math) intact.
        const minuteChanged =
          formatMinuteKey(dateTime) !== originalEditMinuteRef.current;

        // The well's authoritative total-bank bblPerFoot (same helper the save
        // path + live preview use), for finalize's derived bottom.
        const bblPerFootEdit = await getBblPerFoot(wellName);

        // Immutable original snapshot — the values the edit form opened with.
        const originalSnapshot = {
          tankLevelFeet: parseFloat(editLevel) || 0,
          bblsTaken: parseFloat(editBbls) || 0,
          wellDown: editWellDown === true,
          // Prefer the TRUE stored canonical instant (passed from History); only
          // reconstruct from the minute-precision local string as a legacy
          // fallback when the entry predates dateTimeUTC persistence.
          dateTimeUTC: editDateTimeUTC
            ? editDateTimeUTC
            : (() => { try { return parseDateTimeString(editDateTime).toISOString(); } catch { return ''; } })(),
        };

        // ONE finalize authority: normalize, diff changed-only vs the immutable
        // original, resolve Well-Down authority, and derive the bottom with the
        // shared calc. `topLevel` is already decimal feet → topInches 0.
        const finalized = finalizeEdit({
          draft: {
            topFeet: topLevel,
            topInches: 0,
            bbls: bblsTakenNum,
            dateTimeUTC: minuteChanged ? dateTimeUTCString : originalSnapshot.dateTimeUTC,
            dateTime: minuteChanged ? dateTimeString : '',
            wellDown: wellDownFinal,
            wellDownTouched: wellDownAuthoritativeFinal, // authoritative ⇒ genuinely changed
          },
          original: originalSnapshot,
          bblPerFoot: bblPerFootEdit,
          editEventId: '',
        });

        // No-change Save creates NO op, marker, or request.
        if (!finalized.hasChanges) {
          setIsSending(false);
          alert.show(
            t('record.noChangesTitle', { defaultValue: 'No changes' }),
            t('record.noChangesBody', { defaultValue: 'Nothing was changed, so there is nothing to save.' }),
            [{ text: t('common.ok'), onPress: () => router.back() }],
          );
          return;
        }

        // GS3 ordered edits: submitPullEdit decides the safe path — merge
        // into a still-queued pull (no edit packet), hold as a dependent
        // operation until the original is processed, upload now, or block
        // for attention (rejected original / legacy identity). Carries the
        // deterministic CHANGED-ONLY mask + Well-Down authority + immutable
        // original snapshot + content digest from finalize.
        trace.mark('requestBegin');
        const editOutcome = await submitPullEdit({
          originalPacketTimestamp: editPacketTimestamp,
          originalPacketId: editId,
          wellName,
          dateTime: minuteChanged ? dateTimeString : '',           // Local display (legacy)
          dateTimeUTC: minuteChanged ? dateTimeUTCString : '',     // UTC for calculations
          tankLevelFeet: topLevel,
          bblsTaken: bblsTakenNum,
          wellDown: wellDownFinal,
          editedFields: finalized.editedFields,
          wellDownIsAuthoritative: finalized.wellDownIsAuthoritative,
          originalSnapshot,
          payloadDigest: finalized.canonicalString,
        });
        trace.mark('serverAck');
        // Durably stored (merged/held/op) → queued unless it uploaded now.
        submitOutcome =
          editOutcome.mode === 'blocked'
            ? 'failure'
            : editOutcome.mode === 'uploading'
              ? 'success'
              : 'queued';

        // Update the entry's VALUES locally — but never claim '(edited)'
        // here: that marker appears only on server confirmation
        // (editDelivery → setPullEditStatus('edited')).
        await updatePullHistoryEntry(
          editId,
          dateTimeString,
          topLevel,
          bblsTakenNum,
          wellDownFinal,
          // Re-anchor the chronological key to the edited instant ONLY when the
          // time actually changed (Hard Blocker 1); non-time edits leave order intact.
          { markEdited: false, dateTimeUTC: minuteChanged ? dateTimeUTCString : undefined }
        );
        trace.mark('durableWrite');

        // Bottom level after pull — the SAME shared calc as the live preview,
        // the wire payload, and the server row (finalize.bottomInches, in feet).
        const bottomLevelEdit = Math.max(finalized.bottomInches / 12, 0);

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
          wellDownFinal,
          dateTimeString,           // lastPullDateTime
          bblsTakenNum,             // lastPullBbls
          lastPullTopLevelEdit,     // lastPullTopLevel (tank level before pull)
          lastPullBottomLevelEdit,  // lastPullBottomLevel (tank level after pull)
          undefined,                // flowRate (not available yet - will come from response)
          undefined,                // flowRateMinutes (not available yet)
          dateTimeUTCString,        // lastPullDateTimeUTC - use for level calculations
          true                      // forceUpdate - skip timestamp check for edits
        );
        trace.mark('reconcile');

        // Save pending pull for drain animation on main screen (same as new pull)
        // isEdit flag tells main screen to skip immediate response check (old response still exists)
        if (editOutcome.mode === 'uploading' && editOutcome.submitted) {
          await savePendingPull(wellName, {
            topLevel,
            bblsTaken: bblsTakenNum,
            packetTimestamp: editPacketTimestamp,
            packetId: editId,
            timestamp: Date.now(),
            wellDown: wellDownFinal,
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
        // Edit is durably stored (merged/held/op) — clear temporary form
        // state before feedback, same discipline as new pulls.
        resetFormAfterDurableSave();

        if (editOutcome.mode === 'merged_into_queued') {
          // Routine → branded nonblocking toast, plain driver wording.
          showSyncToast({
            title: t('record.toastPullUpdatedTitle'),
            body: t('record.toastPullUpdatedBody', { wellName }),
            tone: 'gold',
          });
          router.back();
        } else if (editOutcome.mode === 'held_dependent') {
          showSyncToast({
            title: t('record.toastEditSavedTitle'),
            body: t('record.toastEditSavedBody', { wellName }),
            tone: 'gold',
          });
          router.back();
        } else if (editOutcome.mode === 'blocked') {
          // Attention-required: blocking alert, never auto-dismissed.
          alert.show(
            t('record.editNeedsAttentionTitle'),
            editOutcome.reason,
            [{ text: t('common.ok'), onPress: () => router.back() }]
          );
        } else {
          // Uploading (or stored for retry). The Cloud Function will process
          // the edit and increment incoming_version when done (~2-3s), which
          // triggers the app's version watcher to auto-sync and refresh.
          router.back();
        }
      } else {
        // --- NEW PULL MODE: Send new packet (with offline queueing) ---
        const bblPerFoot = await getBblPerFoot(wellName);
        const levelAfterPull = Math.max(topLevel - (bblsTakenNum / bblPerFoot), 0);

        // Use smart upload - queues automatically if offline
        // Include predicted level (what driver saw on screen) for performance tracking
        const predictedLevelInches = estLevelFeet !== null ? Math.floor(estLevelFeet * 12) : undefined;
        // GS3 identity fix: ONE server-compatible id minted here carries
        // through upload/queue/replay, Pull History, and Firebase — replays
        // are idempotent and history reconciles by this same id.
        const packetId = mintPacketId(wellName);
        trace.mark('requestBegin');
        const uploadResult = await smartUploadTankPacket({
          packetId,
          wellName,
          dateTime: dateTimeString,           // Local display (legacy)
          dateTimeUTC: dateTimeUTCString,     // UTC for calculations
          tankLevelFeet: topLevel,
          bblsTaken: bblsTakenNum,
          wellDown: wellDownFinal,
          wellDownIsAuthoritative: wellDownAuthoritativeFinal, // false when untouched → server preserves canonical
          predictedLevelInches,               // What driver saw - for performance tracking
        });
        trace.mark('serverAck');
        submitOutcome = uploadResult.queued ? 'queued' : 'success';

        // History carries the SAME stable id whether the upload succeeded
        // or queued — no invented queued_* ids, no identity break.
        const packetTimestamp = packetId.slice(0, 15);

        // Save to pull history for driver reference
        await addPullToHistory(
          wellName,
          dateTimeString,
          topLevel,
          bblsTakenNum,
          wellDownFinal,
          packetTimestamp,
          packetId,
          // Truthful status: an accepted upload is only 'submitted' — the
          // reconciler confirms 'sent' once packets/processed shows it.
          uploadResult.success ? 'submitted' : 'pending_sync'
        );
        trace.mark('durableWrite');

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
          wellDownFinal,
          dateTimeString,      // lastPullDateTime
          bblsTakenNum,        // lastPullBbls
          lastPullTopLevel,    // lastPullTopLevel (tank level before pull)
          lastPullBottomLevel, // lastPullBottomLevel (tank level after pull)
          undefined,           // flowRate (not available yet)
          undefined,           // flowRateMinutes (not available yet)
          dateTimeUTCString    // lastPullDateTimeUTC - use for level calculations
        );
        trace.mark('reconcile');

        // Only save pending pull for animation if we actually sent to Firebase
        // (Don't show waiting animation for queued packets)
        if (uploadResult.success && uploadResult.packetTimestamp && uploadResult.packetId) {
          await savePendingPull(wellName, {
            topLevel,
            bblsTaken: bblsTakenNum,
            packetTimestamp: uploadResult.packetTimestamp,
            packetId: uploadResult.packetId,
            timestamp: Date.now(),
            wellDown: wellDownFinal,
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

        // Clear draft after successful submission, then reset the form —
        // BEFORE any feedback, unconditionally on both queued and online
        // paths (durable local storage already succeeded above).
        await clearDraft();
        resetFormAfterDurableSave();

        if (uploadResult.queued) {
          // Offline: branded, nonblocking, driver-plain — no dev wording.
          showSyncToast({
            title: t('record.toastSavedOnPhoneTitle'),
            body: t('record.toastSavedOnPhoneBody', { wellName }),
            tone: 'gold',
          });
          router.back();
        } else {
          // Online - go back immediately, index.tsx will handle the waiting/animation
          // Dispatch button will appear globally if send queue was created
          router.back();
        }
      }

    } catch (error) {
      console.error('Upload failed', error);
      alert.show(t('record.errorGenericTitle'), error instanceof Error ? error.message : t('record.sendFailedFallback'));
      submitOutcome = 'failure';
    } finally {
      // Always clear busy + guard — success, failure, no-op, or thrown — so the
      // overlay can never get stuck and a subsequent submit is never wedged.
      submitInFlightRef.current = false;
      setIsSending(false);
      trace.mark('navigate');
      trace.end(submitOutcome);
    }
  };

  // Live values: while a field owns the active custom-keypad session its
  // visible value is the keypad DRAFT — hints must derive from that so they
  // update on every number/backspace, not only after Done/commit.
  // Use the SAME active-field check the field itself uses to show the draft
  // (isActiveField, ref-based), so the derived-bottom hint reads the live keypad
  // draft on EVERY keystroke — matching LevelFieldInput's displayValue exactly.
  // (Previously compared keypad.activeFieldKey, which could diverge and make the
  // Bottom hint read a stale/empty committed value and disappear mid-entry.)
  const liveLevel = keypad.isActiveField(LEVEL_FIELD_KEY) ? keypad.draft : level;
  const liveBarrels = keypad.isActiveField(BBLS_FIELD_KEY) ? keypad.draft : barrels;

  const levelHint = getLevelHint(liveLevel, t('record.tankLevelHint'), t('record.invalidFormat'));

  // Bottom level after pull: bottom = tankLevel - (bblsTaken / bblPerFoot)
  const bottomLevelHint = computeBottomLevelHint(liveLevel, liveBarrels, bblPerFoot);

  // Keypad Done gate. New load: Done acts only when the WHOLE form would pass
  // submit's required-field validation — evaluated from the same LIVE values
  // as the hints (active keypad draft, committed state otherwise), through
  // the same authority handleSubmit uses, so the gate can never disagree with
  // the submit path. Edit mode: Done just finishes keypad entry (Save Edit is
  // the explicit edit-submit control), so it stays draft-gated only.
  const keypadDoneEnabled = isEditMode
    ? true
    : isRecordLoadSubmitReady({ wellName, level: liveLevel, barrels: liveBarrels, wellDown });

  // Title and button text based on mode
  const screenTitle = isEditMode ? t('recordExtra.editPull') : t('record.title');
  const submitButtonText = isEditMode
    ? (isSending ? t('recordExtra.sendingEdit') : t('recordExtra.saveEdit'))
    : (isSending ? t('record.buttonSubmitSending') : t('record.buttonSubmit'));

  useEffect(() => { committedBarrelsRef.current = barrels; }, [barrels]);
  useEffect(() => { committedLevelRef.current = level; }, [level]);
  // Mirror Well Down state into a ref so submit reads the LIVE value, not a
  // value frozen inside the keypad Done closure. Every setWellDown (checkbox
  // tap, seed, draft restore, clear, reset) flows through here.
  useEffect(() => { wellDownRef.current = wellDown; }, [wellDown]);

  return (
    <MeasurementKeypadDismissOverlay>
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
            onPress={() => {
              // Explicit driver assertion. Record the touch + the new value
              // synchronously in refs so a keypad Done fired immediately after
              // reads the toggled value (not a stale pre-toggle closure).
              const next = !wellDownRef.current;
              wellDownTouchedRef.current = true;
              wellDownRef.current = next;
              setWellDown(next);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.wellDownLabel}>{t('record.wellIsDown')}</Text>
            <View style={[styles.checkbox, wellDown && styles.checkboxChecked]}>
              {wellDown && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </TouchableOpacity>
        </View>

        {/* Date / Time */}
        <View style={[styles.row, { marginBottom: spacing.sm }]}>
          <View style={[styles.section, { flex: 1, marginRight: wp('2%') }]}>
            <Text style={styles.label}>{t('record.dateLabel')}</Text>
            <TouchableOpacity style={styles.input} onPress={() => {
              setTempDateTime(dateTime);
              setShowDatePicker(true);
            }}>
              <Text style={styles.inputText}>{formatAppDate(dateTime)}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.section, { flex: 1 }]}>
            <Text style={styles.label}>{t('record.timeLabel')}</Text>
            <TouchableOpacity style={styles.input} onPress={() => {
              setTempDateTime(dateTime);
              setShowTimePicker(true);
            }}>
              <Text style={styles.inputText}>{formatAppTime(dateTime)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tank Level - custom measurement keypad (level variant), same
            LevelFieldInput system as BBLs. No Android QWERTY: the keypad's
            feet/inches/space/decimal keys cover every accepted entry format.
            Next = navigation only (Tank Level → Next → BBLs, never submits).
            Done = finish the complete load from HERE: whole-form gated
            (keypadDoneEnabled), commits this live draft, submits with the
            already committed BBL value — no detour back through BBLs. */}
        <View style={styles.section}>
          <Text style={styles.label}>{t('record.tankLevelSection')}</Text>
          <LevelFieldInput
            fieldKey={LEVEL_FIELD_KEY}
            value={level}
            onChange={(v) => {
              committedLevelRef.current = v;
              setLevel(v);
            }}
            variant="level"
            // No in-field example placeholder — the example/format hint lives
            // under the field (levelHint) where it always has. Accessibility
            // name is preserved via accessibilityLabel (was previously carried
            // by the placeholder text).
            placeholder=""
            accessibilityLabel={t('record.tankLevelSection')}
            style={styles.input}
            onNextComplete={() => {
              barrelsFieldRef.current?.activateAsHandoffTarget();
            }}
            onDoneComplete={(formatted) => {
              committedLevelRef.current = formatted;
              setLevel(formatted);
              if (!isEditMode) {
                void handleSubmit({ level: formatted, barrels: committedBarrelsRef.current });
              }
            }}
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
          <LevelFieldInput
            ref={barrelsFieldRef}
            fieldKey={BBLS_FIELD_KEY}
            value={barrels}
            onChange={(v) => {
              committedBarrelsRef.current = v;
              setBarrels(v);
            }}
            variant="numeric"
            placeholder="140"
            style={styles.input}
            onDoneComplete={(formatted) => {
              committedBarrelsRef.current = formatted;
              setBarrels(formatted);
              if (!isEditMode) {
                void handleSubmit({ barrels: formatted });
              }
            }}
          />
          <Text style={styles.bottomLevelHint}>
            {bottomLevelHint ? t('record.bottomHint', { hint: bottomLevelHint }) : ' '}
          </Text>
        </View>
      </ScrollView>

      {/* New pulls submit via the keypad's gold Done key (enabled only when
          the whole form is complete/valid, from either measurement field) —
          no footer button, which keeps the info box + form visible above the
          keypad. Edit mode keeps Submit + Cancel (it has no info box and
          needs a back-out). */}
      {isEditMode && (
        <View style={styles.buttonBlock}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.buttonEdit,
              isSending && styles.buttonDisabled
            ]}
            onPress={() => {
              const flushed = keypad.flushActiveDraft();
              void handleSubmit({
                barrels: flushed?.fieldKey === BBLS_FIELD_KEY ? flushed.committed : committedBarrelsRef.current,
                level: flushed?.fieldKey === LEVEL_FIELD_KEY ? flushed.committed : committedLevelRef.current,
              });
            }}
            disabled={isSending}
          >
            <Text style={styles.buttonText}>{submitButtonText}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => router.back()}
          >
            <Text style={styles.cancelButtonText}>{t('recordExtra.cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

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

      {/* Live derived-Bottom, pinned directly above the keypad while a
          measurement field is being entered. The in-scroll hint under BBLs is
          clipped when the keypad reserves the lower screen, so this always-
          visible bar keeps the Bottom Level shown and updating from the LIVE
          keypad draft on every digit/backspace — BEFORE Done. */}
      {keypad.isOpen && (keypad.isActiveField(BBLS_FIELD_KEY) || keypad.isActiveField(LEVEL_FIELD_KEY)) && (
        <View style={styles.keypadBottomHintBar}>
          <Text style={styles.keypadBottomHintText}>
            {bottomLevelHint ? t('record.bottomHint', { hint: bottomLevelHint }) : ' '}
          </Text>
        </View>
      )}

      {/* Custom Alert Modal */}
      <alert.AlertComponent />
      <MeasurementKeypadSlot doneEnabled={keypadDoneEnabled} />

      {/* Canonical blocking busy state — paints only if the submit runs past
          ~200ms (no flash for instant submits), dims the form, and relabels to
          "Still…" after ~5s. Driven by isSending; the finally in handleSubmit
          guarantees it clears on success, failure, no-op, and unmount. */}
      <WellBuiltBusyOverlay
        visible={isSending}
        label={isEditMode ? t('record.busySavingEdit') : t('record.busySendingPull')}
        longLabel={isEditMode ? t('record.busyStillSaving') : t('record.busyStillSending')}
        testID="record-busy-overlay"
      />
    </View>
    </MeasurementKeypadDismissOverlay>
  );
}

export default function RecordScreen() {
  return (
    <MeasurementKeypadProvider>
      <RecordScreenInner />
    </MeasurementKeypadProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: {
    paddingTop: spacing.sm,
    paddingHorizontal: wp('5%'),
    // Normal small form-bottom spacing only — a fixed density-independent 16dp
    // value, NOT a screen percentage (all spacing.* tokens resolve through
    // hp()). The custom keypad's MeasurementKeypadSlot reserves its own space in
    // normal flow, so no keypad-height / percent-of-screen spacer is needed
    // here. The ScrollView is preserved, so natural scrolling still applies when
    // content genuinely overflows (small screens, landscape, large text scale).
    paddingBottom: 16,
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
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  statusLine: {
    marginBottom: spacing.xs / 2,
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
  section: { marginBottom: spacing.sm },
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
  keypadBottomHintBar: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(16,185,129,0.25)',
    alignItems: 'center',
  },
  keypadBottomHintText: {
    fontSize: hp('1.9%'),
    color: '#10B981',
    fontWeight: '600',
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
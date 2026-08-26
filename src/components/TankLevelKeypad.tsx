import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MEASUREMENT_KEYPAD_HEIGHT } from '../utils/measurementKeypadLayout';
import { useMeasurementKeypad } from '../contexts/MeasurementKeypadContext';

export type KeypadVariant = 'level' | 'numeric';

const KEY_GAP = 5;
const KEY_ROW_HEIGHT = 40;

function KeyButton({
  label,
  onPress,
  actionLabel,
  flex = 1,
  style,
}: {
  label: string;
  onPress: () => void;
  actionLabel?: boolean;
  flex?: number;
  style?: object;
}) {
  return (
    <TouchableOpacity
      style={[styles.key, { flex }, style]}
      onPress={onPress}
    >
      <Text style={[styles.keyLabel, actionLabel ? styles.keyLabelAction : null]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** Blocked keys still execute a press — this one, which does nothing. */
const NOOP = () => {};

function ActionButton({
  label,
  onPress,
  variant,
  blocked,
}: {
  label: string;
  onPress: () => void;
  variant: 'done' | 'next' | 'delete' | 'nav';
  blocked?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.key,
        variant === 'done' && styles.doneBtn,
        variant === 'next' && styles.nextBtn,
        variant === 'delete' && styles.deleteBtn,
        variant === 'nav' && styles.navBtn,
        blocked && styles.actionBtnBlocked,
      ]}
      // A blocked key must stay a live touch responder: with disabled={true}
      // the TouchableOpacity releases the touch, MeasurementKeypadDismissOverlay
      // sees the release as a blank-area tap, and the keypad dismiss-commits
      // the draft (vc17 field defect). Keeping it enabled means it claims the
      // touch exactly like every enabled key; the press itself is a no-op, so
      // a blocked tap changes nothing — keypad open, field active, draft live.
      onPress={blocked ? NOOP : onPress}
      activeOpacity={blocked ? 1 : 0.2}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!blocked }}
    >
      <Text
        style={[
          variant === 'done' ? styles.doneText : styles.keyLabel,
          variant === 'next' ? styles.nextText : null,
          variant === 'nav' ? styles.navText : null,
          actionLabelStyle(variant),
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function actionLabelStyle(variant: string) {
  if (variant === 'delete') return styles.keyLabelAction;
  return null;
}

export interface TankLevelKeypadProps {
  visible: boolean;
  /** The active session advances to another field — enables Next. Next is
   *  ALWAYS rendered (uniform layout); false only dims it. */
  showNext?: boolean;
  /** Whether Done may act right now. The caller decides why (Record Load:
   *  whole form complete/valid from live values); the keypad additionally
   *  requires the active draft itself to be committable. Default true keeps
   *  plain commit-gated Done. */
  doneAllowed?: boolean;
}

/**
 * Keys-only surface — 4 rows × 5 columns. Draft/caret live in the active form field.
 *
 * 7/27 — phone-style digit order (was calculator 789/456/123). Only the numeric
 * positions changed; the feet/inches/decimal (col 4) and Done/Next/Delete/nav
 * (col 5) keys keep their rows.
 * Row1: 1 2 3 ' Done — gold completion key. Blocked unless the active draft
 *   commits AND doneAllowed (caller-supplied gate; Record Load passes
 *   whole-form readiness from live values, edit mode passes true).
 * Row2: 4 5 6 " Next — always rendered so the keypad shape never changes
 *   between fields; enabled only when the session advances to another field
 *   (session.onNext, e.g. Tank Level → BBLs) and the draft commits. Terminal
 *   fields (BBLs) show it dimmed/inert.
 * Row3: 7 8 9 . Delete
 * Row4: 0 SPACE(×2) < >
 */
export default function TankLevelKeypad({ visible, showNext = true, doneAllowed = true }: TankLevelKeypadProps) {
  const keypad = useMeasurementKeypad();
  const canCommit = keypad.canCommit;
  const doneBlocked = !canCommit || !doneAllowed;
  const nextBlocked = !showNext || !canCommit;

  if (!visible) return null;

  const digit = (ch: string) => () => keypad.applyKey({ label: ch, value: ch });
  const symbol = (ch: string) => () => keypad.applyKey({ label: ch, value: ch });

  return (
    <View style={styles.sheet}>
      <View style={styles.grid}>
        <View style={styles.row}>
          <KeyButton label="1" onPress={digit('1')} />
          <KeyButton label="2" onPress={digit('2')} />
          <KeyButton label="3" onPress={digit('3')} />
          <KeyButton label="'" onPress={symbol("'")} />
          <ActionButton label="Done" onPress={keypad.commitDone} variant="done" blocked={doneBlocked} />
        </View>

        <View style={styles.row}>
          <KeyButton label="4" onPress={digit('4')} />
          <KeyButton label="5" onPress={digit('5')} />
          <KeyButton label="6" onPress={digit('6')} />
          <KeyButton label='"' onPress={symbol('"')} />
          <ActionButton label="Next" onPress={keypad.commitNext} variant="next" blocked={nextBlocked} />
        </View>

        <View style={styles.row}>
          <KeyButton label="7" onPress={digit('7')} />
          <KeyButton label="8" onPress={digit('8')} />
          <KeyButton label="9" onPress={digit('9')} />
          <KeyButton label="." onPress={symbol('.')} />
          <ActionButton
            label="DELETE"
            onPress={() => keypad.applyKey({ label: 'DELETE', action: 'delete' })}
            variant="delete"
          />
        </View>

        <View style={styles.row}>
          <KeyButton label="0" onPress={digit('0')} />
          <KeyButton
            label="SPACE"
            onPress={() => keypad.applyKey({ label: 'SPACE', action: 'space' })}
            actionLabel
            flex={2}
          />
          <ActionButton label="‹" onPress={keypad.cursorLeft} variant="nav" />
          <ActionButton label="›" onPress={keypad.cursorRight} variant="nav" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 10,
    minHeight: MEASUREMENT_KEYPAD_HEIGHT,
    width: '100%',
  },
  grid: {
    gap: KEY_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: KEY_GAP,
    height: KEY_ROW_HEIGHT,
  },
  key: {
    flex: 1,
    height: KEY_ROW_HEIGHT,
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  keyLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  keyLabelAction: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  doneBtn: {
    backgroundColor: '#FFD700',
    borderColor: '#FFD700',
  },
  nextBtn: {
    backgroundColor: '#444',
    borderColor: '#555',
  },
  deleteBtn: {
    backgroundColor: '#2a2a2a',
  },
  navBtn: {
    backgroundColor: '#2a2a2a',
  },
  actionBtnBlocked: {
    opacity: 0.45,
  },
  doneText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  nextText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  navText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
});
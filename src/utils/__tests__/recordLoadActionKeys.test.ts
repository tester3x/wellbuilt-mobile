import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyKeyToSession,
  canCommitKeypadSession,
  commitKeypadSession,
  createKeypadSession,
  type KeypadEditingState,
} from '../measurementKeypadSession';
import {
  getRecordLoadBlockReason,
  isRecordLoadSubmitReady,
  liveMeasurementValue,
} from '../recordLoadHints';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

const key = (ch: string) => ({ label: ch, value: ch });
const SPACE = { label: 'SPACE', action: 'space' as const };

const NEW_LOAD = { wellName: 'GS 3', wellDown: false };

describe('Record Load keypad: uniform Next + form-gated Done', () => {
  const record = src('app/record.tsx');
  const keypad = src('src/components/TankLevelKeypad.tsx');
  const field = src('src/components/LevelFieldInput.tsx');
  const ctx = src('src/contexts/MeasurementKeypadContext.tsx');
  const hints = src('src/utils/recordLoadHints.ts');

  const levelBlock = record.slice(record.indexOf('fieldKey={LEVEL_FIELD_KEY}'), record.indexOf('fieldKey={LEVEL_FIELD_KEY}') + 1100);
  const bblsBlock = record.slice(record.indexOf('fieldKey={BBLS_FIELD_KEY}'), record.indexOf('fieldKey={BBLS_FIELD_KEY}') + 700);
  // The Next handler alone — Done behavior is asserted separately, never conflated.
  const levelNextHandler = levelBlock.slice(levelBlock.indexOf('onNextComplete='), levelBlock.indexOf('onDoneComplete='));

  describe('1+5+8. uniform layout: Next and Done always rendered, on both fields', () => {
    it('Next is rendered unconditionally — enabled state is the only variable', () => {
      expect(keypad).toMatch(/<ActionButton label="Next" onPress=\{keypad\.commitNext\} variant="next" blocked=\{nextBlocked\} \/>/);
      // no conditional rendering around the workflow slot anymore
      expect(keypad).not.toMatch(/showNext \? \(/);
      expect(keypad).not.toMatch(/nextPlaceholder/);
      expect((keypad.match(/label="Next"/g) ?? []).length).toBe(1);
    });

    it('Done is rendered unconditionally in its existing gold position', () => {
      expect(keypad).toMatch(/<ActionButton label="Done" onPress=\{keypad\.commitDone\} variant="done" blocked=\{doneBlocked\} \/>/);
      expect((keypad.match(/label="Done"/g) ?? []).length).toBe(1);
    });
  });

  describe('7. Go does not exist', () => {
    it('no Go key, no showGo/showGoAction anywhere in production source', () => {
      for (const s of [record, keypad, field, ctx]) {
        expect(s).not.toMatch(/label="Go"/);
        expect(s).not.toMatch(/showGo/);
      }
    });
  });

  describe('2+6. Next enablement: valid level draft enables; BBLs stays inert', () => {
    it('Next blocked = !showNext || !canCommit', () => {
      expect(keypad).toMatch(/const nextBlocked = !showNext \|\| !canCommit;/);
      // blocked ActionButtons absorb the touch and no-op (see inert suite below)
      expect(keypad).toMatch(/onPress=\{blocked \? NOOP : onPress\}/);
      // showNext = the session advances to another field
      expect(ctx).toMatch(/showNext: !!session\?\.onNext/);
    });

    it('valid level draft commits (Next enabled); invalid blocks it', () => {
      let s: KeypadEditingState = createKeypadSession('', 'level');
      s = applyKeyToSession(s, key('1'));
      s = applyKeyToSession(s, key('0'));
      s = applyKeyToSession(s, SPACE);
      s = applyKeyToSession(s, key('8'));
      expect(canCommitKeypadSession(s)).toBe(true);
      expect(canCommitKeypadSession(createKeypadSession("10'15", 'level'))).toBe(false);
    });

    it('Tank Level session advances (onNext); BBLs never does → its Next is dimmed', () => {
      expect(levelBlock).toMatch(/onNextComplete=\{\(\) => \{\s*barrelsFieldRef\.current\?\.activateAsHandoffTarget\(\);/);
      expect(bblsBlock).not.toMatch(/onNextComplete/);
      expect(field).toMatch(/onNext: onNextComplete\s*\?\s*\(formatted: string\) => \{\s*onChange\(formatted\);\s*onNextComplete\(formatted\);\s*\}\s*: undefined/);
    });
  });

  describe('3+4. Next commits, hands off, never submits', () => {
    it('commitNext commits through the leaving-commit and routes to onNext', () => {
      expect(ctx).toMatch(/const commitNext = useCallback\(\(\) => \{[\s\S]*?commitLeavingKeypadSession\(current, \{ advanceWorkflow: true \}\)/);
      expect(ctx).toMatch(/if \(advanceWorkflow && current\.onNext\) \{\s*current\.onNext\(committed\);/);
      expect(commitKeypadSession(createKeypadSession('10 8', 'level'))).toBe('10\'8"');
    });

    it('Tank Level Next handler is navigation ONLY — no submit call inside it', () => {
      expect(levelNextHandler).toMatch(/barrelsFieldRef\.current\?\.activateAsHandoffTarget\(\);/);
      expect(levelNextHandler).not.toMatch(/handleSubmit/);
    });
  });

  describe('Tank Level Done finishes a complete new load from the level field', () => {
    it('level Done commits the LIVE level draft and submits it with the committed BBL value', () => {
      expect(levelBlock).toMatch(
        /onDoneComplete=\{\(formatted\) => \{\s*committedLevelRef\.current = formatted;\s*setLevel\(formatted\);\s*if \(!isEditMode\) \{\s*void handleSubmit\(\{ level: formatted, barrels: committedBarrelsRef\.current \}\);/,
      );
      // handleSubmit consumes the fresh value synchronously — no dependency
      // on setLevel having rendered
      expect(record).toMatch(/const levelValue = committed\?\.level \?\? committedLevelRef\.current \?\? level;/);
    });

    it('exactly one submission per level Done press; edit mode never submits from it', () => {
      const levelDone = levelBlock.slice(levelBlock.indexOf('onDoneComplete='));
      expect(levelDone.match(/handleSubmit\(/g)?.length).toBe(1);
      expect(levelDone).toMatch(/if \(!isEditMode\) \{/);
    });

    it('correction flow: level active + committed BBLs → Done eligible, no BBLs detour needed', () => {
      // Driver re-opens Tank Level after BBLs is filled: readiness = live
      // level draft + committed barrels → Done enabled from the level field.
      // session opens with the existing value selected (select-all-on-entry);
      // DELETE clears it and the driver retypes the corrected level
      let s: KeypadEditingState = createKeypadSession('10 8', 'level');
      s = applyKeyToSession(s, { label: 'DELETE', action: 'delete' });
      s = applyKeyToSession(s, key('1'));
      s = applyKeyToSession(s, key('0'));
      s = applyKeyToSession(s, SPACE);
      s = applyKeyToSession(s, key('9'));
      const liveLevel = liveMeasurementValue('record-tank-level', '10 8', 'record-tank-level', s.draft);
      expect(liveLevel).toBe('10 9');
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: liveLevel, barrels: '140' })).toBe(true);
      // …but with BBLs still missing, level Done stays disabled
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: liveLevel, barrels: '' })).toBe(false);
      // and the Done path itself never routes through the BBLs field
      const levelDone = levelBlock.slice(levelBlock.indexOf('onDoneComplete='));
      expect(levelDone).not.toMatch(/activateAsHandoffTarget/);
    });
  });

  describe('9-13. Done gate = existing submit validation authority', () => {
    it('9. missing required fields disable Done', () => {
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: '', barrels: '140' })).toBe(false);
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: '10 8', barrels: '' })).toBe(false);
      expect(isRecordLoadSubmitReady({ wellName: '', level: '10 8', barrels: '140', wellDown: false })).toBe(false);
    });

    it('10. invalid live level draft disables Done', () => {
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: 'abc', barrels: '140' })).toBe(false);
      // keypad-invalid level (inches > 11) is caught by the draft gate too
      expect(canCommitKeypadSession(createKeypadSession("10'15", 'level'))).toBe(false);
    });

    it('11. invalid/empty live BBL draft disables Done', () => {
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: '10 8', barrels: '' })).toBe(false);
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: '10 8', barrels: 'abc' })).toBe(false);
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: '10 8', barrels: '14.' })).toBe(false);
    });

    it('12. optional fields never block: well-down submission stays valid with empty fields', () => {
      // existing rule: a down well submits with no level/barrels
      expect(isRecordLoadSubmitReady({ wellName: 'GS 3', level: '', barrels: '', wellDown: true })).toBe(true);
      expect(isRecordLoadSubmitReady({ ...NEW_LOAD, level: '10 8', barrels: '140' })).toBe(true);
    });

    it('13. Done flips enabled the moment the last live value becomes valid', () => {
      let s: KeypadEditingState = createKeypadSession('', 'numeric');
      const readyFor = (state: KeypadEditingState) =>
        isRecordLoadSubmitReady({
          ...NEW_LOAD,
          level: '10 8',
          barrels: liveMeasurementValue('record-bbls-taken', '', 'record-bbls-taken', state.draft),
        });
      expect(readyFor(s)).toBe(false);          // empty draft → disabled
      s = applyKeyToSession(s, key('1'));
      expect(readyFor(s)).toBe(true);           // first digit → enabled immediately
      s = applyKeyToSession(s, { label: 'DELETE', action: 'delete' });
      expect(readyFor(s)).toBe(false);          // backspace to empty → disabled again
    });
  });

  describe('14. gating uses LIVE keypad drafts, same derivation as the hints', () => {
    it('record feeds liveLevel/liveBarrels into the readiness predicate', () => {
      expect(record).toMatch(/const liveLevel = liveMeasurementValue\(LEVEL_FIELD_KEY, level, keypad\.activeFieldKey, keypad\.draft\)/);
      expect(record).toMatch(/const liveBarrels = liveMeasurementValue\(BBLS_FIELD_KEY, barrels, keypad\.activeFieldKey, keypad\.draft\)/);
      expect(record).toMatch(/isRecordLoadSubmitReady\(\{ wellName, level: liveLevel, barrels: liveBarrels, wellDown \}\)/);
      expect(record).toMatch(/<MeasurementKeypadSlot doneEnabled=\{keypadDoneEnabled\} \/>/);
      // slot hands the gate to the keypad
      expect(ctx).toMatch(/<TankLevelKeypad visible showNext=\{showNext\} doneAllowed=\{doneEnabled\} \/>/);
    });
  });

  describe('15. blocked Done/Next are truly inert (vc17 field defect)', () => {
    it('Done blocked = !canCommit || !doneAllowed', () => {
      expect(keypad).toMatch(/const doneBlocked = !canCommit \|\| !doneAllowed;/);
    });

    it('blocked keys keep their touch target — no responder-releasing disabled={blocked}', () => {
      // disabled={true} released the touch to MeasurementKeypadDismissOverlay,
      // which dismiss-committed the draft as a blank-area tap. Blocked keys now
      // stay enabled responders whose press is an explicit no-op.
      expect(keypad).not.toMatch(/disabled=\{blocked\}/);
      expect(keypad).toMatch(/const NOOP = \(\) => \{\};/);
      expect(keypad).toMatch(/onPress=\{blocked \? NOOP : onPress\}/);
    });

    it('blocked keys stay rendered and dimmed with no press feedback', () => {
      expect(keypad).toMatch(/blocked && styles\.actionBtnBlocked/);
      expect(keypad).toMatch(/activeOpacity=\{blocked \? 1 : 0\.2\}/);
      expect(keypad).toMatch(/actionBtnBlocked: \{\s*opacity: 0\.45,/);
    });

    it('accessibility is platform-split: Android must NOT get accessibilityState.disabled', () => {
      // vc18 on-device: Android applies accessibilityState.disabled to the
      // NATIVE view's enabled flag → the key stops claiming touches → the
      // dismiss overlay treats the tap as blank form area (the exact defect).
      expect(keypad).toMatch(/accessibilityRole="button"/);
      expect(keypad).toMatch(/Platform\.OS === 'android'\s*\?\s*\{ accessibilityHint: blocked \? 'Unavailable' : undefined \}\s*:\s*\{ accessibilityState: \{ disabled: !!blocked \} \}/);
    });

    it('keypad sheet fences its touches from the dismiss overlay (deterministic)', () => {
      // Any keypad-surface touch no key claimed is claimed by the sheet, so
      // the overlay's blank-area candidate can never be armed by keypad taps —
      // independent of native disabled/a11y quirks on individual keys.
      const sheet = keypad.slice(keypad.indexOf('styles.sheet'), keypad.indexOf('styles.sheet') + 900);
      expect(sheet).toMatch(/onStartShouldSetResponder=\{\(\) => true\}/);
      expect(sheet).toMatch(/onTouchEnd=\{\(e\) => e\.stopPropagation\(\)\}/);
    });

    it('enabled wiring is untouched: Done → commitDone, Next → commitNext', () => {
      expect(keypad).toMatch(/<ActionButton label="Done" onPress=\{keypad\.commitDone\} variant="done" blocked=\{doneBlocked\} \/>/);
      expect(keypad).toMatch(/<ActionButton label="Next" onPress=\{keypad\.commitNext\} variant="next" blocked=\{nextBlocked\} \/>/);
    });

    it('the dismiss overlay itself is unchanged — blank-area tap still dismisses', () => {
      expect(ctx).toMatch(/const DISMISS_TAP_SLOP_PX = 12;/);
      expect(ctx).toMatch(/onStartShouldSetResponder=\{\(event: GestureResponderEvent\) => \{/);
      expect(ctx).toMatch(/ctx\.closeKeypad\(\);/);
    });
  });

  describe('16+17. enabled Done commits the latest draft and submits exactly once', () => {
    it('commitDone commits the LIVE session draft, then hands that exact value to onDone', () => {
      expect(ctx).toMatch(/const commitDone = useCallback[\s\S]*?const committed = commitKeypadSession\(\{\s*draft: current\.draft,[\s\S]*?current\.onDone\(committed\);/);
      expect(bblsBlock).toMatch(/onDoneComplete=\{\(formatted\) => \{\s*committedBarrelsRef\.current = formatted;\s*setBarrels\(formatted\);\s*if \(!isEditMode\) \{\s*void handleSubmit\(\{ barrels: formatted \}\);/);
    });

    it('one Done press → one submission; repeat press finds no session', () => {
      const bblsDone = bblsBlock.slice(bblsBlock.indexOf('onDoneComplete='));
      expect(bblsDone.match(/handleSubmit\(/g)?.length).toBe(1);
      expect(ctx).toMatch(/current\.onDone\(committed\);\s*sessionRef\.current = null;/);
      expect(ctx).toMatch(/if \(!current \|\| !canCommitKeypadSession\(\{/);
    });
  });

  describe('18. submit path rejects the same invalid cases via the same authority', () => {
    it('handleSubmit routes rejection alerts through getRecordLoadBlockReason', () => {
      expect(record).toMatch(/const blocked = getRecordLoadBlockReason\(\{\s*wellName,\s*level: levelValue,\s*barrels: barrelsValue,\s*wellDown,\s*\}\)/);
      expect(record).toMatch(/blocked === 'no_well'/);
      expect(record).toMatch(/blocked === 'missing_level'/);
      expect(record).toMatch(/blocked === 'missing_barrels'/);
      expect(record).toMatch(/errorMissingLevel/);
      expect(record).toMatch(/errorMissingBarrels/);
    });

    it('the authority still applies the original checks verbatim', () => {
      expect(hints).toMatch(/parseLevel\(form\.level\) === null && !form\.wellDown/);
      expect(hints).toMatch(/!form\.wellDown && \(!form\.barrels \|\| !\/\^\\d\+\(\\\.\\d\+\)\?\$\/\.test\(form\.barrels\.trim\(\)\)\)/);
      expect(getRecordLoadBlockReason({ wellName: '', level: '10 8', barrels: '140', wellDown: false })).toBe('no_well');
      expect(getRecordLoadBlockReason({ ...NEW_LOAD, level: '', barrels: '140' })).toBe('missing_level');
      expect(getRecordLoadBlockReason({ ...NEW_LOAD, level: '10 8', barrels: 'x' })).toBe('missing_barrels');
      expect(getRecordLoadBlockReason({ ...NEW_LOAD, level: '10 8', barrels: '140' })).toBeNull();
    });
  });

  describe('19+20. edit mode: Done finishes entry only; Save Edit is the submit authority', () => {
    it('edit-mode Done bypasses the form gate (commit-only), never submits', () => {
      expect(record).toMatch(/const keypadDoneEnabled = isEditMode\s*\?\s*true\s*:\s*isRecordLoadSubmitReady/);
      expect(bblsBlock).toMatch(/if \(!isEditMode\) \{\s*void handleSubmit\(\{ barrels: formatted \}\);/);
    });

    it('Save Edit flushes active drafts and is the only edit-mode submit call site', () => {
      expect(record).toMatch(/const flushed = keypad\.flushActiveDraft\(\);\s*void handleSubmit\(\{/);
      const editBtn = record.slice(record.indexOf('styles.buttonEdit'), record.indexOf('styles.buttonEdit') + 500);
      expect(editBtn.match(/handleSubmit\(/g)?.length).toBe(1);
    });
  });

  describe('layout/keys otherwise unchanged (no redesign)', () => {
    it('4 rows, same digits/symbols/action keys', () => {
      expect((keypad.match(/<View style=\{styles\.row\}>/g) ?? []).length).toBe(4);
      for (const label of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', "'", '.', 'SPACE', 'DELETE', 'Done', 'Next', '‹', '›']) {
        expect(keypad).toContain(`label="${label}"`);
      }
      expect(keypad).toContain('label=\'"\''); // inches key uses single-quoted JSX
      expect(keypad).toContain("Row1: 1 2 3 ' Done");
      expect(bblsBlock).toMatch(/variant="numeric"/);
    });
  });

  // 21+22: recordLoadLiveHints.test.ts and bblNumpadParity.test.ts run in the
  // same suite and lock the live Bottom/hint behavior and keypad parity.
});

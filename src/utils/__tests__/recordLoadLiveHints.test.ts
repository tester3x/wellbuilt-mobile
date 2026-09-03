import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyKeyToSession,
  createKeypadSession,
  type KeypadEditingState,
} from '../measurementKeypadSession';
import {
  computeBottomLevelHint,
  getLevelHint,
  liveMeasurementValue,
  parseLevel,
} from '../recordLoadHints';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

// Stable Record Load field keys — must match app/record.tsx.
const LEVEL_FIELD_KEY = 'record-tank-level';
const BBLS_FIELD_KEY = 'record-bbls-taken';

const DEFAULT_HINT = 'e.g. 10 8';
const INVALID_HINT = 'Invalid format';

const key = (ch: string) => ({ label: ch, value: ch });
const DELETE = { label: 'DELETE', action: 'delete' as const };
const SPACE = { label: 'SPACE', action: 'space' as const };

describe('Record Load live hints (2026-08-26 field regressions)', () => {
  const record = src('app/record.tsx');

  describe('1. BBL keypad draft drives Bottom live, before Done/commit', () => {
    it('Bottom recalculates on every digit and on backspace', () => {
      const committedLevel = '10 8'; // 10' 8"
      const committedBarrels = '';   // nothing committed yet
      let session: KeypadEditingState = createKeypadSession(committedBarrels, 'numeric');

      const bottomFor = (s: KeypadEditingState) =>
        computeBottomLevelHint(
          committedLevel,
          // BBLs field is the ACTIVE keypad session — hint uses the draft.
          liveMeasurementValue(BBLS_FIELD_KEY, committedBarrels, BBLS_FIELD_KEY, s.draft),
          20,
        );

      expect(bottomFor(session)).toBeNull(); // empty draft → blank hint

      session = applyKeyToSession(session, key('1'));
      expect(bottomFor(session)).toBe('10\'7"');   // 10.6667 - 1/20

      session = applyKeyToSession(session, key('4'));
      expect(bottomFor(session)).toBe('9\'11"');   // 10.6667 - 14/20

      session = applyKeyToSession(session, key('0'));
      expect(bottomFor(session)).toBe('3\'8"');    // 10.6667 - 140/20

      session = applyKeyToSession(session, DELETE);
      expect(bottomFor(session)).toBe('9\'11"');   // backspace → 14 again
    });

    it('empty/zero/invalid live input keeps the blank-hint behavior', () => {
      expect(computeBottomLevelHint('10 8', '', 20)).toBeNull();
      expect(computeBottomLevelHint('10 8', '0', 20)).toBeNull();
      expect(computeBottomLevelHint('10 8', 'abc', 20)).toBeNull();
      expect(computeBottomLevelHint('', '140', 20)).toBeNull();
    });

    it('inactive field falls back to the committed value', () => {
      // Keypad session belongs to the LEVEL field — barrels stays committed.
      expect(liveMeasurementValue(BBLS_FIELD_KEY, '140', LEVEL_FIELD_KEY, '9')).toBe('140');
      // No session at all.
      expect(liveMeasurementValue(BBLS_FIELD_KEY, '140', null, '')).toBe('140');
    });
  });

  describe('2. Tank Level live draft drives its hint and Bottom before commit', () => {
    it('level hint and Bottom update key-by-key from the level keypad draft', () => {
      const committedBarrels = '140';
      let session: KeypadEditingState = createKeypadSession('', 'level');

      const liveFor = (s: KeypadEditingState) =>
        liveMeasurementValue(LEVEL_FIELD_KEY, '', LEVEL_FIELD_KEY, s.draft);
      const hintFor = (s: KeypadEditingState) =>
        getLevelHint(liveFor(s), DEFAULT_HINT, INVALID_HINT);
      const bottomFor = (s: KeypadEditingState) =>
        computeBottomLevelHint(liveFor(s), committedBarrels, 20);

      expect(hintFor(session)).toBe(DEFAULT_HINT); // empty → default hint
      expect(bottomFor(session)).toBeNull();

      session = applyKeyToSession(session, key('1'));
      expect(hintFor(session)).toBe('= 1\'0"');
      expect(bottomFor(session)).toBe('0\'0"');    // 1 - 7 clamps at 0

      session = applyKeyToSession(session, key('0'));
      expect(hintFor(session)).toBe('= 10\'0"');
      expect(bottomFor(session)).toBe('3\'0"');    // 10 - 140/20

      session = applyKeyToSession(session, SPACE);
      session = applyKeyToSession(session, key('8'));
      expect(session.draft).toBe('10 8');
      expect(hintFor(session)).toBe('= 10\'8"');
      expect(bottomFor(session)).toBe('3\'8"');    // 10.6667 - 7
    });

    it("keypad apostrophe/quote entry parses the same as space entry", () => {
      expect(parseLevel("10'8\"")).toBeCloseTo(parseLevel('10 8')!, 10);
      expect(getLevelHint("10'8", DEFAULT_HINT, INVALID_HINT)).toBe('= 10\'8"');
    });

    it('record.tsx derives BOTH hints from live keypad values', () => {
      expect(record).toMatch(
        /const liveLevel = liveMeasurementValue\(LEVEL_FIELD_KEY, level, keypad\.activeFieldKey, keypad\.draft\)/,
      );
      expect(record).toMatch(
        /const liveBarrels = liveMeasurementValue\(BBLS_FIELD_KEY, barrels, keypad\.activeFieldKey, keypad\.draft\)/,
      );
      expect(record).toMatch(/getLevelHint\(liveLevel,/);
      expect(record).toMatch(/computeBottomLevelHint\(liveLevel, liveBarrels, bblPerFoot\)/);
    });
  });

  describe('3. Tank Level is wired through LevelFieldInput, not a native QWERTY TextInput', () => {
    it('uses the custom keypad system with a stable field key', () => {
      expect(record).toMatch(/const LEVEL_FIELD_KEY = 'record-tank-level'/);
      expect(record).toMatch(/const BBLS_FIELD_KEY = 'record-bbls-taken'/);
      expect(record).toMatch(/fieldKey=\{LEVEL_FIELD_KEY\}/);
      expect(record).toMatch(/variant="level"/);
    });

    it('has no native TextInput or QWERTY keyboard left on the screen', () => {
      expect(record).not.toMatch(/<TextInput/);
      expect(record).not.toMatch(/keyboardType=/);
      expect(record).not.toMatch(/from 'react-native'.*TextInput/s);
    });
  });

  describe('4. Next from Tank Level hands off to BBLs', () => {
    it('level field onNextComplete activates the BBLs field as handoff target', () => {
      expect(record).toMatch(
        /onNextComplete=\{\(\) => \{\s*barrelsFieldRef\.current\?\.activateAsHandoffTarget\(\);\s*\}\}/,
      );
    });
  });

  describe('5. Existing BBL custom-keypad behavior remains intact', () => {
    it('BBLs field keeps its numeric keypad wiring and Done-submits new pulls', () => {
      expect(record).toMatch(/fieldKey=\{BBLS_FIELD_KEY\}/);
      expect(record).toMatch(/variant="numeric"/);
      // scope to the BBLs field — Tank Level now has its own onDoneComplete
      const bbls = record.slice(record.indexOf('fieldKey={BBLS_FIELD_KEY}'));
      const done = bbls.slice(bbls.indexOf('onDoneComplete='), bbls.indexOf('onDoneComplete=') + 420);
      expect(done).toMatch(/handleSubmit\(\{ barrels: formatted \}\)/);
      expect(done.match(/handleSubmit\(/g)?.length).toBe(1);
    });
  });

  describe('6. getBblPerFoot() math is unchanged', () => {
    it('submit paths compute bottom from the well bblPerFoot via the shared calc', () => {
      // NEW-PULL path keeps the inline formula.
      expect(record).toMatch(/const bblPerFt = await getBblPerFoot\(wellName\)/);
      expect(record).toMatch(/Math\.max\(topLevel - \(bblsTakenNum \/ bblPerFoot\), 0\)/);
      // EDIT path routes the SAME math through finalizeEdit's shared derived
      // bottom (deriveBottomInches, unit-proven to mirror the server formula):
      // the well's bblPerFoot is fed into finalize, and the bottom comes from it.
      expect(record).toMatch(/const bblPerFootEdit = await getBblPerFoot\(wellName\)/);
      expect(record).toMatch(/bblPerFoot: bblPerFootEdit/);
      expect(record).toMatch(/finalized\.bottomInches \/ 12/);
    });

    it('hint math matches: bottom = tankLevel - (bblsTaken / bblPerFoot)', () => {
      // 10' - 40/20 ft = 8'0"
      expect(computeBottomLevelHint('10 0', '40', 20)).toBe('8\'0"');
      // 60 bbl/ft override (e.g. GS3): 10' - 120/60 ft = 8'0"
      expect(computeBottomLevelHint('10 0', '120', 60)).toBe('8\'0"');
      // clamps at 0
      expect(computeBottomLevelHint('1 0', '500', 20)).toBe('0\'0"');
    });
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyKeyToSession,
  canCommitKeypadSession,
  commitKeypadSession,
  createKeypadSession,
  type KeypadEditingState,
} from '../measurementKeypadSession';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

const key = (ch: string) => ({ label: ch, value: ch });
const SPACE = { label: 'SPACE', action: 'space' as const };

describe('Record Load workflow action key: Next (Tank Level) / Go (BBLs)', () => {
  const record = src('app/record.tsx');
  const keypad = src('src/components/TankLevelKeypad.tsx');
  const field = src('src/components/LevelFieldInput.tsx');
  const ctx = src('src/contexts/MeasurementKeypadContext.tsx');

  const levelBlock = record.slice(record.indexOf('fieldKey={LEVEL_FIELD_KEY}'), record.indexOf('fieldKey={LEVEL_FIELD_KEY}') + 600);
  const bblsBlock = record.slice(record.indexOf('fieldKey={BBLS_FIELD_KEY}'), record.indexOf('fieldKey={BBLS_FIELD_KEY}') + 700);

  describe('1+5. the one existing action slot renders Next or Go by session', () => {
    it('same slot: Next when the session advances (onNext), Go otherwise — no blank placeholder', () => {
      expect(keypad).toMatch(/\{showNext \? \(\s*<ActionButton label="Next" onPress=\{keypad\.commitNext\} variant="next" blocked=\{!canCommit\} \/>\s*\) : \(\s*<ActionButton label="Go" onPress=\{keypad\.commitDone\} variant="next" blocked=\{!canCommit\} \/>\s*\)\}/);
      expect(keypad).not.toMatch(/nextPlaceholder/);
      // showNext derives from the session having an onward field
      expect(ctx).toMatch(/showNext: !!session\?\.onNext/);
    });

    it('Tank Level session has onNext (→ Next); BBLs session has none (→ Go)', () => {
      expect(levelBlock).toMatch(/onNextComplete=\{\(\) => \{\s*barrelsFieldRef\.current\?\.activateAsHandoffTarget\(\);/);
      expect(bblsBlock).not.toMatch(/onNextComplete/);
      // LevelFieldInput only sets session.onNext when onNextComplete is provided
      expect(field).toMatch(/onNext: onNextComplete\s*\?\s*\(formatted: string\) => \{\s*onChange\(formatted\);\s*onNextComplete\(formatted\);\s*\}\s*: undefined/);
    });

    it('Go exists only on the keypad slot — no new form-level button', () => {
      expect((keypad.match(/label="Go"/g) ?? []).length).toBe(1);
      expect(record).not.toMatch(/label="Go"/);
      expect(record).not.toMatch(/ActionButton/);
    });
  });

  describe('2. Next commits the level draft with existing commit/format behavior', () => {
    it('level draft commits through commitKeypadSession (formatLevelOnCommit)', () => {
      let s: KeypadEditingState = createKeypadSession('', 'level');
      s = applyKeyToSession(s, key('1'));
      s = applyKeyToSession(s, key('0'));
      s = applyKeyToSession(s, SPACE);
      s = applyKeyToSession(s, key('8'));
      expect(canCommitKeypadSession(s)).toBe(true);
      expect(commitKeypadSession(s)).toBe('10\'8"');
    });

    it('commitNext routes the committed value into the field before navigating', () => {
      expect(ctx).toMatch(/const commitNext = useCallback\(\(\) => \{[\s\S]*?commitLeavingKeypadSession\(current, \{ advanceWorkflow: true \}\)/);
      // advancing commit hands the committed draft to session.onNext,
      // which (via LevelFieldInput) runs onChange(formatted) first
      expect(ctx).toMatch(/if \(advanceWorkflow && current\.onNext\) \{\s*current\.onNext\(committed\);/);
    });

    it('invalid level drafts block the action key', () => {
      expect(canCommitKeypadSession(createKeypadSession("10'15", 'level'))).toBe(false);
      expect(keypad).toMatch(/label="Next"[^/]*blocked=\{!canCommit\}/);
    });
  });

  describe('3. Next hands off to BBLs', () => {
    it('onNextComplete activates the BBLs field through the existing keypad handoff', () => {
      expect(levelBlock).toMatch(/activateAsHandoffTarget/);
      expect(field).toMatch(/keypadCtx\.handoffToField\(\{/);
    });
  });

  describe('4. Next does not submit the load', () => {
    it('no submit call anywhere on the Tank Level field wiring', () => {
      expect(levelBlock).not.toMatch(/handleSubmit/);
      expect(levelBlock).not.toMatch(/onDoneComplete/);
    });
  });

  describe('6. Go commits the active BBL draft before submit', () => {
    it('commitDone commits the LIVE session draft, then hands that exact value to onDone', () => {
      expect(ctx).toMatch(/const commitDone = useCallback[\s\S]*?const committed = commitKeypadSession\(\{\s*draft: current\.draft,[\s\S]*?current\.onDone\(committed\);/);
    });

    it('record submits the formatted value it was handed (not stale state)', () => {
      expect(bblsBlock).toMatch(/onDoneComplete=\{\(formatted\) => \{\s*committedBarrelsRef\.current = formatted;\s*setBarrels\(formatted\);\s*if \(!isEditMode\) \{\s*void handleSubmit\(\{ barrels: formatted \}\);/);
    });

    it('numeric commit yields the typed draft', () => {
      let s: KeypadEditingState = createKeypadSession('', 'numeric');
      s = applyKeyToSession(s, key('1'));
      s = applyKeyToSession(s, key('4'));
      s = applyKeyToSession(s, key('0'));
      expect(commitKeypadSession(s)).toBe('140');
    });
  });

  describe('7+8. exactly one submission per Go press; duplicate protection intact', () => {
    it('one onDoneComplete → one handleSubmit call', () => {
      const done = record.slice(record.indexOf('onDoneComplete='), record.indexOf('onDoneComplete=') + 420);
      expect(done.match(/handleSubmit\(/g)?.length).toBe(1);
    });

    it('commitDone clears the session after onDone, so a repeat press early-returns', () => {
      expect(ctx).toMatch(/current\.onDone\(committed\);\s*sessionRef\.current = null;/);
      expect(ctx).toMatch(/if \(!current \|\| !canCommitKeypadSession\(\{/);
    });
  });

  describe('9. keypad layout and normal keys unchanged', () => {
    it('4 rows, same digits/symbols/action keys', () => {
      expect((keypad.match(/<View style=\{styles\.row\}>/g) ?? []).length).toBe(4);
      for (const label of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', "'", '.', 'SPACE', 'DELETE', 'Done', '‹', '›']) {
        expect(keypad).toContain(`label="${label}"`);
      }
      expect(keypad).toContain('label=\'"\''); // inches key uses single-quoted JSX
      expect(keypad).toContain("Row1: 1 2 3 ' Done");
      expect(bblsBlock).toMatch(/variant="numeric"/);
    });
  });

  // 10. Live Bottom/hint behavior from c8a624c is covered by
  // recordLoadLiveHints.test.ts, which runs in the same suite.
});

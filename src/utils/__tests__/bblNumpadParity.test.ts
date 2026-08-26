import { readFileSync } from 'fs';
import { join } from 'path';
import { applyKeyToSession, canCommitKeypadSession, createKeypadSession } from '../measurementKeypadSession';

// Ported from wellbuilt-ticket TankLevelKeypad.tsx @ 59fb97e30056bd77549a59efb82f7a2f82e2d621
const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('WB-T numpad on Record Load measurement fields', () => {
  const record = src('app/record.tsx');
  const keypad = src('src/components/TankLevelKeypad.tsx');
  const field = src('src/components/LevelFieldInput.tsx');

  it('Tank Level Next hands off to the BBL keypad field', () => {
    expect(record).toMatch(/onNextComplete=\{\(\) => \{\s*barrelsFieldRef\.current\?\.activateAsHandoffTarget\(\);/);
    expect(record).not.toMatch(/barrelsRef\b/);
    expect(record).not.toMatch(/isBarrelsFocused/);
    expect(record).not.toMatch(/handleBarrelsFocus/);
  });

  it('opens the numeric variant for BBLs and the level variant for Tank Level — no native keyboard', () => {
    expect(record).toMatch(/variant="numeric"/);
    expect(record).toMatch(/variant="level"/);
    expect(record).not.toMatch(/keyboardType=/);
    expect(field).toMatch(/variant = 'level'/);
  });

  it('reuses the checked-in WB-T keypad layout', () => {
    expect(keypad).toContain('label="1"');
    expect(keypad).toContain('label="DELETE"');
    expect(keypad).toContain('label="SPACE"');
    expect(keypad).toContain("Row1: 1 2 3 ' Done");
  });

  it('digits, backspace, and numeric commit work without duplicate entry', () => {
    let session = createKeypadSession('', 'numeric');
    session = applyKeyToSession(session, { label: '1', value: '1' });
    session = applyKeyToSession(session, { label: '4', value: '4' });
    session = applyKeyToSession(session, { label: '0', value: '0' });
    expect(session.draft).toBe('140');
    session = applyKeyToSession(session, { label: 'DELETE', action: 'delete' });
    expect(session.draft).toBe('14');
    expect(canCommitKeypadSession(createKeypadSession("10'6\"", 'numeric'))).toBe(false);
    expect(canCommitKeypadSession(createKeypadSession('140', 'numeric'))).toBe(true);
  });

  it('one Done press produces one committed BBL value and one submission', () => {
    // scope to the BBLs field — Tank Level has its own onDoneComplete now
    const bbls = record.slice(record.indexOf('fieldKey={BBLS_FIELD_KEY}'));
    const done = bbls.slice(bbls.indexOf('onDoneComplete='), bbls.indexOf('onDoneComplete=') + 420);
    expect(done).toMatch(/handleSubmit\(\{ barrels: formatted \}\)/);
    expect(done.match(/handleSubmit\(/g)?.length).toBe(1);
    expect(record).toMatch(/if \(!isEditMode\)/);
  });

  it('invalid or empty BBL drafts cannot submit', () => {
    expect(canCommitKeypadSession(createKeypadSession("10'6\"", 'numeric'))).toBe(false);
    expect(canCommitKeypadSession(createKeypadSession('abc', 'numeric'))).toBe(false);
    // barrels requirement now lives in the shared validation authority
    // (recordLoadHints.getRecordLoadBlockReason), which handleSubmit consumes.
    const hints = src('src/utils/recordLoadHints.ts');
    expect(hints).toMatch(/!form\.wellDown && \(!form\.barrels \|\| !\/\^\\d\+\(\\\.\\d\+\)\?\$\/\.test\(form\.barrels\.trim\(\)\)\)/);
    expect(record).toMatch(/getRecordLoadBlockReason\(\{/);
    expect(record).toMatch(/errorMissingBarrels/);
  });

  it('does not read an absolute cross-repo keypad path', () => {
    const self = src('src/utils/__tests__/bblNumpadParity.test.ts');
    expect(self).not.toMatch(/D:\/dev\/wellbuilt-ticket/);
    expect(self).not.toMatch(/wellbuilt-ticket\/components\/TankLevelKeypad/);
  });
});

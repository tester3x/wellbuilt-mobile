import { readFileSync } from 'fs';
import { join } from 'path';
import { applyKeyToSession, canCommitKeypadSession, createKeypadSession } from '../measurementKeypadSession';

// Ported from wellbuilt-ticket TankLevelKeypad.tsx @ 59fb97e30056bd77549a59efb82f7a2f82e2d621
const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('WB-T numpad on BBLs Taken only', () => {
  const record = src('app/record.tsx');
  const keypad = src('src/components/TankLevelKeypad.tsx');
  const field = src('src/components/LevelFieldInput.tsx');

  it('Tank Level submit/Next opens the BBL keypad', () => {
    expect(record).toMatch(/onSubmitEditing=\{openBblsKeypad\}/);
    expect(record).toMatch(/const openBblsKeypad = \(\) => \{\s*barrelsFieldRef\.current\?\.focus\(\);/);
    expect(record).not.toMatch(/barrelsRef/);
    expect(record).not.toMatch(/isBarrelsFocused/);
    expect(record).not.toMatch(/handleBarrelsFocus/);
  });

  it('opens the numeric variant for BBLs; level stays QWERTY', () => {
    expect(record).toMatch(/variant="numeric"/);
    expect(record).toMatch(/keyboardType="default"/);
    expect(record).not.toMatch(/keyboardType="number-pad"/);
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
    const done = record.slice(record.indexOf('onDoneComplete='), record.indexOf('onDoneComplete=') + 420);
    expect(done).toMatch(/handleSubmit\(\{ barrels: formatted \}\)/);
    expect(done.match(/handleSubmit\(/g)?.length).toBe(1);
    expect(record).toMatch(/if \(!isEditMode\)/);
  });

  it('invalid or empty BBL drafts cannot submit', () => {
    expect(canCommitKeypadSession(createKeypadSession("10'6\"", 'numeric'))).toBe(false);
    expect(canCommitKeypadSession(createKeypadSession('abc', 'numeric'))).toBe(false);
    expect(record).toMatch(/!wellDown && \(!barrelsValue \|\| !\/\^\\d\+\(\\\.\\d\+\)\?\$\/\.test\(barrelsValue\.trim\(\)\)\)/);
    expect(record).toMatch(/errorMissingBarrels/);
  });

  it('does not read an absolute cross-repo keypad path', () => {
    const self = src('src/utils/__tests__/bblNumpadParity.test.ts');
    expect(self).not.toMatch(/D:\/dev\/wellbuilt-ticket/);
    expect(self).not.toMatch(/wellbuilt-ticket\/components\/TankLevelKeypad/);
  });
});

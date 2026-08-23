import { readFileSync } from 'fs';
import { join } from 'path';
import { applyKeyToSession, canCommitKeypadSession, createKeypadSession } from '../measurementKeypadSession';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('WB-T numpad on BBLs Taken only', () => {
  const record = src('app/record.tsx');
  const keypad = src('src/components/TankLevelKeypad.tsx');
  const wbt = readFileSync(join('D:/dev/wellbuilt-ticket/components/TankLevelKeypad.tsx'), 'utf8');

  it('BBLs field opens the WB-T numpad; level stays QWERTY', () => {
    expect(record).toMatch(/variant="numeric"/);
    expect(record).toMatch(/keyboardType="default"/);
    expect(record).not.toMatch(/keyboardType="number-pad"/);
    expect(record).toMatch(/BBLS_FIELD_KEY/);
    expect(record).not.toMatch(/record-tank-level/);
  });

  it('reuses the exact WB-T keypad layout', () => {
    expect(keypad).toContain('label="1"');
    expect(keypad).toContain('label="DELETE"');
    expect(keypad).toContain('label="SPACE"');
    expect(wbt).toContain('Row1: 1 2 3 \' Done');
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

  it('BBL Done submits the committed keypad draft', () => {
    expect(record).toMatch(/onDoneComplete=\{\(formatted\) => \{/);
    expect(record).toMatch(/handleSubmit\(\{ barrels: formatted \}\)/);
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyKeyToSession,
  canCommitKeypadSession,
  commitKeypadSession,
  createKeypadSession,
  moveKeypadCursor,
} from '../measurementKeypadSession';
import { measurementInputVisualProps } from '../measurementFieldStyle';
import { insertAtSelection, deleteBackward } from '../tankLevelEditing';

const root = join(__dirname, '../../..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('WB-T keypad parity in WB-M', () => {
  const keypad = src('src/components/TankLevelKeypad.tsx');
  const field = src('src/components/LevelFieldInput.tsx');
  const record = src('app/record.tsx');
  const wbtKeypad = readFileSync(
    join('D:/dev/wellbuilt-ticket/components/TankLevelKeypad.tsx'),
    'utf8',
  );

  it('keeps the exact WB-T key layout', () => {
    const layout = [
      'label="1"',
      'label="2"',
      'label="3"',
      'label="\'"',
      'label="Done"',
      'label="4"',
      'label="5"',
      'label="6"',
      'label=\'"\'',
      'label="Next"',
      'label="7"',
      'label="8"',
      'label="9"',
      'label="."',
      'label="DELETE"',
      'label="0"',
      'label="SPACE"',
      'label="‹"',
      'label="›"',
    ];
    for (const token of layout) {
      expect(keypad).toContain(token);
      expect(wbtKeypad).toContain(token);
    }
    expect(keypad).toMatch(/Row1: 1 2 3 ' Done/);
    expect(keypad).toMatch(/Row2: 4 5 6 " Next/);
    expect(keypad).toMatch(/Row3: 7 8 9 \. Delete/);
    expect(keypad).toMatch(/SPACE\(×2\)/);
  });

  it('suppresses native IME for both record fields', () => {
    expect(measurementInputVisualProps().showSoftInputOnFocus).toBe(false);
    expect(field).toMatch(/showSoftInputOnFocus=\{activeVisualProps\.showSoftInputOnFocus\}/);
    expect(record).not.toMatch(/keyboardType="number-pad"/);
    expect(record).toMatch(/variant="level"/);
    expect(record).toMatch(/variant="numeric"/);
  });

  it('Tank Level Next hands off directly to BBLs Taken', () => {
    expect(record).toMatch(/onNextComplete=/);
    expect(record).toMatch(/activateAsHandoffTarget/);
    expect(record).toMatch(/record-tank-level/);
    expect(record).toMatch(/record-bbls-taken/);
  });

  it('selection/caret insertion, range replace, DELETE, SPACE/apostrophe/quote/decimal', () => {
    let session = createKeypadSession('', 'level');
    session = applyKeyToSession(session, { label: '1', value: '1' });
    session = applyKeyToSession(session, { label: '0', value: '0' });
    session = applyKeyToSession(session, { label: 'SPACE', action: 'space' });
    session = applyKeyToSession(session, { label: '6', value: '6' });
    expect(session.draft).toBe('10 6');
    expect(canCommitKeypadSession(session)).toBe(true);

    session = createKeypadSession('', 'level');
    session = applyKeyToSession(session, { label: '1', value: '1' });
    session = applyKeyToSession(session, { label: '0', value: '0' });
    session = applyKeyToSession(session, { label: "'", value: "'" });
    session = applyKeyToSession(session, { label: '6', value: '6' });
    session = applyKeyToSession(session, { label: '"', value: '"' });
    expect(session.draft).toBe('10\'6"');

    session = createKeypadSession('', 'level');
    session = applyKeyToSession(session, { label: '1', value: '1' });
    session = applyKeyToSession(session, { label: '0', value: '0' });
    session = applyKeyToSession(session, { label: '.', value: '.' });
    session = applyKeyToSession(session, { label: '5', value: '5' });
    expect(session.draft).toBe('10.5');

    const replaced = insertAtSelection('140', { start: 0, end: 3 }, '5');
    expect(replaced.draft).toBe('5');
    const deleted = deleteBackward('140', { start: 3, end: 3 });
    expect(deleted.draft).toBe('14');
    const moved = moveKeypadCursor(createKeypadSession('140', 'numeric'), 'left');
    expect(moved.selection).toEqual({ start: 2, end: 2 });
  });

  it('numeric BBL commit rejects measurement symbols and Done uses the keypad draft', () => {
    const bad = createKeypadSession("10'6\"", 'numeric');
    expect(canCommitKeypadSession(bad)).toBe(false);
    const good = createKeypadSession('140', 'numeric');
    expect(canCommitKeypadSession(good)).toBe(true);
    expect(commitKeypadSession(good)).toBe('140');
    expect(record).toMatch(/onDoneComplete=\{\(formatted\) => \{/);
    expect(record).toMatch(/handleSubmit\(\{\s*level: committedLevelRef\.current,\s*barrels: formatted,/);
  });

  it('Cancel/back closes the keypad so drafts cannot leak across fields', () => {
    expect(record).toMatch(/dismissAndBack/);
    expect(record).toMatch(/keypad\.closeKeypad\(\)/);
    expect(record).toMatch(/fieldKey=\{LEVEL_FIELD_KEY\}/);
    expect(record).toMatch(/fieldKey=\{BBLS_FIELD_KEY\}/);
  });

  it('edit-mode populated values still select the complete buffer including a final quote', () => {
    const session = createKeypadSession('10\'6"', 'level');
    expect(session.selection).toEqual({ start: 0, end: '10\'6"'.length });
    expect(record).toMatch(/activateAsHandoffTarget/);
  });

  it('preserves the existing level parser in record.tsx', () => {
    expect(record).toMatch(/const parseLevel = \(input: string\): number \| null => \{/);
    expect(record).toMatch(/"6 4"/);
    expect(record).toMatch(/6\.4 means 6\.4 feet/);
  });
});

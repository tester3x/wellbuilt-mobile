// Source-level regression proofs for the shared Record Load / Pull Edit screen
// (app/record.tsx) and the shared keypad slot. Mirrors the repo's existing
// source-assertion pattern (see src/ui/__tests__/safeAreaBadge.test.ts).
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');
const record = read('app/record.tsx');
const levelField = read('src/components/LevelFieldInput.tsx');
const context = read('src/contexts/MeasurementKeypadContext.tsx');
const keypad = read('src/components/TankLevelKeypad.tsx');

describe('Record Load / Pull Edit — Issue 1: artificial form gap removed', () => {
  const contentContainer = (record.match(/contentContainer:\s*\{[\s\S]*?\},/) || [''])[0];

  it('#1 the obsolete 30% content padding is gone', () => {
    expect(record).not.toMatch(/paddingBottom:\s*hp\(['"]30%['"]\)/);
    // (the "no screen-derived value at the form-bottom padding" guarantee is
    //  enforced precisely on the padding VALUE in #2, not on comment text)
  });

  it('#2 form-bottom padding is a fixed density-independent dp value, not screen-derived', () => {
    const pb = ((contentContainer.match(/paddingBottom:\s*([^,\n]+)/) || [])[1] || '').trim();
    expect(pb).toMatch(/^\d+$/);            // a plain dp number (e.g. 16), not a token/expression
    expect(pb).not.toMatch(/hp\(|wp\(/);    // reject any screen percentage
    expect(pb).not.toMatch(/spacing\./);    // reject spacing tokens (all resolve through hp())
    expect(Number(pb)).toBeGreaterThan(0);
    expect(Number(pb)).toBeLessThanOrEqual(48); // reject restoration of a large artificial spacer
  });

  it('#3 the ScrollView is preserved (natural scrolling retained on overflow)', () => {
    expect(record).toMatch(/<ScrollView/);
  });
});

describe('Record Load / Pull Edit — Issue 2: duplicate Tank Level placeholder removed', () => {
  it('#4 Tank Level renders no in-field example placeholder', () => {
    expect(record).toMatch(/variant="level"[\s\S]{0,400}?placeholder=""/);
    expect(record).not.toMatch(/tankLevelPlaceholder/); // old in-field example source removed
  });

  it('#5 the below-field Tank Level hint remains', () => {
    expect(record).toMatch(/styles\.levelHint/);
    expect(record).toMatch(/\{levelHint\}/);
  });

  it('#6 Barrels Taken keeps its placeholder "140"', () => {
    expect(record).toMatch(/variant="numeric"[\s\S]{0,400}?placeholder="140"/);
  });

  it('accessibility preserved: Tank Level supplies accessibilityLabel; LevelFieldInput forwards it and keeps no empty-string fallback', () => {
    expect(record).toMatch(/accessibilityLabel=\{t\('record\.tankLevelSection'\)\}/);
    expect(levelField).toMatch(/accessibilityLabel/);
    // Default only applies to `undefined`, not '' — so an empty placeholder stays empty.
    expect(levelField).toMatch(/placeholder = '10 4'/);
    expect(levelField).toMatch(/placeholder=\{placeholder\}/);
    expect(levelField).not.toMatch(/placeholder=\{placeholder \|\|/);
  });
});

describe('Record Load / Pull Edit — Issue 3: bottom safe area owned by the slot exactly once', () => {
  it('the slot is the geometry owner: uses the effective clearance via the single helper', () => {
    expect(context).toMatch(/useSafeAreaInsets/);
    // Effective bottom = max(live inset, pre-hide initial inset), applied once.
    expect(context).toMatch(/getEffectiveBottomClearance\(\s*insets\.bottom,\s*initialWindowSafeAreaInsets\?\.bottom/);
    expect(context).toMatch(/getMeasurementSlotGeometry\(effectiveBottom\)/);
    expect(context).toMatch(/paddingBottom:\s*slotGeometry\.safeAreaPadding/);
    expect(context).toMatch(/outputRange:\s*\[slotGeometry\.entryTranslateY,\s*0\]/);
  });

  it('the keypad component keeps its own 10-unit internal padding and does NOT add the inset again', () => {
    expect(keypad).toMatch(/paddingBottom:\s*10/);      // internal padding preserved
    expect(keypad).not.toMatch(/useSafeAreaInsets/);    // inset added exactly once (slot only)
    expect(keypad).not.toMatch(/getMeasurementSlotGeometry/);
  });
});

describe('Shared screen path', () => {
  it('#10 new Record Load and Pull Edit are the same corrected screen/component', () => {
    expect(record).toMatch(/editMode/);               // one file serves both (params.editMode)
    expect(record).toMatch(/<MeasurementKeypadSlot/); // same keypad slot for both
    expect(record).toMatch(/LevelFieldInput/);        // same field component for both
  });
});

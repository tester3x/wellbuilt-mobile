import { validateMeasurementDraft } from '../tankLevelFormat';
import { createKeypadSession, canCommitKeypadSession, commitKeypadSession } from '../measurementKeypadSession';
import { parseLevel, isRecordLoadSubmitReady } from '../recordLoadHints';

describe('fractional inches at the upper foot boundary', () => {
  for (let tenth = 1; tenth <= 9; tenth++) {
    const inches = `11.${tenth}`;
    for (const input of [`10 ${inches}`, `10'${inches}`, `10'${inches}"`]) {
      it(`accepts and preserves ${input} through keypad commit and form readiness`, () => {
        expect(validateMeasurementDraft(input).valid).toBe(true);
        const session = createKeypadSession(input, 'level');
        expect(canCommitKeypadSession(session)).toBe(true);
        const committed = commitKeypadSession(session);
        expect(parseLevel(committed)).toBeCloseTo(10 + Number(inches) / 12, 12);
        expect(isRecordLoadSubmitReady({ wellName: 'Fixture Well', level: committed, barrels: '140', wellDown: false })).toBe(true);
      });
    }
  }

  it.each(['10 12', "10'12", '10\'12.1"', '10 15', '12"'])(
    'still blocks out-of-range inches in %s', input => {
      expect(validateMeasurementDraft(input).valid).toBe(false);
      expect(canCommitKeypadSession(createKeypadSession(input, 'level'))).toBe(false);
    },
  );

  it.each(['10 11', "10'0", '10.9', "10'11."])(
    'retains whole inches, decimal feet and editable drafts: %s', input => {
      expect(validateMeasurementDraft(input).valid).toBe(true);
    },
  );
});

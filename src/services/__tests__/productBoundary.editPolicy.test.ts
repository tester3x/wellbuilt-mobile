/**
 * Product-boundary pins: WB-M route/flow edits must never inherit WB-T's
 * 24-hour ticket edit limit.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WBM_HAS_EDIT_DEADLINE, WBT_TICKET_EDIT_WINDOW_HOURS } from '../editMarkers';

describe('WB-M / WB-T product boundary', () => {
  test('WB-M has no edit deadline', () => {
    expect(WBM_HAS_EDIT_DEADLINE).toBe(false);
  });
  test('WB-T 24h is documentation-only in this app', () => {
    expect(WBT_TICKET_EDIT_WINDOW_HOURS).toBe(24);
  });
  test('history.tsx does not gate edits on age', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../app/history.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/editExpired/);
    expect(src).not.toMatch(/Edit window closed/);
    expect(src).not.toMatch(/24 \* 60 \* 60 \* 1000/);
    expect(src).toMatch(/no age deadline/);
  });
  test('editMarkers has no age-window helper', () => {
    const src = fs.readFileSync(path.join(__dirname, '../editMarkers.ts'), 'utf8');
    expect(src).not.toMatch(/isWithinEditWindow/);
    expect(src).not.toMatch(/EDIT_WINDOW_MS/);
  });
});

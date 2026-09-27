import { selectSummaryWellNames } from '../summaryWellSelection';

test('includes unchecked down wells on a selected route, retaining checked wells', () => {
  const selected = ['Gabriel 5', 'Gabriel 6'];
  const config = {
    'Gabriel 1': { route: 'Gabriels' }, 'Gabriel 5': { route: 'Gabriels' },
    'Gabriel 6': { route: 'Gabriels' }, 'Gabriel 7': { route: 'Gabriels' },
    'Watford down': { route: 'Watford' },
  };
  expect(selectSummaryWellNames(selected, config, new Set(['Gabriel 1', 'Watford down'])))
    .toEqual(['Gabriel 1', 'Gabriel 5', 'Gabriel 6']);
  expect(selected).toEqual(['Gabriel 5', 'Gabriel 6']);
});

test('stale selections and down-state cache cannot add wells outside the authorized catalog', () => {
  const config = { Allowed: { route: 'Gabriels' } };
  expect(selectSummaryWellNames(['Allowed', 'Revoked'], config, new Set(['Revoked'])))
    .toEqual(['Allowed']);
  expect(selectSummaryWellNames(['Revoked'], config, new Set(['Allowed']))).toEqual([]);
});

test('no selected route stays empty and returning to up honors the unchecked setting again', () => {
  const config = { Checked: { route: 'R' }, Unchecked: { route: 'R' } };
  expect(selectSummaryWellNames([], config, new Set(['Unchecked']))).toEqual([]);
  expect(selectSummaryWellNames(['Checked'], config, new Set())).toEqual(['Checked']);
});

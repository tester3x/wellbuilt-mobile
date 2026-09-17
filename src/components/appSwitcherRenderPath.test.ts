import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const switcher = readFileSync(join(root, 'src/components/AppSwitcher.tsx'), 'utf8');
const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
const home = readFileSync(join(root, 'app/(tabs)/index.tsx'), 'utf8');

describe('AppSwitcher render path (WB-M)', () => {
  it('does not render a floating switcher', () => {
    assert.doesNotMatch(switcher, /PanResponder/);
    assert.doesNotMatch(switcher, /wbt_app_switcher_pos/);
    assert.doesNotMatch(switcher, /floating draggable button/);
    assert.doesNotMatch(layout, /floating WB ecosystem/);
    assert.match(switcher, /<Modal/);
    assert.match(layout, /<AppSwitcher/);
  });

  it('More → Switch Apps still opens the modal', () => {
    assert.match(home, />More</);
    assert.match(home, /Switch Apps/);
    assert.match(home, /appSwitcherOpen/);
    assert.match(switcher, /appSwitcherOpen/);
    assert.match(switcher, /setIsOpen\(true\)/);
  });

  it('expected app links remain', () => {
    assert.match(switcher, /wellbuilt-suite/);
    assert.match(switcher, /wellbuilt-tickets:\/\/sso-start/);
    assert.match(switcher, /jsaapp/);
    assert.match(switcher, /wbewallet/);
    assert.equal(existsSync(join(root, 'src/components/appSwitcherCompanyLookup.ts')), true);
  });
});

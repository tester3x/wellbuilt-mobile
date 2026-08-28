// Mike's instruction: "CODE THE TAPPABLE PACKET BANNERS OUT." The tappable
// packet-status banner (Needs Attention / Pending / Retry / delivery-count) is
// removed from the WB-M UI entirely — not repaired. Because it was a single
// source-level component (never conditionally rendered by delivery state), proving
// the component and every render/import are gone proves it cannot render in ANY
// state (zero / pending / attention / rejected / retry). The underlying delivery
// reconciliation, retry processing, receipts, logs, and the Sync Status screen are
// preserved; only the tap banner UI is gone.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const has = (rel: string) => existsSync(join(root, rel));

describe('no tappable packet-status banner remains in the WB-M UI', () => {
  test('the SyncAttentionBadge component file no longer exists', () => {
    expect(has('src/components/SyncAttentionBadge.tsx')).toBe(false);
    // its banner-only placement helper is gone too (no other consumer)
    expect(has('src/ui/safeAreaBadge.ts')).toBe(false);
  });

  test('no source file imports or renders a packet-status banner (cannot render in any state)', () => {
    for (const rel of ['app/_layout.tsx', 'app/(tabs)/index.tsx', 'app/record.tsx', 'app/summary.tsx', 'app/well-data.tsx', 'app/settings.tsx']) {
      if (!has(rel)) continue;
      const src = read(rel);
      expect(src).not.toMatch(/SyncAttentionBadge/);
    }
  });

  test('the root layout renders no packet-count tap banner and no banner navigation handler', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).not.toMatch(/SyncAttentionBadge/);
    expect(layout).not.toMatch(/badgeOpenFilter/);
    expect(layout).not.toMatch(/needs? attention/i);
    // No banner-driven navigation to the sync-status route from a floating banner.
    expect(layout).not.toMatch(/pathname:\s*'\/sync-status'/);
  });

  test('the banner render site left NO layout gap — it was an absolute overlay, now simply absent', () => {
    const layout = read('app/_layout.tsx');
    // The SyncToastHost sibling remains; the removed badge was position:absolute so
    // its removal changes no flow layout. Assert the container children are intact.
    expect(layout).toMatch(/<SyncToastHost \/>/);
    expect(layout).toMatch(/<Stack/);
    // Nothing rendered a spacer/placeholder in the badge's place.
    expect(layout).not.toMatch(/badgeTopOffset|badgePlacement|SyncAttentionBadge/);
  });

  test('normal WB-M navigation is unchanged — the Stack and tab routes remain', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/<Stack/);
    // The tabs group still exists (home/record/etc. unaffected).
    expect(has('app/(tabs)/index.tsx')).toBe(true);
  });

  test('underlying delivery services are preserved (reconciliation/selectors still present)', () => {
    const svc = read('src/services/deliveryStatus.ts');
    expect(svc).toMatch(/export function selectDeliveryItems/);
    expect(svc).toMatch(/reconcileSubmittedPulls/);
    // The Sync Status screen file is preserved (route still exists).
    expect(has('app/sync-status.tsx')).toBe(true);
  });
});

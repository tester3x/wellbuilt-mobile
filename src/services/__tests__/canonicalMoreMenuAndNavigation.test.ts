import { readFileSync } from 'fs';
import { join } from 'path';
import { MORE_MENU_TOKENS } from '../../constants/moreMenuTokens';

const root = join(__dirname, '../../..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('Task 1 — Exact WB-T More-Menu Structural Parity', () => {
  test('1. MoreMenu tokens match WB-T c2318589 reference tokens exactly', () => {
    // Popup container tokens
    expect(MORE_MENU_TOKENS.popup.position).toBe('absolute');
    expect(MORE_MENU_TOKENS.popup.right).toBe(16);
    expect(MORE_MENU_TOKENS.popup.backgroundColor).toBe('#1a1a1a');
    expect(MORE_MENU_TOKENS.popup.borderRadius).toBe(12);
    expect(MORE_MENU_TOKENS.popup.borderWidth).toBe(1);
    expect(MORE_MENU_TOKENS.popup.borderColor).toBe('#333');
    expect(MORE_MENU_TOKENS.popup.paddingVertical).toBe(4);
    expect(MORE_MENU_TOKENS.popup.minWidth).toBe(180);
    expect(MORE_MENU_TOKENS.popup.shadowColor).toBe('#000');
    expect(MORE_MENU_TOKENS.popup.shadowOffset).toEqual({ width: 0, height: -2 });
    expect(MORE_MENU_TOKENS.popup.shadowOpacity).toBe(0.3);
    expect(MORE_MENU_TOKENS.popup.shadowRadius).toBe(8);
    expect(MORE_MENU_TOKENS.popup.elevation).toBe(8);

    // Row item tokens (min 44px touch target)
    expect(MORE_MENU_TOKENS.item.flexDirection).toBe('row');
    expect(MORE_MENU_TOKENS.item.alignItems).toBe('center');
    expect(MORE_MENU_TOKENS.item.paddingVertical).toBe(12);
    expect(MORE_MENU_TOKENS.item.paddingHorizontal).toBe(16);
    expect(MORE_MENU_TOKENS.item.minHeight).toBeGreaterThanOrEqual(44);
    expect(MORE_MENU_TOKENS.item.gap).toBe(12);

    // Typography & colors
    expect(MORE_MENU_TOKENS.label.fontSize).toBe(15);
    expect(MORE_MENU_TOKENS.label.fontWeight).toBe('500');
    expect(MORE_MENU_TOKENS.label.color).toBe('#fff');

    // Separator divider
    expect(MORE_MENU_TOKENS.divider.height).toBe(1);
    expect(MORE_MENU_TOKENS.divider.backgroundColor).toBe('#333');
    expect(MORE_MENU_TOKENS.divider.marginHorizontal).toBe(12);

    // Backdrop
    expect(MORE_MENU_TOKENS.backdrop.flex).toBe(1);
    expect(MORE_MENU_TOKENS.backdrop.backgroundColor).toBe('rgba(0,0,0,0.5)');

    // Trigger dots
    expect(MORE_MENU_TOKENS.triggerDots.fontSize).toBe(22);
    expect(MORE_MENU_TOKENS.triggerDots.fontWeight).toBe('700');
    expect(MORE_MENU_TOKENS.triggerDots.lineHeight).toBe(24);
    expect(MORE_MENU_TOKENS.triggerDots.textAlign).toBe('center');

    // Icon size
    expect(MORE_MENU_TOKENS.iconSize).toBe(20);
  });

  test('2. Single authoritative MoreMenu component exists and structurally separates in-app from cross-app actions', () => {
    const moreMenuSrc = src('src/components/MoreMenu.tsx');

    // Modal with transparent fade and onRequestClose
    expect(moreMenuSrc).toMatch(/<Modal[^>]*onRequestClose=\{onClose\}/);
    expect(moreMenuSrc).toMatch(/animationType="fade"/);
    expect(moreMenuSrc).toMatch(/transparent/);

    // Backdrop with dismissal
    expect(moreMenuSrc).toMatch(/<Pressable[^>]*onPress=\{onClose\}/);

    // Anchoring with bottomInset + 65 and right: 16
    expect(moreMenuSrc).toMatch(/bottom:\s*bottomInset\s*\+\s*65/);
    expect(moreMenuSrc).toMatch(/right:\s*16/);

    // In-app actions appear first
    const routeMeIdx = moreMenuSrc.indexOf('accessibilityLabel="Route Me"');
    const summaryIdx = moreMenuSrc.indexOf('accessibilityLabel="Summary"');
    const dividerIdx = moreMenuSrc.lastIndexOf('moreMenuDivider');
    const switchAppsIdx = moreMenuSrc.indexOf('accessibilityLabel="Switch Apps"');

    expect(routeMeIdx).toBeGreaterThan(0);
    expect(summaryIdx).toBeGreaterThan(routeMeIdx);
    expect(dividerIdx).toBeGreaterThan(summaryIdx);
    expect(switchAppsIdx).toBeGreaterThan(dividerIdx);

    // Icons
    expect(moreMenuSrc).toMatch(/name="navigate-outline"/);
    expect(moreMenuSrc).toMatch(/name="stats-chart-outline"/);
    expect(moreMenuSrc).toMatch(/name="apps-outline"/);
  });

  test('3. Trigger button is strictly ••• with no text label, and index.tsx uses single MoreMenu component', () => {
    const indexSrc = src('app/(tabs)/index.tsx');

    // Must import and use MoreMenu
    expect(indexSrc).toMatch(/import\s*\{\s*MoreMenu/);
    expect(indexSrc).toMatch(/<MoreMenu/);

    // Must NOT have any inline More Menu Modals in index.tsx
    const modalMatches = indexSrc.match(/<Modal\s+visible=\{showMore\}/g);
    expect(modalMatches).toBeNull();

    // Trigger button has accessibilityLabel="•••" and renders •••
    expect(indexSrc).toMatch(/accessibilityLabel="•••"/);
    expect(indexSrc).toMatch(/<Text style=\{styles\.navDots\}>•••<\/Text>/);

    // No visible "More", "... More", or "Menu" text
    expect(indexSrc).not.toMatch(/>\s*More\s*</i);
    expect(indexSrc).not.toMatch(/>\s*\.\.\.\s*More\s*</i);
    expect(indexSrc).not.toMatch(/>\s*Menu\s*</i);
  });
});

describe('Task 2 — Keep Android System Navigation Visible', () => {
  test('4. Android system navigation is visible, non-immersive, and maintained across foreground resume', () => {
    const layoutSrc = src('app/_layout.tsx');

    // Never hidden
    expect(layoutSrc).not.toMatch(/NavigationBar\.setVisibilityAsync\('hidden'\)/);
    expect(layoutSrc).not.toMatch(/NavigationBar\.setBehaviorAsync\('overlay-swipe'\)/);
    expect(layoutSrc).not.toMatch(/StatusBar\.setHidden\(true\)/);

    // Explicitly visible and non-immersive inset-touch
    expect(layoutSrc).toMatch(/NavigationBar\.setVisibilityAsync\('visible'\)/);
    expect(layoutSrc).toMatch(/NavigationBar\.setBehaviorAsync\('inset-touch'\)/);
    expect(layoutSrc).toMatch(/NavigationBar\.setButtonStyleAsync\('light'\)/);
    expect(layoutSrc).toMatch(/StatusBar\.setHidden\(false\)/);

    // Foreground listener calls configureSystemNav
    expect(layoutSrc).toMatch(/configureSystemNav\(\)/);
    expect(layoutSrc).toMatch(/AppState\.addEventListener\('change'/);
  });
});

describe('Task 3 — Bottom-Inset Screen Census', () => {
  test('5. Main screen (app/(tabs)/index.tsx) clears insets.bottom on bottomNav and MoreMenu', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    expect(indexSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(indexSrc).toMatch(/paddingBottom:\s*Math\.max\(insets\.bottom,\s*12\)/);
    expect(indexSrc).toMatch(/bottomInset=\{insets\.bottom\}/);
  });

  test('6. Summary screen (app/summary.tsx) clears insets.bottom on sliderFooter', () => {
    const summarySrc = src('app/summary.tsx');
    expect(summarySrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(summarySrc).toMatch(/styles\.sliderFooter,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*12\)/);
  });

  test('7. Record screen (app/record.tsx) clears insets.bottom on edit buttonBlock', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(recordSrc).toMatch(/styles\.buttonBlock,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*12\)/);
  });

  test('8. History screen (app/history.tsx) clears insets.bottom on scrollContent and search modal', () => {
    const historySrc = src('app/history.tsx');
    expect(historySrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(historySrc).toMatch(/styles\.scrollContent,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)/);
    expect(historySrc).toMatch(/paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)\s*\+\s*spacing\.md/);
  });

  test('9. Route Me screen (app/route-me.tsx) clears insets.bottom on footer and list', () => {
    const routeSrc = src('app/route-me.tsx');
    expect(routeSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(routeSrc).toMatch(/styles\.footer,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*12\)\s*\+\s*spacing\.md\s*\}/);
    expect(routeSrc).toMatch(/paddingBottom:\s*spacing\.xl\s*\*\s*3\s*\+\s*Math\.max\(insets\.bottom,\s*16\)/);
  });

  test('10. Settings screen (app/settings.tsx) clears insets.bottom on scrollContent', () => {
    const settingsSrc = src('app/settings.tsx');
    expect(settingsSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(settingsSrc).toMatch(/styles\.scrollContent,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)\s*\+\s*24\s*\}/);
  });

  test('11. Driver Login screen (app/driver-login.tsx) clears insets.bottom and status bar top', () => {
    const loginSrc = src('app/driver-login.tsx');
    expect(loginSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(loginSrc).toMatch(/styles\.registerBackButton,\s*\{\s*top:\s*insets\.top\s*\+\s*8\s*\}\]/);
    expect(loginSrc).toMatch(/paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)/);
  });

  test('12. Welcome screen (app/welcome.tsx) clears insets.bottom and top', () => {
    const welcomeSrc = src('app/welcome.tsx');
    expect(welcomeSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(welcomeSrc).toMatch(/styles\.container,\s*\{\s*paddingTop:\s*Math\.max\(insets\.top,\s*16\)\s*\+\s*20,\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)\s*\+\s*16\s*\}\]/);
  });

  test('13. Well Data screen (app/well-data.tsx) clears insets.bottom on flatListContent', () => {
    const wellDataSrc = src('app/well-data.tsx');
    expect(wellDataSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(wellDataSrc).toMatch(/styles\.flatListContent,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)\s*\+\s*20\s*\}/);
  });

  test('14. About screen (app/about.tsx) clears insets.bottom on scrollContent', () => {
    const aboutSrc = src('app/about.tsx');
    expect(aboutSrc).toMatch(/useSafeAreaInsets\(\)/);
    expect(aboutSrc).toMatch(/styles\.scrollContent,\s*\{\s*paddingBottom:\s*Math\.max\(insets\.bottom,\s*16\)\s*\+\s*20\s*\}/);
  });
});

import * as fs from 'fs';
import * as path from 'path';

describe('WB-M registration screen viewport fit & touch targets', () => {
  const driverLoginPath = path.join(__dirname, '../../../app/driver-login.tsx');
  const source = fs.readFileSync(driverLoginPath, 'utf8');

  // Parse styles from source
  const extractStyleObject = (styleName: string): Record<string, any> => {
    const marker = `${styleName}: {`;
    const startIdx = source.indexOf(marker);
    if (startIdx === -1) return {};
    const sub = source.slice(startIdx + marker.length);
    const endIdx = sub.indexOf('},');
    const body = sub.slice(0, endIdx);
    const result: Record<string, any> = {};
    for (const line of body.split('\n')) {
      const match = line.match(/^\s*([a-zA-Z0-9]+):\s*([^,]+),?/);
      if (match) {
        const key = match[1].trim();
        let val: any = match[2].trim();
        if (!isNaN(Number(val))) {
          val = Number(val);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
    return result;
  };

  test('header Back is overlayed so it does not grow the closed-keyboard height budget', () => {
    const back = extractStyleObject('registerBackButton');
    expect(back.position).toBe('absolute');
    expect(Number(back.width)).toBeGreaterThanOrEqual(44);
    expect(Number(back.height)).toBeGreaterThanOrEqual(44);
    expect(source).toContain('testID="register-header-back"');
    expect(source).toContain('onPress={handleSwitchToLogin}');
  });

  test('source contains register-specific compact styles', () => {
    expect(source).toContain('scrollContentRegister');
    expect(source).toContain('logoContainerRegister');
    expect(source).toContain('logoRegister');
    expect(source).toContain('appNameRegister');
    expect(source).toContain('formContainerRegister');
    expect(source).toContain('titleRegister');
    expect(source).toContain('subtitleRegister');
    expect(source).toContain('inputRegister');
    expect(source).toContain('hintRegister');
    expect(source).toContain('buttonRegister');
    expect(source).toContain('linkTextRegister');
    expect(source).toContain('approvalHintRegister');
    expect(source).toContain('versionRegister');
  });

  test('all registration fields are present with correct bindings', () => {
    // 4 required registration inputs
    expect(source).toContain("placeholder={t('driverLogin.displayNamePlaceholder')}");
    expect(source).toContain("placeholder={t('driverLogin.legalNamePlaceholder')}");
    expect(source).toContain("placeholder={t('driverLogin.companyPlaceholder', 'Company join code')}");
    expect(source).toContain("renderPasscodeInput(t('driverLogin.createPasscode'))");

    // Required hints & legal copy
    expect(source).toContain("t('loginExtra.usedOnTickets')");
    expect(source).toContain("t('driverLogin.companyHint', 'Enter the join code your employer gave you')");
    expect(source).toContain("t('driverLogin.passcodeHint')");
    expect(source).toContain("t('driverLogin.approvalHint')");

    // Action buttons & links
    expect(source).toContain("t('driverLogin.submitRegistration')");
    expect(source).toContain("t('driverLogin.alreadyRegistered')");
    expect(source).toContain("t('driverLogin.signInLink')");
  });

  test('touch targets meet mobile accessibility guidelines (min 44dp)', () => {
    const inputStyle = extractStyleObject('inputRegister');
    const buttonStyle = extractStyleObject('buttonRegister');

    expect(Number(inputStyle.minHeight)).toBeGreaterThanOrEqual(44);
    expect(Number(buttonStyle.minHeight)).toBeGreaterThanOrEqual(44);
  });

  test('closed-keyboard registration form fits within viewport height on all supported devices', () => {
    const scroll = extractStyleObject('scrollContentRegister');
    const logoContainer = extractStyleObject('logoContainerRegister');
    const logo = extractStyleObject('logoRegister');
    const appName = extractStyleObject('appNameRegister');
    const title = extractStyleObject('titleRegister');
    const subtitle = extractStyleObject('subtitleRegister');
    const input = extractStyleObject('inputRegister');
    const inputTight = extractStyleObject('inputRegisterTight');
    const hint = extractStyleObject('hintRegister');
    const button = extractStyleObject('buttonRegister');
    const link = extractStyleObject('linkTextRegister');
    const approval = extractStyleObject('approvalHintRegister');
    const version = extractStyleObject('versionRegister');

    // Element height budget when rendered
    const paddingTop = Number(scroll.paddingTop) || 8;
    const paddingBottom = Number(scroll.paddingBottom) || 16;
    const logoBlockHeight =
      (Number(logo.height) || 44) +
      (Number(logo.marginBottom) || 2) +
      (Number(appName.fontSize) ? Number(appName.fontSize) + 4 : 22) +
      (Number(logoContainer.marginBottom) || 6);

    const titleBlockHeight =
      (Number(title.fontSize) ? Number(title.fontSize) + 2 : 20) +
      (Number(title.marginBottom) || 2) +
      (Number(subtitle.fontSize) ? Number(subtitle.fontSize) + 3 : 15) +
      (Number(subtitle.marginBottom) || 8);

    const field1Height = (Number(input.minHeight) || 44) + (Number(input.marginBottom) || 6);

    const field2Height =
      (Number(input.minHeight) || 44) +
      (Number(inputTight.marginBottom) || 2) +
      (Number(hint.lineHeight) || 14) +
      (Number(hint.marginBottom) || 6);

    const field3Height =
      (Number(input.minHeight) || 44) +
      (Number(inputTight.marginBottom) || 2) +
      (Number(hint.lineHeight) || 14) +
      (Number(hint.marginBottom) || 6);

    const field4Height =
      (Number(input.minHeight) || 44) +
      (Number(inputTight.marginBottom) || 2) +
      (Number(hint.lineHeight) || 14) +
      8; // passcodeHintBottom

    const buttonHeight = (Number(button.minHeight) || 44) + (Number(button.marginBottom) || 6);

    const linkHeight =
      (Number(link.fontSize) ? Number(link.fontSize) + 4 : 17) +
      (Number(link.marginTop) || 2) +
      (Number(link.marginBottom) || 6);

    const approvalHeight =
      (Number(approval.lineHeight) || 14) * 2 + // 2 lines of text
      (Number(approval.marginTop) || 0) +
      (Number(approval.marginBottom) || 2);

    const versionHeight =
      (Number(version.fontSize) ? Number(version.fontSize) + 2 : 12) +
      (Number(version.marginTop) || 2) +
      (Number(version.paddingTop) || 2);

    const totalHeight =
      paddingTop +
      logoBlockHeight +
      titleBlockHeight +
      field1Height +
      field2Height +
      field3Height +
      field4Height +
      buttonHeight +
      linkHeight +
      approvalHeight +
      versionHeight +
      paddingBottom;

    // Supported devices (height, system bars inset, usable height)
    const devices = [
      { name: 'Samsung Galaxy Z Fold 7 Cover', screenH: 882, insets: 72 },
      { name: 'Samsung Galaxy S24 Ultra', screenH: 915, insets: 72 },
      { name: 'Standard / Short Android Phone', screenH: 667, insets: 72 },
      { name: 'Compact Android Phone (640p)', screenH: 640, insets: 72 },
      { name: 'Tablet / Unfolded Fold', screenH: 1024, insets: 72 },
    ];

    for (const d of devices) {
      const usableHeight = d.screenH - d.insets;
      expect(totalHeight).toBeLessThanOrEqual(usableHeight);
    }

    // Expected total height is ~510-530px, fitting comfortably in <= 568px
    expect(totalHeight).toBeLessThanOrEqual(535);
  });
});

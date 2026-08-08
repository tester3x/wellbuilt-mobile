import fs from 'fs';

let s = fs.readFileSync('app/manager.tsx', 'utf8');

// Import format helper if missing
if (!s.includes("from '../src/i18n/format'") && !s.includes('from "../src/i18n/format"')) {
  s = s.replace(
    "import { useTranslation } from \"react-i18next\";",
    "import { useTranslation } from \"react-i18next\";\nimport { formatAppDateTime } from '../src/i18n/format';\nimport { userFacingErrorMessage } from '../src/i18n/userFacingError';",
  );
}

const pairs = [
  [
    "alert.show('Cleanup Complete', `Deleted ${count} old log entries.`);",
    "alert.show(t('manager.cleanupComplete'), t('manager.cleanupDeleted', { count }));",
  ],
  [
    "alert.show('Error', 'Could not cleanup logs');",
    "alert.show(t('manager.error'), t('manager.errorCleanupLogs'));",
  ],
  [
    "alert.show('Deleted', `Removed ${selectedLogs.size} logs`);",
    "alert.show(t('manager.deletedLogs'), t('manager.deletedLogsMessage', { count: selectedLogs.size }));",
  ],
  [
    "alert.show('Error', 'Could not delete some logs');",
    "alert.show(t('manager.error'), t('manager.errorDeleteLogs'));",
  ],
  [
    "alert.show('Updated', `${driverToChangeRole.displayName} is now a ${roleLabel}`);",
    "alert.show(t('manager.roleUpdated'), t('manager.roleUpdatedMessage', { name: driverToChangeRole.displayName, role: roleLabel }));",
  ],
  [
    "alert.show(t('manager.error'), 'Could not update role');",
    "alert.show(t('manager.error'), t('manager.errorUpdateRole'));",
  ],
  [
    "alert.show('Device Registered', 'This device is now registered as company-owned. Login activity will be tracked.');",
    "alert.show(t('manager.deviceRegistered'), t('manager.deviceRegisteredMessage'));",
  ],
  [
    "alert.show('Error', result.error || 'Could not register device');",
    "alert.show(t('manager.error'), t('manager.errorRegisterDevice'));",
  ],
  [
    "alert.show('Error', 'Could not register device');",
    "alert.show(t('manager.error'), t('manager.errorRegisterDevice'));",
  ],
  [
    'alert.show(\'Device Removed\', `"${device.nickname}" has been removed from company devices.`);',
    "alert.show(t('manager.deviceRemoved'), t('manager.deviceRemovedMessage', { name: device.nickname }));",
  ],
  [
    "alert.show('Error', 'Could not remove device');",
    "alert.show(t('manager.error'), t('manager.errorRemoveDevice'));",
  ],
  [
    '<Text style={styles.modalTitle}>Register Company Device</Text>',
    "<Text style={styles.modalTitle}>{t('manager.registerDeviceTitle')}</Text>",
  ],
  [
    'This device will be tracked for login activity.',
    "{t('manager.registerDeviceSubtitle')}",
  ],
  [
    'placeholder="Device nickname (e.g., Truck 5 Tablet)"',
    "placeholder={t('manager.deviceNicknamePlaceholder')}",
  ],
  [
    '<Text style={styles.modalCancelText}>Cancel</Text>',
    "<Text style={styles.modalCancelText}>{t('common.cancel')}</Text>",
  ],
  [
    '<Text style={styles.modalRegisterText}>Register</Text>',
    "<Text style={styles.modalRegisterText}>{t('manager.register')}</Text>",
  ],
  [
    '<Text style={styles.modalTitle}>Approve Driver</Text>',
    "<Text style={styles.modalTitle}>{t('manager.approveDriver')}</Text>",
  ],
  [
    'Approve {pendingApproval?.displayName}?',
    "{t('manager.approveName', { name: pendingApproval?.displayName })}",
  ],
  [
    '<Text style={styles.roleSelectionTitle}>Select Role:</Text>',
    "<Text style={styles.roleSelectionTitle}>{t('manager.selectRole')}</Text>",
  ],
  [
    '<Text style={styles.roleSelectionTitle}>Select New Role:</Text>',
    "<Text style={styles.roleSelectionTitle}>{t('manager.selectNewRole')}</Text>",
  ],
  [
    '<Text style={styles.roleOptionLabel}>Viewer</Text>',
    "<Text style={styles.roleOptionLabel}>{t('manager.roleViewer')}</Text>",
  ],
  [
    '<Text style={styles.roleOptionDesc}>Can view wells, cannot submit pulls</Text>',
    "<Text style={styles.roleOptionDesc}>{t('manager.roleViewerDesc')}</Text>",
  ],
  [
    '<Text style={styles.roleOptionLabel}>Driver</Text>',
    "<Text style={styles.roleOptionLabel}>{t('manager.roleDriver')}</Text>",
  ],
  [
    '<Text style={styles.roleOptionDesc}>Can view wells and submit pulls</Text>',
    "<Text style={styles.roleOptionDesc}>{t('manager.roleDriverDesc')}</Text>",
  ],
  [
    '<Text style={styles.roleOptionLabel}>Admin</Text>',
    "<Text style={styles.roleOptionLabel}>{t('manager.roleAdmin')}</Text>",
  ],
  [
    '<Text style={styles.roleOptionDesc}>Can manage drivers, view performance</Text>',
    "<Text style={styles.roleOptionDesc}>{t('manager.roleAdminDesc')}</Text>",
  ],
  [
    '<Text style={styles.modalRegisterText}>Approve</Text>',
    "<Text style={styles.modalRegisterText}>{t('manager.approve')}</Text>",
  ],
  [
    '<Text style={styles.modalTitle}>Change Role</Text>',
    "<Text style={styles.modalTitle}>{t('manager.changeRole')}</Text>",
  ],
  [
    '<Text style={styles.modalRegisterText}>Update</Text>',
    "<Text style={styles.modalRegisterText}>{t('manager.update')}</Text>",
  ],
  [
    '<Text style={styles.performanceButtonTitle}>Performance Tracker</Text>',
    "<Text style={styles.performanceButtonTitle}>{t('manager.performanceTracker')}</Text>",
  ],
  [
    '<Text style={styles.performanceButtonSubtitle}>View prediction accuracy</Text>',
    "<Text style={styles.performanceButtonSubtitle}>{t('manager.performanceSubtitle')}</Text>",
  ],
  [
    '<Text style={styles.actionText}>All</Text>',
    "<Text style={styles.actionText}>{t('manager.selectAll')}</Text>",
  ],
  [
    '<Text style={styles.actionText}>Cancel</Text>',
    "<Text style={styles.actionText}>{t('common.cancel')}</Text>",
  ],
  [
    '<Text style={styles.emptyText}>No company devices registered</Text>',
    "<Text style={styles.emptyText}>{t('manager.noDevices')}</Text>",
  ],
  [
    '<Text style={styles.deviceBadgeText}>THIS DEVICE</Text>',
    "<Text style={styles.deviceBadgeText}>{t('manager.thisDevice')}</Text>",
  ],
  [
    '<Text style={styles.emptySubtext}>No logins recorded yet</Text>',
    "<Text style={styles.emptySubtext}>{t('manager.noLoginHistory')}</Text>",
  ],
  [
    '<Text style={styles.removeDeviceText}>Remove Device</Text>',
    "<Text style={styles.removeDeviceText}>{t('manager.removeDevice')}</Text>",
  ],
  [
    '<Text style={styles.emptyText}>No production data yet</Text>',
    "<Text style={styles.emptyText}>{t('manager.noProductionData')}</Text>",
  ],
  [
    '<Text style={styles.logHint}>Long-press any log to select</Text>',
    "<Text style={styles.logHint}>{t('manager.longPressSelect')}</Text>",
  ],
  [
    '<Text style={styles.emptyText}>No logs</Text>',
    "<Text style={styles.emptyText}>{t('manager.noLogs')}</Text>",
  ],
];

// Badge labels — replace carefully with global
const globals = [
  ['>ADMIN<', ">{t('manager.badgeAdmin')}<"],
  ['>VIEWER<', ">{t('manager.badgeViewer')}<"],
  ['>DRIVER<', ">{t('manager.badgeDriver')}<"],
  ["'ADMIN'", "t('manager.badgeAdmin')"],
  ["'VIEWER'", "t('manager.badgeViewer')"],
  ["'DRIVER'", "t('manager.badgeDriver')"],
  ['>Local<', ">{t('manager.filterLocal')}<"],
  ['>System<', ">{t('manager.filterSystem')}<"],
  ['>Error<', ">{t('manager.filterError')}<"],
  ['>Debug<', ">{t('manager.filterDebug')}<"],
  ['>Role<', ">{t('manager.role')}<"],
  ['>Well<', ">{t('manager.colWell')}<"],
  ['>Pulls<', ">{t('manager.colPulls')}<"],
];

let applied = 0;
for (const [a, b] of pairs) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    applied++;
  } else {
    console.log('MISS:', a.slice(0, 70));
  }
}
for (const [a, b] of globals) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    applied++;
  }
}

// formatDate uses app language
s = s.replace(
  `return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });`,
  `return formatAppDateTime(date, { hour: '2-digit', minute: '2-digit' });`,
);
s = s.replace(
  `{log.timestamp.toLocaleDateString()} {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  `{formatAppDateTime(log.timestamp, { hour: '2-digit', minute: '2-digit' })}`,
);

// roleLabel mapping should use t()
s = s.replace(
  /const roleLabel = newRole === 'admin' \? 'Admin' : newRole === 'viewer' \? 'Viewer' : 'Driver';/,
  `const roleLabel = newRole === 'admin' ? t('manager.roleAdmin') : newRole === 'viewer' ? t('manager.roleViewer') : t('manager.roleDriver');`,
);
s = s.replace(
  /const roleLabel = selectedRole === 'admin' \? 'Admin' : selectedRole === 'viewer' \? 'Viewer' : 'Driver';/,
  `const roleLabel = selectedRole === 'admin' ? t('manager.roleAdmin') : selectedRole === 'viewer' ? t('manager.roleViewer') : t('manager.roleDriver');`,
);

fs.writeFileSync('app/manager.tsx', s);
console.log('applied', applied);

// Remaining English UI candidates
const left = [];
s.split(/\n/).forEach((line, i) => {
  if (/t\(|console\.|import |\/\//.test(line)) return;
  if (
    /Text[^>]*>[A-Za-z]{3,}/.test(line) ||
    /alert\.show\(['"][A-Z]/.test(line) ||
    /placeholder="[A-Z]/.test(line)
  ) {
    left.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  }
});
console.log('remaining', left.length);
left.slice(0, 50).forEach((x) => console.log(x));

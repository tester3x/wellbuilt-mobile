// src/config/changelog.ts
// Changelog entries for "What's New" modal
//
// ============================================================================
// WHAT GOES IN THE CHANGELOG?
// ============================================================================
//
// INCLUDE (things users notice):
//   - New features they can use
//   - Bug fixes that affected them (e.g., "Last Pull not updating")
//   - UI changes they'll see
//   - Performance improvements they'll feel
//
// DON'T INCLUDE (housekeeping):
//   - Internal refactoring
//   - Code cleanup
//   - Developer tooling changes
//   - Backend/Firebase rule changes (unless user-facing)
//   - Logging improvements
//   - TypeScript fixes
//
// AUDIENCE TAGS:
//   - 'all'     = Everyone sees this (drivers + managers)
//   - 'driver'  = Only drivers see this (main app features)
//   - 'manager' = Only managers see this (manager dashboard features)
//
// ============================================================================

export type UserRole = 'driver' | 'manager';
export type ChangeAudience = 'all' | 'driver' | 'manager';

export interface ChangeItem {
  type: 'new' | 'improved' | 'fixed';
  descriptionKey: string;  // i18n key under whatsNew.changes.*
  audience: ChangeAudience;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: ChangeItem[];
}

// Current app version - keep in sync with app.json
export const CURRENT_VERSION = '2.1.0';

// Changelog entries (newest first)
// descriptionKey references i18n keys under whatsNew.changes.*
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.1.0',
    date: '2026-01-28',
    title: 'Sync & Accuracy Fixes',
    changes: [
      {
        type: 'fixed',
        audience: 'all',
        descriptionKey: 'flowRateSync',
      },
      {
        type: 'fixed',
        audience: 'all',
        descriptionKey: 'excelEditsSync',
      },
      {
        type: 'fixed',
        audience: 'all',
        descriptionKey: 'editsReflectLevel',
      },
      {
        type: 'fixed',
        audience: 'all',
        descriptionKey: 'systemOfflineFix',
      },
      {
        type: 'improved',
        audience: 'manager',
        descriptionKey: 'unifiedLogs',
      },
      // NOT INCLUDED (housekeeping):
      // - Firebase security rules update (backend)
      // - Removed separate flow rate cache (internal refactor)
      // - VBA edit packet race condition fix (backend)
    ],
  },
  {
    version: '2.0.0',
    date: '2026-01-15',
    title: 'Major Update',
    changes: [
      {
        type: 'new',
        audience: 'all',
        descriptionKey: 'freshLook',
      },
      {
        type: 'new',
        audience: 'driver',
        descriptionKey: 'performanceStats',
      },
      {
        type: 'new',
        audience: 'manager',
        descriptionKey: 'managerDashboard',
      },
    ],
  },
];

/**
 * Filter changelog for a specific user role
 * Managers see everything, drivers only see 'all' and 'driver' changes
 */
export function filterChangelogForRole(
  entry: ChangelogEntry,
  role: UserRole
): ChangelogEntry | null {
  const filteredChanges = entry.changes.filter(change => {
    if (change.audience === 'all') return true;
    if (role === 'manager') return true; // Managers see everything
    return change.audience === role;
  });

  // If no changes for this role, return null (don't show modal)
  if (filteredChanges.length === 0) return null;

  return {
    ...entry,
    changes: filteredChanges,
  };
}

/**
 * Get the current version's changelog filtered for a user role
 */
export function getCurrentChangelogForRole(role: UserRole): ChangelogEntry | null {
  const currentEntry = CHANGELOG.find(entry => entry.version === CURRENT_VERSION);
  if (!currentEntry) return null;
  return filterChangelogForRole(currentEntry, role);
}

// Legacy function for backwards compatibility
export function getCurrentChangelog(): ChangelogEntry | undefined {
  return CHANGELOG.find(entry => entry.version === CURRENT_VERSION);
}

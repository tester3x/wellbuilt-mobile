// hooks/use-whats-new.ts
// Hook to manage "What's New" modal display after app updates
//
// TRACKING BY CONTENT HASH:
// Instead of tracking by version number (which requires version bumps for every change),
// we track by a hash of the changelog content. When the changelog changes, users see
// the modal again even if version stays the same (useful for avoiding Apple reviews).
//
// "DON'T SHOW AGAIN" FEATURE:
// Users can check "Don't show again" to suppress the modal. But when we update the
// changelog with new content, the hash changes and they'll see it once more.

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CURRENT_VERSION,
  getCurrentChangelogForRole,
  getCurrentChangelog,
  ChangelogEntry,
  UserRole
} from '@/src/config/changelog';
import { isCurrentUserAdmin } from '@/src/services/driverAuth';

// Storage keys
const LAST_SEEN_HASH_KEY = '@wellbuilt_last_seen_changelog_hash';
const DONT_SHOW_HASH_KEY = '@wellbuilt_dont_show_changelog_hash';

/**
 * Generate a simple hash of changelog content
 * Changes when any changelog text changes, forcing modal to show
 */
function hashChangelog(entry: ChangelogEntry | null | undefined): string {
  if (!entry) return '';

  // Combine version + all change descriptions into a single string
  const content = [
    entry.version,
    entry.title,
    entry.date,
    ...entry.changes.map(c => `${c.type}:${c.audience}:${c.description}`)
  ].join('|');

  // Simple hash function (djb2)
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) + content.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

interface UseWhatsNewResult {
  showWhatsNew: boolean;
  changelog: ChangelogEntry | null;
  dismissWhatsNew: (dontShowAgain?: boolean) => void;
  isLoading: boolean;
}

export function useWhatsNew(): UseWhatsNewResult {
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [changelog, setChangelog] = useState<ChangelogEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkChangelog();
  }, []);

  const checkChangelog = async () => {
    try {
      // Get the raw changelog to compute hash (before role filtering)
      const rawChangelog = getCurrentChangelog();
      const currentHash = hashChangelog(rawChangelog);

      // Get stored values
      const [lastSeenHash, dontShowHash] = await Promise.all([
        AsyncStorage.getItem(LAST_SEEN_HASH_KEY),
        AsyncStorage.getItem(DONT_SHOW_HASH_KEY),
      ]);

      // If user checked "don't show again" for THIS hash, skip
      if (dontShowHash === currentHash) {
        setIsLoading(false);
        return;
      }

      // If user has already seen this exact changelog content, skip
      if (lastSeenHash === currentHash) {
        setIsLoading(false);
        return;
      }

      // Content has changed (or never seen) - show the modal
      // Determine user role for filtering
      const isAdmin = await isCurrentUserAdmin();
      const userRole: UserRole = isAdmin ? 'manager' : 'driver';

      // Get changelog filtered for this user's role
      const filteredChangelog = getCurrentChangelogForRole(userRole);

      // Only show modal if there are changes relevant to this user
      if (filteredChangelog && filteredChangelog.changes.length > 0) {
        setChangelog(filteredChangelog);
        setShowWhatsNew(true);
      } else {
        // No relevant changes for this user, silently mark as seen
        await AsyncStorage.setItem(LAST_SEEN_HASH_KEY, currentHash);
      }
    } catch (error) {
      console.error('[WhatsNew] Error checking changelog:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const dismissWhatsNew = useCallback(async (dontShowAgain: boolean = false) => {
    setShowWhatsNew(false);
    try {
      // Compute current hash
      const rawChangelog = getCurrentChangelog();
      const currentHash = hashChangelog(rawChangelog);

      // Always save that user has seen this content
      await AsyncStorage.setItem(LAST_SEEN_HASH_KEY, currentHash);

      // If "don't show again" checked, save that too
      if (dontShowAgain) {
        await AsyncStorage.setItem(DONT_SHOW_HASH_KEY, currentHash);
      }
    } catch (error) {
      console.error('[WhatsNew] Error saving state:', error);
    }
  }, []);

  return {
    showWhatsNew,
    changelog,
    dismissWhatsNew,
    isLoading,
  };
}

// Utility to reset the "seen" state (for testing)
export async function resetWhatsNewState(): Promise<void> {
  await AsyncStorage.multiRemove([LAST_SEEN_HASH_KEY, DONT_SHOW_HASH_KEY]);
}

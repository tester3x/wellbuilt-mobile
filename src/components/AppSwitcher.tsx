// AppSwitcher — More-menu modal for switching between WB ecosystem apps.
// Opened by DeviceEventEmitter 'appSwitcherOpen' (More → Switch Apps).
// No floating badge. Apps loaded from Firestore app_registry, filtered by
// fail-closed company tier. Consumes only `tier` via public_companies lookup.

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import i18n from '../i18n';
import {
  FAIL_CLOSED_TIER,
  TIER_INCLUDES,
  applyAppSwitcherTierLookup,
  createAppSwitcherTierSession,
} from './appSwitcherCompanyLookup';

let collection: any, getDocs: any, firestoreDoc: any, firestoreGetDoc: any;
try {
  const fs = require('firebase/firestore');
  collection = fs.collection; getDocs = fs.getDocs; firestoreDoc = fs.doc; firestoreGetDoc = fs.getDoc;
} catch {}
const db: any = null;

const REGISTRY_CACHE_KEY = 'wbt_app_registry_cache';
const HUB_SCHEME = 'wellbuilt-suite';
const DEFAULT_SELF_SCHEME = 'wellbuilt-tickets';

interface AppEntry {
  id: string;
  name: string;
  shortName: string;
  iconUrl: string;
  deepLinkScheme: string;
  requiredTier: 'free' | 'field' | 'god';
  sortOrder: number;
  enabled: boolean;
  androidPackage?: string;
}

interface Props {
  badgeSource?: any;
  selfScheme?: string;
  firestoreDb?: any;
  getIdentity?: () => Promise<{ hash?: string; name?: string; driverId?: string } | null>;
}

const FALLBACK_APPS: AppEntry[] = [
  { id: 'wbs', name: 'WellBuilt Suite', shortName: 'Suite', iconUrl: '', deepLinkScheme: 'wellbuilt-suite', requiredTier: 'free', sortOrder: 0, enabled: true },
  { id: 'wbm', name: 'WellBuilt Mobile', shortName: 'Mobile', iconUrl: '', deepLinkScheme: 'wellbuilt-mobile', requiredTier: 'free', sortOrder: 1, enabled: true },
  { id: 'wbt', name: 'WaterTicket', shortName: 'Tickets', iconUrl: '', deepLinkScheme: 'wellbuilt-tickets', requiredTier: 'field', sortOrder: 2, enabled: true },
  { id: 'wbjsa', name: 'WB JSA', shortName: 'JSA', iconUrl: '', deepLinkScheme: 'jsaapp', requiredTier: 'free', sortOrder: 3, enabled: true },
  { id: 'wbew', name: 'WB eQuipment', shortName: 'eQuip', iconUrl: '', deepLinkScheme: 'wbewallet', requiredTier: 'field', sortOrder: 4, enabled: true },
];

export default function AppSwitcher({ selfScheme, firestoreDb, getIdentity }: Props) {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [tier, setTier] = useState<string>(FAIL_CLOSED_TIER);
  const tierSessionRef = useRef(createAppSwitcherTierSession());
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('appSwitcherOpen', () => setIsOpen(true));
    return () => sub.remove();
  }, []);

  const effectiveDb = firestoreDb || db;

  useEffect(() => {
    const session = tierSessionRef.current;
    const generation = session.startLookup();
    (async () => {
      const canRead = !!(effectiveDb && firestoreGetDoc && firestoreDoc);
      const companyId = canRead ? await AsyncStorage.getItem('selectedCompanyId') : null;
      await applyAppSwitcherTierLookup({
        companyId,
        generation,
        isCurrent: (g) => session.isCurrent(g),
        read: async (collectionName, id) => {
          const snap = await firestoreGetDoc(firestoreDoc(effectiveDb, collectionName, id));
          const exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
          return { exists, data: exists ? snap.data() : undefined };
        },
        setTier,
      });
    })();
    return () => {
      session.invalidate();
    };
  }, [effectiveDb]);

  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(REGISTRY_CACHE_KEY);
        if (cached) {
          setApps(JSON.parse(cached));
        }

        if (effectiveDb) {
          const snap = await getDocs(collection(effectiveDb, 'app_registry'));
          const entries: AppEntry[] = [];
          snap.forEach((d: any) => {
            const data = d.data();
            if (data.enabled !== false) {
              entries.push({ id: d.id, ...data } as AppEntry);
            }
          });
          entries.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          setApps(entries);
          AsyncStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(entries)).catch(() => {});
        } else if (!cached) {
          setApps(FALLBACK_APPS);
        }
      } catch (err) {
        console.warn('[AppSwitcher] Failed to load registry:', err);
        if (apps.length === 0) setApps(FALLBACK_APPS);
      }
    })();
  }, [effectiveDb]);

  const effectiveSelfScheme = selfScheme || DEFAULT_SELF_SCHEME;
  const visibleApps = useMemo(() => {
    const allowed = TIER_INCLUDES[tier] || TIER_INCLUDES.free;
    return apps.filter(app =>
      app.enabled !== false &&
      app.deepLinkScheme !== effectiveSelfScheme &&
      allowed.includes(app.requiredTier),
    );
  }, [apps, tier, effectiveSelfScheme]);

  const launchApp = useCallback(async (app: AppEntry) => {
    setIsOpen(false);
    try {
      let url = `${app.deepLinkScheme}://`;

      if (app.deepLinkScheme !== HUB_SCHEME) {
        let identity: { hash?: string; name?: string; driverId?: string } | null = null;
        if (getIdentity) {
          identity = await getIdentity();
        }
        if (identity?.name || identity?.driverId) {
          if (app.deepLinkScheme === 'wellbuilt-tickets') {
            url = 'wellbuilt-tickets://sso-start';
          } else if (app.deepLinkScheme === 'jsaapp') {
            Alert.alert(
              i18n.t('common.updateRequired'),
              i18n.t('appSwitcher.jsaMigrationBody'),
            );
            return;
          } else if (app.deepLinkScheme === 'wbewallet' || app.deepLinkScheme === 'wellbuiltequipment') {
            url = `${app.deepLinkScheme}://`;
          } else {
            url = `${app.deepLinkScheme}://`;
          }
        }
      }

      await Linking.openURL(url);
    } catch {
      try {
        await Linking.openURL(`${app.deepLinkScheme}://`);
      } catch {
        if (Platform.OS === 'android' && app.androidPackage) {
          try {
            await Linking.openURL(`intent://#Intent;package=${app.androidPackage};end`);
            return;
          } catch {}
        }
        Alert.alert(
          i18n.t('appSwitcher.notInstalledTitle'),
          i18n.t('appSwitcher.notInstalledBody', { appName: app.name }),
        );
      }
    }
  }, [getIdentity]);

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)} statusBarTranslucent>
      <Pressable style={styles.cardBackdrop} onPress={() => setIsOpen(false)}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>SWITCH APPS</Text>
            <TouchableOpacity
              onPress={() => setIsOpen(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close app switcher"
              style={styles.cardClose}
            >
              <Text style={styles.cardCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.cardGrid}>
            {visibleApps.map((app) => (
              <TouchableOpacity
                key={app.id}
                onPress={() => launchApp(app)}
                activeOpacity={0.7}
                style={styles.cardApp}
                accessibilityRole="button"
                accessibilityLabel={`Open ${app.name}`}
              >
                <View style={styles.cardIcon}>
                  {app.iconUrl ? (
                    <Image source={{ uri: app.iconUrl }} style={styles.cardIconImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.cardIconLetter}>{(app.shortName || app.name)[0]}</Text>
                  )}
                </View>
                <Text style={styles.cardAppLabel} numberOfLines={1}>{app.shortName}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cardBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFD700',
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardTitle: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  cardClose: {
    padding: 4,
  },
  cardCloseText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  cardApp: {
    width: '45%',
    alignItems: 'center',
    paddingVertical: 12,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111',
    borderWidth: 1.5,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardIconImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  cardIconLetter: {
    color: '#FFD700',
    fontWeight: '800',
    fontSize: 16,
  },
  cardAppLabel: {
    color: '#ccc',
    fontWeight: '600',
    marginTop: 6,
    fontSize: 12,
  },
});

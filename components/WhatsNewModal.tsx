// components/WhatsNewModal.tsx
// Shows "What's New" modal after app update
//
// Features:
// - "Don't show again" checkbox - suppresses modal until changelog changes
// - When changelog content changes, modal shows again (even if version stays same)

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ChangelogEntry } from '@/src/config/changelog';

interface WhatsNewModalProps {
  visible: boolean;
  changelog: ChangelogEntry | null;
  onDismiss: (dontShowAgain?: boolean) => void;
}

export function WhatsNewModal({ visible, changelog, onDismiss }: WhatsNewModalProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!changelog) return null;

  const getChangeIcon = (type: 'new' | 'improved' | 'fixed') => {
    switch (type) {
      case 'new':
        return { name: 'sparkles' as const, color: '#10B981' }; // Green
      case 'improved':
        return { name: 'trending-up' as const, color: '#3B82F6' }; // Blue
      case 'fixed':
        return { name: 'checkmark-circle' as const, color: '#F59E0B' }; // Amber
    }
  };

  const getChangeLabel = (type: 'new' | 'improved' | 'fixed') => {
    return t(`whatsNew.${type}`);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={[
          styles.container,
          { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }
        ]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="gift" size={32} color="#F59E0B" />
            </View>
            <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              {t('whatsNew.title')}
            </Text>
            <Text style={[styles.version, { color: isDark ? '#8E8E93' : '#6B7280' }]}>
              {t('whatsNew.version', { version: changelog.version })}
            </Text>
          </View>

          {/* Changes List */}
          <ScrollView style={styles.changesList} showsVerticalScrollIndicator={false}>
            {changelog.changes.map((change, index) => {
              const icon = getChangeIcon(change.type);
              const label = getChangeLabel(change.type);

              return (
                <View key={index} style={styles.changeItem}>
                  <View style={[styles.changeBadge, { backgroundColor: icon.color + '20' }]}>
                    <Ionicons name={icon.name} size={16} color={icon.color} />
                    <Text style={[styles.changeLabel, { color: icon.color }]}>
                      {label}
                    </Text>
                  </View>
                  <Text style={[
                    styles.changeDescription,
                    { color: isDark ? '#E5E5EA' : '#374151' }
                  ]}>
                    {t(`whatsNew.changes.${change.descriptionKey}`)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          {/* Don't Show Again Checkbox */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setDontShowAgain(!dontShowAgain)}
            activeOpacity={0.7}
          >
            <View style={[
              styles.checkbox,
              dontShowAgain && styles.checkboxChecked,
              { borderColor: isDark ? '#8E8E93' : '#9CA3AF' }
            ]}>
              {dontShowAgain && (
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              )}
            </View>
            <Text style={[styles.checkboxLabel, { color: isDark ? '#8E8E93' : '#6B7280' }]}>
              {t('whatsNew.dontShowAgain')}
            </Text>
          </TouchableOpacity>

          {/* Dismiss Button */}
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={() => {
              onDismiss(dontShowAgain);
              setDontShowAgain(false); // Reset for next time
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.dismissButtonText}>{t('whatsNew.gotIt')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    maxHeight: '80%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F59E0B20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  version: {
    fontSize: 14,
  },
  changesList: {
    maxHeight: 300,
  },
  changeItem: {
    marginBottom: 16,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
    gap: 4,
  },
  changeLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  changeDescription: {
    fontSize: 15,
    lineHeight: 22,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  checkboxLabel: {
    fontSize: 14,
  },
  dismissButton: {
    backgroundColor: '#F59E0B',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  dismissButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
});

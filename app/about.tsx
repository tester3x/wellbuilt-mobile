import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverSession } from '../src/services/driverAuth';
import { hp, spacing, wp } from '../src/ui/layout';

type UserRole = 'viewer' | 'driver' | 'admin';

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [userRole, setUserRole] = useState<UserRole>('driver');
  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    const loadSession = async () => {
      const session = await getDriverSession();
      if (session) {
        setUserName(session.displayName);
        if (session.isAdmin) {
          setUserRole('admin');
        } else if (session.isViewer) {
          setUserRole('viewer');
        } else {
          setUserRole('driver');
        }
      }
    };
    loadSession();
  }, []);

  const getRoleBadgeStyle = () => {
    switch (userRole) {
      case 'admin':
        return styles.roleBadgeAdmin;
      case 'viewer':
        return styles.roleBadgeViewer;
      default:
        return styles.roleBadgeDriver;
    }
  };

  const getRoleLabel = () => {
    switch (userRole) {
      case 'admin':
        return t('aboutScreen.admin');
      case 'viewer':
        return t('aboutScreen.viewer');
      default:
        return t('aboutScreen.driver');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('aboutScreen.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* App Identity */}
        <View style={styles.heroSection}>
          <Text style={styles.appName}>WellBuilt</Text>
          <Text style={styles.tagline}>{t('aboutScreen.mobile')}</Text>
          <Text style={styles.version}>
            Version {Constants.expoConfig?.version || '1.0.0'}
          </Text>
        </View>

        {/* User Role Card */}
        <View style={styles.roleCard}>
          <Text style={styles.roleCardLabel}>{t('aboutScreen.signedInAs')}</Text>
          <Text style={styles.roleCardName}>{userName || t('aboutScreen.loading')}</Text>
          <View style={[styles.roleBadge, getRoleBadgeStyle()]}>
            <Text style={styles.roleBadgeText}>{getRoleLabel()}</Text>
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.description}>
            {t('aboutScreen.description')}
          </Text>
        </View>

        {/* Features */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('aboutScreen.features')}</Text>
          <View style={styles.featureList}>
            <FeatureItem text={t('aboutScreen.feature1')} />
            <FeatureItem text={t('aboutScreen.feature2')} />
            <FeatureItem text={t('aboutScreen.feature3')} />
            <FeatureItem text={t('aboutScreen.feature4')} />
            <FeatureItem text={t('aboutScreen.feature5')} />
            <FeatureItem text={t('aboutScreen.feature6')} />
          </View>
        </View>

        {/* How It Works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('aboutScreen.howItWorks')}</Text>
          <Text style={styles.howItWorksText}>
            {t('aboutScreen.howItWorksText')}
          </Text>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('aboutScreen.support')}</Text>
          <Text style={styles.supportText}>
            {t('aboutScreen.supportText')}
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerTagline}>{t('aboutScreen.tagline')}</Text>
          <Text style={styles.copyright}>© 2026 WellBuilt</Text>
        </View>
      </ScrollView>
    </View>
  );
}

// Feature item component
function FeatureItem({ text }: { text: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureBullet}>•</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05060B',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: wp('5%'),
    marginBottom: spacing.md,
  },
  backButton: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
    width: 40,
  },
  backText: {
    fontSize: hp('2.4%'),
    color: '#9CA3AF',
  },
  headerTitle: {
    fontSize: hp('2.2%'),
    color: '#F9FAFB',
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: wp('6%'),
    paddingBottom: hp('5%'),
  },
  // Hero section
  heroSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  appName: {
    fontSize: hp('4%'),
    fontWeight: '700',
    color: '#F9FAFB',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: hp('2%'),
    color: '#60A5FA',
    fontWeight: '500',
    marginTop: 2,
  },
  version: {
    fontSize: hp('1.5%'),
    color: '#6B7280',
    marginTop: spacing.sm,
  },
  // Role card
  roleCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  roleCardLabel: {
    fontSize: hp('1.2%'),
    color: '#6B7280',
    fontWeight: '500',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  roleCardName: {
    fontSize: hp('2%'),
    color: '#F9FAFB',
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  roleBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleBadgeAdmin: {
    backgroundColor: '#2563EB',
  },
  roleBadgeViewer: {
    backgroundColor: '#6B7280',
  },
  roleBadgeDriver: {
    backgroundColor: '#10B981',
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: hp('1.4%'),
    fontWeight: '700',
    letterSpacing: 1,
  },
  // Sections
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: hp('1.3%'),
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: hp('1.7%'),
    color: '#9CA3AF',
    lineHeight: hp('2.6%'),
    textAlign: 'center',
  },
  // Features
  featureList: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  featureBullet: {
    color: '#60A5FA',
    fontSize: hp('1.6%'),
    marginRight: spacing.sm,
    marginTop: 1,
  },
  featureText: {
    color: '#D1D5DB',
    fontSize: hp('1.6%'),
    flex: 1,
  },
  // How it works
  howItWorksText: {
    fontSize: hp('1.5%'),
    color: '#9CA3AF',
    lineHeight: hp('2.4%'),
  },
  // Support
  supportText: {
    fontSize: hp('1.5%'),
    color: '#9CA3AF',
  },
  // Footer
  footer: {
    marginTop: spacing.xl,
    alignItems: 'center',
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  footerTagline: {
    fontSize: hp('1.5%'),
    color: '#6B7280',
    fontStyle: 'italic',
  },
  copyright: {
    fontSize: hp('1.3%'),
    color: '#374151',
    marginTop: spacing.xs,
  },
});

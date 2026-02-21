import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { hp, spacing, wp } from '../src/ui/layout';

export default function WelcomeScreen() {
  const router = useRouter();
  const { t, i18n: i18nInstance } = useTranslation();
  const [quoteIndex, setQuoteIndex] = useState(0);

  // Pick random quote index on mount
  useEffect(() => {
    setQuoteIndex(Math.floor(Math.random() * 15));
  }, []);

  // Get translated quotes array
  const quotes = t('welcome.quotes', { returnObjects: true }) as string[];
  const quote = Array.isArray(quotes) ? quotes[quoteIndex] || quotes[0] : '';

  const handleContinue = () => {
    router.replace('/(tabs)');
  };

  const handleSettings = () => {
    router.push('/settings');
  };

  const toggleLanguage = () => {
    const next = (i18nInstance.language || 'en').startsWith('es') ? 'en' : 'es';
    i18nInstance.changeLanguage(next);
  };

  const isSpanish = (i18nInstance.language || 'en').startsWith('es');

  return (
    <View style={styles.container}>
      {/* Language toggle - top right */}
      <TouchableOpacity style={styles.langToggle} onPress={toggleLanguage}>
        <Text style={styles.langToggleText}>
          {isSpanish ? '🇺🇸 EN' : '🇲🇽 ES'}
        </Text>
      </TouchableOpacity>

      {/* Logo */}
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/images/WellBuilt_Icon_transparent.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={styles.appNameRow}>
          <Text style={styles.appName}>WellBuilt</Text>
          <Text style={styles.trademark}>™</Text>
        </View>
        <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
      </View>

      {/* Encouraging quote */}
      <View style={styles.quoteContainer}>
        <Text style={styles.quote}>"{quote}"</Text>
      </View>

      {/* Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueButtonText}>{t('welcome.letsLoad')}</Text>
        </TouchableOpacity>

        <View style={styles.secondaryButtons}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleSettings}>
            <Text style={styles.secondaryButtonText}>⚙️ {t('welcome.settings')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Version */}
      <Text style={styles.version}>v{Constants.expoConfig?.version || '1.0.0'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05060B',
    paddingTop: hp('12%'),
    paddingBottom: hp('5%'),
    paddingHorizontal: wp('8%'),
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  langToggle: {
    position: 'absolute',
    top: hp('6%'),
    right: wp('5%'),
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: '#1F2937',
    borderRadius: 8,
  },
  langToggleText: {
    fontSize: hp('1.6%'),
    color: '#9CA3AF',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logo: {
    width: wp('40%'),
    height: wp('40%'),
    marginBottom: spacing.sm,
  },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  appName: {
    fontSize: hp('4.5%'),
    fontWeight: '700',
    color: '#F9FAFB',
    letterSpacing: 2,
  },
  trademark: {
    fontSize: hp('1.6%'),
    fontWeight: '400',
    color: '#6B7280',
    marginTop: hp('0.5%'),
    marginLeft: 2,
  },
  tagline: {
    fontSize: hp('2%'),
    color: '#6B7280',
    letterSpacing: 4,
    marginTop: spacing.xs,
  },
  quoteContainer: {
    paddingHorizontal: wp('5%'),
  },
  quote: {
    fontSize: hp('2.2%'),
    color: '#9CA3AF',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: hp('3.2%'),
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
  },
  continueButton: {
    backgroundColor: '#2563EB',
    paddingVertical: hp('2%'),
    paddingHorizontal: wp('15%'),
    borderRadius: 12,
    marginBottom: spacing.xl,
  },
  continueButtonText: {
    fontSize: hp('2.2%'),
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  secondaryButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: wp('8%'),
  },
  secondaryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    fontSize: hp('1.8%'),
    color: '#6B7280',
  },
  version: {
    fontSize: hp('1.4%'),
    color: '#374151',
  },
});

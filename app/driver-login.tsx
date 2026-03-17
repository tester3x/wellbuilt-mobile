import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  verifyLogin,
  saveDriverSession,
  isDriverVerified,
  submitRegistration,
  isPasscodeAvailable,
  getPendingRegistration,
  checkRegistrationStatus,
  completeRegistration,
  clearPendingRegistration,
} from '../src/services/driverAuth';
import { hp, spacing, wp } from '../src/ui/layout';

type Mode =
  | 'checking'
  | 'login'
  | 'register'
  | 'verifying'
  | 'registering'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'error';

// Passcode validation: letters, numbers, and common symbols only
const VALID_PASSCODE_REGEX = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;

const validatePasscode = (code: string, t: (key: string) => string): { valid: boolean; error?: string } => {
  if (!code.trim()) {
    return { valid: false, error: t('driverLogin.passcodeRequired') };
  }
  if (code.length < 4) {
    return { valid: false, error: t('driverLogin.passcodeTooShort') };
  }
  if (code.length > 12) {
    return { valid: false, error: t('driverLogin.passcodeTooLong') };
  }
  if (!VALID_PASSCODE_REGEX.test(code)) {
    return { valid: false, error: t('driverLogin.passcodeInvalidChars') };
  }
  return { valid: true };
};

export default function DriverLoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('checking');
  const [passcode, setPasscode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const legalNameRef = useRef<TextInput>(null);
  const companyRef = useRef<TextInput>(null);
  const passcodeRef = useRef<TextInput>(null);
  const [passcodeError, setPasscodeError] = useState('');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Check initial state on mount
  useEffect(() => {
    checkInitialState();
  }, []);

  // Validate passcode as user types (only in register mode)
  useEffect(() => {
    if (mode === 'register' && passcode.length > 0) {
      const validation = validatePasscode(passcode, t);
      if (!validation.valid && passcode.length >= 1) {
        // Only show "invalid characters" error, not length errors while typing
        if (validation.error?.includes('invalid characters')) {
          setPasscodeError(validation.error);
        } else {
          setPasscodeError('');
        }
      } else {
        setPasscodeError('');
      }
    } else {
      setPasscodeError('');
    }
  }, [passcode, mode]);

  // Auto-poll for registration approval when in pending mode
  useEffect(() => {
    if (mode === 'pending') {
      // Start polling every 5 seconds
      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await checkRegistrationStatus();
          if (status === 'approved') {
            // Stop polling
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            // Auto-complete registration and go to app
            const result = await completeRegistration();
            if (result.success) {
              router.replace('/welcome');
            } else {
              setMode('approved'); // Fallback to manual continue
            }
          } else if (status === 'rejected') {
            // Stop polling and show rejection
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setMode('rejected');
          }
          // If still pending, keep polling
        } catch (err) {
          console.log('[DriverLogin] Poll error (will retry):', err);
        }
      }, 5000);

      // Cleanup on unmount or mode change
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }
  }, [mode, router]);

  const checkInitialState = async () => {
    try {
      // Already logged in?
      const verified = await isDriverVerified();
      if (verified) {
        router.replace('/welcome');
        return;
      }

      // Have pending registration?
      const pending = await getPendingRegistration();
      if (pending) {
        setPendingName(pending.displayName);
        const status = await checkRegistrationStatus();

        if (status === 'approved') {
          setMode('approved');
        } else if (status === 'rejected') {
          setMode('rejected');
        } else {
          setMode('pending');
        }
        return;
      }

      // Show login screen
      setMode('login');
    } catch (err) {
      console.error('[DriverLogin] Initial check error:', err);
      setMode('login');
    }
  };

  // Handle login with name + passcode
  const handleLogin = async () => {
    if (!displayName.trim()) {
      setError(t('driverLogin.enterName'));
      return;
    }
    if (!passcode.trim()) {
      setError(t('driverLogin.enterPasscode'));
      return;
    }

    setMode('verifying');
    setError('');

    try {
      const result = await verifyLogin(displayName.trim(), passcode.trim());

      if (result.valid && result.driverId && result.displayName && result.passcodeHash) {
        await saveDriverSession(result.driverId, result.displayName, result.passcodeHash, result.isAdmin || false, result.isViewer || false, result.companyId, result.companyName, result.tier, 'manual');
        router.replace('/welcome');
      } else {
        setMode('login');
        setError(result.error || t('driverLogin.invalidCredentials'));
      }
    } catch (err) {
      console.error('[DriverLogin] Login error:', err);
      setMode('error');
      setError(t('driverLogin.connectionError'));
    }
  };

  // Handle registration submission
  const handleRegister = async () => {
    // Validate passcode
    const validation = validatePasscode(passcode, t);
    if (!validation.valid) {
      setError(validation.error || t('driverLogin.invalidPasscode'));
      return;
    }

    if (!displayName.trim()) {
      setError(t('driverLogin.enterDisplayName'));
      return;
    }

    if (displayName.trim().length < 2) {
      setError(t('driverLogin.displayNameTooShort'));
      return;
    }

    if (!legalName.trim() || legalName.trim().length < 2) {
      setError('Enter your full legal name');
      return;
    }

    setMode('registering');
    setError('');

    try {
      // Check if passcode is available
      const available = await isPasscodeAvailable(passcode.trim(), displayName.trim());
      if (!available.available) {
        setMode('register');
        setError(available.reason || t('driverLogin.passcodeNotAvailable'));
        return;
      }

      // Submit registration
      const result = await submitRegistration({
        passcode: passcode.trim(),
        displayName: displayName.trim(),
        companyName: companyName.trim(),
        legalName: legalName.trim(),
      });

      if (result.success) {
        setPendingName(displayName.trim());
        setMode('pending');
      } else {
        setMode('register');
        setError(result.error || t('driverLogin.registrationFailed'));
      }
    } catch (err) {
      console.error('[DriverLogin] Registration error:', err);
      setMode('register');
      setError(t('driverLogin.connectionErrorRetry'));
    }
  };

  // Complete registration after approval
  const handleCompleteRegistration = async () => {
    setMode('verifying');

    try {
      const result = await completeRegistration();

      if (result.success) {
        router.replace('/welcome');
      } else {
        setMode('error');
        setError(result.error || t('driverLogin.completionFailed'));
      }
    } catch (err) {
      console.error('[DriverLogin] Complete registration error:', err);
      setMode('error');
      setError(t('driverLogin.connectionErrorRetry'));
    }
  };

  // Cancel pending registration and start over
  const handleCancelRegistration = async () => {
    await clearPendingRegistration();
    setPasscode('');
    setDisplayName('');
    setPendingName('');
    setMode('login');
  };

  // Try again after error
  const handleTryAgain = () => {
    setError('');
    setPasscode('');
    setMode('login');
  };

  // Switch to register mode
  const handleSwitchToRegister = () => {
    setError('');
    setPasscode('');
    setShowPasscode(false);
    setMode('register');
  };

  // Switch to login mode
  const handleSwitchToLogin = () => {
    setError('');
    setPasscode('');
    setShowPasscode(false);
    setMode('login');
  };

  // Render passcode input with eye toggle
  const renderPasscodeInput = (placeholder: string, autoFocus: boolean = false) => (
    <View style={styles.inputContainer}>
      <TextInput
        ref={passcodeRef}
        style={[
          styles.input,
          styles.inputWithIcon,
          passcodeError ? styles.inputError : null,
        ]}
        value={passcode}
        onChangeText={setPasscode}
        placeholder={placeholder}
        placeholderTextColor="#6B7280"
        secureTextEntry={!showPasscode}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="go"
        onSubmitEditing={mode === 'login' ? handleLogin : handleRegister}
      />
      <TouchableOpacity
        style={styles.eyeButton}
        onPress={() => setShowPasscode(!showPasscode)}
      >
        <Ionicons
          name={showPasscode ? 'eye-off' : 'eye'}
          size={22}
          color="#6B7280"
        />
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
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
        </View>

        {/* CHECKING MODE */}
        {mode === 'checking' && (
          <View style={styles.formContainer}>
            <ActivityIndicator size="large" color="#2563EB" style={styles.loader} />
            <Text style={styles.subtitle}>{t('driverLogin.loading')}</Text>
          </View>
        )}

        {/* LOGIN MODE */}
        {mode === 'login' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t('driverLogin.title')}</Text>
            <Text style={styles.subtitle}>
              {t('driverLogin.subtitle')}
            </Text>

            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('driverLogin.namePlaceholder')}
              placeholderTextColor="#6B7280"
              autoCapitalize="words"
              autoFocus
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passcodeRef.current?.focus()}
            />

            {renderPasscodeInput(t('driverLogin.passcodePlaceholder'))}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, (!passcode.trim() || !displayName.trim()) && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={!passcode.trim() || !displayName.trim()}
            >
              <Text style={styles.buttonText}>{t('driverLogin.signIn')}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSwitchToRegister}>
              <Text style={styles.linkText}>
                {t('driverLogin.newDriver')} <Text style={styles.linkBold}>{t('driverLogin.registerHere')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* REGISTER MODE */}
        {mode === 'register' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t('driverLogin.registerTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('driverLogin.registerSubtitle')}
            </Text>

            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('driverLogin.displayNamePlaceholder')}
              placeholderTextColor="#6B7280"
              autoCapitalize="words"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => legalNameRef.current?.focus()}
            />

            <TextInput
              ref={legalNameRef}
              style={styles.input}
              value={legalName}
              onChangeText={setLegalName}
              placeholder="Full legal name (e.g., Mike Burger)"
              placeholderTextColor="#6B7280"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => companyRef.current?.focus()}
            />
            <Text style={styles.passcodeHint}>Used on printed tickets, invoices, and payroll</Text>

            <TextInput
              ref={companyRef}
              style={styles.input}
              value={companyName}
              onChangeText={setCompanyName}
              placeholder={t('driverLogin.companyPlaceholder', 'Your company name')}
              placeholderTextColor="#6B7280"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passcodeRef.current?.focus()}
            />
            <Text style={styles.passcodeHint}>
              {t('driverLogin.companyHint', 'Enter the company name your employer gave you')}
            </Text>

            {renderPasscodeInput(t('driverLogin.createPasscode'))}

            {passcodeError ? (
              <Text style={styles.passcodeError}>{passcodeError}</Text>
            ) : (
              <Text style={styles.passcodeHint}>
                {t('driverLogin.passcodeHint')}
              </Text>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[
                styles.button,
                (!passcode.trim() || !displayName.trim() || !legalName.trim() || !!passcodeError) && styles.buttonDisabled,
              ]}
              onPress={handleRegister}
              disabled={!passcode.trim() || !displayName.trim() || !legalName.trim() || !!passcodeError}
            >
              <Text style={styles.buttonText}>{t('driverLogin.submitRegistration')}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSwitchToLogin}>
              <Text style={styles.linkText}>
                {t('driverLogin.alreadyRegistered')} <Text style={styles.linkBold}>{t('driverLogin.signInLink')}</Text>
              </Text>
            </TouchableOpacity>

            <Text style={styles.hint}>
              {t('driverLogin.approvalHint')}
            </Text>
          </View>
        )}

        {/* VERIFYING/REGISTERING MODE */}
        {(mode === 'verifying' || mode === 'registering') && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>
              {mode === 'verifying' ? t('driverLogin.signingIn') : t('driverLogin.registering')}
            </Text>
            <ActivityIndicator size="large" color="#2563EB" style={styles.loader} />
            <Text style={styles.subtitle}>
              {mode === 'verifying' ? t('driverLogin.verifyingPasscode') : t('driverLogin.submittingRegistration')}
            </Text>
          </View>
        )}

        {/* PENDING MODE */}
        {mode === 'pending' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t('driverLogin.pendingTitle')}</Text>

            <View style={styles.infoBox}>
              <Text style={styles.infoBoxText}>
                {t('driverLogin.pendingMessage', { name: pendingName })}
              </Text>
              <Text style={[styles.infoBoxText, { marginTop: spacing.sm }]}>
                {t('driverLogin.pendingAdminReview')}
              </Text>
            </View>

            <ActivityIndicator size="small" color="#60A5FA" style={{ marginVertical: spacing.md }} />
            <Text style={styles.subtitle}>{t('driverLogin.checkingApproval')}</Text>

            <TouchableOpacity onPress={handleCancelRegistration} style={{ marginTop: spacing.lg }}>
              <Text style={styles.linkText}>
                <Text style={styles.linkBold}>{t('driverLogin.cancelRegistration')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* APPROVED MODE */}
        {mode === 'approved' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t('driverLogin.approvedTitle')}</Text>

            <View style={styles.successBox}>
              <Text style={styles.successBoxText}>
                {t('driverLogin.approvedMessage', { name: pendingName })}
              </Text>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleCompleteRegistration}>
              <Text style={styles.buttonText}>{t('driverLogin.continueToApp')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* REJECTED MODE */}
        {mode === 'rejected' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t('driverLogin.rejectedTitle')}</Text>

            <View style={styles.errorBox}>
              <Text style={styles.errorBoxText}>
                {t('driverLogin.rejectedMessage')}
              </Text>
              <Text style={[styles.errorBoxText, { marginTop: spacing.md, fontSize: hp('1.6%') }]}>
                {t('driverLogin.rejectedContactAdmin')}
              </Text>
              <Text style={[styles.errorBoxText, { marginTop: spacing.sm, fontSize: hp('1.4%'), fontStyle: 'italic', opacity: 0.7 }]}>
                {t('driverLogin.rejectedNiceDay')}
              </Text>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleCancelRegistration}>
              <Text style={styles.buttonText}>{t('driverLogin.startOver')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ERROR MODE */}
        {mode === 'error' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t('driverLogin.errorTitle')}</Text>

            <View style={styles.errorBox}>
              <Text style={styles.errorBoxText}>
                {error || t('driverLogin.errorDefault')}
              </Text>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleTryAgain}>
              <Text style={styles.buttonText}>{t('driverLogin.tryAgain')}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSwitchToRegister}>
              <Text style={styles.linkText}>
                {t('driverLogin.needToRegister')} <Text style={styles.linkBold}>{t('driverLogin.registerHere')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Version display */}
        <Text style={styles.version}>
          v{Constants.expoConfig?.version || '1.0.0'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05060B',
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: hp('10%'),
    paddingBottom: hp('40%'),
    paddingHorizontal: wp('8%'),
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: hp('4%'),
  },
  logo: {
    width: wp('25%'),
    height: wp('25%'),
    marginBottom: spacing.sm,
  },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  appName: {
    fontSize: hp('3%'),
    fontWeight: '700',
    color: '#F9FAFB',
    letterSpacing: 2,
  },
  trademark: {
    fontSize: hp('1.2%'),
    fontWeight: '400',
    color: '#6B7280',
    marginTop: hp('0.3%'),
    marginLeft: 2,
  },
  formContainer: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: hp('2.4%'),
    fontWeight: '700',
    color: '#F9FAFB',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: hp('1.8%'),
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: wp('5%'),
  },
  inputContainer: {
    width: '100%',
    position: 'relative',
    marginBottom: spacing.sm,
  },
  input: {
    width: '100%',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    paddingVertical: hp('1.8%'),
    paddingHorizontal: wp('5%'),
    fontSize: hp('2%'),
    color: '#F9FAFB',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#374151',
  },
  inputWithIcon: {
    paddingRight: wp('12%'),
    marginBottom: 0,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  eyeButton: {
    position: 'absolute',
    right: wp('4%'),
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: wp('2%'),
  },
  passcodeHint: {
    fontSize: hp('1.3%'),
    color: '#6B7280',
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
    marginLeft: wp('1%'),
  },
  passcodeError: {
    fontSize: hp('1.3%'),
    color: '#EF4444',
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
    marginLeft: wp('1%'),
  },
  loader: {
    marginVertical: spacing.xl,
  },
  infoBox: {
    backgroundColor: '#1E3A5F',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
    width: '100%',
  },
  infoBoxText: {
    fontSize: hp('1.6%'),
    color: '#93C5FD',
    textAlign: 'center',
  },
  successBox: {
    backgroundColor: '#14532D',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
    width: '100%',
  },
  successBoxText: {
    fontSize: hp('1.6%'),
    color: '#86EFAC',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#7F1D1D',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
    width: '100%',
  },
  errorBoxText: {
    fontSize: hp('1.6%'),
    color: '#FCA5A5',
    textAlign: 'center',
  },
  hint: {
    fontSize: hp('1.4%'),
    color: '#6B7280',
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: wp('5%'),
  },
  error: {
    color: '#EF4444',
    fontSize: hp('1.6%'),
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2563EB',
    paddingVertical: hp('1.8%'),
    paddingHorizontal: wp('10%'),
    borderRadius: 12,
    minWidth: wp('60%'),
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  buttonDisabled: {
    backgroundColor: '#1E3A5F',
    opacity: 0.6,
  },
  buttonText: {
    fontSize: hp('2%'),
    fontWeight: '700',
    color: '#FFFFFF',
  },
  linkText: {
    fontSize: hp('1.6%'),
    color: '#9CA3AF',
    marginTop: spacing.sm,
  },
  linkBold: {
    color: '#60A5FA',
    fontWeight: '600',
  },
  version: {
    fontSize: hp('1.4%'),
    color: '#374151',
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
});

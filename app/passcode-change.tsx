/**
 * Forced passcode change (WB-M).
 *
 * Reached ONLY via the post-auth authority (decidePostAuthRoute →
 * /passcode-change) when the server reports mustChangePasscode. The driver is
 * authenticated with a temporary/admin-set passcode and must replace it before
 * any normal app access. This screen:
 *   - blocks the Android hardware Back button (no bypass to tabs/welcome),
 *   - collects the temporary passcode + a new private passcode (twice),
 *   - submits ONLY through the governed driverChangeOwnPasscode callable,
 *   - clears the forced-change gate ONLY after the server confirms
 *     (returns mustChangePasscode:false), then re-enters the normal gate.
 *
 * No plaintext passcode is logged, stored, or placed in errors.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { changeOwnPasscode } from '../src/services/secureDriverAuth';
import { setPersistedMustChangePasscode } from '../src/services/driverAuth';
import { authorizeEstablishedSession } from '../src/services/postAuthGate';
import {
  AUTH_TIMEOUT_MS,
  classifyAuthOutcome,
  publicAuthMessage,
  withAuthTimeout,
} from '../src/services/authFlowState';

const MIN_PASSCODE = 6;

export default function PasscodeChangeScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Block Android hardware Back: a temporary passcode must not reach the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canSubmit =
    !busy &&
    current.trim().length >= MIN_PASSCODE &&
    next.trim().length >= MIN_PASSCODE &&
    next === confirm &&
    next !== current;

  const submit = async () => {
    setError(null);
    if (next.length < MIN_PASSCODE) {
      setError(`New passcode must be at least ${MIN_PASSCODE} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('New passcode entries do not match.');
      return;
    }
    if (next === current) {
      setError('New passcode must be different from the temporary one.');
      return;
    }
    setBusy(true);
    try {
      const raced = await withAuthTimeout(
        changeOwnPasscode({ currentPasscode: current, newPasscode: next }),
        AUTH_TIMEOUT_MS,
      );
      if (!mountedRef.current) return; // unmounted → abandon, no spinner
      if (raced.timedOut) {
        setError(publicAuthMessage('timeout'));
        return;
      }
      const result = raced.value;
      // Only clear the gate when the SERVER confirms the replacement.
      if (result?.ok === true) {
        await setPersistedMustChangePasscode(false);
        const dest = await authorizeEstablishedSession({
          eligibleDestination: '/welcome',
          revalidation: 'valid',
          mustChangePasscode: false,
        });
        if (!mountedRef.current) return;
        router.replace(dest);
        return;
      }
      setError(publicAuthMessage('server_error'));
    } catch (err) {
      // Map to a secret-free category; never echo raw server text that could
      // reveal whether the temporary passcode was right vs another failure.
      const code =
        err instanceof Error ? extractCode(err.message) : null;
      const category = classifyAuthOutcome({
        code,
        networkFailed: isNetworkError(err),
      });
      setError(publicAuthMessage(category === 'ok' ? 'server_error' : category));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your passcode</Text>
      <Text style={styles.message}>
        You signed in with a temporary passcode. Create your own private passcode to continue.
      </Text>

      <TextInput
        style={styles.input}
        value={current}
        onChangeText={setCurrent}
        placeholder="Temporary passcode"
        placeholderTextColor="#6B7280"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={next}
        onChangeText={setNext}
        placeholder="New passcode"
        placeholderTextColor="#6B7280"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Confirm new passcode"
        placeholderTextColor="#6B7280"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      ) : (
        <Text style={styles.hint}>At least {MIN_PASSCODE} characters. Keep it private.</Text>
      )}

      <Pressable
        style={[styles.btn, !canSubmit && styles.btnDisabled]}
        onPress={submit}
        disabled={!canSubmit}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.btnText}>Set passcode</Text>
        )}
      </Pressable>
    </View>
  );
}

function extractCode(message: string): string | null {
  // Server HttpsError messages sometimes prefix a code like "permission-denied:".
  const m = message.match(/\b(unauthenticated|permission-denied|not-found|failed-precondition|invalid-argument|unavailable|deadline-exceeded)\b/);
  return m ? m[1] : null;
}

function isNetworkError(err: unknown): boolean {
  const m = err instanceof Error ? err.message.toLowerCase() : '';
  return m.includes('network') || m.includes('timed out') || m.includes('fetch');
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#05060B',
    paddingHorizontal: 32,
  },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  message: { color: '#9CA3AF', fontSize: 15, lineHeight: 22, marginBottom: 24 },
  input: {
    backgroundColor: '#111827',
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  hint: { color: '#6B7280', fontSize: 13, marginBottom: 20 },
  error: { color: '#FCA5A5', fontSize: 14, marginBottom: 20 },
  btn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});

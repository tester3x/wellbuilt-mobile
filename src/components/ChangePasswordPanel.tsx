import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { changeOwnPasscode } from '../services/secureDriverAuth';

export default function ChangePasswordPanel() {
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const clearSecrets = () => {
    setCurrentPasscode('');
    setNewPasscode('');
    setConfirmPasscode('');
  };

  useEffect(() => () => { clearSecrets(); }, []);

  const onSubmit = async () => {
    if (!currentPasscode || !newPasscode || newPasscode !== confirmPasscode) {
      setMessage('Could not change password');
      clearSecrets();
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await changeOwnPasscode({ currentPasscode, newPasscode });
      setMessage('Password updated');
    } catch {
      setMessage('Could not change password');
    } finally {
      clearSecrets();
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Change password</Text>
      <TextInput
        style={styles.input}
        value={currentPasscode}
        onChangeText={setCurrentPasscode}
        placeholder="Current password"
        placeholderTextColor="#6B7280"
        secureTextEntry
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        value={newPasscode}
        onChangeText={setNewPasscode}
        placeholder="New password"
        placeholderTextColor="#6B7280"
        secureTextEntry
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        value={confirmPasscode}
        onChangeText={setConfirmPasscode}
        placeholder="Confirm new password"
        placeholderTextColor="#6B7280"
        secureTextEntry
        autoCapitalize="none"
      />
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      <View style={styles.row}>
        <TouchableOpacity onPress={() => { clearSecrets(); setMessage(''); }} disabled={busy}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onSubmit} disabled={busy}>
          <Text style={styles.btnText}>{busy ? 'Saving…' : 'Update password'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', marginTop: 12 },
  title: { color: '#F9FAFB', fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: '#111827',
    color: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    width: '100%',
  },
  msg: { color: '#D1D5DB', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cancel: { color: '#9CA3AF', padding: 8 },
  btn: { backgroundColor: '#2563EB', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  btnText: { color: '#fff', fontWeight: '600' },
});

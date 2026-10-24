import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';
import { pendingTankInfo, readTankInfo, refreshTankInfo, saveTankInfo,
  type TankConfig, type TankEdit, type TankInfo } from '../services/tankInfo';
import { editableTankConfig, tankInfoChanges, tankInfoDraft, tankInfoNumbers } from '../utils/tankInfoDraft';

export function TankInfoModal({ wellName, fallback, onClose, onSaved }: {
  wellName: string; fallback: TankConfig; onClose(): void; onSaved(): void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<TankInfo | null>(null), [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<TankEdit>(), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const config = editableTankConfig(info?.config || fallback);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cached = await readTankInfo(wellName);
        if (active && cached) { setInfo(cached); }
        const saved = await pendingTankInfo(wellName); if (active) setPending(saved);
        const fresh = await refreshTankInfo(wellName);
        if (active) { setInfo(fresh); }
      } catch { if (active) setError(t('tankInfo.offline')); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [wellName, t]);
  const beginEdit = () => {
    setDraft(tankInfoDraft(pending?.state === 'blocked' ? { ...config, ...pending.patch } : config));
    setEdit(true); setError('');
  };
  const save = async () => {
    if (!info?.canEdit) return;
    setBusy(true); setError('');
    try {
      const patch = tankInfoChanges(info.config, draft);
      if (!Object.keys(patch).length) { setEdit(false); return; }
      await saveTankInfo(wellName, Number(info.config.tankInfoRevision || 0), patch,
        pending?.state === 'blocked' ? pending.id : undefined);
      const saved = await pendingTankInfo(wellName); setPending(saved);
      const confirmed = await readTankInfo(wellName); if (confirmed) setInfo(confirmed);
      setEdit(false); if (!saved) onSaved();
    } catch { setError(t('tankInfo.invalid')); }
    finally { setBusy(false); }
  };
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.panel} accessibilityViewIsModal>
        <View style={styles.header}><Text style={styles.title}>{t('tankInfo.title')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>×</Text></Pressable></View>
        <Text style={styles.well}>{wellName}</Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          {busy && <ActivityIndicator color="#60a5fa" />}
          {!!error && <Text accessibilityRole="alert" style={styles.notice}>{error}</Text>}
          {!!pending && <Text style={styles.notice}>{t(pending.state === 'blocked' ? 'tankInfo.blocked' : 'tankInfo.pending')}</Text>}
          {['ndicName', 'ndicApiNo', 'operator', 'route'].map(key => <View key={key} style={styles.row}>
            <Text style={styles.label}>{t('tankInfo.' + key)}</Text>
            <Text style={styles.value}>{config[key] || t('tankInfo.unknown')}</Text>
          </View>)}
          {tankInfoNumbers.map(key => <View key={key} style={styles.row}>
            <Text style={styles.label}>{t('tankInfo.' + key)}</Text>
            {edit ? <TextInput accessibilityLabel={t('tankInfo.' + key)} style={styles.input}
              value={draft[key]} onChangeText={value => setDraft(d => ({ ...d, [key]: value }))}
              keyboardType={['tankHeight', 'tankDiameter', 'loadLine', 'allowedBottom'].includes(key) ? 'default' : 'decimal-pad'}
              placeholder={t('tankInfo.unknown')} placeholderTextColor="#8290a6" />
              : <Text style={styles.value}>{config[key] ?? t('tankInfo.unknown')}</Text>}
          </View>)}
          <View style={styles.row}><Text style={styles.label}>{t('tankInfo.bankRate')}</Text>
            <Text style={styles.value}>{config.bblPerFoot ?? t('tankInfo.unknown')}</Text></View>
          {edit && <Text style={styles.hint}>{t('tankInfo.unitsHint')}</Text>}
          <Text style={styles.label}>{t('tankInfo.h2sStatus')}</Text>
          {edit ? <View style={styles.picker}><Picker selectedValue={draft.h2sStatus}
            onValueChange={value => setDraft(d => ({ ...d, h2sStatus: value }))} style={styles.pickerText}>
            {['unknown', 'none', 'low', 'high'].map(value => <Picker.Item key={value} value={value} label={t('tankInfo.h2s.' + value)} />)}
          </Picker></View> : <Text style={styles.value}>{t('tankInfo.h2s.' + config.h2sStatus)}</Text>}
          <Text style={styles.label}>{t('tankInfo.tankNotes')}</Text>
          {edit ? <TextInput multiline maxLength={1000} accessibilityLabel={t('tankInfo.tankNotes')} style={[styles.input, styles.notes]}
            value={draft.tankNotes} onChangeText={value => setDraft(d => ({ ...d, tankNotes: value }))} />
            : <Text style={styles.value}>{config.tankNotes || t('tankInfo.noNotes')}</Text>}
          {!!config.tankManufacturer && <Text style={styles.value}>{config.tankManufacturer}</Text>}
          {!!config.tankSerialNumber && <Text style={styles.value}>{config.tankSerialNumber}</Text>}
          {!!config.tankInfoUpdatedBy && <Text style={styles.hint}>{t('tankInfo.updatedBy', { name: config.tankInfoUpdatedBy,
            date: config.tankInfoUpdatedAt ? new Date(Number(config.tankInfoUpdatedAt)).toLocaleString() : '' })}</Text>}
          <Text style={styles.label}>{t('tankInfo.primaryDriver')}</Text>
          <Text style={styles.value}>{info?.primaryDrivers.map(d => d.name + (d.allRoutes ? ' (' + t('tankInfo.allRoutes') + ')' : '')).join(', ') || t('tankInfo.notDesignated')}</Text>

        </ScrollView>
        <View style={styles.actions}>
          <Pressable disabled={busy} style={styles.secondary} onPress={edit ? () => setEdit(false) : onClose}>
            <Text style={styles.buttonText}>{t(edit ? 'common.cancel' : 'common.close')}</Text></Pressable>
          {info?.canEdit && <Pressable disabled={busy || pending?.state === 'pending'} style={styles.primary} onPress={edit ? save : beginEdit}>
            <Text style={styles.buttonText}>{t(edit ? 'tankInfo.save' : pending?.state === 'blocked' ? 'tankInfo.review' : 'tankInfo.edit')}</Text></Pressable>}
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 20 },
  panel: { maxHeight: '90%', backgroundColor: '#121a2a', borderColor: '#334155', borderWidth: 1, borderRadius: 18, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 23, fontWeight: '700', color: '#60a5fa' }, close: { fontSize: 32, color: '#fff' },
  well: { color: '#fff', fontSize: 18, marginBottom: 16 }, row: { marginBottom: 12 },
  label: { color: '#a7b2c7', fontSize: 15, marginTop: 6, marginBottom: 4 }, value: { color: '#fff', fontSize: 17, marginBottom: 8 },
  input: { color: '#fff', fontSize: 17, backgroundColor: '#1e293b', borderColor: '#52617a', borderWidth: 1, borderRadius: 8, padding: 12 },
  notes: { minHeight: 80, textAlignVertical: 'top' }, hint: { color: '#a7b2c7', marginVertical: 10 },
  notice: { color: '#fbbf24', marginBottom: 12 }, picker: { backgroundColor: '#1e293b', borderRadius: 8 },
  pickerText: { color: '#fff' }, actions: { flexDirection: 'row', gap: 12, paddingTop: 16 },
  primary: { flex: 1, backgroundColor: '#2563eb', borderRadius: 9, padding: 14, alignItems: 'center' },
  secondary: { flex: 1, backgroundColor: '#334155', borderRadius: 9, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

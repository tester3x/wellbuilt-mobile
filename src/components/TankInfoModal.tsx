import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';
import { onTankInfoChange, pendingTankInfo, readTankInfo, refreshTankInfo, saveTankInfo,
  type TankConfig, type TankEdit, type TankInfo } from '../services/tankInfo';
import { changeTankInfoField, editableTankConfig, formatTankInfoNumber, tankInfoChanges, tankInfoDraft, tankInfoNumbers } from '../utils/tankInfoDraft';

export function TankInfoModal({ wellName, fallback, onClose, onSaved }: {
  wellName: string; fallback: TankConfig; onClose(): void; onSaved(): void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<TankInfo | null>(null), [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<TankEdit>(), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const config = editableTankConfig(info?.config || fallback);
  const manualRate = useRef(false);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  useEffect(() => {
    let active = true;
    const unsubscribe = onTankInfoChange((well, applied) => {
      if (well !== wellName || !active) return;
      void (async () => {
        const [cached, saved] = await Promise.all([readTankInfo(wellName), pendingTankInfo(wellName)]);
        if (!active) return;
        if (cached) setInfo(cached); setPending(saved);
        if (applied) onSavedRef.current();
      })().catch(() => {});
    });
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
    return () => { active = false; unsubscribe(); };
  }, [wellName, t]);
  const beginEdit = () => {
    manualRate.current = false;
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
      setEdit(false);
    } catch { setError(t('tankInfo.invalid')); }
    finally { setBusy(false); }
  };
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.panel} accessibilityViewIsModal>
        <View style={styles.header}><Text style={styles.title}>{config.ndicName || t('tankInfo.ndicName')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {busy && <ActivityIndicator color="#60a5fa" />}
          {!!error && <Text accessibilityRole="alert" style={styles.notice}>{error}</Text>}
          {!!pending && <Text style={styles.notice}>{t(pending.state === 'blocked' ? 'tankInfo.blocked' : 'tankInfo.pending')}</Text>}
          <View style={styles.identity}>
            {['ndicApiNo', 'operator', 'route'].map(key => <View key={key} style={styles.row}>
              <Text style={[styles.label, styles.rowLabel]}>{t('tankInfo.' + key)}</Text>
              <Text style={[styles.value, styles.rowValue]}>{config[key] || t('tankInfo.unknown')}</Text>
            </View>)}
          </View>
          {tankInfoNumbers.filter(key => key !== 'activeTanks').map(key => <View key={key} style={edit ? styles.editRow : styles.row}>
            <Text style={[styles.label, !edit && styles.rowLabel]}>{t('tankInfo.' + key)}</Text>
            {edit ? <TextInput accessibilityLabel={t('tankInfo.' + key)} style={styles.input}
              value={draft[key]} onChangeText={value => {
                if (key === 'perTankBblPerFoot') manualRate.current = value.trim() !== '';
                setDraft(d => changeTankInfoField(d, key, value, manualRate.current));
              }}
              keyboardType={['tankHeight', 'tankDiameter', 'loadLine', 'allowedBottom'].includes(key) ? 'default' : 'decimal-pad'}
              placeholder={t('tankInfo.unknown')} placeholderTextColor="#8290a6" />
              : <Text style={[styles.value, styles.rowValue]}>{formatTankInfoNumber(config[key]) || t('tankInfo.unknown')}</Text>}
          </View>)}
          {edit && <Text style={styles.hint}>{t('tankInfo.unitsHint')}</Text>}
          <View style={edit ? styles.editRow : styles.row}><Text style={[styles.label, !edit && styles.rowLabel]}>{t('tankInfo.h2sStatus')}</Text>
          {edit ? <View style={styles.picker}><Picker selectedValue={draft.h2sStatus}
            onValueChange={value => setDraft(d => ({ ...d, h2sStatus: value }))} style={styles.pickerText}>
            {['unknown', 'none', 'low', 'high'].map(value => <Picker.Item key={value} value={value} label={t('tankInfo.h2s.' + value)} />)}
          </Picker></View> : <Text style={[styles.value, styles.rowValue]}>{t('tankInfo.h2s.' + config.h2sStatus)}</Text>}</View>
          <View style={edit ? styles.editRow : styles.row}><Text style={[styles.label, !edit && styles.rowLabel]}>{t('tankInfo.tankNotes')}</Text>
          {edit ? <TextInput multiline maxLength={1000} accessibilityLabel={t('tankInfo.tankNotes')} style={[styles.input, styles.notes]}
            value={draft.tankNotes} onChangeText={value => setDraft(d => ({ ...d, tankNotes: value }))} />
            : <Text style={[styles.value, styles.rowValue]}>{config.tankNotes || t('tankInfo.noNotes')}</Text>}</View>
          {!!config.tankManufacturer && <Text style={styles.value}>{config.tankManufacturer}</Text>}
          {!!config.tankSerialNumber && <Text style={styles.value}>{config.tankSerialNumber}</Text>}
          {!!config.tankInfoUpdatedBy && <Text style={styles.hint}>{t('tankInfo.updatedBy', { name: config.tankInfoUpdatedBy,
            date: config.tankInfoUpdatedAt ? new Date(Number(config.tankInfoUpdatedAt)).toLocaleString() : '' })}</Text>}
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
  backdrop: { flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 16 },
  panel: { maxHeight: '94%', backgroundColor: '#121a2a', borderColor: '#334155', borderWidth: 1, borderRadius: 18, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: '#60a5fa' }, close: { fontSize: 28, color: '#fff' },
  identity: { borderBottomWidth: 1, borderBottomColor: '#334155', paddingBottom: 6, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 5 },
  editRow: { marginBottom: 9 },
  rowLabel: { flex: 1 }, rowValue: { flex: 1.25 },
  label: { color: '#a7b2c7', fontSize: 13, lineHeight: 18 },
  value: { color: '#fff', fontSize: 14, lineHeight: 19 },
  input: { color: '#fff', fontSize: 15, backgroundColor: '#1e293b', borderColor: '#52617a', borderWidth: 1, borderRadius: 8, padding: 9 },
  notes: { minHeight: 60, textAlignVertical: 'top' }, hint: { color: '#a7b2c7', fontSize: 12, lineHeight: 16, marginVertical: 5 },
  notice: { color: '#fbbf24', marginBottom: 12 }, picker: { backgroundColor: '#1e293b', borderRadius: 8 },
  pickerText: { color: '#fff' }, actions: { flexDirection: 'row', gap: 12, paddingTop: 10 },
  primary: { flex: 1, backgroundColor: '#2563eb', borderRadius: 9, padding: 14, alignItems: 'center' },
  secondary: { flex: 1, backgroundColor: '#334155', borderRadius: 9, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

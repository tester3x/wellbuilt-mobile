import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { flushFreshWaterDeliveries, getFreshWaterSupply, listFreshWaterTankGroups, pendingFreshWaterDeliveries,
  queueFreshWaterDelivery, type FreshWaterDeliveryDraft, type FreshWaterSupply,
  type FreshWaterTankGroup } from '../src/services/freshWaterSupply';

export default function FreshWaterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<FreshWaterTankGroup[]>([]);
  const [selected, setSelected] = useState('');
  const [supply, setSupply] = useState<FreshWaterSupply | null>(null);
  const [barrels, setBarrels] = useState('');
  const [before, setBefore] = useState('');
  const [pending, setPending] = useState<FreshWaterDeliveryDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refreshPending = useCallback(async () => setPending(await pendingFreshWaterDeliveries()), []);
  useEffect(() => {
    let active = true;
    listFreshWaterTankGroups().then(result => {
      if (!active) return;
      setGroups((result.groups || []).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(e => setMessage(String(e)));
    refreshPending();
    const timer = setInterval(() => {
      flushFreshWaterDeliveries().then(refreshPending).catch(() => undefined);
    }, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [refreshPending]);

  const select = async (groupId: string) => {
    setSelected(groupId);
    setSupply(null);
    setBefore('');
    setMessage('');
    setBusy(true);
    try { setSupply(await getFreshWaterSupply(groupId)); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const send = async () => {
    if (!supply || busy) return;
    const deliveredBbl = Number(barrels);
    const measuredBeforeFeet = before.trim() ? Number(before) : undefined;
    if (!Number.isFinite(deliveredBbl) || deliveredBbl <= 0 || deliveredBbl > 500
      || (measuredBeforeFeet !== undefined && (!Number.isFinite(measuredBeforeFeet)
        || measuredBeforeFeet < 0 || measuredBeforeFeet > supply.config.tankHeightFeet))) {
      Alert.alert('Check the numbers', 'Enter one load of 1–500 BBL and a valid before level.');
      return;
    }
    if (!supply.status && measuredBeforeFeet === undefined) {
      Alert.alert('Starting level needed', 'Measure the tanks before the first delivery.');
      return;
    }
    const projected = measuredBeforeFeet ?? supply.status?.projectedFeet;
    const after = projected === null || projected === undefined ? null
      : projected + deliveredBbl / (supply.config.tankCount * supply.config.bblPerFootPerTank);
    if (after !== null && after > supply.config.tankHeightFeet) {
      Alert.alert('Tank may overflow', `This load would reach about ${after.toFixed(1)} ft, above the ${supply.config.tankHeightFeet} ft tank.`);
      return;
    }
    Alert.alert('Record fresh water delivery', `${deliveredBbl} BBL to ${supply.name}${after === null ? '' : ` · estimated after ${after.toFixed(1)} ft`}. One load, hourly service.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Record', onPress: async () => {
        setBusy(true);
        try {
          await queueFreshWaterDelivery({ groupId: selected, deliveredBbl, measuredBeforeFeet });
          const result = await flushFreshWaterDeliveries();
          await refreshPending();
          setBarrels(''); setBefore('');
          setMessage(result.pending ? 'Saved on this phone. It will retry while the app is open.' : 'Delivery confirmed.');
          if (!result.pending) setSupply(await getFreshWaterSupply(selected));
        } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      } },
    ]);
  };

  return <View style={[styles.root, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
    <View style={styles.header}><Pressable onPress={() => router.back()}><Text style={styles.link}>‹ Back</Text></Pressable><Text style={styles.title}>Fresh Water Tank Refill</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.sub}>Single load · hourly service · separate from produced water</Text>
      {groups.length === 0 && <Text style={styles.muted}>No fresh-water tank groups are configured on your assigned routes yet.</Text>}
      {groups.map(group => <Pressable key={group.groupId} style={[styles.pad, selected === group.groupId && styles.selected]} onPress={() => select(group.groupId)}>
        <View style={styles.groupLine}><Text style={styles.padText}>{group.name}</Text><Text style={styles.tankBadge}>{group.config.tankCount} tank{group.config.tankCount === 1 ? '' : 's'}</Text></View>
        <Text style={styles.muted}>Supplies: {group.wellNames.join(', ')}</Text>
      </Pressable>)}
      {busy && <ActivityIndicator color="#38bdf8" />}
      {supply && <View style={styles.card}>
        <Text style={styles.title}>{supply.name}</Text>
        <Text style={styles.muted}>Supplies: {supply.wellNames.join(', ')}</Text>
        <Text style={styles.label}>Current estimated level</Text>
        <Text style={styles.level}>{supply.status?.projectedFeet?.toFixed(1) ?? 'Needs first reading'} ft</Text>
        <Text style={styles.muted}>{supply.config.tankCount} tank(s) · {supply.config.tankHeightFeet} ft high · {supply.config.bblPerFootPerTank} BBL/ft each · {supply.status?.dailyUseBbl ?? supply.config.dailyUseBbl} BBL/day use</Text>
        <Text style={styles.label}>Delivered barrels (one load)</Text>
        <TextInput style={styles.input} value={barrels} onChangeText={setBarrels} keyboardType="decimal-pad" placeholder="e.g. 120" placeholderTextColor="#64748b" />
        <Text style={styles.label}>Measured level before unloading (ft, optional after first reading)</Text>
        <TextInput style={styles.input} value={before} onChangeText={setBefore} keyboardType="decimal-pad" placeholder="Gauge reading" placeholderTextColor="#64748b" />
        <Pressable style={styles.button} onPress={send} disabled={busy}><Text style={styles.buttonText}>Record delivery</Text></Pressable>
      </View>}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {pending.length > 0 && <View style={styles.card}>
        <Text style={styles.title}>Saved deliveries ({pending.length})</Text>
        {pending.map(item => <Text key={item.deliveryId} style={styles.muted}>{item.groupId || item.wellName} · {item.deliveredBbl} BBL · {item.error || 'Waiting to send'}</Text>)}
        <Pressable style={styles.button} onPress={async () => { await flushFreshWaterDeliveries(); await refreshPending(); }}><Text style={styles.buttonText}>Retry sending</Text></Pressable>
      </View>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060b', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 12 },
  title: { color: '#f8fafc', fontSize: 19, fontWeight: '700' },
  link: { color: '#38bdf8', fontSize: 17 },
  content: { gap: 10, paddingBottom: 30 },
  sub: { color: '#94a3b8', marginBottom: 10 },
  muted: { color: '#94a3b8', lineHeight: 20 },
  pad: { padding: 14, borderRadius: 10, backgroundColor: '#172033', borderWidth: 1, borderColor: '#253348' },
  selected: { borderColor: '#38bdf8' },
  padText: { color: '#f8fafc', fontWeight: '600' },
  groupLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  tankBadge: { color: '#05060b', backgroundColor: '#38bdf8', overflow: 'hidden', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3, fontWeight: '700' },
  card: { backgroundColor: '#111b2d', borderRadius: 12, padding: 16, gap: 10, marginTop: 12 },
  label: { color: '#cbd5e1', marginTop: 8 },
  level: { color: '#38bdf8', fontSize: 30, fontWeight: '700' },
  input: { backgroundColor: '#07111e', borderWidth: 1, borderColor: '#334155', borderRadius: 8, color: '#fff', padding: 12, fontSize: 18 },
  button: { backgroundColor: '#0891b2', padding: 14, alignItems: 'center', borderRadius: 8, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700' },
  message: { color: '#fbbf24', lineHeight: 21 },
});

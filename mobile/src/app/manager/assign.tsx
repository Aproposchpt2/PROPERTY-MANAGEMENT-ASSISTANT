import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, assignVendor, listVendors, type Vendor } from '../../lib/api';
import { VISIT_WINDOWS, hourLabel, nextDays, visitWindow, windowAvailable } from '../../lib/cases';
import { Button, Centered, Label } from '../../components/ui';
import { colors, fonts, radius } from '../../lib/theme';
import { showMessage } from '../../lib/dialog';

// Assign a service provider to a case, with an optional 2-hour visit window.
// Same API as the web dashboard; the server moves the case to Assigned or Scheduled.
export default function AssignProvider() {
  const params = useLocalSearchParams<{ id: string; vendorId?: string; caseNumber?: string }>();
  const id = String(params.id);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string>(typeof params.vendorId === 'string' ? params.vendorId : '');
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [workOrder, setWorkOrder] = useState('');
  const [saving, setSaving] = useState(false);
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => nextDays(now), [now]);

  useEffect(() => {
    listVendors()
      .then(setVendors)
      .catch(e => setError(e instanceof ApiError ? e.message : 'Could not load providers.'));
  }, []);

  if (error) return <Centered><Text style={s.p}>{error}</Text><Button label="Back" tone="ghost" onPress={() => router.back()} /></Centered>;
  if (!vendors) return <Centered><Text style={{ color: colors.body, fontFamily: fonts.regular }}>Loading providers…</Text></Centered>;

  const scheduled = dayIndex !== null && hour !== null;
  async function save() {
    if (!vendorId) return showMessage('Choose a provider');
    if ((dayIndex === null) !== (hour === null)) return showMessage('Finish the visit time', 'Pick both a day and a time, or neither.');
    const w = scheduled ? visitWindow(days[dayIndex!], hour!) : null;
    setSaving(true);
    try {
      await assignVendor(id, { vendorId, scheduledStart: w?.start ?? null, scheduledEnd: w?.end ?? null, workOrderRef: workOrder.trim() || null });
      router.back();
    } catch (e) {
      showMessage('Not assigned', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  const dayName = (d: Date, i: number) =>
    i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      {params.caseNumber ? <Text style={s.caseNo}>Case {params.caseNumber}</Text> : null}
      <Label>PROVIDER</Label>
      {vendors.length === 0 ? (
        <Text style={s.p}>No active providers for this property. Add providers in the web Management Dashboard.</Text>
      ) : vendors.map(v => (
        <Pressable
          key={v.id}
          onPress={() => setVendorId(v.id)}
          style={[s.vendor, vendorId === v.id && s.vendorOn]}
          accessibilityRole="radio"
          accessibilityState={{ selected: vendorId === v.id }}
          accessibilityLabel={`${v.name ?? 'Provider'}${v.trade ? `, ${v.trade}` : ''}`}
        >
          <Ionicons name={vendorId === v.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={vendorId === v.id ? colors.gold : colors.muted} />
          <View style={{ flex: 1 }}>
            <Text style={s.vName}>{v.name ?? 'Unnamed provider'}</Text>
            {v.trade ? <Text style={s.meta}>{v.trade}</Text> : null}
          </View>
        </Pressable>
      ))}

      <Label>VISIT DAY (OPTIONAL)</Label>
      <View style={s.chips}>
        {days.map((d, i) => (
          <Chip key={i} label={dayName(d, i)} on={dayIndex === i} onPress={() => { setDayIndex(dayIndex === i ? null : i); setHour(null); }} />
        ))}
      </View>
      {dayIndex !== null ? (
        <>
          <Label>VISIT WINDOW</Label>
          <View style={s.chips}>
            {VISIT_WINDOWS.map(h => windowAvailable(days[dayIndex], h, now) ? (
              <Chip key={h} label={`${hourLabel(h)}–${hourLabel(h + 2)}`} on={hour === h} onPress={() => setHour(hour === h ? null : h)} />
            ) : null)}
          </View>
        </>
      ) : null}

      <Label>WORK ORDER # (OPTIONAL)</Label>
      <TextInput placeholderTextColor={colors.muted} style={s.input} value={workOrder} onChangeText={setWorkOrder} maxLength={100} accessibilityLabel="Work order number" />

      <Text style={s.small}>
        {scheduled
          ? 'A new case moves to Scheduled. Any earlier provider on this case is replaced.'
          : 'A new case moves to Assigned. Any earlier provider on this case is replaced.'}
      </Text>
      <Button label="Assign provider" onPress={save} busy={saving} disabled={!vendorId} />
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.chipText, on && { color: colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 10, paddingBottom: 48 },
  caseNo: { fontSize: 26, color: colors.ivory, fontFamily: fonts.serif, fontVariant: ['lining-nums'] },
  p: { fontSize: 15, lineHeight: 22, color: colors.body, textAlign: 'center', fontFamily: fonts.regular },
  vendor: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius, padding: 14 },
  vendorOn: { borderColor: colors.gold, borderWidth: 2 },
  vName: { fontSize: 19, color: colors.ink, fontFamily: fonts.serif },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2, fontFamily: fonts.regular },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.field },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.body, fontFamily: fonts.bold },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.field, padding: 14, borderRadius: radius, fontSize: 15, fontFamily: fonts.regular, color: colors.ink },
  small: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, fontFamily: fonts.regular },
});

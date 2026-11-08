import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, getCase, updateCase, type CasePatch } from '../../lib/api';
import { CASE_STATUSES, eventLabel, formatWhen, isUrgent, type CaseDetail } from '../../lib/cases';
import { Button, Card, Centered, Label, PriorityBadge, StatusBadge } from '../../components/ui';
import { colors } from '../../lib/theme';

const MAX_TENANT_UPDATE = 1000;   // matches the pma_maintenance_requests check constraints
const MAX_INTERNAL_NOTES = 4000;

export default function CaseWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setCase] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [tenantUpdate, setTenantUpdate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getCase(String(id));
      setCase(d);
      setStatus(d.status);
      setTenantUpdate(d.tenantUpdate ?? '');
      setNotes(d.internalNotes ?? '');
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this case.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error && !c) return <Centered><Text>{error}</Text><Button label="Try again" onPress={load} /></Centered>;
  if (!c) return <Centered><Text>Loading case…</Text></Centered>;

  const patch: CasePatch = {};
  if (status !== c.status) patch.status = status;
  if (tenantUpdate.trim() !== (c.tenantUpdate ?? '')) patch.tenant_update = tenantUpdate.trim();
  if (notes.trim() !== (c.internalNotes ?? '')) patch.internal_notes = notes.trim();
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    if (!dirty || !c) return;
    setSaving(true);
    try {
      await updateCase(c.id, patch);
      await load();
      Alert.alert('Saved', patch.tenant_update !== undefined
        ? 'Case updated. The resident sees your update on their status page.'
        : 'Case updated.');
    } catch (e) {
      Alert.alert('Update failed', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  const urgent = isUrgent(c.priority);
  const where = [c.reportedAddress, c.reportedUnit && `Unit ${c.reportedUnit}`].filter(Boolean).join(' · ');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: c.caseNumber ? `Case ${c.caseNumber}` : 'Case' }} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {urgent ? (
          <View style={s.urgent} accessibilityRole="alert">
            <Ionicons name="warning" size={18} color="#fff" />
            <Text style={s.urgentText}>
              {c.isEmergency ? 'EMERGENCY. If anyone is in danger, make sure 911 has been called.' : 'Urgent priority.'}
            </Text>
          </View>
        ) : null}
        <View style={s.badges}><StatusBadge status={c.status} /><PriorityBadge priority={c.priority} /></View>
        {c.reportedName ? <Text style={s.title}>{c.reportedName}</Text> : null}
        {where ? <Text style={s.meta}>{where}</Text> : null}
        <Text style={s.meta}>Reported {formatWhen(c.createdAt)}{c.sourceChannel ? ` by ${c.sourceChannel}` : ''}</Text>

        <Label>DESCRIPTION</Label>
        <Card><Text style={s.desc}>{c.descriptionVerbatim || c.summary || 'No description recorded.'}</Text></Card>

        <Card style={{ gap: 6 }}>
          {c.category ? <Text style={s.info}>Category: {c.category}</Text> : null}
          <Text style={s.info}>
            Resident contact: {c.contactMethod ? `${c.contactMethod}${c.contactDestinationMasked ? ` (${c.contactDestinationMasked})` : ''}` : 'not collected'}
          </Text>
          {c.language && c.language !== 'en' ? <Text style={s.info}>Language: {c.language}</Text> : null}
          <Text style={s.info}>Provider: {c.vendorName ?? 'not assigned'}</Text>
          {c.scheduledStart ? (
            <Text style={s.info}>Scheduled: {formatWhen(c.scheduledStart)}{c.scheduledEnd ? ` – ${formatWhen(c.scheduledEnd)}` : ''}</Text>
          ) : null}
          {c.workOrderRef ? <Text style={s.info}>Work order: {c.workOrderRef}</Text> : null}
        </Card>

        <Label>STATUS</Label>
        <View style={s.statuses}>
          {CASE_STATUSES.map(st => (
            <Pressable
              key={st}
              disabled={saving}
              onPress={() => setStatus(st)}
              accessibilityRole="button"
              accessibilityState={{ selected: status === st }}
              style={[s.status, status === st && s.statusActive]}
            >
              <Text style={[s.statusText, status === st && { color: '#fff' }]}>{st}</Text>
            </Pressable>
          ))}
        </View>

        <Label>UPDATE FOR THE RESIDENT</Label>
        <TextInput
          multiline
          value={tenantUpdate}
          onChangeText={setTenantUpdate}
          maxLength={MAX_TENANT_UPDATE}
          style={s.input}
          placeholder="Shown to the resident on their status page"
          accessibilityLabel="Update for the resident"
        />
        <Text style={s.count}>{tenantUpdate.length}/{MAX_TENANT_UPDATE}</Text>

        <Label>INTERNAL NOTES (STAFF ONLY)</Label>
        <TextInput
          multiline
          value={notes}
          onChangeText={setNotes}
          maxLength={MAX_INTERNAL_NOTES}
          style={s.input}
          placeholder="Never shown to the resident"
          accessibilityLabel="Internal notes"
        />

        <Button label={dirty ? 'Save changes' : 'No changes'} onPress={save} busy={saving} disabled={!dirty} />
        <Text style={s.small}>
          Assign vendors and answer cost approvals from the web Management Dashboard.
        </Text>
        <Pressable onPress={() => Linking.openURL('https://pma.stellaruc.com/manager')} accessibilityRole="link">
          <Text style={s.link}>Open the web dashboard</Text>
        </Pressable>

        {c.timeline?.length ? (
          <>
            <Label>ACTIVITY TIMELINE</Label>
            <Card style={{ gap: 12 }}>
              {[...c.timeline].reverse().map((e, i) => (
                <View key={`${e.createdAt}-${i}`}>
                  <Text style={s.eventTitle}>{eventLabel(e.eventType)}</Text>
                  {e.body ? <Text style={s.eventBody}>{e.body}</Text> : null}
                  <Text style={s.meta}>{formatWhen(e.createdAt)}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  body: { padding: 20, gap: 10, paddingBottom: 48 },
  urgent: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.ember, padding: 12, borderRadius: 12 },
  urgentText: { color: '#fff', fontWeight: '800', flex: 1 },
  badges: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.navy },
  meta: { fontSize: 13, color: colors.muted },
  desc: { fontSize: 16, lineHeight: 23, color: colors.body },
  info: { fontSize: 14, color: colors.body },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.field },
  statusActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  statusText: { fontWeight: '800', color: colors.body },
  input: { backgroundColor: '#fff', minHeight: 100, textAlignVertical: 'top', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.field, fontSize: 15 },
  count: { fontSize: 11, color: colors.muted, textAlign: 'right' },
  small: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4 },
  link: { fontSize: 14, color: colors.teal, fontWeight: '800', textAlign: 'center' },
  eventTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  eventBody: { fontSize: 13, color: colors.body, marginTop: 2 },
});

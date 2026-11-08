import { useCallback, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, answerApproval, getCase, updateCase, type CasePatch } from '../../lib/api';
import { CASE_STATUSES, eventLabel, formatMoney, formatWhen, isUrgent, needsApproval, savedMessage, type CaseDetail } from '../../lib/cases';
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
  const [notify, setNotify] = useState(true);
  const [answering, setAnswering] = useState(false);
  const loadedOnce = useRef(false);

  // resetForm=false refreshes the case (e.g. after assigning a provider) without
  // throwing away an update or notes the manager is still typing.
  const load = useCallback(async (resetForm = true) => {
    try {
      const d = await getCase(String(id));
      setCase(d);
      if (resetForm) {
        setStatus(d.status);
        setTenantUpdate(d.tenantUpdate ?? '');
        setNotes(d.internalNotes ?? '');
        setNotify(true);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this case.');
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    load(!loadedOnce.current);
    loadedOnce.current = true;
  }, [load]));

  if (error && !c) return <Centered><Text>{error}</Text><Button label="Try again" onPress={() => load()} /></Centered>;
  if (!c) return <Centered><Text>Loading case…</Text></Centered>;

  const patch: CasePatch = {};
  if (status !== c.status) patch.status = status;
  if (tenantUpdate.trim() !== (c.tenantUpdate ?? '')) patch.tenant_update = tenantUpdate.trim();
  if (notes.trim() !== (c.internalNotes ?? '')) patch.internal_notes = notes.trim();
  const dirty = Object.keys(patch).length > 0;
  const canNotify = !!patch.tenant_update;
  const residentReachable = c.contactMethod === 'sms' || c.contactMethod === 'email';

  async function save() {
    if (!dirty || !c) return;
    setSaving(true);
    try {
      const body: CasePatch = canNotify && notify && residentReachable ? { ...patch, notify_resident: true } : patch;
      const r = await updateCase(c.id, body);
      await load();
      Alert.alert('Saved', savedMessage(!!patch.tenant_update, r.notification));
    } catch (e) {
      Alert.alert('Update failed', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  function confirmApproval(response: 'APPROVED' | 'DECLINED') {
    if (!c) return;
    const verb = response === 'APPROVED' ? 'Approve' : 'Decline';
    Alert.alert(`${verb} ${formatMoney(c.nteAmount)}?`, response === 'APPROVED'
      ? 'The provider can go ahead. A proposed visit time is confirmed and the case moves to Scheduled.'
      : 'The provider is told the work is not approved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb, style: response === 'DECLINED' ? 'destructive' : 'default', onPress: async () => {
          setAnswering(true);
          try {
            await answerApproval(c.id, response);
            await load(false);
          } catch (e) {
            Alert.alert('Not recorded', e instanceof ApiError ? e.message : 'Try again.');
          } finally {
            setAnswering(false);
          }
        },
      },
    ]);
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

        {needsApproval(c) ? (
          <View style={s.approval} accessibilityRole="alert">
            <Text style={s.approvalTitle}>Cost approval needed</Text>
            <Text style={s.info}>
              The provider's quote{c.nteAmount != null ? ` of ${formatMoney(c.nteAmount)}` : ''} is over the pre-approved limit for this property.
            </Text>
            <View style={s.approvalRow}>
              <Button label="Approve" icon="checkmark" onPress={() => confirmApproval('APPROVED')} busy={answering} style={{ flex: 1 }} />
              <Button label="Decline" tone="ghost" onPress={() => confirmApproval('DECLINED')} disabled={answering} style={{ flex: 1 }} />
            </View>
          </View>
        ) : c.nteAmount != null && c.approvalState && c.approvalState !== 'NOT_REQUIRED' ? (
          <Text style={s.meta}>Cost {formatMoney(c.nteAmount)}: {c.approvalState.toLowerCase()}</Text>
        ) : null}

        <Label>DESCRIPTION</Label>
        <Card><Text style={s.desc}>{c.descriptionVerbatim || c.summary || 'No description recorded.'}</Text></Card>

        <Card style={{ gap: 6 }}>
          {c.category ? <Text style={s.info}>Category: {c.category}</Text> : null}
          <Text style={s.info}>
            Resident contact: {c.contactMethod ? `${c.contactMethod}${c.contactDestinationMasked ? ` (${c.contactDestinationMasked})` : ''}` : 'not collected'}
          </Text>
          {c.language && c.language !== 'en' ? <Text style={s.info}>Language: {c.language}</Text> : null}
        </Card>

        <Label>SERVICE PROVIDER</Label>
        <Card style={{ gap: 6 }}>
          <Text style={s.provider}>{c.vendorName ?? 'Not assigned'}</Text>
          {c.scheduledStart ? (
            <Text style={s.info}>Visit: {formatWhen(c.scheduledStart)}{c.scheduledEnd ? ` – ${formatWhen(c.scheduledEnd)}` : ''}</Text>
          ) : c.vendorName ? <Text style={s.meta}>No visit time yet</Text> : null}
          {c.workOrderRef ? <Text style={s.info}>Work order: {c.workOrderRef}</Text> : null}
          <Button
            label={c.vendorName ? 'Change provider or time' : 'Assign provider'}
            icon="construct"
            tone={c.vendorName ? 'ghost' : 'primary'}
            onPress={() => router.push({ pathname: '/manager/assign', params: { id: c.id, vendorId: c.vendorId ?? '', caseNumber: c.caseNumber ?? '' } })}
            style={{ marginTop: 6 }}
          />
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
        {canNotify ? (
          residentReachable ? (
            <Pressable
              style={s.notify} onPress={() => setNotify(n => !n)}
              accessibilityRole="checkbox" accessibilityState={{ checked: notify }}
            >
              <Ionicons name={notify ? 'checkbox' : 'square-outline'} size={22} color={notify ? colors.teal : colors.muted} />
              <Text style={s.notifyText}>
                Also send this update to the resident by {c.contactMethod === 'sms' ? 'text' : 'email'}{c.contactDestinationMasked ? ` (${c.contactDestinationMasked})` : ''}
              </Text>
            </Pressable>
          ) : (
            <Text style={s.meta}>The resident didn't choose text or email, so they'll see this on their status page only.</Text>
          )
        ) : null}

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
          Add or edit providers and pre-approval limits in the web Management Dashboard.
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
  approval: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#93C5FD', borderRadius: 14, padding: 14, gap: 8 },
  approvalTitle: { fontSize: 16, fontWeight: '800', color: '#1E3A8A' },
  approvalRow: { flexDirection: 'row', gap: 10 },
  provider: { fontSize: 16, fontWeight: '800', color: colors.ink },
  notify: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 },
  notifyText: { flex: 1, fontSize: 14, color: colors.body },
  eventTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  eventBody: { fontSize: 13, color: colors.body, marginTop: 2 },
});

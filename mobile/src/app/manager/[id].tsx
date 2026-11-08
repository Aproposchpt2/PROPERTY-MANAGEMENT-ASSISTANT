import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, answerApproval, getCase, updateCase, type CasePatch } from '../../lib/api';
import { eventLabel, formatMoney, formatWhen, isUrgent, needsApproval, savedMessage, type CaseDetail } from '../../lib/cases';
import { Button, Card, Centered, Label, PriorityBadge, StatusBadge } from '../../components/ui';
import { colors, fonts, radius } from '../../lib/theme';
import { confirmAction, showMessage } from '../../lib/dialog';

import { EntrySelect, SectionTabs } from '../../components/manager-controls';
import { MANAGER_STATUSES, TENANT_UPDATE_PRESETS, INTERNAL_NOTE_PRESETS } from '../../lib/manager-entries';

const CASE_TABS = ['Overview', 'Update', 'Provider', 'Activity'] as const;

const MAX_TENANT_UPDATE = 1000;   // matches the pma_maintenance_requests check constraints
const MAX_INTERNAL_NOTES = 4000;

export default function CaseWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<(typeof CASE_TABS)[number]>('Overview');
  const [c, setCase] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [tenantUpdate, setTenantUpdate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [notify, setNotify] = useState(true);
  const [answering, setAnswering] = useState(false);
  const loadedCaseId = useRef<string | null>(null);
  const previousStatus = useRef<string | null>(null);

  // resetForm=false refreshes the case (e.g. after assigning a provider) without
  // throwing away an update or notes the manager is still typing.
  const load = useCallback(async (resetForm = true) => {
    try {
      const d = await getCase(String(id));
      setCase(d);
      const wasStatus = previousStatus.current;
      previousStatus.current = d.status;
      if (!resetForm) setStatus(value => value === wasStatus ? d.status : value);
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
    load(loadedCaseId.current !== id);
    loadedCaseId.current = id;
  }, [load, id]));

  if (error && !c) return <Centered><Text style={{ color: colors.body, fontFamily: fonts.regular }}>{error}</Text><Button label="Try again" onPress={() => load()} /></Centered>;
  if (!c) return <Centered><Text style={{ color: colors.body, fontFamily: fonts.regular }}>Loading case…</Text></Centered>;

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
      showMessage('Saved', savedMessage(!!patch.tenant_update, r.notification));
    } catch (e) {
      showMessage('Update failed', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmApproval(response: 'APPROVED' | 'DECLINED') {
    if (!c) return;
    const verb = response === 'APPROVED' ? 'Approve' : 'Decline';
    const ok = await confirmAction(
      `${verb} ${formatMoney(c.nteAmount)}?`,
      response === 'APPROVED'
        ? 'The work is approved. If the provider proposed a visit time, it is confirmed and the case moves to Scheduled.'
        : 'The quote is marked declined. Contact the provider about next steps.',
      verb,
      response === 'DECLINED',
    );
    if (!ok) return;
    setAnswering(true);
    try {
      await answerApproval(c.id, response);
      await load(false);
    } catch (e) {
      showMessage('Not recorded', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setAnswering(false);
    }
  }

  const urgent = isUrgent(c.priority);
  const where = [c.reportedAddress, c.reportedUnit && `Unit ${c.reportedUnit}`].filter(Boolean).join(' · ');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: c.caseNumber ? `Case ${c.caseNumber}` : 'Case' }} />
      <SectionTabs items={CASE_TABS} value={tab} onChange={setTab} />
      <ScrollView key={`${id}-${tab}`} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {error ? <Text style={s.meta} accessibilityRole="alert">{error}</Text> : null}
        {tab === 'Overview' ? <>
        <Text style={s.title}>Case {c.caseNumber || '—'}</Text>
        {urgent ? (
          <View style={s.urgent} accessibilityRole="alert">
            <Ionicons name="warning" size={18} color={colors.ivory} />
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
              The provider&apos;s quote{c.nteAmount != null ? ` of ${formatMoney(c.nteAmount)}` : ''} is over the pre-approved limit for this property.
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

        </> : null}
        {tab === 'Provider' ? <>
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

        </> : null}
        {tab === 'Update' ? <>
        <Label>STATUS</Label>
        <EntrySelect label="Status" options={MANAGER_STATUSES} value={status} onSelect={setStatus} disabled={saving} />

        <Label>UPDATE FOR THE RESIDENT</Label>
        <EntrySelect label="Choose a tenant update" options={TENANT_UPDATE_PRESETS} onSelect={setTenantUpdate} disabled={saving} />
        <TextInput placeholderTextColor={colors.muted}
          multiline
          editable={!saving}
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
              <Ionicons name={notify ? 'checkbox' : 'square-outline'} size={22} color={notify ? colors.gold : colors.muted} />
              <Text style={s.notifyText}>
                Also send this update to the resident by {c.contactMethod === 'sms' ? 'text' : 'email'}{c.contactDestinationMasked ? ` (${c.contactDestinationMasked})` : ''}
              </Text>
            </Pressable>
          ) : (
            <Text style={s.meta}>The resident didn&apos;t choose text or email, so they&apos;ll see this on their status page only.</Text>
          )
        ) : null}

        <Label>INTERNAL NOTES (STAFF ONLY)</Label>
        <EntrySelect label="Choose an internal note" options={INTERNAL_NOTE_PRESETS} onSelect={setNotes} disabled={saving} />
        <TextInput placeholderTextColor={colors.muted}
          multiline
          editable={!saving}
          value={notes}
          onChangeText={setNotes}
          maxLength={MAX_INTERNAL_NOTES}
          style={s.input}
          placeholder="Never shown to the resident"
          accessibilityLabel="Internal notes"
        />

        <Button label={dirty ? 'Save changes' : 'No changes'} onPress={save} busy={saving} disabled={!dirty} />
        </> : null}
        {tab === 'Activity' ? <>
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
        ) : <Text style={s.meta}>No activity yet.</Text>}
        </> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  body: { padding: 20, gap: 10, paddingBottom: 48 },
  urgent: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.urgent, padding: 12, borderRadius: radius },
  urgentText: { color: colors.ivory, flex: 1, fontFamily: fonts.bold },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  title: { fontSize: 28, color: colors.ivory, fontFamily: fonts.serif },
  meta: { fontSize: 13, color: colors.muted, fontFamily: fonts.regular },
  desc: { fontSize: 16, lineHeight: 23, color: colors.body, fontFamily: fonts.regular },
  info: { fontSize: 14, color: colors.body, fontFamily: fonts.regular },
  input: { backgroundColor: colors.card, minHeight: 100, textAlignVertical: 'top', padding: 14, borderRadius: radius, borderWidth: 1, borderColor: colors.field, fontSize: 15, fontFamily: fonts.regular, color: colors.ink },
  count: { fontSize: 11, color: colors.muted, textAlign: 'right', fontFamily: fonts.regular },
  approval: { backgroundColor: colors.goldDeep, borderWidth: 1, borderColor: colors.gold, borderRadius: radius, padding: 14, gap: 8 },
  approvalTitle: { fontSize: 20, color: colors.goldLight, fontFamily: fonts.serif },
  approvalRow: { flexDirection: 'row', gap: 10 },
  provider: { fontSize: 20, color: colors.ink, fontFamily: fonts.serif },
  notify: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 },
  notifyText: { flex: 1, fontSize: 14, color: colors.body, fontFamily: fonts.regular },
  eventTitle: { fontSize: 14, color: colors.ink, fontFamily: fonts.bold },
  eventBody: { fontSize: 13, color: colors.body, marginTop: 2, fontFamily: fonts.regular },
});

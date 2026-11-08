import { useCallback, useEffect, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getPortalCase } from '../lib/api';
import { CASE_STATUSES, eventLabel, formatWhen, parseStatusToken, statusStep, type PortalCase } from '../lib/cases';
import { forgetCase, rememberCase } from '../lib/recent';
import { Button, Card, Centered, EmergencyNote, Label, StatusBadge } from '../components/ui';
import { colors } from '../lib/theme';

// Resident case view. Opened from the resident screen or a pma://status?t=TOKEN link.
export default function CaseStatus() {
  const params = useLocalSearchParams<{ t?: string }>();
  const token = parseStatusToken(typeof params.t === 'string' ? params.t : '');
  const [data, setData] = useState<PortalCase | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setState('invalid'); return; }
    try {
      const d = await getPortalCase(token);
      setData(d);
      setState('ready');
      rememberCase({ token, caseNumber: d.caseNumber, status: d.status, seenAt: new Date().toISOString() }).catch(() => {});
    } catch (e: any) {
      if (e?.status === 404 || e?.status === 400) {
        setState('invalid');
        forgetCase(token).catch(() => {});
      } else {
        setState(prev => (prev === 'ready' ? 'ready' : 'error'));
      }
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  // Refresh when the app returns to the foreground and once a minute while open, like the web portal.
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') load(); }, 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [load]);

  if (state === 'loading') return <Centered><Text>Loading your case…</Text></Centered>;
  if (state === 'invalid') {
    return (
      <Centered>
        <Ionicons name="link" size={40} color={colors.muted} />
        <Text style={s.center}>This status link is not valid or has expired. Use the most recent link from your text or email, or call the property line.</Text>
        <Button label="Back" tone="ghost" onPress={() => router.back()} />
      </Centered>
    );
  }
  if (state === 'error' || !data) {
    return (
      <Centered>
        <Text style={s.center}>We couldn't load your case right now.</Text>
        <Button label="Try again" onPress={() => { setState('loading'); load(); }} />
      </Centered>
    );
  }

  const tz = data.propertyTimezone;
  const step = statusStep(data.status);
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  return (
    <ScrollView contentContainerStyle={s.wrap} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={s.caseNo}>Case {data.caseNumber}</Text>
      <Text style={s.meta}>Reported {formatWhen(data.createdAt, tz)}</Text>
      <StatusBadge status={data.status} />
      {data.isEmergency ? (
        <View style={s.urgent} accessibilityRole="alert">
          <Ionicons name="warning" size={18} color="#fff" />
          <Text style={s.urgentText}>Marked urgent. Your property team has been alerted.</Text>
        </View>
      ) : null}

      <Card style={{ gap: 10 }}>
        {CASE_STATUSES.map((st, i) => {
          const done = step >= 0 && i <= step;
          return (
            <View key={st} style={s.stepRow} accessibilityLabel={`${st}${done ? ', done' : ''}`}>
              <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={done ? colors.teal : colors.field} />
              <Text style={[s.stepText, done && s.stepDone, i === step && { color: colors.teal }]}>{st}</Text>
            </View>
          );
        })}
      </Card>

      {data.tenantUpdate ? (
        <>
          <Label>LATEST UPDATE FROM YOUR PROPERTY TEAM</Label>
          <Card><Text style={s.body}>{data.tenantUpdate}</Text></Card>
        </>
      ) : null}

      {data.vendorName || data.scheduledStart ? (
        <>
          <Label>SERVICE VISIT</Label>
          <Card style={{ gap: 6 }}>
            {data.vendorName ? <Text style={s.body}>Provider: {data.vendorName}</Text> : null}
            {data.scheduledStart ? (
              <Text style={s.body}>
                Scheduled: {formatWhen(data.scheduledStart, tz)}{data.scheduledEnd ? ` – ${formatWhen(data.scheduledEnd, tz)}` : ''}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {data.completedAt ? <Text style={s.meta}>Completed {formatWhen(data.completedAt, tz)}</Text> : null}

      {data.timeline?.length ? (
        <>
          <Label>ACTIVITY</Label>
          <Card style={{ gap: 10 }}>
            {[...data.timeline].reverse().map((e, i) => (
              <View key={`${e.createdAt}-${i}`}>
                <Text style={s.eventTitle}>{eventLabel(e.eventType)}</Text>
                <Text style={s.meta}>{formatWhen(e.createdAt, tz)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <EmergencyNote />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 12, paddingBottom: 40 },
  center: { textAlign: 'center', fontSize: 15, color: colors.body, lineHeight: 22 },
  caseNo: { fontSize: 26, fontWeight: '800', color: colors.navy },
  meta: { fontSize: 13, color: colors.muted },
  urgent: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.ember, padding: 12, borderRadius: 12 },
  urgentText: { color: '#fff', fontWeight: '800', flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepText: { fontSize: 15, color: colors.muted },
  stepDone: { color: colors.ink, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, color: colors.body },
  eventTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
});

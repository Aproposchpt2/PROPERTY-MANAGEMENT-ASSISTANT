import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, listCases } from '../../lib/api';
import { QUEUE_FILTERS, caseCounts, filterCases, formatMoney, formatWhen, isUrgent, needsApproval, type CaseSummary, type QueueFilter } from '../../lib/cases';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/session';
import { Button, Centered, PriorityBadge, StatusBadge } from '../../components/ui';
import { colors } from '../../lib/theme';
import { registerForPush, unregisterPush } from '../../lib/push';

let pushRegistered = false; // once per app session and sign-in

export default function ManagerDashboard() {
  const { session } = useSession();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('All');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCases(await listCases());
      setError(null);
      // The server has just confirmed manager access: register this phone for alerts once per sign-in.
      if (!pushRegistered) {
        pushRegistered = true;
        registerForPush().catch(() => {});
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Something went wrong. Try again.'));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const counts = useMemo(() => caseCounts(cases), [cases]);
  const approvals = useMemo(() => cases.filter(needsApproval).length, [cases]);
  const visible = useMemo(() => filterCases(cases, filter), [cases, filter]);
  // Stop alerts to this phone first, while the session can still authorize the request.
  const signOut = async () => {
    await unregisterPush();
    pushRegistered = false;
    await supabase.auth.signOut();
  };

  const header = <Stack.Screen options={{
    headerRight: () => (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => router.push('/manager/alerts')} accessibilityRole="button" accessibilityLabel="Alerts" hitSlop={10} style={{ paddingHorizontal: 10 }}>
          <Ionicons name="notifications-outline" size={22} color="#fff" />
        </Pressable>
        <Pressable onPress={signOut} accessibilityRole="button" hitSlop={10} style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Sign out</Text>
        </Pressable>
      </View>
    ),
  }} />;

  // Signed in, but the server says this account has no manager role or no access to this property.
  if (error && (error.status === 403 || error.status === 401)) {
    return (
      <Centered>
        {header}
        <Ionicons name="lock-closed" size={40} color={colors.muted} />
        <Text style={s.centerText}>
          {error.status === 403
            ? `${session?.user.email ?? 'This account'} does not have manager access to this property. Ask an owner or administrator to add you.`
            : error.message}
        </Text>
        <Button label="Sign out" tone="navy" onPress={signOut} />
      </Centered>
    );
  }
  if (!loaded) return <Centered>{header}<Text>Loading cases…</Text></Centered>;

  return (
    <View style={s.page}>
      {header}
      <FlatList
        data={visible}
        keyExtractor={c => c.id}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <>
            <Text style={s.eyebrow}>PROPERTY MANAGEMENT ASSISTANT</Text>
            <Text style={s.subtitle}>Monitor incidents, prioritize response and keep everyone updated.</Text>
            {error ? <Text style={s.error}>{error.message} Pull down to retry.</Text> : null}
            <View style={s.metrics}>
              <Metric label="Active" value={counts.active} icon="pulse" color={colors.teal} onPress={() => setFilter('All')} />
              <Metric label="New" value={counts.new} icon="notifications" color={colors.blue} onPress={() => setFilter('New')} />
              <Metric label="Urgent" value={counts.urgent} icon="warning" color={colors.ember} onPress={() => setFilter('Urgent')} />
              <Metric label="Resolved" value={counts.resolved} icon="checkmark-circle" color={colors.green} onPress={() => setFilter('Resolved')} />
            </View>
            {approvals > 0 ? (
              <Pressable style={s.approvals} onPress={() => setFilter('Approval')} accessibilityRole="button">
                <Ionicons name="cash" size={20} color="#1E3A8A" />
                <Text style={s.approvalsText}>
                  {approvals} cost approval{approvals === 1 ? '' : 's'} waiting for you
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#1E3A8A" />
              </Pressable>
            ) : null}
            <Text style={s.section}>Incident Queue</Text>
            <View style={s.filters}>
              {QUEUE_FILTERS.map(f => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f }}
                  style={[s.chip, filter === f && s.chipActive]}
                >
                  <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f}</Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="checkmark-done-circle" size={42} color="#94A3B8" />
            <Text style={s.emptyText}>No cases in this view.</Text>
          </View>
        }
        renderItem={({ item }) => <CaseRow item={item} />}
      />
    </View>
  );
}

function CaseRow({ item }: { item: CaseSummary }) {
  const urgent = isUrgent(item.priority);
  const where = [item.reportedAddress, item.reportedUnit && `Unit ${item.reportedUnit}`].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Case ${item.caseNumber ?? ''}, ${item.status}${urgent ? ', urgent' : ''}`}
      style={[s.card, urgent && s.cardUrgent]}
      onPress={() => router.push({ pathname: '/manager/[id]', params: { id: item.id } })}
    >
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>Case {item.caseNumber ?? '—'}{item.reportedName ? ` · ${item.reportedName}` : ''}</Text>
          {where ? <Text style={s.meta}>{where}</Text> : null}
          <Text style={s.meta}>{formatWhen(item.updatedAt || item.createdAt)}</Text>
        </View>
        <PriorityBadge priority={item.priority} />
      </View>
      <View style={s.cardBottom}>
        <StatusBadge status={item.status} />
        {needsApproval(item) ? (
          <View style={s.approvalBadge}><Text style={s.approvalBadgeText}>APPROVAL {formatMoney(item.nteAmount)}</Text></View>
        ) : null}
        {item.vendorName ? <Text style={s.vendor} numberOfLines={1}>{item.vendorName}</Text> : null}
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function Metric({ label, value, icon, color, onPress }: {
  label: string; value: number; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void;
}) {
  return (
    <Pressable style={s.metric} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${value} ${label}`}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={s.metricValue}>{value}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: 16, paddingBottom: 40 },
  centerText: { textAlign: 'center', fontSize: 15, lineHeight: 22, color: colors.body },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1, color: colors.teal, marginTop: 4 },
  subtitle: { fontSize: 15, lineHeight: 21, color: '#52606D', marginTop: 5, marginBottom: 14 },
  error: { color: colors.emberDark, marginBottom: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, flexBasis: '45%', backgroundColor: '#fff', padding: 15, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  metricValue: { fontSize: 27, fontWeight: '800', color: colors.ink, marginTop: 6 },
  metricLabel: { fontSize: 13, color: colors.muted },
  section: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 24, marginBottom: 10 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.line },
  chipActive: { backgroundColor: colors.navy },
  chipText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  chipTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  cardUrgent: { borderColor: '#FDBA74', borderLeftWidth: 5, borderLeftColor: colors.ember },
  cardTop: { flexDirection: 'row', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  vendor: { flex: 1, fontSize: 12, color: colors.muted, textAlign: 'right' },
  approvals: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#93C5FD', borderRadius: 12, padding: 14, marginTop: 12 },
  approvalsText: { flex: 1, fontWeight: '800', color: '#1E3A8A' },
  approvalBadge: { backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  approvalBadgeText: { fontSize: 10, fontWeight: '900', color: '#1E3A8A' },
  empty: { alignItems: 'center', padding: 36, gap: 8 },
  emptyText: { color: colors.muted },
});

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, listCases } from '../../lib/api';
import { QUEUE_FILTERS, caseCounts, filterCases, formatMoney, formatWhen, isUrgent, needsApproval, type CaseSummary, type QueueFilter } from '../../lib/cases';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/session';
import { Button, Centered, PriorityBadge, StatusBadge } from '../../components/ui';
import { colors, fonts, radius } from '../../lib/theme';
import { registerForPush, unregisterPush } from '../../lib/push';
import { unregisterWebPush } from '../../lib/webpush';
import { BUSINESS_NAME } from '../../lib/config';

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
      // (Browsers wait for a tap on the Alerts screen; they can't be asked without one.)
      if (!pushRegistered && Platform.OS !== 'web') {
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
  // Stop alerts to this phone or browser first, while the session can still authorize the request.
  const signOut = async () => {
    await (Platform.OS === 'web' ? unregisterWebPush() : unregisterPush());
    pushRegistered = false;
    await supabase.auth.signOut();
  };

  const header = <Stack.Screen options={{
    headerRight: () => (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => router.push('/manager/alerts')} accessibilityRole="button" accessibilityLabel="Alerts" hitSlop={10} style={{ paddingHorizontal: 10 }}>
          <Ionicons name="notifications-outline" size={22} color={colors.ivory} />
        </Pressable>
        <Pressable onPress={signOut} accessibilityRole="button" hitSlop={10} style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: colors.goldLight, fontFamily: fonts.bold }}>Sign out</Text>
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
            ? `${session?.user.email ?? 'This account'} does not have access to this property's team dashboard. Ask your account owner or administrator to add you.`
            : error.message}
        </Text>
        <Button label="Sign out" tone="navy" onPress={signOut} />
      </Centered>
    );
  }
  if (!loaded) return <Centered>{header}<Text style={{ color: colors.body, fontFamily: fonts.regular }}>Loading cases…</Text></Centered>;

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
            <Text style={s.eyebrow}>{BUSINESS_NAME ? BUSINESS_NAME.toUpperCase() : 'PROPERTY MANAGEMENT ASSISTANT'}</Text>
            <Text style={s.subtitle}>Monitor incidents, prioritize response and keep everyone updated.</Text>
            {error ? <Text style={s.error}>{error.message} Pull down to retry.</Text> : null}
            <View style={s.metrics}>
              <Metric label="Active" value={counts.active} icon="pulse" color={colors.gold} onPress={() => setFilter('All')} />
              <Metric label="New" value={counts.new} icon="notifications" color={colors.goldLight} onPress={() => setFilter('New')} />
              <Metric label="Urgent" value={counts.urgent} icon="warning" color={colors.urgent} onPress={() => setFilter('Urgent')} />
              <Metric label="Resolved" value={counts.resolved} icon="checkmark-circle" color={colors.ivory} onPress={() => setFilter('Resolved')} />
            </View>
            {approvals > 0 ? (
              <Pressable style={s.approvals} onPress={() => setFilter('Approval')} accessibilityRole="button">
                <Ionicons name="cash" size={20} color={colors.goldLight} />
                <Text style={s.approvalsText}>
                  {approvals} cost approval{approvals === 1 ? '' : 's'} waiting for you
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.goldLight} />
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
            <Ionicons name="checkmark-done-circle" size={42} color={colors.muted} />
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
  centerText: { textAlign: 'center', fontSize: 15, lineHeight: 22, color: colors.body, fontFamily: fonts.regular },
  eyebrow: { fontSize: 10, letterSpacing: 1.1, color: colors.gold, marginTop: 4, fontFamily: fonts.label },
  subtitle: { fontSize: 15, lineHeight: 21, color: colors.body, marginTop: 5, marginBottom: 14, fontFamily: fonts.regular },
  error: { color: colors.urgentText, marginBottom: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, padding: 15, borderRadius: radius, borderWidth: 1, borderColor: colors.line },
  metricValue: { fontSize: 28, color: colors.ink, marginTop: 6, fontFamily: fonts.bold },
  metricLabel: { fontSize: 13, color: colors.muted, fontFamily: fonts.regular },
  section: { fontSize: 24, color: colors.ink, marginTop: 24, marginBottom: 10, fontFamily: fonts.serif },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius, backgroundColor: colors.line },
  chipActive: { backgroundColor: colors.gold },
  chipText: { fontSize: 12, color: colors.body, fontFamily: fonts.bold },
  chipTextActive: { color: colors.onAccent },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  cardUrgent: { borderColor: colors.urgent, borderLeftWidth: 5, borderLeftColor: colors.urgent },
  cardTop: { flexDirection: 'row', gap: 10 },
  cardTitle: { fontSize: 20, color: colors.ink, fontFamily: fonts.serif, fontVariant: ['lining-nums'] },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4, fontFamily: fonts.regular },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  vendor: { flex: 1, fontSize: 12, color: colors.muted, textAlign: 'right', fontFamily: fonts.regular },
  approvals: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.goldDeep, borderWidth: 1, borderColor: colors.gold, borderRadius: radius, padding: 14, marginTop: 12 },
  approvalsText: { flex: 1, color: colors.goldLight, fontFamily: fonts.bold },
  approvalBadge: { backgroundColor: colors.goldDeep, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius },
  approvalBadgeText: { fontSize: 10, color: colors.goldLight, fontFamily: fonts.bold },
  empty: { alignItems: 'center', padding: 36, gap: 8 },
  emptyText: { color: colors.muted },
});

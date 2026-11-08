import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View, Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PHONE_FILTERS, filterCases, formatMoney, formatWhen, isUrgent, needsApproval, type CaseSummary, type QueueFilter } from '../lib/cases';
import { useManagerCases } from '../lib/manager-cases';
import { useSession } from '../lib/session';
import { Button, Centered, PriorityBadge, StatusBadge } from './ui';
import { SectionTabs } from './manager-controls';
import { colors, fonts, radius } from '../lib/theme';
import { BUSINESS_NAME } from '../lib/config';

export function CaseQueue({ approvalsOnly = false }: { approvalsOnly?: boolean }) {
  const { cases, loading, loaded, error, refresh, signOut } = useManagerCases();
  const { session } = useSession();
  const [filter, setFilter] = useState<QueueFilter>('Open');
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const visible = useMemo(() => filterCases(cases, approvalsOnly ? 'Approval' : filter), [cases, filter, approvalsOnly]);
  if (error && (error.status === 401 || error.status === 403)) return <Centered>
    <Ionicons name="lock-closed" size={40} color={colors.muted} />
    <Text style={s.centerText}>{error.status === 403
      ? `${session?.user.email ?? 'This account'} does not have access to this property's team dashboard. Ask your account owner or administrator to add you.`
      : error.message}</Text>
    <Button label="Sign out" tone="navy" onPress={signOut} />
  </Centered>;
  if (!loaded) return <Centered><Text style={s.centerText}>Loading cases…</Text></Centered>;
  return <View style={s.page}>
    {!approvalsOnly ? <SectionTabs items={PHONE_FILTERS} value={filter} onChange={setFilter} /> : null}
    <FlatList data={visible} keyExtractor={c => c.id} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.gold} />}
      ListHeaderComponent={<>
        <Text style={s.eyebrow}>{BUSINESS_NAME ? BUSINESS_NAME.toUpperCase() : 'PROPERTY MANAGEMENT ASSISTANT'}</Text>
        <Text style={s.subtitle}>{approvalsOnly ? 'Review cases waiting on cost approval.' : 'Incident queue'}</Text>
        {error ? <><Text style={s.error}>{error.message}</Text><Button label="Try again" tone="ghost" onPress={refresh} /></> : null}
      </>}
      ListEmptyComponent={<View style={s.empty}><Ionicons name="checkmark-done-circle" size={42} color={colors.muted} />
        <Text style={s.emptyText}>{error ? 'Cases could not be loaded.' : approvalsOnly ? 'No cost approvals waiting.' : 'No cases in this view.'}</Text></View>}
      renderItem={({ item }) => <CaseRow item={item} />} />
  </View>;
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

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: 16, paddingBottom: 40 },
  centerText: { textAlign: 'center', fontSize: 15, lineHeight: 22, color: colors.body, fontFamily: fonts.regular },
  eyebrow: { fontSize: 10, letterSpacing: 1.1, color: colors.gold, marginTop: 4, fontFamily: fonts.label },
  subtitle: { fontSize: 15, lineHeight: 21, color: colors.body, marginTop: 5, marginBottom: 14, fontFamily: fonts.regular },
  error: { color: colors.urgentText, marginBottom: 10 },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  cardUrgent: { borderColor: colors.urgent, borderLeftWidth: 5, borderLeftColor: colors.urgent },
  cardTop: { flexDirection: 'row', gap: 10 },
  cardTitle: { fontSize: 20, color: colors.ink, fontFamily: fonts.serif, fontVariant: ['lining-nums'] },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4, fontFamily: fonts.regular },
  cardBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 },
  vendor: { flex: 1, fontSize: 12, color: colors.muted, textAlign: 'right', fontFamily: fonts.regular },
  approvalBadge: { backgroundColor: colors.goldDeep, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius },
  approvalBadgeText: { fontSize: 10, color: colors.goldLight, fontFamily: fonts.bold },
  empty: { alignItems: 'center', padding: 36, gap: 8 },
  emptyText: { color: colors.muted },
});

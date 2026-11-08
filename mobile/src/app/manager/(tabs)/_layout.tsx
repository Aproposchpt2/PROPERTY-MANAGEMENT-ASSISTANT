import { useCallback } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ManagerCasesProvider, useManagerCases } from '../../../lib/manager-cases';
import { needsApproval } from '../../../lib/cases';
import { colors, fonts } from '../../../lib/theme';

function TeamTabs() {
  const { cases, refresh } = useManagerCases();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const approvals = cases.filter(needsApproval).length;
  return <Tabs screenOptions={{
    headerStyle: { backgroundColor: colors.header }, headerTintColor: colors.goldLight,
    headerTitleStyle: { fontFamily: fonts.serif, color: colors.ivory, fontSize: 22 },
    tabBarStyle: { backgroundColor: colors.header, borderTopColor: colors.line },
    tabBarActiveTintColor: colors.goldLight, tabBarInactiveTintColor: colors.muted,
    tabBarLabelStyle: { fontFamily: fonts.regular, fontSize: 12 },
    tabBarBadgeStyle: { backgroundColor: colors.gold, color: colors.onAccent },
    sceneStyle: { backgroundColor: colors.page },
  }} screenListeners={{ focus: () => { void refresh(); } }}>
    <Tabs.Screen name="index" options={{ title: 'Cases', tabBarIcon: ({ focused, size }) => <Ionicons name="list-outline" color={focused ? colors.goldLight : colors.muted} size={size} /> }} />
    <Tabs.Screen name="approvals" options={{ title: 'Approvals', tabBarBadge: approvals || undefined,
      tabBarIcon: ({ focused, size }) => <Ionicons name="checkmark-circle-outline" color={focused ? colors.goldLight : colors.muted} size={size} /> }} />
    <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: ({ focused, size }) => <Ionicons name="notifications-outline" color={focused ? colors.goldLight : colors.muted} size={size} /> }} />
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ focused, size }) => <Ionicons name="person-circle-outline" color={focused ? colors.goldLight : colors.muted} size={size} /> }} />
  </Tabs>;
}
export default function TabLayout() {
  return <ManagerCasesProvider><TeamTabs /></ManagerCasesProvider>;
}

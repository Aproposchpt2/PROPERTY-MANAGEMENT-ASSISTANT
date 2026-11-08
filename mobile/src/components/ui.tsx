import type { ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../lib/theme';
import { isUrgent } from '../lib/cases';

type ButtonProps = {
  label: string;
  onPress: () => void;
  // primary: solid gold (the site's .btn.primary); ember: same, for the main resident action;
  // navy: gold outline (the site's .btn.outline); ghost: quiet outline.
  tone?: 'primary' | 'ember' | 'navy' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, tone = 'primary', icon, disabled, busy, style }: ButtonProps) {
  const solid = tone === 'primary' || tone === 'ember';
  const fg = solid ? colors.onAccent : tone === 'navy' ? colors.goldLight : colors.ivory;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        solid ? s.solid : tone === 'navy' ? s.outline : s.ghost,
        { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={s.btnRow}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// PMA is not an emergency service. This wording stays visible wherever residents report or track issues.
export function EmergencyNote() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Life-threatening emergency? Call 911 first."
      onPress={() => Linking.openURL('tel:911')}
      style={s.emergency}
    >
      <Ionicons name="warning" size={20} color={colors.urgentText} />
      <Text style={s.emergencyText}>
        Fire, gas smell, flooding near electricity or anyone in danger? Leave the area and call 911 first. PMA does not replace emergency services.
      </Text>
    </Pressable>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const done = status === 'Completed' || status === 'Closed';
  return (
    <View style={[s.badge, done && s.badgeDone]}>
      <Text style={[s.badgeText, done && { color: colors.ivory }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  const urgent = isUrgent(priority);
  return (
    <View style={[s.priority, urgent && s.priorityUrgent]}>
      {urgent ? <Ionicons name="warning" size={11} color={colors.urgentText} /> : null}
      <Text style={[s.priorityText, urgent && { color: colors.urgentText }]}>{priority.toUpperCase()}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={s.center}>{children}</View>;
}

const s = StyleSheet.create({
  btn: { paddingVertical: 15, paddingHorizontal: 18, borderRadius: radius, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  solid: { backgroundColor: colors.gold },
  outline: { borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'transparent' },
  ghost: { borderWidth: 1, borderColor: colors.line, backgroundColor: 'transparent' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnText: { fontFamily: fonts.bold, fontSize: 15, letterSpacing: 0.2 },
  emergency: { flexDirection: 'row', gap: 10, backgroundColor: colors.urgentSoft, borderColor: colors.urgent, borderWidth: 1, padding: 14, borderRadius: radius },
  emergencyText: { flex: 1, color: colors.urgentText, fontSize: 14, lineHeight: 20, fontFamily: fonts.medium },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.goldDeep, borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius },
  badgeDone: { backgroundColor: colors.charcoal, borderColor: colors.line },
  badgeText: { color: colors.goldLight, fontSize: 9, fontFamily: fonts.label, letterSpacing: 0.8 },
  priority: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.charcoal, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius },
  priorityUrgent: { backgroundColor: colors.urgentSoft, borderColor: colors.urgent },
  priorityText: { fontSize: 9, fontFamily: fonts.label, letterSpacing: 0.8, color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 16, borderWidth: 1, borderColor: colors.line },
  label: { fontSize: 9, fontFamily: fonts.label, color: colors.goldLight, letterSpacing: 1.2, marginTop: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.page },
});

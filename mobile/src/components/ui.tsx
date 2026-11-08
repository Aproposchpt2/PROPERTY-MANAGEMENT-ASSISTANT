import type { ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';
import { isUrgent } from '../lib/cases';

type ButtonProps = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ember' | 'navy' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, tone = 'primary', icon, disabled, busy, style }: ButtonProps) {
  const bg = { primary: colors.teal, ember: colors.ember, navy: colors.navy, ghost: 'transparent' }[tone];
  const fg = tone === 'ghost' ? colors.navy : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        tone === 'ghost' && s.ghost, style]}
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
      <Ionicons name="warning" size={20} color={colors.emberDark} />
      <Text style={s.emergencyText}>
        Fire, gas smell, flooding near electricity or anyone in danger? Leave the area and call 911 first. PMA does not replace emergency services.
      </Text>
    </Pressable>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const done = status === 'Completed' || status === 'Closed';
  return (
    <View style={[s.badge, done && { backgroundColor: '#DCFCE7' }]}>
      <Text style={[s.badgeText, done && { color: colors.green }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  const urgent = isUrgent(priority);
  return (
    <View style={[s.priority, urgent && s.priorityUrgent]}>
      {urgent ? <Ionicons name="warning" size={11} color={colors.emberDark} /> : null}
      <Text style={[s.priorityText, urgent && { color: colors.emberDark }]}>{priority.toUpperCase()}</Text>
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
  btn: { paddingVertical: 15, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  ghost: { borderWidth: 1, borderColor: colors.field },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { fontWeight: '800', fontSize: 16 },
  emergency: { flexDirection: 'row', gap: 10, backgroundColor: colors.emberSoft, borderColor: '#FDBA74', borderWidth: 1, padding: 14, borderRadius: 12 },
  emergencyText: { flex: 1, color: colors.emberDark, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', backgroundColor: '#CCFBF1', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  badgeText: { color: '#0F766E', fontSize: 12, fontWeight: '900' },
  priority: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.page, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  priorityUrgent: { backgroundColor: colors.emberSoft },
  priorityText: { fontSize: 10, fontWeight: '900', color: '#475569' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.line },
  label: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 1, marginTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});

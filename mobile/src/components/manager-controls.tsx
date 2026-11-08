import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../lib/theme';

export function SectionTabs<T extends string>({ items, value, onChange }: {
  items: readonly T[]; value: T; onChange: (value: T) => void;
}) {
  return <View style={s.tabBar}><ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <View style={s.tabs} accessibilityRole="tablist">
      {items.map(item => <Pressable key={item} accessibilityRole="tab"
        accessibilityState={{ selected: value === item }} onPress={() => onChange(item)}
        style={[s.tab, value === item && s.active]}>
        <Text style={[s.tabText, value === item && s.activeText]}>{item}</Text>
      </Pressable>)}
    </View>
  </ScrollView></View>;
}

// No native dependency: the same accessible, scrollable picker works on phones and web.
// A preset only calls onSelect; the parent keeps the editable text and handles saving.
export function EntrySelect({ label, options, value, onSelect, disabled = false }: {
  label: string; options: readonly string[]; value?: string;
  onSelect: (value: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'Choose'}`}
      accessibilityState={{ expanded: open, disabled }} disabled={disabled}
      onPress={() => setOpen(true)} style={s.select}>
      <Text style={s.selectText}>{value || label}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.gold} />
    </Pressable>
    <Modal visible={open && !disabled} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.backdrop}>
        <View style={s.dialog} accessibilityViewIsModal>
          <Text style={s.title}>{label}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {options.map(option => <Pressable key={option} accessibilityRole="button"
              accessibilityState={{ selected: value === option }}
              onPress={() => { onSelect(option); setOpen(false); }} style={s.option}>
              <Text style={s.selectText}>{option}</Text>
              {value === option ? <Ionicons name="checkmark" size={20} color={colors.gold} /> : null}
            </Pressable>)}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={s.option}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  tabBar: { backgroundColor: colors.page, borderBottomWidth: 1, borderBottomColor: colors.line },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, gap: 4 },
  tab: { minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  active: { borderBottomColor: colors.gold },
  tabText: { color: colors.body, fontFamily: fonts.regular, fontSize: 13 },
  activeText: { color: colors.goldLight, fontFamily: fonts.medium },
  select: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.field,
    backgroundColor: colors.card, padding: 14, minHeight: 50, borderRadius: radius },
  selectText: { color: colors.body, fontFamily: fonts.regular, fontSize: 15, flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 },
  dialog: { maxHeight: '85%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.gold, padding: 16 },
  title: { color: colors.goldLight, fontFamily: fonts.serif, fontSize: 25, marginBottom: 12 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.line },
  cancel: { color: colors.goldLight, fontFamily: fonts.medium, textAlign: 'center', flex: 1 },
});

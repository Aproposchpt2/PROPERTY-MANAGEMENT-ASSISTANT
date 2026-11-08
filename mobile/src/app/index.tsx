import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmergencyNote } from '../components/ui';
import { colors } from '../lib/theme';

export default function Welcome() {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.wrap}>
        <View style={s.hero}>
          <Text style={s.eyebrow}>PROPERTY MANAGEMENT ASSISTANT</Text>
          <Text style={s.title}>Everyone Stays Informed</Text>
          <Text style={s.tag}>Your 24/7 Property Customer Care Center. From incident report to resolution, follow every update in one place.</Text>
        </View>
        <Button label="I'm a resident" icon="home" tone="ember" onPress={() => router.push('/resident')} />
        <Text style={s.hint}>Report a maintenance issue or check on a case you already reported.</Text>
        <Button label="Manager sign in" icon="speedometer" tone="navy" onPress={() => router.push('/manager')} />
        <Text style={s.hint}>For property owners, managers and administrators with a PMA dashboard account.</Text>
        <EmergencyNote />
        <Text style={s.footer}>STELLAR INTELLIGENT SOFTWARE DEVELOPERS · Operated by Apropos Group LLC</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: 24, gap: 12, paddingTop: 36 },
  hero: { gap: 8, marginBottom: 18 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1, color: colors.teal },
  title: { fontSize: 32, fontWeight: '800', color: colors.navy },
  tag: { fontSize: 16, lineHeight: 23, color: '#52606D' },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 10, textAlign: 'center' },
  footer: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 20 },
});

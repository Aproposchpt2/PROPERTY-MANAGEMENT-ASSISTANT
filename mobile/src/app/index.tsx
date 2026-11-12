import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmergencyNote } from '../components/ui';
import { colors, fonts } from '../lib/theme';
import { MANAGER_ENABLED } from '../lib/config';

export default function Welcome() {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.wrap}>
        <View style={s.hero}>
          <Text style={s.eyebrow}>PROPERTY MANAGEMENT ASSISTANT</Text>
          <Text style={s.title}>Everyone Stays Informed</Text>
          <Text style={s.tag}>Your 24/7 Property Customer Care Center. From incident report to resolution, follow every update in one place.</Text>
        </View>
        <Button label="Request maintenance" icon="construct" tone="ember" onPress={() => router.push('/request')} />
        <Text style={s.hint}>Tell us what's wrong. You'll get a case number right away, just like calling the Customer Care Center.</Text>
        <Button label="Check on a request" icon="list" tone="navy" onPress={() => router.push('/resident')} />
        <Text style={s.hint}>See the status of a request you made in the app or by phone.</Text>
        {MANAGER_ENABLED ? (
          <>
            <Button label="Team sign in" icon="speedometer" tone="ghost" onPress={() => router.push('/manager')} />
            <Text style={s.hint}>For the property management team, with a dashboard account.</Text>
          </>
        ) : null}
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
  eyebrow: { fontSize: 10, letterSpacing: 1.1, color: colors.gold, fontFamily: fonts.label },
  title: { fontSize: 36, color: colors.ivory, fontFamily: fonts.serif },
  tag: { fontSize: 16, lineHeight: 23, color: colors.body, fontFamily: fonts.regular },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 10, textAlign: 'center', fontFamily: fonts.regular },
  footer: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 20, fontFamily: fonts.regular },
});

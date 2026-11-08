import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, EmergencyNote, Label, StatusBadge } from '../components/ui';
import { parseStatusToken } from '../lib/cases';
import { PMA_PHONE, displayPhone } from '../lib/config';
import { listRecent, type RecentCase } from '../lib/recent';
import { colors } from '../lib/theme';

export default function Resident() {
  const [link, setLink] = useState('');
  const [recent, setRecent] = useState<RecentCase[]>([]);

  useFocusEffect(useCallback(() => { listRecent().then(setRecent); }, []));

  async function callLine() {
    const url = `tel:${PMA_PHONE}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Call the property line', `Call ${displayPhone(PMA_PHONE)} from any phone.`);
    }
  }

  function track() {
    const token = parseStatusToken(link);
    if (!token) {
      Alert.alert('Check the link', 'Paste the full status link from your text or email. It looks like pma.stellaruc.com/status?t=…');
      return;
    }
    setLink('');
    router.push({ pathname: '/status', params: { t: token } });
  }

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.h}>Report an Issue</Text>
      <Card style={s.gap}>
        <Text style={s.p}>
          Call the property line any time, day or night. The assistant records your address, unit, the problem and how to reach you, then gives you a case number before the call ends.
        </Text>
        <Button label={`Call ${displayPhone(PMA_PHONE)}`} icon="call" tone="ember" onPress={callLine} />
        <Text style={s.small}>You'll get a text or email with a status link for your case.</Text>
      </Card>
      <EmergencyNote />

      <Text style={[s.h, { marginTop: 18 }]}>Track a Case</Text>
      <Card style={s.gap}>
        <Label>STATUS LINK</Label>
        <TextInput
          style={s.input}
          value={link}
          onChangeText={setLink}
          placeholder="Paste your status link"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Status link"
          onSubmitEditing={track}
          returnKeyType="go"
        />
        <Button label="Show my case" icon="search" onPress={track} disabled={!link.trim()} />
      </Card>

      {recent.length > 0 ? (
        <View style={s.gap}>
          <Label>RECENT CASES ON THIS DEVICE</Label>
          {recent.map(r => (
            <Pressable
              key={r.token}
              accessibilityRole="button"
              accessibilityLabel={`Case ${r.caseNumber}, ${r.status}`}
              style={s.recent}
              onPress={() => router.push({ pathname: '/status', params: { t: r.token } })}
            >
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={s.caseNo}>Case {r.caseNumber}</Text>
                <StatusBadge status={r.status} />
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 12, paddingBottom: 40 },
  gap: { gap: 12 },
  h: { fontSize: 24, fontWeight: '800', color: colors.navy },
  p: { fontSize: 15, lineHeight: 22, color: colors.body },
  small: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.field, padding: 14, borderRadius: 12, fontSize: 15 },
  recent: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 15, borderWidth: 1, borderColor: colors.line },
  caseNo: { fontSize: 16, fontWeight: '800', color: colors.ink },
});

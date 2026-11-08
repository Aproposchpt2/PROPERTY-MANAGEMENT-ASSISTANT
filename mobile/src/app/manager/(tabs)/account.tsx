import { useState } from 'react';
import { Linking, ScrollView, Text } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, Label } from '../../../components/ui';
import { useManagerCases } from '../../../lib/manager-cases';
import { useSession } from '../../../lib/session';
import { BUSINESS_NAME } from '../../../lib/config';
import { colors, fonts } from '../../../lib/theme';
import { showMessage } from '../../../lib/dialog';

export default function Account() {
  const { session } = useSession();
  const { signOut } = useManagerCases();
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    try { await signOut(); }
    catch { showMessage('Could not sign out', 'Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Label>ACCOUNT</Label>
    <Card><Text style={{ color: colors.ivory, fontFamily: fonts.serif, fontSize: 26 }}>{BUSINESS_NAME || 'Property Management Assistant'}</Text>
      <Text style={{ color: colors.body, fontFamily: fonts.regular, marginTop: 8 }}>{session?.user.email}</Text></Card>
    <Button label="Open web dashboard" tone="ghost" icon="open-outline"
      onPress={() => { Linking.openURL('https://pma.stellaruc.com/manager').catch(() => showMessage('Could not open dashboard', 'Try again.')); }} />
    <Button label="Sign out" tone="navy" onPress={leave} busy={busy} />
    <Text style={{ color: colors.muted, fontFamily: fonts.regular }}>App version {Constants.expoConfig?.version ?? 'Unknown'}</Text>
  </ScrollView>;
}

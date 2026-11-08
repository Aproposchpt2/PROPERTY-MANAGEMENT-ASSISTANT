import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, sendTestPush, type PushPrefs } from '../../lib/api';
import { registerForPush, type PushState } from '../../lib/push';
import { registerForWebPush, webPushStatus } from '../../lib/webpush';

const isWeb = Platform.OS === 'web';
type ScreenState = PushState | { state: 'ASK'; message: string };

// Phones register straight away; browsers must wait for a tap before asking permission.
const initialState = (): Promise<ScreenState> => (isWeb ? webPushStatus() : registerForPush());
const register = (prefs?: PushPrefs): Promise<PushState> => (isWeb ? registerForWebPush(prefs) : registerForPush(prefs));
import { Button, Card, Centered, Label } from '../../components/ui';
import { colors, fonts, radius } from '../../lib/theme';
import { showMessage } from '../../lib/dialog';

const ITEMS: { key: keyof PushPrefs; title: string; detail: string }[] = [
  {
    key: 'emergency', title: 'Emergencies',
    detail: isWeb
      ? 'A request is flagged as an emergency, such as a gas smell or flooding. The alert stays on screen until you dismiss it.'
      : 'A request is flagged as an emergency, such as a gas smell or flooding. Uses your phone\'s loudest alert channel on Android.',
  },
  { key: 'newCase', title: 'New cases', detail: 'Any new maintenance request, by phone or in the app.' },
  { key: 'approval', title: 'Cost approvals', detail: 'A provider\'s quote is over the pre-approved limit and needs your answer.' },
];

// This phone's case alerts. Staff texts keep arriving as before; these are in addition.
export default function Alerts() {
  const [push, setPush] = useState<ScreenState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { initialState().then(setPush); }, []);

  async function turnOn() {
    setSaving(true);
    setPush(await register());
    setSaving(false);
  }

  async function toggle(key: keyof PushPrefs, value: boolean) {
    if (push?.state !== 'REGISTERED') return;
    const prefs = { ...push.prefs, [key]: value };
    setPush({ ...push, prefs });
    setSaving(true);
    const r = await register(prefs);
    setSaving(false);
    if (r.state === 'REGISTERED') setPush(r);
    else { setPush({ ...push }); showMessage('Not saved', r.message); }
  }

  async function test() {
    setTesting(true);
    try {
      const r = await sendTestPush();
      if (!r.success) {
        showMessage('Test not sent', r.state === 'DISABLED'
          ? 'Push notifications are not switched on for PMA yet. Ask your administrator.'
          : 'No notification could be sent to this phone. Try turning alerts off and on.');
      }
    } catch (e) {
      showMessage('Test not sent', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setTesting(false);
    }
  }

  if (!push) return <Centered><Text style={{ color: colors.body, fontFamily: fonts.regular }}>Checking notifications…</Text></Centered>;

  if (push.state === 'ASK') {
    return (
      <Centered>
        <Ionicons name="notifications" size={40} color={colors.gold} />
        <Text style={s.center}>{push.message}</Text>
        <Button label="Turn on alerts" icon="notifications" onPress={turnOn} busy={saving} />
        <Text style={s.small}>Your browser will ask for permission. You'll still get staff text messages.</Text>
      </Centered>
    );
  }

  if (push.state !== 'REGISTERED') {
    return (
      <Centered>
        <Ionicons name="notifications-off" size={40} color={colors.muted} />
        <Text style={s.center}>{push.message}</Text>
        {push.state === 'DENIED' && !isWeb ? <Button label="Open Settings" onPress={() => Linking.openSettings()} /> : null}
        {push.state === 'FAILED' ? <Button label="Try again" onPress={() => { setPush(null); (isWeb ? register() : registerForPush()).then(setPush); }} /> : null}
        <Text style={s.small}>You'll still get staff text messages.</Text>
      </Centered>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      {!push.serverEnabled ? (
        <View style={s.notice}>
          <Text style={s.noticeText}>This phone is registered, but PMA isn't sending push notifications yet. You'll still get staff texts.</Text>
        </View>
      ) : null}
      <Label>ALERT ME ABOUT</Label>
      <Card style={{ gap: 18 }}>
        {ITEMS.map(item => (
          <View key={item.key} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{item.title}</Text>
              <Text style={s.detail}>{item.detail}</Text>
            </View>
            <Switch
              value={push.prefs[item.key]}
              onValueChange={v => toggle(item.key, v)}
              disabled={saving}
              trackColor={{ true: colors.gold }}
              accessibilityLabel={item.title}
            />
          </View>
        ))}
      </Card>
      <Button label="Send a test notification" icon="notifications" tone="ghost" onPress={test} busy={testing} />
      <Text style={s.small}>
        Alerts go to this device while you're signed in. Signing out stops them. Staff text messages continue as before.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 12, paddingBottom: 40 },
  center: { textAlign: 'center', fontSize: 15, lineHeight: 22, color: colors.body, fontFamily: fonts.regular },
  small: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, fontFamily: fonts.regular },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 20, color: colors.ink, fontFamily: fonts.serif },
  detail: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18, fontFamily: fonts.regular },
  notice: { backgroundColor: colors.urgentSoft, borderRadius: radius, padding: 14 },
  noticeText: { color: colors.urgentText, lineHeight: 20, fontFamily: fonts.bold },
});

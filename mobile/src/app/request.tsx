import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RequestError, requestCode, submitRequest, type RequestResult } from '../lib/api';
import { LIMITS, contactError, detailsError, statusTokenFrom } from '../lib/request';
import { loadProfile, saveProfile } from '../lib/profile';
import { rememberCase } from '../lib/recent';
import { PMA_PHONE, displayPhone } from '../lib/config';
import { Button, Card, EmergencyNote, Label } from '../components/ui';
import { colors, fonts, radius } from '../lib/theme';

type Step = 'details' | 'contact' | 'code' | 'done';
const CONSENT_TEXT =
  'Send me updates about this request by the method I chose. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.';

// The app's version of calling the Customer Care Center: the same details Ava collects,
// filed through the same server path, with the resident's phone confirmed by a texted code.
export default function MaintenanceRequest() {
  const [step, setStep] = useState<Step>('details');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [unit, setUnit] = useState('');
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<'sms' | 'email'>('sms');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState('');
  const [last4, setLast4] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RequestResult | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    loadProfile().then(p => {
      if (p.name) setName(p.name);
      if (p.address) setAddress(p.address);
      if (p.unit) setUnit(p.unit);
      if (p.phone) setPhone(p.phone);
      if (p.email) setEmail(p.email);
      if (p.contactMethod) setMethod(p.contactMethod);
      if (p.language) setLanguage(p.language);
    });
  }, []);

  // A message about a field goes away as soon as the resident changes something.
  useEffect(() => { setError(null); }, [description, name, address, unit, phone, method, email, consent, code]);

  const go = (next: Step) => { setError(null); setStep(next); scroll.current?.scrollTo({ y: 0, animated: false }); };

  function nextFromDetails() {
    const e = detailsError({ description, name, address, unit });
    if (e) return setError(e);
    go('contact');
  }

  async function sendCode() {
    const e = contactError(phone, method, email, consent);
    if (e) return setError(e);
    setBusy(true);
    setError(null);
    try {
      const r = await requestCode(phone);
      setChallenge(r.challenge);
      setLast4(r.phoneLast4);
      setCode('');
      go('code');
    } catch (err) {
      setError(err instanceof RequestError ? err.message : 'We could not send a code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the text.');
    setBusy(true);
    setError(null);
    try {
      const r = await submitRequest({
        challenge, code: code.trim(),
        reportedName: name.trim(), reportedAddress: address.trim(), reportedUnit: unit.trim(),
        description: description.trim(), language,
        contactMethod: method, ...(method === 'email' ? { email: email.trim() } : {}),
        consent: true,
      });
      setResult(r);
      saveProfile({ name: name.trim(), address: address.trim(), unit: unit.trim(), phone, email: email.trim(), contactMethod: method, language });
      const token = statusTokenFrom(r);
      if (token) rememberCase({ token, caseNumber: r.caseNumber, status: 'New', seenAt: new Date().toISOString() }).catch(() => {});
      go('done');
    } catch (err) {
      const e = err instanceof RequestError ? err : null;
      if (e && ['EXPIRED', 'INVALID', 'TOO_MANY_ATTEMPTS', 'CONFLICT'].includes(e.state)) {
        setChallenge('');
        setError(e.message);
        setStep('contact');
      } else {
        setError(e ? e.message : 'Your request was not filed. Try again, or call the property line.');
      }
    } finally {
      setBusy(false);
    }
  }

  const callLine = () => Linking.openURL(`tel:${PMA_PHONE}`).catch(() => {});

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        {step !== 'done' ? <Steps step={step} /> : null}

        {step === 'details' ? (
          <>
            <EmergencyNote />
            <Label>WHAT'S THE PROBLEM?</Label>
            <TextInput placeholderTextColor={colors.muted}
              style={[s.input, s.area]} multiline value={description} onChangeText={setDescription}
              maxLength={LIMITS.description} accessibilityLabel="Describe the problem"
              placeholder="What is wrong, where it is, when it started, and anything we should know to get in"
            />
            <Label>YOUR NAME</Label>
            <TextInput placeholderTextColor={colors.muted} style={s.input} value={name} onChangeText={setName} maxLength={LIMITS.name}
              autoComplete="name" textContentType="name" accessibilityLabel="Your name" placeholder="First and last name" />
            <Label>PROPERTY ADDRESS</Label>
            <TextInput placeholderTextColor={colors.muted} style={s.input} value={address} onChangeText={setAddress} maxLength={LIMITS.address}
              autoComplete="street-address" textContentType="fullStreetAddress" accessibilityLabel="Property address" placeholder="Street address" />
            <Label>UNIT OR APARTMENT</Label>
            <TextInput placeholderTextColor={colors.muted} style={s.input} value={unit} onChangeText={setUnit} maxLength={LIMITS.unit}
              accessibilityLabel="Unit or apartment" placeholder='e.g. 14B, or "none"' />
            <Label>LANGUAGE FOR UPDATES</Label>
            <Choice options={[['en', 'English'], ['es', 'Español']]} value={language} onChange={v => setLanguage(v as 'en' | 'es')} />
            {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
            <Button label="Continue" onPress={nextFromDetails} />
          </>
        ) : null}

        {step === 'contact' ? (
          <>
            <Text style={s.p}>We'll text a code to your mobile phone to confirm it's you, the same way we know who's calling.</Text>
            <Label>MOBILE PHONE</Label>
            <TextInput placeholderTextColor={colors.muted} style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
              autoComplete="tel" textContentType="telephoneNumber" accessibilityLabel="Mobile phone" placeholder="(702) 555-0100" maxLength={20} />
            <Label>SEND MY CASE NUMBER AND UPDATES BY</Label>
            <Choice options={[['sms', 'Text'], ['email', 'Email']]} value={method} onChange={v => setMethod(v as 'sms' | 'email')} />
            {method === 'email' ? (
              <>
                <Label>EMAIL</Label>
                <TextInput placeholderTextColor={colors.muted} style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
                  autoComplete="email" textContentType="emailAddress" accessibilityLabel="Email" placeholder="you@example.com" maxLength={254} />
              </>
            ) : null}
            <Pressable
              style={s.consent} onPress={() => setConsent(c => !c)}
              accessibilityRole="checkbox" accessibilityState={{ checked: consent }}
            >
              <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={24} color={consent ? colors.gold : colors.muted} />
              <Text style={s.consentText}>{CONSENT_TEXT}</Text>
            </Pressable>
            {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
            <Button label="Text me a code" icon="chatbubble-ellipses" onPress={sendCode} busy={busy} />
            <Button label="Back" tone="ghost" onPress={() => go('details')} disabled={busy} />
          </>
        ) : null}

        {step === 'code' ? (
          <>
            <Text style={s.p}>Enter the 6-digit code we texted to the number ending in {last4}. It expires in 10 minutes.</Text>
            <TextInput placeholderTextColor={colors.muted}
              style={[s.input, s.code]} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code"
              accessibilityLabel="6-digit code" placeholder="••••••" maxLength={6} autoFocus
            />
            {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
            <Button label="Submit request" icon="send" tone="ember" onPress={submit} busy={busy} disabled={code.length !== 6} />
            <Button label="Send a new code" tone="ghost" onPress={sendCode} disabled={busy} />
          </>
        ) : null}

        {step === 'done' && result ? (
          <>
            <View style={s.doneHead}>
              <Ionicons name="checkmark-circle" size={56} color={colors.ivory} />
              <Text style={s.doneTitle}>Request received</Text>
              <Text style={s.caseNo}>Case {result.caseNumber}</Text>
            </View>
            {result.urgent ? (
              <View style={s.urgent} accessibilityRole="alert">
                <Ionicons name="warning" size={20} color={colors.ivory} />
                <Text style={s.urgentText}>
                  This looks urgent, so your property team has been alerted now. If anyone is in danger, leave the area and call 911.
                </Text>
              </View>
            ) : null}
            <Card>
              <Text style={s.p}>
                {result.notificationSent
                  ? `We sent your case number${method === 'email' ? ' by email' : ' by text'} with a link to follow it.`
                  : 'Keep your case number. You can follow your request in this app.'}
              </Text>
            </Card>
            {statusTokenFrom(result) ? (
              <Button label="Follow my request" icon="eye" onPress={() => router.replace({ pathname: '/status', params: { t: statusTokenFrom(result)! } })} />
            ) : null}
            <Button label="Done" tone="ghost" onPress={() => router.replace('/')} />
          </>
        ) : null}

        {step !== 'done' ? (
          <Pressable onPress={callLine} accessibilityRole="button" style={s.callLink}>
            <Text style={s.callText}>Rather talk to someone? Call {displayPhone(PMA_PHONE)}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Steps({ step }: { step: Step }) {
  const steps: [Step, string][] = [['details', 'Problem'], ['contact', 'Contact'], ['code', 'Confirm']];
  const at = steps.findIndex(([k]) => k === step);
  return (
    <View style={s.steps} accessibilityLabel={`Step ${at + 1} of 3`}>
      {steps.map(([k, label], i) => (
        <View key={k} style={s.stepItem}>
          <View style={[s.dot, i <= at && s.dotOn]}><Text style={[s.dotText, i <= at && { color: colors.onAccent }]}>{i + 1}</Text></View>
          <Text style={[s.stepLabel, i === at && { color: colors.goldLight, fontFamily: fonts.bold }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function Choice({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.choice}>
      {options.map(([v, label]) => (
        <Pressable
          key={v} onPress={() => onChange(v)} style={[s.choiceItem, value === v && s.choiceOn]}
          accessibilityRole="radio" accessibilityState={{ selected: value === v }}
        >
          <Text style={[s.choiceText, value === v && { color: colors.onAccent }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 10, paddingBottom: 48 },
  p: { fontSize: 15, lineHeight: 22, color: colors.body, fontFamily: fonts.regular },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.field, padding: 14, borderRadius: radius, fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
  area: { minHeight: 130, textAlignVertical: 'top' },
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontFamily: fonts.bold, color: colors.ink },
  error: { color: colors.urgentText, fontSize: 14, fontFamily: fonts.bold },
  choice: { flexDirection: 'row', gap: 8 },
  choiceItem: { flex: 1, padding: 13, borderRadius: radius, borderWidth: 1, borderColor: colors.field, backgroundColor: colors.card, alignItems: 'center' },
  choiceOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  choiceText: { color: colors.body, fontFamily: fonts.bold },
  consent: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8 },
  consentText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.body, fontFamily: fonts.regular },
  steps: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  stepItem: { alignItems: 'center', gap: 4, flex: 1 },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.gold },
  dotText: { color: colors.muted, fontFamily: fonts.bold },
  stepLabel: { fontSize: 12, color: colors.muted, fontFamily: fonts.regular },
  doneHead: { alignItems: 'center', gap: 6, marginVertical: 16 },
  doneTitle: { fontSize: 30, color: colors.ivory, fontFamily: fonts.serif },
  caseNo: { fontSize: 24, color: colors.gold, fontFamily: fonts.serif, fontVariant: ['lining-nums'] },
  urgent: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.urgent, padding: 14, borderRadius: radius },
  urgentText: { color: colors.ivory, flex: 1, lineHeight: 20, fontFamily: fonts.bold },
  callLink: { alignItems: 'center', paddingVertical: 14 },
  callText: { color: colors.gold, fontFamily: fonts.bold },
});

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button, Label } from '../../components/ui';
import { colors, fonts, radius } from '../../lib/theme';
import { showMessage } from '../../lib/dialog';
import { BUSINESS_NAME } from '../../lib/config';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same passwordless sign-in as the web Management Dashboard: an emailed one-time code.
// shouldCreateUser:false means only existing dashboard accounts can sign in.
export default function ManagerLogin() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return showMessage('Email required', 'Enter the email address on your dashboard account.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return showMessage('Could not send code', error.message);
    setSent(true);
  }

  async function verify() {
    const token = code.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) return showMessage('Code required', 'Enter the code from the email.');
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
    setBusy(false);
    if (error) showMessage('Sign in failed', error.message);
    // On success the session changes and the protected dashboard opens automatically.
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.brand}>PROPERTY MANAGEMENT ASSISTANT</Text>
        <Text style={s.business}>{BUSINESS_NAME || 'Team Sign In'}</Text>
        <Text style={s.tag}>Team sign in. Use the email on your dashboard account; we'll email you a sign-in code.</Text>
        <Label>EMAIL</Label>
        <TextInput placeholderTextColor={colors.muted}
          style={s.input}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@company.com"
          value={email}
          onChangeText={v => { setEmail(v); setSent(false); }}
          accessibilityLabel="Email"
        />
        {!sent ? (
          <Button label="Email me a code" onPress={sendCode} busy={busy} />
        ) : (
          <>
            <Label>CODE</Label>
            <TextInput placeholderTextColor={colors.muted}
              style={s.input}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="Code from the email"
              value={code}
              onChangeText={setCode}
              maxLength={10}
              accessibilityLabel="Sign-in code"
            />
            <Button label="Sign in" onPress={verify} busy={busy} />
            <Button label="Send a new code" tone="ghost" onPress={sendCode} disabled={busy} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, gap: 12, paddingTop: 32 },
  business: { fontSize: 34, lineHeight: 38, color: colors.ivory, fontFamily: fonts.serif },
  brand: { fontSize: 10, letterSpacing: 1.2, color: colors.gold, fontFamily: fonts.label, marginBottom: 6 },
  tag: { fontSize: 15, lineHeight: 22, color: colors.body, marginBottom: 8, fontFamily: fonts.regular },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.field, padding: 15, borderRadius: radius, fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
});

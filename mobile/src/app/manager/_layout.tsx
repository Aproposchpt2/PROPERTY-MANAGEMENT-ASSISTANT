import { Redirect, Stack } from 'expo-router';
import { MANAGER_ENABLED, STAFF_APP } from '../../lib/config';
import { useSession } from '../../lib/session';
import { Centered } from '../../components/ui';
import { ActivityIndicator } from 'react-native';
import { colors } from '../../lib/theme';

// Signed-out users only reach the sign-in screen. Signing in is not enough on its own:
// every manager API call is also checked on the server against tenant_users role and property access.
export default function ManagerLayout() {
  const { session, loading } = useSession();
  // Phase 2 feature: hidden, and unreachable by link, until EXPO_PUBLIC_ENABLE_MANAGER=true.
  if (!MANAGER_ENABLED) return <Redirect href="/" />;
  if (loading) return <Centered><ActivityIndicator color={colors.teal} /></Centered>;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: colors.page },
      }}
    >
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" options={{ title: 'Team Sign In', headerBackVisible: !STAFF_APP }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ title: 'Dashboard', headerBackVisible: !STAFF_APP }} />
        <Stack.Screen name="[id]" options={{ title: 'Case' }} />
        <Stack.Screen name="assign" options={{ title: 'Assign Provider' }} />
        <Stack.Screen name="alerts" options={{ title: 'Alerts' }} />
      </Stack.Protected>
    </Stack>
  );
}

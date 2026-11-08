import { Stack } from 'expo-router';
import { useSession } from '../../lib/session';
import { Centered } from '../../components/ui';
import { ActivityIndicator } from 'react-native';
import { colors } from '../../lib/theme';

// Signed-out users only reach the sign-in screen. Signing in is not enough on its own:
// every manager API call is also checked on the server against tenant_users role and property access.
export default function ManagerLayout() {
  const { session, loading } = useSession();
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
        <Stack.Screen name="login" options={{ title: 'Manager Sign In' }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ title: 'Manager Dashboard' }} />
        <Stack.Screen name="[id]" options={{ title: 'Case' }} />
      </Stack.Protected>
    </Stack>
  );
}

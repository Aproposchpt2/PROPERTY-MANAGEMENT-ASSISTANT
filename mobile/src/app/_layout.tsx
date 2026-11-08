import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../lib/session';
import { colors } from '../lib/theme';
import { MANAGER_ENABLED, STAFF_APP } from '../lib/config';
import { NotificationRouter } from '../components/NotificationRouter';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      {MANAGER_ENABLED && Platform.OS !== 'web' ? <NotificationRouter /> : null}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.navy },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.page },
        }}
      >
        {/* Resident screens: not in the staff (in-house) app, which opens on team sign-in. */}
        <Stack.Protected guard={!STAFF_APP}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="request" options={{ title: 'Request Maintenance' }} />
          <Stack.Screen name="resident" options={{ title: 'My Requests' }} />
          <Stack.Screen name="status" options={{ title: 'Case Status' }} />
        </Stack.Protected>
        <Stack.Screen name="manager" options={{ headerShown: false }} />
      </Stack>
    </SessionProvider>
  );
}

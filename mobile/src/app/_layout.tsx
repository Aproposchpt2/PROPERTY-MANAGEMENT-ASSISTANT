import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../lib/session';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.navy },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.page },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="request" options={{ title: 'Request Maintenance' }} />
        <Stack.Screen name="resident" options={{ title: 'My Requests' }} />
        <Stack.Screen name="status" options={{ title: 'Case Status' }} />
        <Stack.Screen name="manager" options={{ headerShown: false }} />
      </Stack>
    </SessionProvider>
  );
}

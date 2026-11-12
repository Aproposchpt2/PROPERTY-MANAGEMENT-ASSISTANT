import { ActivityIndicator, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { CormorantGaramond_400Regular, CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { Syncopate_400Regular } from '@expo-google-fonts/syncopate';
import { SessionProvider } from '../lib/session';
import { colors, headerOptions } from '../lib/theme';
import { MANAGER_ENABLED, STAFF_APP } from '../lib/config';
import { NotificationRouter } from '../components/NotificationRouter';

export default function RootLayout() {
  // Brand fonts (same as the website). If they fail to load, the app still opens with system fonts.
  const [loaded, fontError] = useFonts({
    CormorantGaramond_400Regular, CormorantGaramond_500Medium,
    DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold,
    Syncopate_400Regular,
  });
  if (!loaded && !fontError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }
  return (
    <SessionProvider>
      <StatusBar style="light" />
      {MANAGER_ENABLED && Platform.OS !== 'web' ? <NotificationRouter /> : null}
      <Stack screenOptions={headerOptions}>
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

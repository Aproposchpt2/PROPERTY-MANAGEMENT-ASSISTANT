// Manager push notifications: permission, Android channels, Expo push token, and registering
// this phone with the PMA server (/api/manager/push-token). Residents never register.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { registerPushToken, removePushToken, type PushPrefs } from './api';
import { notificationCaseId } from './cases';

const TOKEN_KEY = 'pma.pushToken.v1';

// Show case alerts even while the app is open. Phones only: the web build has no notifications.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type PushState =
  | { state: 'REGISTERED'; prefs: PushPrefs; serverEnabled: boolean }
  | { state: 'WEB' | 'NOT_DEVICE' | 'DENIED' | 'NO_PROJECT' | 'FAILED'; message: string };

// The server's notification kinds use these channel ids (lib/pma-push.js).
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('cases', {
    name: 'Case alerts',
    description: 'New cases and cost approvals',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('emergency', {
    name: 'Emergencies',
    description: 'Emergency maintenance cases',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
  });
}

function projectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig || Constants.easConfig?.projectId || null;
}

export async function storedToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try { return await SecureStore.getItemAsync(TOKEN_KEY); } catch { return null; }
}

// Ask for permission (only if the OS still allows asking), get this phone's Expo push token
// and register it for the signed-in manager. Safe to call on every sign-in.
export async function registerForPush(prefs?: PushPrefs): Promise<PushState> {
  if (Platform.OS === 'web') return { state: 'WEB', message: 'Notifications are only available in the phone app.' };
  if (!Device.isDevice) return { state: 'NOT_DEVICE', message: 'Notifications need a real phone, not a simulator.' };
  try {
    await ensureChannels();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      return { state: 'DENIED', message: 'Notifications are turned off for PMA. Turn them on in your phone\'s Settings.' };
    }
    const id = projectId();
    if (!id) return { state: 'NO_PROJECT', message: 'This build is not set up for notifications yet (no EAS project id).' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    const r = await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android', prefs);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return { state: 'REGISTERED', prefs: r.prefs, serverEnabled: r.enabled };
  } catch {
    return { state: 'FAILED', message: 'Could not turn on notifications. Check your connection and try again.' };
  }
}

// On sign-out: stop alerts to this phone. Best effort; must run before the session ends.
export async function unregisterPush() {
  const token = await storedToken();
  if (!token) return;
  try { await removePushToken(token); } catch { /* server cleans up dead tokens on its own */ }
  try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* ignore */ }
}

// Case id carried by a tapped notification, if any.
export function requestIdFrom(response: Notifications.NotificationResponse | null | undefined): string | null {
  return notificationCaseId(response?.notification.request.content.data);
}

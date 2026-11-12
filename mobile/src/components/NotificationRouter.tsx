import { useEffect } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { requestIdFrom } from '../lib/push';

// Opens the case a manager's notification is about: on a tap while the app is running, and on
// the tap that launched the app. The manager area still requires sign-in and manager access.
export function NotificationRouter() {
  useEffect(() => {
    const seen = new Set<string>();
    const open = (response: Notifications.NotificationResponse | null) => {
      const id = requestIdFrom(response);
      const key = response?.notification.request.identifier;
      if (!id || !key || seen.has(key)) return;
      seen.add(key);
      router.push({ pathname: '/manager/[id]', params: { id } });
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  return null;
}

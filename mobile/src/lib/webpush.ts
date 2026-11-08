// Web push for managers using the web app (pma.stellaruc.com/app). Uses the service worker in
// public/sw.js. iPhone/iPad: only works when the app was added to the Home Screen (iOS 16.4+),
// and permission can only be asked from a tap, so this runs from the Alerts screen.
import { getWebPushKey, registerWebPush, removeWebPush, type PushPrefs } from './api';
import type { PushState } from './push';

const SW_URL = '/app/sw.js';
const SW_SCOPE = '/app/';

type Nav = Navigator & { standalone?: boolean };

export function webPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isIos(): boolean {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return (navigator as Nav).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return reg ? reg.pushManager.getSubscription() : null;
}

// What the Alerts screen should show before asking for anything.
export async function webPushStatus(): Promise<PushState | { state: 'ASK'; message: string }> {
  if (!webPushSupported()) {
    return isIos() && !isInstalled()
      ? { state: 'NOT_DEVICE', message: 'On iPhone, add PMA to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on alerts.' }
      : { state: 'NOT_DEVICE', message: 'This browser does not support notifications. Use Chrome, Edge, Firefox or Safari, or add PMA to your Home Screen.' };
  }
  if (Notification.permission === 'denied') {
    return { state: 'DENIED', message: 'Notifications are blocked for this site. Allow them in your browser or phone settings.' };
  }
  const sub = await currentSubscription().catch(() => null);
  if (sub && Notification.permission === 'granted') return registerForWebPush();
  return { state: 'ASK', message: 'Get an alert on this device for emergencies, new cases and cost approvals.' };
}

// Ask permission (must be called from a tap), subscribe and register with the server.
// Also used to save new preferences.
export async function registerForWebPush(prefs?: PushPrefs): Promise<PushState> {
  try {
    if (!webPushSupported()) return { state: 'NOT_DEVICE', message: 'This browser does not support notifications.' };
    const key = await getWebPushKey();
    if (!key.publicKey) {
      return { state: 'NO_PROJECT', message: 'Web alerts are not set up on the server yet. You\'ll still get staff texts.' };
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      return { state: 'DENIED', message: 'Notifications are blocked for this site. Allow them in your browser or phone settings.' };
    }
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) as BufferSource });
    }
    const r = await registerWebPush(sub.toJSON(), prefs);
    return { state: 'REGISTERED', prefs: r.prefs, serverEnabled: r.enabled };
  } catch {
    return { state: 'FAILED', message: 'Could not turn on alerts. Check your connection and try again.' };
  }
}

// On sign-out: stop alerts to this browser. Best effort; runs before the session ends.
export async function unregisterWebPush() {
  if (!webPushSupported()) return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await removeWebPush(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch { /* ignore */ }
}

// Messages and confirmations that work on phones and in the web app. React Native's Alert does
// nothing in a browser, so the web app uses the browser's own dialogs.
import { Alert, Platform } from 'react-native';

const web = Platform.OS === 'web';

export function showMessage(title: string, message?: string): void {
  if (web) {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

// Resolves true when the person confirms.
export function confirmAction(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
  if (web) {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) === true);
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

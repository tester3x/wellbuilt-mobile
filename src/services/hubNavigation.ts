import { Alert, Linking } from 'react-native';

/** Opening the hub restores its account; it never starts or ends a shift. */
export async function backToSuite(): Promise<void> {
  try {
    await Linking.openURL('wellbuilt-suite://');
  } catch {
    Alert.alert('WB S unavailable', 'WB S could not be opened. Check that it is installed on this device.');
  }
}

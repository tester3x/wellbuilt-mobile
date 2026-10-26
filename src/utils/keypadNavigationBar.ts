import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { createNavigationBarVisibility } from './navigationBarVisibility';

const visibility = createNavigationBarVisibility(async hidden => {
  if (Platform.OS !== 'android') return;
  await NavigationBar.setBehaviorAsync(hidden ? 'overlay-swipe' : 'inset-touch').catch(() => {});
  await NavigationBar.setVisibilityAsync(hidden ? 'hidden' : 'visible');
});

export const refreshAppNavigationBar = () => visibility.refresh().catch(() => {});
export const hideNavigationForKeypad = (owner: object) => visibility.acquire(owner).catch(() => {});
export const releaseKeypadNavigation = (owner: object) => visibility.release(owner).catch(() => {});

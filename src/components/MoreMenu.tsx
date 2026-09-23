import React from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MORE_MENU_TOKENS } from '../constants/moreMenuTokens';

export interface MoreMenuProps {
  visible: boolean;
  onClose: () => void;
  onRouteMe: () => void;
  onSummary: () => void;
  onSwitchApps: () => void;
  bottomInset?: number;
}

export const moreMenuStyles = StyleSheet.create({
  moreMenuBackdrop: MORE_MENU_TOKENS.backdrop,
  moreMenuPopup: MORE_MENU_TOKENS.popup,
  moreMenuItem: MORE_MENU_TOKENS.item,
  moreMenuLabel: MORE_MENU_TOKENS.label,
  moreMenuDivider: MORE_MENU_TOKENS.divider,
});

/**
 * Single authoritative WellBuilt More Menu (•••) component.
 * Structurally matches WB-T c2318589 HomeScreen with in-app actions
 * separated from cross-app Switch Apps by a canonical divider.
 */
export function MoreMenu({
  visible,
  onClose,
  onRouteMe,
  onSummary,
  onSwitchApps,
  bottomInset = 0,
}: MoreMenuProps) {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={moreMenuStyles.moreMenuBackdrop} onPress={onClose}>
        <View
          style={[
            moreMenuStyles.moreMenuPopup,
            { bottom: bottomInset + 65, right: 16 },
          ]}
        >
          {/* In-app action 1: Route Me */}
          <TouchableOpacity
            style={moreMenuStyles.moreMenuItem}
            onPress={() => {
              onClose();
              onRouteMe();
            }}
            accessibilityRole="button"
            accessibilityLabel="Route Me"
          >
            <Ionicons
              name="navigate-outline"
              size={MORE_MENU_TOKENS.iconSize}
              color="#fff"
            />
            <Text style={moreMenuStyles.moreMenuLabel}>
              {t('nav.routeMe', { defaultValue: 'Route Me' })}
            </Text>
          </TouchableOpacity>

          {/* In-app action 2: Summary */}
          <TouchableOpacity
            style={moreMenuStyles.moreMenuItem}
            onPress={() => {
              onClose();
              onSummary();
            }}
            accessibilityRole="button"
            accessibilityLabel="Summary"
          >
            <Ionicons
              name="stats-chart-outline"
              size={MORE_MENU_TOKENS.iconSize}
              color="#fff"
            />
            <Text style={moreMenuStyles.moreMenuLabel}>
              {t('nav.summary', { defaultValue: 'Summary' })}
            </Text>
          </TouchableOpacity>

          {/* Structural separator between in-app actions and cross-app action */}
          <View style={moreMenuStyles.moreMenuDivider} />

          {/* Cross-app action: Switch Apps */}
          <TouchableOpacity
            style={moreMenuStyles.moreMenuItem}
            onPress={() => {
              onClose();
              onSwitchApps();
            }}
            accessibilityRole="button"
            accessibilityLabel="Switch Apps"
          >
            <Ionicons
              name="apps-outline"
              size={MORE_MENU_TOKENS.iconSize}
              color="#fff"
            />
            <Text style={moreMenuStyles.moreMenuLabel}>
              {t('nav.switchApps', { defaultValue: 'Switch Apps' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

export default MoreMenu;

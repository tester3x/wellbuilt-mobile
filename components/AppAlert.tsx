import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {
  widthPercentageToDP as wp,
  heightPercentageToDP as hp,
} from 'react-native-responsive-screen';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AppAlertProps {
  visible: boolean;
  title: string;
  message: string;
  buttons?: AlertButton[];
  onDismiss?: () => void;
}

/**
 * Custom styled alert component that matches the WellBuilt Mobile dark theme.
 * Use this instead of Alert.alert() for consistent styling across the app.
 *
 * Usage:
 * ```tsx
 * const [alertVisible, setAlertVisible] = useState(false);
 * const [alertConfig, setAlertConfig] = useState({ title: '', message: '', buttons: [] });
 *
 * // Show alert
 * setAlertConfig({
 *   title: 'Success',
 *   message: 'Driver approved!',
 *   buttons: [{ text: 'OK', onPress: () => setAlertVisible(false) }]
 * });
 * setAlertVisible(true);
 *
 * // In render
 * <AppAlert
 *   visible={alertVisible}
 *   title={alertConfig.title}
 *   message={alertConfig.message}
 *   buttons={alertConfig.buttons}
 *   onDismiss={() => setAlertVisible(false)}
 * />
 * ```
 */
export function AppAlert({
  visible,
  title,
  message,
  buttons = [{ text: 'OK' }],
  onDismiss,
}: AppAlertProps) {
  const handleButtonPress = (button: AlertButton) => {
    button.onPress?.();
    onDismiss?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.alertBox}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={[
            styles.buttonContainer,
            buttons.length === 1 && styles.buttonContainerSingle
          ]}>
            {buttons.map((button, index) => {
              const isDestructive = button.style === 'destructive';
              const isCancel = button.style === 'cancel';
              const isPrimary = !isDestructive && !isCancel && buttons.length > 1 && index === buttons.length - 1;

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.button,
                    buttons.length === 1 && styles.buttonSingle,
                    isCancel && styles.buttonCancel,
                    isDestructive && styles.buttonDestructive,
                    isPrimary && styles.buttonPrimary,
                  ]}
                  onPress={() => handleButtonPress(button)}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel && styles.buttonTextCancel,
                      isDestructive && styles.buttonTextDestructive,
                      isPrimary && styles.buttonTextPrimary,
                    ]}
                  >
                    {button.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Hook to easily manage AppAlert state
 */
export function useAppAlert() {
  const [visible, setVisible] = React.useState(false);
  const [config, setConfig] = React.useState<{
    title: string;
    message: string;
    buttons: AlertButton[];
  }>({
    title: '',
    message: '',
    buttons: [{ text: 'OK' }],
  });

  const show = (
    title: string,
    message: string,
    buttons?: AlertButton[]
  ) => {
    setConfig({
      title,
      message,
      buttons: buttons || [{ text: 'OK' }],
    });
    setVisible(true);
  };

  const hide = () => {
    setVisible(false);
  };

  const AlertComponent = () => (
    <AppAlert
      visible={visible}
      title={config.title}
      message={config.message}
      buttons={config.buttons}
      onDismiss={hide}
    />
  );

  return {
    show,
    hide,
    visible,
    AlertComponent,
  };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: wp('5%'),
  },
  alertBox: {
    backgroundColor: '#111827',
    borderRadius: hp('1.5%'),
    padding: hp('2.5%'),
    width: '90%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#374151',
  },
  title: {
    fontSize: hp('2.2%'),
    color: '#F9FAFB',
    fontWeight: '700',
    marginBottom: hp('1%'),
    textAlign: 'center',
  },
  message: {
    fontSize: hp('1.7%'),
    color: '#D1D5DB',
    textAlign: 'center',
    marginBottom: hp('2.5%'),
    lineHeight: hp('2.4%'),
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: wp('3%'),
  },
  buttonContainerSingle: {
    justifyContent: 'center',
  },
  button: {
    flex: 1,
    paddingVertical: hp('1.4%'),
    borderRadius: hp('0.8%'),
    backgroundColor: '#374151',
    alignItems: 'center',
  },
  buttonSingle: {
    flex: 0,
    paddingHorizontal: wp('10%'),
  },
  buttonCancel: {
    backgroundColor: '#374151',
  },
  buttonDestructive: {
    backgroundColor: '#7F1D1D',
  },
  buttonPrimary: {
    backgroundColor: '#2563EB',
  },
  buttonText: {
    fontSize: hp('1.6%'),
    color: '#F9FAFB',
    fontWeight: '600',
  },
  buttonTextCancel: {
    color: '#D1D5DB',
  },
  buttonTextDestructive: {
    color: '#FCA5A5',
  },
  buttonTextPrimary: {
    color: '#FFFFFF',
  },
});

export default AppAlert;

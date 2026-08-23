/**
 * Form-wide exclusive input ownership — ordinary QWERTY vs measurement keypad vs picker.
 */

export type FormInputOwnerType = 'ordinary' | 'measurement' | 'picker' | 'none';

export interface FormInputOwnershipState {
  measurementSessionOpen: boolean;
  measurementFieldKey: string | null;
  ordinaryFieldKey: string | null;
  pickerOpen: boolean;
}

export function assertExclusiveFormInputOwnership(state: FormInputOwnershipState): void {
  if (state.measurementSessionOpen && state.ordinaryFieldKey) {
    throw new Error(
      `dual input ownership: measurement=${state.measurementFieldKey ?? 'open'} ordinary=${state.ordinaryFieldKey}`,
    );
  }
  if (state.measurementSessionOpen && state.pickerOpen) {
    throw new Error('measurement session cannot stay open under an active picker');
  }
}

export function ownershipCleanupForType(type: FormInputOwnerType): {
  surrenderMeasurement: boolean;
  blurOrdinary: boolean;
  dismissKeyboard: boolean;
} {
  switch (type) {
    case 'ordinary':
      return { surrenderMeasurement: true, blurOrdinary: false, dismissKeyboard: false };
    case 'measurement':
      return { surrenderMeasurement: false, blurOrdinary: true, dismissKeyboard: true };
    case 'picker':
    case 'none':
      return { surrenderMeasurement: true, blurOrdinary: true, dismissKeyboard: true };
    default:
      return { surrenderMeasurement: false, blurOrdinary: false, dismissKeyboard: false };
  }
}
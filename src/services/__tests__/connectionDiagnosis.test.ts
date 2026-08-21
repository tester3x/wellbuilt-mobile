import {
  diagnoseHttpStatus,
  diagnoseNetInfo,
  diagnoseThrown,
  formatDiagnosis,
} from '../connectionDiagnosis';
import { displayTimeFromPacketId } from '../backendAccess';
import { classifyError } from '../../i18n/userFacingError';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';

describe('connection diagnosis', () => {
  test('no network is not auth', () => {
    expect(diagnoseNetInfo({ isConnected: false })).toEqual({
      kind: 'no_network', code: 'netinfo_disconnected', retryable: true,
    });
    expect(diagnoseThrown(new Error('Network request failed')).kind).toBe('no_network');
  });

  test('timeout vs unreachable', () => {
    const abort = new Error('aborted');
    (abort as any).name = 'AbortError';
    expect(diagnoseThrown(abort).kind).toBe('timeout');
    expect(diagnoseThrown(new Error('Cannot reach WellBuilt server')).kind).toBe('unreachable');
  });

  test('auth/session expiration is not connectivity loss', () => {
    const missing = new Error('missing');
    (missing as any).name = 'AuthSessionError';
    expect(diagnoseThrown(missing)).toEqual({ kind: 'auth_session', code: 'auth_missing', retryable: false });
    expect(diagnoseThrown(new Error('id_token_required')).kind).toBe('auth_session');
    expect(diagnoseHttpStatus(401).kind).toBe('auth_session');
  });

  test('permission denial is distinct from auth and offline', () => {
    expect(diagnoseHttpStatus(403).kind).toBe('permission');
    expect(diagnoseThrown(new Error('permission_denied')).kind).toBe('permission');
  });

  test('formatDiagnosis never includes secrets', () => {
    const line = formatDiagnosis(
      { kind: 'auth_session', code: 'http_401', retryable: false },
      'Bearer supersecret-token',
    );
    expect(line).toBe('auth_session [http_401]');
    expect(line).not.toMatch(/Bearer|supersecret/i);
  });
});

describe('classifyError kinds required by the operational UI', () => {
  test('maps the required failure classes', () => {
    expect(classifyError(new Error('id_token_required'))).toBe('authSession');
    expect(classifyError(new Error('permission_denied'))).toBe('permission');
    expect(classifyError(new Error('rejected by server'))).toBe('serverRejection');
    expect(classifyError(new Error('malformed packet'))).toBe('malformed');
    expect(classifyError(new Error('Cannot reach host'))).toBe('unreachable');
    const abort = new Error('aborted');
    (abort as any).name = 'AbortError';
    expect(classifyError(abort)).toBe('timeout');
  });

  test('EN and ES define the new safe messages', () => {
    const keys = [
      'network', 'noNetwork', 'server', 'timeout', 'unreachable',
      'authSession', 'permission', 'serverRejection', 'malformed',
      'retryableQueued', 'unknown', 'firebaseRead', 'firebaseWrite', 'updateRequired',
    ];
    for (const key of keys) {
      const enMsg = (en as any).errors[key] as string;
      const esMsg = (es as any).errors[key] as string;
      expect(enMsg.length).toBeGreaterThan(5);
      expect(esMsg.length).toBeGreaterThan(5);
      expect(enMsg).not.toMatch(/AIza|Bearer/i);
    }
  });
});

describe('packet-id display time (Unknown time repair)', () => {
  test('reconstructs local display time from a Gabriel-style packet id', () => {
    expect(displayTimeFromPacketId('20260819_135505_Gabriel3_zj6ije')).toBe('8/19/2026 1:55 PM');
    expect(displayTimeFromPacketId('20260819_113203_Gabriel5_7ndycj')).toBe('8/19/2026 11:32 AM');
  });

  test('empty / malformed ids yield empty string, never a fake time', () => {
    expect(displayTimeFromPacketId('')).toBe('');
    expect(displayTimeFromPacketId('queued_legacy')).toBe('');
  });
});

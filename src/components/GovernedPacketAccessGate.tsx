import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ensureGovernedProductionWaterAccess,
  governedUiKind,
  isGovernedPacketAccessEnabled,
  type GovernedReadyResult,
} from '../services/governedPacketAccess';

type Props = {
  jobId: string;
  disabled?: boolean;
  children: React.ReactNode;
};

export default function GovernedPacketAccessGate({ jobId, disabled, children }: Props) {
  const { t } = useTranslation();
  const governed = !disabled && isGovernedPacketAccessEnabled();
  const [result, setResult] = useState<GovernedReadyResult | null>(governed ? null : { ok: true, snapshot: null, kind: 'ok' });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (!isGovernedPacketAccessEnabled()) {
      setResult({ ok: true, snapshot: null, kind: 'ok' });
      return;
    }
    setResult(null);
    const next = await ensureGovernedProductionWaterAccess({ jobId, surface: 'open' });
    if (mounted.current) setResult(next);
  }, [jobId]);

  useEffect(() => {
    if (!governed) return;
    void run();
  }, [governed, run, attempt]);

  if (!governed) {
    return <>{children}</>;
  }

  if (!result) {
    return (
      <View style={styles.panel} accessibilityState={{ busy: true }}>
        <ActivityIndicator color="#F5C242" />
        <Text style={styles.body}>{t('governedPacket.verifying')}</Text>
      </View>
    );
  }

  if (!result.ok) {
    const ui = governedUiKind(result);
    const titleKey =
      ui === 'offline' ? 'governedPacket.offlineTitle'
      : ui === 'packet' ? 'governedPacket.packetTitle'
      : ui === 'missing' ? 'governedPacket.missingTitle'
      : 'governedPacket.networkTitle';
    const bodyKey =
      ui === 'offline' ? 'governedPacket.offlineBody'
      : ui === 'packet' ? 'governedPacket.packetBody'
      : ui === 'missing' ? 'governedPacket.missingBody'
      : 'governedPacket.networkBody';
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>{t(titleKey)}</Text>
        <Text style={styles.body}>{t(bodyKey)}</Text>
        {result.retryable ? (
          <TouchableOpacity
            style={styles.retry}
            onPress={() => setAttempt((n) => n + 1)}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t('governedPacket.retry')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: '#05060B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: '#F5C242',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    color: '#D1D5DB',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
  },
  retry: {
    marginTop: 20,
    backgroundColor: '#F5C242',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#111827',
    fontWeight: '700',
  },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ensureGovernedProductionWaterAccess,
  governedUiKind,
  isGovernedPacketAccessEnabled,
  type GovernedReadyResult,
} from '../services/governedPacketAccess';
import type { ExecutionBindingSnapshot } from '../services/governedPacketAccessMemory';

type Props = {
  jobId: string;
  queryWellName?: string;
  disabled?: boolean;
  onResolved?: (snapshot: ExecutionBindingSnapshot | null) => void;
  children: React.ReactNode;
};

export default function GovernedPacketAccessGate({ jobId, queryWellName, disabled, onResolved, children }: Props) {
  const { t } = useTranslation();
  const id = typeof jobId === 'string' ? jobId.trim() : '';
  const governed = !disabled && isGovernedPacketAccessEnabled() && !!id;
  const [result, setResult] = useState<GovernedReadyResult | null>(governed ? null : { ok: true, snapshot: null, kind: 'ok' });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (!id || !isGovernedPacketAccessEnabled()) {
      setResult({ ok: true, snapshot: null, kind: 'ok' });
      onResolved?.(null);
      return;
    }
    setResult(null);
    const next = await ensureGovernedProductionWaterAccess({ jobId: id, surface: 'open', queryWellName });
    if (mounted.current) {
      setResult(next);
      onResolved?.(next.ok ? next.snapshot : null);
    }
  }, [id, queryWellName, onResolved]);

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
      <View style={{ flex: 1 }}>
        <View style={styles.banner}>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>{t(titleKey)}</Text>
            <Text style={styles.bannerBody}>{t(bodyKey)}</Text>
          </View>
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
        {children}
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
  body: {
    color: '#D1D5DB',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
  },
  banner: {
    backgroundColor: '#1C1917',
    borderBottomWidth: 1,
    borderBottomColor: '#F5C242',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerContent: {
    flex: 1,
    marginRight: 10,
  },
  bannerTitle: {
    color: '#F5C242',
    fontSize: 13,
    fontWeight: '700',
  },
  bannerBody: {
    color: '#D1D5DB',
    fontSize: 11,
    marginTop: 2,
  },
  retry: {
    backgroundColor: '#F5C242',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 12,
  },
});

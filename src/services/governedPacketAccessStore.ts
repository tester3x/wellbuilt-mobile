import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  invalidatePersistedExecutionBindingInKv,
  loadPersistedExecutionBindingFromKv,
  persistExecutionBindingToKv,
  type BindingAcceptResult,
  type SessionIdentity,
} from './governedPacketAccessCore';
import type { ExecutionBindingSnapshot } from './governedPacketAccessMemory';

export async function persistExecutionBinding(snapshot: ExecutionBindingSnapshot): Promise<void> {
  await persistExecutionBindingToKv(AsyncStorage, snapshot);
}

export async function loadPersistedExecutionBinding(input: {
  jobId: string;
  session: SessionIdentity;
}): Promise<BindingAcceptResult> {
  return loadPersistedExecutionBindingFromKv(AsyncStorage, input);
}

export async function invalidatePersistedExecutionBinding(jobId: string): Promise<void> {
  await invalidatePersistedExecutionBindingInKv(AsyncStorage, jobId);
}

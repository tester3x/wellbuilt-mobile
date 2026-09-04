/**
 * Privacy-safe phase timing for the two blocking transactional flows
 * (new-pull submit, edit save). Purpose: diagnose the variable submit latency
 * reported after the security/session update WITHOUT logging any sensitive data.
 *
 * What is recorded (operational metadata only):
 *   - operation type: 'create' | 'edit'
 *   - per-phase durations (monotonic clock)
 *   - online/offline at start
 *   - outcome: 'success' | 'queued' | 'timeout' | 'failure'
 *   - warm/cold auth hint when determinable (was a Firebase user already present)
 *
 * What is NEVER recorded (enforced by construction — the API accepts only the
 * fields above; there is no free-form payload channel):
 *   - passcodes / tokens / driver identity / well names / pull values /
 *     ticket contents / request or response bodies.
 *
 * Traces stay LOCAL: an in-memory ring buffer, readable for tests and (in dev)
 * summarized to the console in redacted form. No network egress here.
 */

export type SubmitOp = 'create' | 'edit';
export type SubmitOutcome = 'success' | 'queued' | 'timeout' | 'failure';

/** The ten canonical submit phases, in order. */
export const SUBMIT_PHASES = [
  'tap', // 1. button tap received
  'validation', // 2. client validation complete
  'durableWrite', // 3. local durable record / op-queue write complete
  'sessionRetrieval', // 4. driver session retrieval complete
  'authReadiness', // 5. Firebase user/token/auth readiness complete
  'revalidation', // 6. any session revalidation complete
  'requestBegin', // 7. network request / enqueue begins
  'serverAck', // 8. server acknowledgement or status result
  'reconcile', // 9. local reconciliation complete
  'navigate', // 10. navigation away from the form
] as const;

export type SubmitPhase = (typeof SUBMIT_PHASES)[number];

/** Monotonic clock — immune to wall-clock adjustments. Falls back to Date.now. */
export function monotonicNow(): number {
  const p: { now?: () => number } | undefined = (globalThis as any).performance;
  if (p && typeof p.now === 'function') return p.now();
  return Date.now();
}

export interface SubmitTraceSummary {
  traceId: string;
  op: SubmitOp;
  online: boolean;
  warmAuth: boolean | null;
  outcome: SubmitOutcome | null;
  /** Milliseconds from the FIRST mark to each marked phase (cumulative). */
  atMs: Partial<Record<SubmitPhase, number>>;
  /** Milliseconds spent in each phase (delta from the previous mark). */
  phaseMs: Partial<Record<SubmitPhase, number>>;
  totalMs: number | null;
}

let _seq = 0;
const RING_MAX = 50;
const _ring: SubmitTraceSummary[] = [];

/** Non-crypto trace id: sequence + monotonic stamp. Contains no identity. */
function nextTraceId(op: SubmitOp): string {
  _seq = (_seq + 1) % 1_000_000;
  return `${op}-${Math.floor(monotonicNow())}-${_seq}`;
}

export class SubmitTrace {
  readonly traceId: string;
  readonly op: SubmitOp;
  private online = true;
  private warmAuth: boolean | null = null;
  private outcome: SubmitOutcome | null = null;
  private readonly start: number;
  private prev: number;
  private readonly atMs: Partial<Record<SubmitPhase, number>> = {};
  private readonly phaseMs: Partial<Record<SubmitPhase, number>> = {};
  private ended = false;

  constructor(op: SubmitOp) {
    this.op = op;
    this.traceId = nextTraceId(op);
    this.start = monotonicNow();
    this.prev = this.start;
  }

  setOnline(online: boolean): this {
    this.online = !!online;
    return this;
  }

  /** Warm auth = a Firebase user object already existed when the op started. */
  setWarmAuth(warm: boolean): this {
    this.warmAuth = !!warm;
    return this;
  }

  /** Record that a phase just completed. Idempotent per phase (first wins). */
  mark(phase: SubmitPhase): this {
    if (this.ended || phase in this.atMs) return this;
    const now = monotonicNow();
    this.atMs[phase] = now - this.start;
    this.phaseMs[phase] = now - this.prev;
    this.prev = now;
    return this;
  }

  /** Finish the trace with an outcome; pushes a redacted summary to the ring. */
  end(outcome: SubmitOutcome): SubmitTraceSummary {
    if (!this.ended) {
      this.outcome = outcome;
      this.ended = true;
    }
    const summary: SubmitTraceSummary = {
      traceId: this.traceId,
      op: this.op,
      online: this.online,
      warmAuth: this.warmAuth,
      outcome: this.outcome,
      atMs: { ...this.atMs },
      phaseMs: { ...this.phaseMs },
      totalMs: this.atMs.navigate ?? this.atMs.reconcile ?? this.atMs.serverAck ?? null,
    };
    _ring.push(summary);
    if (_ring.length > RING_MAX) _ring.shift();
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // Redacted, operational-only. No identity/payload is present in `summary`.
      // eslint-disable-next-line no-console
      console.log(
        `[SubmitTiming] ${summary.op} ${summary.outcome} online=${summary.online} warmAuth=${summary.warmAuth} total=${summary.totalMs}ms`,
        summary.phaseMs,
      );
    }
    return summary;
  }
}

/** Start a new trace for an operation. */
export function startSubmitTrace(op: SubmitOp): SubmitTrace {
  return new SubmitTrace(op);
}

/** Read-only view of recent local traces (for a diagnostics screen / tests). */
export function getRecentSubmitTraces(): SubmitTraceSummary[] {
  return _ring.slice();
}

/** Test/util helper — clears the in-memory ring. */
export function __clearSubmitTraces(): void {
  _ring.length = 0;
  _seq = 0;
}

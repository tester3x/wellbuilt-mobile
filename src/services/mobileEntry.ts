/** Bounded, cancellable app-open attempt. Never logs credentials or owner hints. */
export function startMobileEntry(ops: {
  established(): Promise<boolean>;
  authorize(): Promise<{ authorizeUrl: string }>;
  open(url: string): Promise<unknown>;
  ready(): void;
  failed(): void;
}): () => void {
  let active = true;
  let recoveryStarted = false;
  console.info('[MobileEntry] checking');
  const finish = (ready: boolean) => {
    if (!active) return;
    active = false;
    clearTimeout(recovery);
    clearTimeout(deadline);
    console.info('[MobileEntry]', ready ? 'ready' : 'retry-required');
    if (ready) ops.ready(); else ops.failed();
  };
  // Re-read established access if Android restores a stranded handoff screen.
  // Never mint a second PKCE attempt or replay a code on this timer.
  const recovery = setTimeout(() => {
    recoveryStarted = true;
    console.info('[MobileEntry] rechecking-established-access');
    void ops.established().then(ready => { if (ready) finish(true); }).catch(() => {});
  }, 8000);
  const deadline = setTimeout(() => finish(false), 20000);
  void (async () => {
    if (await ops.established()) { finish(true); return; }
    if (!active || recoveryStarted) return;
    const { authorizeUrl } = await ops.authorize();
    if (!active || recoveryStarted) return;
    await ops.open(authorizeUrl);
  })().catch(error => {
    if (error?.message !== 'sso_attempt_in_progress') finish(false);
  });
  return () => { active = false; clearTimeout(recovery); clearTimeout(deadline); };
}

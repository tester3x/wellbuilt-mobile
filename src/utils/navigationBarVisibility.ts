/** Serialize native visibility changes; overlapping input owners cannot restore
 * the bar while another keypad still owns it. Read desired state at execution
 * time so a queued hide cannot win after its keypad has already closed. */
export function createNavigationBarVisibility(apply: (hidden: boolean) => Promise<void>) {
  const owners = new Set<object>();
  let pending = Promise.resolve();
  const refresh = () => {
    pending = pending.catch(() => {}).then(() => apply(owners.size > 0));
    return pending;
  };
  return {
    refresh,
    acquire(owner: object) { owners.add(owner); return refresh(); },
    release(owner: object) { owners.delete(owner); return refresh(); },
  };
}

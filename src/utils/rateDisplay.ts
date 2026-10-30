/** Presentation only: retain full precision in inventory and forecast calculations. */
export function formatRateDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'N/A';
  const seconds = Math.round(minutes * 60);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  return hours > 0 ? `${hours}h ${mins}m ${secs}s` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function displayConsumptionDaily(daily: number | null | undefined): number | null {
  return daily != null && Number.isFinite(daily) && daily >= 0 ? Math.round(daily * 10) / 10 : null;
}

/** Include down wells on represented routes, within the current authorized
 * catalog. This is a summary-only view; it never changes saved well selections.
 */
export function selectSummaryWellNames(
  selected: string[],
  scopedConfig: Record<string, { route?: string }>,
  downWells: ReadonlySet<string>,
): string[] {
  const selectedSet = new Set(selected.filter(name => Object.prototype.hasOwnProperty.call(scopedConfig, name)));
  const routes = new Set([...selectedSet].map(name => scopedConfig[name].route || 'Unknown'));
  return Object.keys(scopedConfig).filter(name =>
    selectedSet.has(name) || (downWells.has(name) && routes.has(scopedConfig[name].route || 'Unknown')),
  );
}

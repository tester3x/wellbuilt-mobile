/** Display order is shared by successful loads and recovery, never by selection storage. */
export function wellDisplayOrder(names: readonly string[], config: Record<string, any> | null,
  savedRouteOrder: unknown, previous: readonly string[] = []): string[] {
  const order = Array.isArray(savedRouteOrder) ? savedRouteOrder.filter((v): v is string => typeof v === 'string') : [];
  const route = (name: string) => typeof config?.[name]?.route === 'string' ? config[name].route.trim() : '';
  // A temporarily incomplete catalogue cannot turn a previously grouped list
  // into one global alphabetic list. Eligibility still comes from this load.
  if (previous.length && names.some(name => !route(name))) {
    const eligible = new Set(names), known = new Set(previous);
    return [...previous.filter(name => eligible.has(name)), ...names.filter(name => !known.has(name))];
  }
  return [...names].sort((a,b) => {
    const ra=route(a)||'Unknown',rb=route(b)||'Unknown';
    const ia=order.indexOf(ra),ib=order.indexOf(rb);
    if(ia!==ib && (ia>=0||ib>=0)) return (ia<0?Infinity:ia)-(ib<0?Infinity:ib);
    return ra.localeCompare(rb)||a.localeCompare(b);
  });
}

/** Picker indices belong to its frozen list, not a later background catalogue. */
export function pickerWellIndex(snapshot: readonly string[], index: number, current: readonly string[]): number {
  const well=snapshot[index];
  return well===undefined ? -1 : current.indexOf(well);
}

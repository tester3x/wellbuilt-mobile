/**
 * WB-M G-014R1 governed packet-driven Production Water access.
 *
 * Default OFF. Current 7d87f17 well-pull / eligibility / history / DDJD /
 * Route Me / AppSwitcher / bootstrap behavior is unchanged while this
 * constant is false.
 *
 * A later authorized field-test build enables it by changing ONLY this
 * constant to true, then producing one authorized APK. The packet
 * definition cannot enable this flag. No remote-config.
 *
 * Location: src/services/governedPacketAccessFlag.ts
 */
export const GOVERNED_PACKET_ACCESS: boolean = true;

export function isGovernedPacketAccessEnabled(): boolean {
  return GOVERNED_PACKET_ACCESS === true;
}

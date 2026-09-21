/**
 * WB-M G-014 governed packet-driven Production Water access.
 *
 * Default OFF. Existing well-pull / eligibility / history behavior is
 * unchanged while this constant is false.
 *
 * A later authorized field-test build enables it by changing ONLY this
 * constant to true, then producing one authorized APK. The packet
 * definition cannot enable this flag. No remote-config.
 *
 * Location: src/services/governedPacketAccessFlag.ts
 */
export const GOVERNED_PACKET_ACCESS: boolean = false;

export function isGovernedPacketAccessEnabled(): boolean {
  return GOVERNED_PACKET_ACCESS === true;
}

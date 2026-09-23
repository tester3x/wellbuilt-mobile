/**
 * Authoritative design tokens for the WellBuilt More menu (•••).
 * Structurally identical to WB-T (c2318589 HomeScreen.tsx:6370-6411).
 */
export const MORE_MENU_TOKENS = {
  popup: {
    position: 'absolute' as const,
    right: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 4,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  item: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    gap: 12,
  },
  label: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: '#fff',
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginHorizontal: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  triggerDots: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700' as const,
    lineHeight: 24,
    textAlign: 'center' as const,
  },
  iconSize: 20,
} as const;

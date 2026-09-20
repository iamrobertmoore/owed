/**
 * Held paper. A document rests above the edge of the ledger that keeps it.
 * Broad shapes and a four-unit gap survive at 16px. Ink and paper leave the
 * recovery and outstanding colours to actual amounts in the interface.
 */
export function Mark({ size = 38 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Owed">
      <rect width="64" height="64" rx="14" fill="#101418" />
      <path d="M24 12h16l8 8v20H24z" fill="#F2EFE9" />
      <path d="M40 12v8h8" fill="#101418" opacity="0.25" />
      <path d="M12 24h8v20h28v8H12z" fill="#F2EFE9" />
      <path d="M30 28h12v4H30z" fill="#101418" />
    </svg>
  );
}

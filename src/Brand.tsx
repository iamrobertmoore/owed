/**
 * The mark, inline. A receipt: the record is the product. Two lines of recorded
 * terms and one green amount, because the amount is the point.
 */
export function Mark({ size = 38 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Owed">
      <rect width="64" height="64" rx="14" fill="#101418" />
      <path
        d="M20 12h24a2 2 0 0 1 2 2v34.5l-3.5-2.6-3.5 2.6-3.5-2.6-3.5 2.6-3.5-2.6-3.5 2.6-3.5-2.6V14a2 2 0 0 1 2-2Z"
        fill="#FAF8F5"
      />
      <rect x="25" y="21" width="14" height="3" rx="1.5" fill="#101418" opacity="0.55" />
      <rect x="25" y="28" width="9" height="3" rx="1.5" fill="#101418" opacity="0.55" />
      <rect x="25" y="36" width="14" height="4" rx="2" fill="#0E7C5A" />
      <rect x="25" y="42.5" width="14" height="1.5" rx="0.75" fill="#0E7C5A" />
    </svg>
  );
}

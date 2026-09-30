export function StatusBadge({
  status,
  showDot = true,
}: {
  status: string;
  showDot?: boolean;
}) {
  return (
    <span className={`badge ${status}`}>
      {showDot && <span />}
      {status}
    </span>
  );
}

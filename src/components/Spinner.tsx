export function Spinner({ size = 16 }: { size?: number }) {
  const s = size;
  return (
    <span
      aria-label="loading"
      style={{
        display: "inline-block",
        width: s,
        height: s,
        borderRadius: "50%",
        border: `${Math.max(2, Math.round(s / 8))}px solid #e5e7eb`,
        borderTopColor: "#2563eb",
        animation: "spin 0.9s linear infinite"
      }}
    />
  );
}

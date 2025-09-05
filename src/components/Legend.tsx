type Counts = Record<string, number>;

export function Legend({
  byType = {},
  byStatus = {}
}: { byType?: Counts; byStatus?: Counts }) {
  const typeChips: Array<[string, string]> = [
    ["site", "#1463FF"],
    ["vehicle", "#16a34a"],
    ["equipment", "#9333ea"],
    ["crew", "#f43f5e"],
    ["geofence", "#f59e0b"],
    ["route", "#1f2937"]
  ];
  const statusChips: Array<[string, string]> = [
    ["active", "#16a34a"],
    ["maintenance", "#f59e0b"],
    ["offline", "#ef4444"]
  ];

  return (
    <div style={{
      position: "absolute", bottom: 12, left: 12, background: "white",
      border: "1px solid #e5e7eb", borderRadius: 10, padding: 10,
      boxShadow: "0 6px 18px rgba(0,0,0,0.08)", minWidth: 220
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Legend</div>

      <div style={{ fontSize: 11, color: "#374151", marginBottom: 6 }}>Types</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        {typeChips.map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: color, border: "1px solid #d1d5db" }} />
            <span style={{ fontSize: 12 }}>{label}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
              {byType[label] ?? 0}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#374151", marginBottom: 6 }}>Status</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {statusChips.map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: color, border: "1px solid #d1d5db" }} />
            <span style={{ fontSize: 12 }}>{label}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
              {byStatus[label] ?? 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

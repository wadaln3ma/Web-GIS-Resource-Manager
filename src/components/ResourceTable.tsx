type Feature = { type: "Feature"; id?: number; geometry: any; properties: any };
type Row = { id: number; name: string; rtype: string; status: string; props: any; geomType: string };

function toRows(features: Feature[]): Row[] {
  return (features || []).map((f) => ({
    id: Number(f.properties?.id),
    name: String(f.properties?.name ?? ""),
    rtype: String(f.properties?.rtype ?? "site"),
    status: String(f.properties?.status ?? "active"),
    props: Object.fromEntries(Object.entries(f.properties || {}).filter(([k]) => !["id","name","rtype","status"].includes(k))),
    geomType: f.geometry?.type ?? "Unknown"
  })).filter(r => Number.isFinite(r.id));
}

export function ResourceTable({
  features,
  onZoom,
  onEditCell,
  onDelete,
  onSelect
}: {
  features: Feature[];
  onZoom: (id: number) => void;
  onEditCell: (id: number, patch: any) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onSelect: (id: number) => void;
}) {
  const rows: Row[] = toRows(features);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <Th>ID</Th>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Geom</Th>
          <Th>Props</Th>
          <Th>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
            <Td>{r.id}</Td>
            <Td>
              <input
                defaultValue={r.name}
                onBlur={(e) => onEditCell(r.id, { p_name: e.target.value || null })}
                style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
              />
            </Td>
            <Td>
              <select
                defaultValue={r.rtype}
                onChange={(e) => onEditCell(r.id, { p_rtype: e.target.value })}
                style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
              >
                {["site","vehicle","equipment","crew","geofence","route"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Td>
            <Td>
              <select
                defaultValue={r.status}
                onChange={(e) => onEditCell(r.id, { p_status: e.target.value })}
                style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
              >
                {["active","maintenance","offline"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Td>
            <Td>{r.geomType}</Td>
            <Td>
              <details>
                <summary style={{ cursor: "pointer", color: "#2563eb" }}>
                  {Object.keys(r.props).length} fields
                </summary>
                <textarea
                  defaultValue={JSON.stringify(r.props, null, 2)}
                  onBlur={(e) => {
                    try {
                      const obj = e.target.value.trim() ? JSON.parse(e.target.value) : null;
                      onEditCell(r.id, { p_properties: obj });
                    } catch {
                      // noop; basic UI — could show toast in page
                      e.currentTarget.style.outline = "2px solid #ef4444";
                      setTimeout(() => { e.currentTarget.style.outline = "none"; }, 800);
                    }
                  }}
                  rows={6}
                  style={{ width: "100%", fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid #ddd", marginTop: 6 }}
                />
              </details>
            </Td>
            <Td>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onZoom(r.id)} title="Zoom to" style={btn}>🔎</button>
                <button onClick={() => onSelect(r.id)} title="Open in panel" style={btn}>✎</button>
                <button onClick={() => onDelete(r.id)} title="Delete" style={{ ...btn, background: "#fee2e2" }}>🗑</button>
              </div>
            </Td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><Td colSpan={7} style={{ textAlign: "center", color: "#666", padding: 20 }}>No features.</Td></tr>
        )}
      </tbody>
    </table>
  );
}

function Th({ children }: any) {
  return <th style={{ textAlign: "left", fontWeight: 600, padding: "6px 8px", fontSize: 12, color: "#374151" }}>{children}</th>;
}
function Td({ children, ...rest }: any) {
  return <td {...rest} style={{ padding: "6px 8px", verticalAlign: "top" }}>{children}</td>;
}
const btn: React.CSSProperties = { padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, background: "#fff" };

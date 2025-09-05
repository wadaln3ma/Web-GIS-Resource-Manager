// src/components/WorkOrders.tsx
"use client";

import React, { useMemo, useState } from "react";

export type WorkOrderStatus = "open" | "in_progress" | "blocked" | "done";
export type WorkOrderPriority = "low" | "medium" | "high" | "urgent";

export type WorkOrder = {
  id: number;
  title: string;
  resource_id: number | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  assignee?: string | null;
  due_date?: string | null; // ISO date (YYYY-MM-DD)
  notes?: string | null;
  created_at?: string;
};

type Props = {
  list: WorkOrder[];
  /** Called when the user creates a new work order */
  onCreate?: (payload: Omit<WorkOrder, "id" | "created_at">) => Promise<void> | void;
  /** Called when a single field is changed for an existing item */
  onUpdate?: (id: number, patch: Partial<WorkOrder>) => Promise<void> | void;
  /** Called when the user deletes an item */
  onDelete?: (id: number) => Promise<void> | void;
  /** Optional: resource options for the selector */
  resourceOptions?: Array<{ id: number; name: string }>;
};

const STATUSES: WorkOrderStatus[] = ["open", "in_progress", "blocked", "done"];
const PRIORITIES: WorkOrderPriority[] = ["low", "medium", "high", "urgent"];

export function WorkOrders({
  list,
  onCreate,
  onUpdate,
  onDelete,
  resourceOptions = [],
}: Props) {
  // New WO form state
  const [title, setTitle] = useState("");
  const [resourceId, setResourceId] = useState<number | "">("");
  const [status, setStatus] = useState<WorkOrderStatus>("open");
  const [priority, setPriority] = useState<WorkOrderPriority>("medium");
  const [assignee, setAssignee] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const canCreate = title.trim().length > 0;

  async function handleCreate() {
    if (!onCreate) return;
    if (!canCreate) return;

    await onCreate({
      title: title.trim(),
      resource_id: resourceId === "" ? null : Number(resourceId),
      status,
      priority,
      assignee: assignee.trim() || null,
      due_date: dueDate || null,
      notes: notes.trim() || null,
    });

    // Reset
    setTitle("");
    setResourceId("");
    setStatus("open");
    setPriority("medium");
    setAssignee("");
    setDueDate("");
    setNotes("");
  }

  const ordered = useMemo(() => {
    // simple sort: urgent/high first, then due date asc, then open/in_progress/blocked/done
    const prioRank: Record<WorkOrderPriority, number> = {
      urgent: 0, high: 1, medium: 2, low: 3,
    };
    const statusRank: Record<WorkOrderStatus, number> = {
      open: 0, in_progress: 1, blocked: 2, done: 3,
    };
    return [...list].sort((a, b) => {
      const p = prioRank[a.priority] - prioRank[b.priority];
      if (p !== 0) return p;
      const da = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
      const db = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return statusRank[a.status] - statusRank[b.status];
    });
  }, [list]);

  return (
    <div className="wo-wrap">
      <div className="wo-head">
        <strong>Work Orders</strong>
      </div>

      {/* Create form */}
      <div className="wo-create">
        <input
          className="input"
          placeholder="Title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <select
          className="select"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value === "" ? "" : Number(e.target.value))}
        >
          <option value="">Unassigned resource</option>
          {resourceOptions.map((r) => (
            <option key={r.id} value={r.id}>{r.name} (#{r.id})</option>
          ))}
        </select>

        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
        </select>

        <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as WorkOrderPriority)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{labelPriority(p)}</option>)}
        </select>

        <input
          className="input"
          placeholder="Assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        />

        <input
          className="input"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />

        <textarea
          className="textarea"
          placeholder="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <button className="btn blue" onClick={handleCreate} disabled={!canCreate}>Add</button>
      </div>

      {/* List */}
      <div className="wo-list">
        {ordered.map((wo) => (
          <div key={wo.id} className="wo-item">
            <div className="wo-main">
              <div className="wo-title">
                <span className={`prio prio-${wo.priority}`} title={`Priority: ${wo.priority}`} />
                {wo.title}
              </div>
              <div className="wo-meta">
                #{wo.id}
                {wo.resource_id != null && <> · res {wo.resource_id}</>}
                {wo.due_date && <> · due {wo.due_date}</>}
                {wo.assignee && <> · {wo.assignee}</>}
              </div>
            </div>

            <div className="wo-editors">
              <select
                className="select-sm"
                value={wo.status}
                onChange={(e) => onUpdate?.(wo.id, { status: e.target.value as WorkOrderStatus })}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
              </select>

              <select
                className="select-sm"
                value={wo.priority}
                onChange={(e) => onUpdate?.(wo.id, { priority: e.target.value as WorkOrderPriority })}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{labelPriority(p)}</option>)}
              </select>

              <button className="btn-sm danger" onClick={() => onDelete?.(wo.id)}>Delete</button>
            </div>
          </div>
        ))}

        {/* ✅ FIXED: use && (not `and`) */}
        {ordered.length === 0 && (
          <div style={{ color: "#888", fontSize: 13 }}>No work orders yet.</div>
        )}
      </div>

      <style jsx>{`
        .wo-wrap { border:1px solid #eee; border-radius:12px; background:#fff; overflow:hidden; }
        .wo-head { padding:10px 12px; border-bottom:1px solid #eee; background:#fafafa; }
        .wo-create { display:grid; gap:8px; grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr; padding:10px; border-bottom:1px dashed #eee; }
        .wo-create .textarea { grid-column: 1 / -2; }
        .wo-create .btn { align-self: center; }

        .wo-list { padding:8px; display:grid; gap:8px; }
        .wo-item { display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center; border:1px solid #eee; border-radius:10px; padding:8px; }
        .wo-title { font-weight:600; display:flex; align-items:center; gap:6px; }
        .wo-meta { color:#666; font-size:12px; margin-top:2px; }
        .wo-editors { display:flex; gap:6px; align-items:center; }

        .prio { width:10px; height:10px; border-radius:50%; display:inline-block; }
        .prio-low { background:#a3e635; }
        .prio-medium { background:#fde047; }
        .prio-high { background:#fb923c; }
        .prio-urgent { background:#ef4444; }

        .input, .select, .textarea {
          padding: 8px; border-radius: 10px; border: 1px solid #e5e7eb;
        }
        .select-sm, .btn-sm { font-size:12px; padding: 4px 8px; border-radius: 8px; }
        .btn { border:1px solid #e5e7eb; background:#fff; border-radius:10px; padding:8px 12px; cursor:pointer; }
        .btn.blue { background:#eef6ff; }
        .btn-sm.danger { background:#fee2e2; border:1px solid #fca5a5; }
      `}</style>
    </div>
  );
}

function labelStatus(s: WorkOrderStatus) {
  switch (s) {
    case "open": return "Open";
    case "in_progress": return "In progress";
    case "blocked": return "Blocked";
    case "done": return "Done";
    default: return s;
  }
}
function labelPriority(p: WorkOrderPriority) {
  switch (p) {
    case "low": return "Low";
    case "medium": return "Medium";
    case "high": return "High";
    case "urgent": return "Urgent";
    default: return p;
  }
}

"use client";

import { useState } from "react";
import { FIXED_ROOT, roots } from "@/lib/resumeModel";

export default function AddSectionModal({ items, onClose, onAdd }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState("jobs");
  const [parentId, setParentId] = useState("");

  const parentOptions = roots(items).filter((r) => FIXED_ROOT.indexOf(r.id) < 0);

  function submit() {
    if (!label.trim()) return;
    onAdd({ label: label.trim(), type, parentId: parentId || null });
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 440 }}>
        <div className="modal-header">
          <h3>Add section</h3>
          <button className="modal-close" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Section title</label>
            <input className="field-input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </div>
          <div className="field-group">
            <label className="field-label">Type</label>
            <select className="field-input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="jobs">Jobs / experience</option>
              <option value="summary">Summary</option>
              <option value="list">List</option>
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Nest under</label>
            <select className="field-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— Root level —</option>
              {parentOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Add</button>
        </div>
      </div>
    </div>
  );
}

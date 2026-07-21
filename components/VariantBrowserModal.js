"use client";

import { useState } from "react";

export default function VariantBrowserModal({ variants, currentVariant, onClose, onLoad, onDelete }) {
  const [filter, setFilter] = useState("");
  const shown = variants.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 760 }}>
        <div className="modal-header">
          <h3>All variants ({variants.length})</h3>
          <button className="modal-close" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="vb-search-row">
            <input className="vb-search" placeholder="Search variants…" autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="vb-grid">
            {!shown.length && (
              <div className="vb-none">{variants.length ? `No variants match "${filter}"` : "No saved variants yet — use Save as… to create one"}</div>
            )}
            {shown.map((v) => {
              const active = v.name === currentVariant;
              return (
                <div className={"vb-card" + (active ? " active-variant" : "")} key={v.id}>
                  {active && <span className="vb-card-badge">Currently open</span>}
                  <div className="vb-card-name">{v.name}</div>
                  <div className="vb-card-actions">
                    {active ? (
                      <button className="btn" onClick={() => onLoad(v.name)}><i className="ti ti-device-floppy" /> Save</button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => onLoad(v.name)}><i className="ti ti-upload" /> Load</button>
                    )}
                    <button className="btn vb-del" title="Delete" onClick={() => onDelete(v.name)}><i className="ti ti-trash" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

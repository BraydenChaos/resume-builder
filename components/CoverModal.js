"use client";

import { useState } from "react";

export default function CoverModal({ cover, headerName, onClose, onSave }) {
  const [salutation, setSalutation] = useState(cover.salutation || "");
  const [bodyText, setBodyText] = useState((cover.body || []).join("\n\n"));
  const [signoff, setSignoff] = useState(cover.signoff || "");
  const [signName, setSignName] = useState(cover.signName || "");

  function save() {
    onSave({
      salutation,
      body: bodyText.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length),
      signoff,
      signName,
    });
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) save(); }}>
      <div className="modal">
        <div className="modal-header">
          <h3>Edit cover letter</h3>
          <button className="modal-close" onClick={save}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Salutation</label>
            <input className="field-input" value={salutation} onChange={(e) => setSalutation(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Body (separate paragraphs with a blank line)</label>
            <textarea className="field-input" rows={13} style={{ lineHeight: 1.5 }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
          </div>
          <div className="row-2">
            <div className="field-group">
              <label className="field-label">Sign-off</label>
              <input className="field-input" value={signoff} onChange={(e) => setSignoff(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">Signature name (blank uses header name)</label>
              <input className="field-input" placeholder={headerName} value={signName} onChange={(e) => setSignName(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Done</button>
        </div>
      </div>
    </div>
  );
}

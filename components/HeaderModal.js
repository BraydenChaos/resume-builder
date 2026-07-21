"use client";

import { useState } from "react";

export default function HeaderModal({ header, onClose, onSave }) {
  const [name, setName] = useState(header.name);
  const [title, setTitle] = useState(header.title);
  const [contact, setContact] = useState(header.contact.map((c) => ({ ...c })));

  function updateContact(i, field, value) {
    setContact((prev) => prev.map((c, ci) => (ci === i ? { ...c, [field]: value } : c)));
  }
  function removeContact(i) { setContact((prev) => prev.filter((_, ci) => ci !== i)); }
  function addContact() { setContact((prev) => [...prev, { text: "", url: "" }]); }

  function save() { onSave({ name, title, contact }); }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) save(); }}>
      <div className="modal" style={{ width: 560 }}>
        <div className="modal-header">
          <h3>Edit header</h3>
          <button className="modal-close" onClick={save}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Full name</label>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Title / tagline</label>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field-group" style={{ marginTop: 4 }}><label className="field-label">Contact items</label></div>
          {contact.map((c, i) => (
            <div className="job-editor" style={{ gap: 8, padding: 10 }} key={i}>
              <div className="row-2">
                <div className="field-group">
                  <label className="field-label">Label</label>
                  <input className="field-input" value={c.text} onChange={(e) => updateContact(i, "text", e.target.value)} />
                </div>
                <div className="field-group">
                  <label className="field-label">URL (optional)</label>
                  <input className="field-input" placeholder="https:// or mailto:" value={c.url} onChange={(e) => updateContact(i, "url", e.target.value)} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <button className="del-btn" onClick={() => removeContact(i)}><i className="ti ti-trash" /></button>
              </div>
            </div>
          ))}
          <button className="add-btn" onClick={addContact}><i className="ti ti-plus" /> Add contact item</button>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Done</button>
        </div>
      </div>
    </div>
  );
}

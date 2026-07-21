"use client";

import { useState } from "react";
import { deepClone } from "@/lib/resumeModel";

// Structural editor: add/remove jobs, bullets, skill groups, list items. Field-level
// text (org/title/summary/bullet copy) can also just be edited inline on the page —
// this modal is for structure. Simplified vs the original: skill items are one
// comma-separated field per group rather than draggable individual chips.
export default function SectionModal({ section, masterMode, note, onClose, onSave }) {
  const [state, setState] = useState(() => deepClone(section));
  const [noteText, setNoteText] = useState(note || "");

  function save() { onSave(state, masterMode ? noteText : undefined); }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) save(); }}>
      <div className="modal">
        <div className="modal-header">
          <h3>Edit: {section.label}</h3>
          <button className="modal-close" onClick={save}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Section title</label>
            <input className="field-input" value={state.label} onChange={(e) => setState((s) => ({ ...s, label: e.target.value }))} />
          </div>

          {state.type === "summary" && (
            <div className="field-group">
              <label className="field-label">Content</label>
              <textarea className="field-input" rows={7} value={state.content}
                onChange={(e) => setState((s) => ({ ...s, content: e.target.value }))} />
            </div>
          )}

          {state.type === "list" && (
            <div className="field-group">
              <label className="field-label">Items (one per line)</label>
              <textarea className="field-input" rows={Math.max(4, state.items.length + 2)}
                value={state.items.join("\n")}
                onChange={(e) => setState((s) => ({ ...s, items: e.target.value.split("\n") }))} />
            </div>
          )}

          {state.type === "skills" && (
            <>
              {state.groups.map((g, gi) => (
                <div className="job-editor" key={gi}>
                  <div className="job-editor-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Group {gi + 1}</span>
                    <button className="del-btn" onClick={() => setState((s) => ({ ...s, groups: s.groups.filter((_, i) => i !== gi) }))}>
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Category</label>
                    <input className="field-input" value={g.label}
                      onChange={(e) => setState((s) => ({ ...s, groups: s.groups.map((gg, i) => i === gi ? { ...gg, label: e.target.value } : gg) }))} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Skills (comma-separated)</label>
                    <input className="field-input" value={g.items}
                      onChange={(e) => setState((s) => ({ ...s, groups: s.groups.map((gg, i) => i === gi ? { ...gg, items: e.target.value } : gg) }))} />
                  </div>
                </div>
              ))}
              <button className="add-btn" onClick={() => setState((s) => ({ ...s, groups: [...s.groups, { label: "", items: "" }] }))}>
                <i className="ti ti-plus" /> Add group
              </button>
            </>
          )}

          {state.type === "jobs" && (
            <>
              {state.jobs.map((job, ji) => (
                <div className="job-editor" key={ji}>
                  <div className="job-editor-title">Role {ji + 1}</div>
                  <div className="row-2">
                    <div className="field-group">
                      <label className="field-label">Organization</label>
                      <input className="field-input" value={job.org}
                        onChange={(e) => setState((s) => ({ ...s, jobs: s.jobs.map((j, i) => i === ji ? { ...j, org: e.target.value } : j) }))} />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Dates</label>
                      <input className="field-input" value={job.dates}
                        onChange={(e) => setState((s) => ({ ...s, jobs: s.jobs.map((j, i) => i === ji ? { ...j, dates: e.target.value } : j) }))} />
                    </div>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Title</label>
                    <input className="field-input" value={job.title}
                      onChange={(e) => setState((s) => ({ ...s, jobs: s.jobs.map((j, i) => i === ji ? { ...j, title: e.target.value } : j) }))} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Bullets</label>
                    {job.bullets.map((b, bi) => (
                      <div className="bullet-row" key={bi}>
                        <textarea className="field-input" rows={2} value={b}
                          onChange={(e) => setState((s) => ({
                            ...s, jobs: s.jobs.map((j, i) => i === ji ? { ...j, bullets: j.bullets.map((bb, bbi) => bbi === bi ? e.target.value : bb) } : j),
                          }))} />
                        <button className="del-btn" onClick={() => setState((s) => ({
                          ...s, jobs: s.jobs.map((j, i) => i === ji ? { ...j, bullets: j.bullets.filter((_, bbi) => bbi !== bi) } : j),
                        }))}><i className="ti ti-trash" /></button>
                      </div>
                    ))}
                    <button className="add-btn" onClick={() => setState((s) => ({
                      ...s, jobs: s.jobs.map((j, i) => i === ji ? { ...j, bullets: [...j.bullets, ""] } : j),
                    }))}><i className="ti ti-plus" /> Add bullet</button>
                  </div>
                </div>
              ))}
              <button className="add-btn" onClick={() => setState((s) => ({ ...s, jobs: [...s.jobs, { org: "", dates: "", title: "", bullets: [""] }] }))}>
                <i className="ti ti-plus" /> Add role
              </button>
            </>
          )}

          {masterMode && (
            <div className="field-group notes-field">
              <label className="field-label">Project notes (Master only · never printed)</label>
              <textarea className="field-input" rows={5}
                placeholder="Plain-English context: what this project really was, scope, your role, results, who to talk to, anything that helps tailor future resumes."
                value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <div className="notes-hint">Notes live on the Master only and never appear on any resume or PDF.</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel &amp; revert</button>
          <button className="btn btn-primary" onClick={save}>Done</button>
        </div>
      </div>
    </div>
  );
}

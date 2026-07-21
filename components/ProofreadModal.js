"use client";

export default function ProofreadModal({ loading, findings, appliedIds, onClose, onApply }) {
  const technical = findings.filter((f) => f.category === "technical");
  const alignment = findings.filter((f) => f.category === "alignment");

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h3>Proofread</h3>
          <button className="modal-close" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          {loading && <div className="proof-loading"><span className="proof-spinner" /> Reading through your resume…</div>}
          {!loading && !findings.length && <div className="proof-note">Nothing to proofread yet, or no issues found.</div>}
          {!loading && technical.length > 0 && <FindingGroup title="Technical" findings={technical} appliedIds={appliedIds} onApply={onApply} />}
          {!loading && alignment.length > 0 && <FindingGroup title="Alignment with job description" findings={alignment} appliedIds={appliedIds} onApply={onApply} />}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function FindingGroup({ title, findings, appliedIds, onApply }) {
  return (
    <div>
      <div className="proof-group-title">{title}</div>
      {findings.map((f) => {
        const applied = appliedIds.has(f._fid);
        return (
          <div className={"proof-finding" + (applied ? " applied" : "")} key={f._fid}>
            <input type="checkbox" checked={applied} onChange={() => !applied && onApply(f)} disabled={applied} />
            <div className="pf-body">
              <div className="pf-issue">{f.issue}</div>
              <div className="pf-suggestion">{f.suggestion}</div>
              {applied && <div className="pf-applied-tag">Applied</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

export default function TopBar({
  view, setView, onOpen, onSave, onSaveAs, onAddSection,
  masterMode, onToggleMaster, onNewFromMaster, onPdf, currentVariant,
  onProofread, hasJD,
}) {
  return (
    <div className="topbar">
      <div className="tb-seg">
        <button className={view === "resume" ? "active" : ""} onClick={() => setView("resume")}>Resume</button>
        <button className={view === "cover" ? "active" : ""} onClick={() => setView("cover")}>Cover Letter</button>
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <button className="tb-btn" onClick={onOpen}><i className="ti ti-folder-open" /> Open</button>
        <button className="tb-btn" onClick={onSave}><i className="ti ti-device-floppy" /> Save</button>
        <button className="tb-btn" onClick={onSaveAs}><i className="ti ti-copy" /> Save as</button>
        <button className="tb-btn" onClick={onAddSection}><i className="ti ti-plus" /> Add section</button>
      </div>
      <div className="tb-sep" />
      <button className="tb-btn" onClick={onProofread} title={hasJD ? "Proofread against the job description this resume was built from" : "No job description attached to this resume — build it from a JD first"}>
        <i className="ti ti-list-check" /> Proofread
      </button>
      <div className="tb-sep" />
      {masterMode ? (
        <span className="tb-context"><i className="ti ti-lock" /> Editing Master</span>
      ) : (
        <button className="tb-btn" onClick={onNewFromMaster}><i className="ti ti-file-plus" /> New from Master</button>
      )}
      <button id="btn-master" className={"tb-btn" + (masterMode ? " master-active" : "")} onClick={onToggleMaster}>
        <i className="ti ti-crown" /> {masterMode ? "Done" : "Edit Master"}
      </button>
      <div className="tb-spacer" />
      {currentVariant && <span className="tb-context">{currentVariant}</span>}
      <button className="tb-btn primary" onClick={onPdf}><i className="ti ti-download" /> PDF</button>
    </div>
  );
}

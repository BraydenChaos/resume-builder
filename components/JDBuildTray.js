"use client";

import { useState } from "react";

// Sidebar intake box — pastes a JD in to Build a tailored draft from Master. This
// is purely a "create a new resume" tool, distinct from Proofread (top bar), which
// reviews the CURRENT resume against the JD that was originally used to build it.
export default function JDBuildTray({ onBuild, building }) {
  const [text, setText] = useState("");

  return (
    <div className="jd-tray">
      <div className="jd-head"><i className="ti ti-sparkles" /> Build from job description</div>
      <p className="jd-sub">Paste a role. Claude drafts a tailored resume from your Master, then you Save as.</p>
      <textarea className="jd-input" placeholder="Paste a job description here…" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (text.trim()) onBuild(text.trim(), () => setText("")); } }} />
      <button className="btn btn-primary" disabled={building} onClick={() => text.trim() && onBuild(text.trim(), () => setText(""))}>
        <i className={building ? "ti ti-loader-2" : "ti ti-wand"} /> {building ? "Building…" : "Build tailored resume"}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { buildHeaderHTML, pageStyleFromMargins } from "@/lib/resumeRender";
import { coverIsEmpty } from "@/lib/resumeModel";

// Simplified vs the original: cover letters are short enough that DOM-measured
// pagination isn't worth the complexity — this renders as a single page (it will
// simply overflow visually in the rare case of a very long letter).
export default function CoverLetterView({ header, cover, margins, onEdit, onEditHeader, onCreate }) {
  const style = pageStyleFromMargins(margins);
  const headerRef = useRef(null);

  useEffect(() => {
    const el = headerRef.current && headerRef.current.querySelector("#r-header-click");
    if (!el || !onEditHeader) return;
    el.addEventListener("click", onEditHeader);
    return () => el.removeEventListener("click", onEditHeader);
  });

  if (coverIsEmpty(cover)) {
    return (
      <div className="resume-page" style={style}>
        <div className="r-letter-empty">
          No cover letter yet for this variant.<br />Write one to match this resume to a specific job.
          <button className="btn btn-primary" onClick={onCreate}><i className="ti ti-plus" /> Write cover letter</button>
        </div>
      </div>
    );
  }

  return (
    <div className="resume-page" style={style}>
      <div ref={headerRef} dangerouslySetInnerHTML={{ __html: buildHeaderHTML(header) }} />
      <div className="r-letter-body r-letter-block" onClick={onEdit}>
        {cover.salutation && <div className="r-letter-salutation">{cover.salutation}</div>}
        {(cover.body || []).map((p, i) => <div className="r-letter-para" key={i}>{p}</div>)}
        {cover.signoff && <div className="r-letter-signoff">{cover.signoff}</div>}
        <div className="r-letter-signname">{(cover.signName && cover.signName.trim()) || header.name}</div>
      </div>
    </div>
  );
}

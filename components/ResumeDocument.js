"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { buildBlocks, buildHeaderHTML, paginate, PAGE_H, PAGE_TOL, PAGE_MARGINS, pageStyleFromMargins } from "@/lib/resumeRender";
import { useInlineEdit } from "@/hooks/useInlineEdit";

// Ported from renderResume() in resume_builder.html. Pagination needs real
// rendered heights (a paragraph's wrapped line count depends on font metrics we
// don't want to hand-compute), so this renders once into a hidden measure
// surface, reads back block heights, then lays out page-sized chunks of HTML.
export default function ResumeDocument({ items, header, margins, showMarginGuides, onSectionClick, onInlineCommit, pagesWrapRef }) {
  const measureRef = useRef(null);
  const pagesRef = useRef(null);
  const [pageCount, setPageCount] = useState(1);

  useInlineEdit(pagesRef, onInlineCommit || (() => {}));

  const m = margins || PAGE_MARGINS;

  useLayoutEffect(() => {
    const ms = measureRef.current;
    const wrap = pagesRef.current;
    if (!ms || !wrap) return;

    const blocks = buildBlocks(items);
    const headerHTML = buildHeaderHTML(header);

    let measureHTML = headerHTML;
    blocks.forEach((b, bi) => {
      let mhtml = b.html;
      if (b.isParentHeader) mhtml += "</div>"; // close the open r-section for measurement
      measureHTML += '<div class="measure-block" data-bi="' + bi + '">' + mhtml + "</div>";
    });
    ms.innerHTML = measureHTML;

    const hrEl = ms.querySelector(".r-hr");
    const msRect = ms.getBoundingClientRect();
    const headerH = hrEl ? hrEl.getBoundingClientRect().bottom - msRect.top : 80;

    const blockHeights = [];
    ms.querySelectorAll(".measure-block").forEach((el, bi) => {
      blockHeights[bi] = el.getBoundingClientRect().height;
    });

    const pageH = 984 - m.top - m.bottom;
    const pages = paginate(items, blocks, blockHeights, headerH, pageH, PAGE_TOL);

    let pagesHTML = "";
    pages.forEach((chunks, pi) => {
      if (pi > 0) pagesHTML += '<div class="page-break-gap"><span class="page-label">Page ' + (pi + 1) + "</span></div>";
      pagesHTML += '<div class="resume-page' + (showMarginGuides ? " show-guides" : "") + '" id="rpage-' + pi + '" style="' + styleObjToCss(pageStyleFromMargins(m)) + '">';
      if (pi === 0) pagesHTML += headerHTML;
      chunks.forEach((ch) => { pagesHTML += ch.html; });
      pagesHTML += "</div>";
    });
    wrap.innerHTML = pagesHTML;
    setPageCount(pages.length);
  }, [items, header, m.top, m.right, m.bottom, m.left, showMarginGuides]);

  useLayoutEffect(() => {
    const wrap = pagesRef.current;
    if (!wrap || !onSectionClick) return;
    const handler = (e) => {
      const el = e.target.closest("[data-id]");
      if (!el) return;
      e.stopPropagation();
      onSectionClick(el.getAttribute("data-id"));
    };
    wrap.addEventListener("click", handler);
    return () => wrap.removeEventListener("click", handler);
  }, [onSectionClick, pageCount]);

  return (
    <>
      <div className="pages-wrap" ref={(el) => { pagesRef.current = el; if (pagesWrapRef) pagesWrapRef.current = el; }} />
      <div id="measure-surface" ref={measureRef} style={{ padding: m.top + "px " + m.right + "px " + m.bottom + "px " + m.left + "px" }} />
    </>
  );
}

function styleObjToCss(obj) {
  return Object.entries(obj).map(([k, v]) => k + ":" + v).join(";");
}

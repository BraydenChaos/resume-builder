"use client";

import { useEffect, useRef } from "react";

// Ported from resume_builder.html's ieStart/ieCommit/ieCancel. Click any [data-ie]
// element inside the container to edit its raw text in place; Enter/blur commits,
// Escape cancels. Simplification vs the original: pressing Enter on a bullet/list
// item just commits (it doesn't also insert-and-continue-typing a new sibling) —
// use the section editor to add more bullets/items.
const IE_MULTILINE = { "c-para": true };

export function useInlineEdit(containerRef, onCommit) {
  const activeRef = useRef(null); // { el, kind, dataset, orig }

  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap) return;

    function readValue(el, kind) {
      let v = el.innerText.replace(/ /g, " ");
      if (!IE_MULTILINE[kind]) v = v.replace(/\s*\n\s*/g, " ");
      return v.replace(/\n{3,}/g, "\n\n");
    }

    function commit() {
      const a = activeRef.current;
      if (!a) return;
      activeRef.current = null;
      const v = readValue(a.el, a.kind);
      a.el.removeAttribute("contenteditable");
      a.el.classList.remove("ie-editing");
      if (v !== a.orig) onCommit(a.kind, a.el.dataset, v);
    }

    function cancel() {
      const a = activeRef.current;
      if (!a) return;
      activeRef.current = null;
      a.el.textContent = a.orig;
      a.el.removeAttribute("contenteditable");
      a.el.classList.remove("ie-editing");
    }

    function start(el) {
      if (activeRef.current) {
        if (activeRef.current.el === el) return;
        commit();
      }
      const kind = el.getAttribute("data-ie");
      const orig = el.textContent || "";
      el.classList.add("ie-editing");
      try { el.setAttribute("contenteditable", "plaintext-only"); } catch (e) {}
      if (!el.isContentEditable) el.setAttribute("contenteditable", "true");
      el.textContent = orig;
      activeRef.current = { el, kind, orig };
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function onClick(e) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) { e.stopPropagation(); return; } // text selection, not an edit click
      const el = e.target.closest && e.target.closest("[data-ie]");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      start(el);
    }

    function onKeydown(e) {
      const a = activeRef.current;
      if (!a || !a.el.contains(e.target)) return;
      if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
    }

    function onFocusout(e) {
      if (activeRef.current && e.target === activeRef.current.el) commit();
    }

    wrap.addEventListener("click", onClick, true);
    wrap.addEventListener("keydown", onKeydown, true);
    wrap.addEventListener("focusout", onFocusout);
    return () => {
      wrap.removeEventListener("click", onClick, true);
      wrap.removeEventListener("keydown", onKeydown, true);
      wrap.removeEventListener("focusout", onFocusout);
    };
  }, [containerRef, onCommit]);
}

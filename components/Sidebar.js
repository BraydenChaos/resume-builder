"use client";

import { useRef, useState } from "react";
import { FIXED_ROOT, roots, kids } from "@/lib/resumeModel";

// Ported from resume_builder.html's renderSidebar/setupDrag: drag a chip onto the
// top/bottom third of another chip to reorder as a sibling, onto the middle third
// to nest as its child (root sections only, and not onto a FIXED_ROOT section).
export default function Sidebar({ items, onReorder, onToggleVisible, onDelete, onUnmount, onAddSection, onEditSection, jdTray }) {
  const [dragId, setDragId] = useState(null);
  const [dropInfo, setDropInfo] = useState(null); // { id, zone }
  const wrapRef = useRef(null);

  const rootItems = roots(items);

  function handleDragOver(e, tgt) {
    e.preventDefault();
    if (!dragId || dragId === tgt.id) return;
    const src = items.find((x) => x.id === dragId);
    if (!src) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - rect.top) / rect.height;
    const srcIsChild = !!src.parentId;
    const tgtIsChild = !!tgt.parentId;
    const srcFixed = FIXED_ROOT.indexOf(src.id) >= 0;
    const tgtFixed = FIXED_ROOT.indexOf(tgt.id) >= 0;
    let zone;
    if (srcFixed || tgtIsChild || srcIsChild) zone = rel < 0.5 ? "before" : "after";
    else if (rel < 0.28) zone = "before";
    else if (rel > 0.72) zone = "after";
    else zone = tgtFixed ? "no-child" : "child";
    setDropInfo({ id: tgt.id, zone });
  }

  function handleDrop(e, tgt) {
    e.preventDefault();
    const info = dropInfo;
    setDropInfo(null);
    const draggedId = dragId;
    setDragId(null);
    if (!draggedId || draggedId === tgt.id || !info || info.zone === "no-child") return;
    onReorder(draggedId, tgt.id, info.zone === "child" ? "child" : info.zone);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Sections</h2>
        <p>Drag to reorder · drop on center to nest · click text on the page to edit it in place</p>
      </div>
      <div className="section-list" ref={wrapRef}>
        {rootItems.map((r) => (
          <div key={r.id}>
            <Chip
              item={r} isChild={false}
              dropClass={dropInfo && dropInfo.id === r.id ? dropClassFor(dropInfo.zone) : ""}
              dragging={dragId === r.id}
              onDragStart={() => setDragId(r.id)}
              onDragEnd={() => { setDragId(null); setDropInfo(null); }}
              onDragOver={(e) => handleDragOver(e, r)}
              onDragLeave={() => setDropInfo(null)}
              onDrop={(e) => handleDrop(e, r)}
              onToggleVisible={() => onToggleVisible(r.id)}
              onDelete={() => onDelete(r.id)}
              onClick={() => onEditSection(r.id)}
            />
            {kids(items, r.id).map((c) => (
              <Chip
                key={c.id} item={c} isChild
                dropClass={dropInfo && dropInfo.id === c.id ? dropClassFor(dropInfo.zone) : ""}
                dragging={dragId === c.id}
                onDragStart={() => setDragId(c.id)}
                onDragEnd={() => { setDragId(null); setDropInfo(null); }}
                onDragOver={(e) => handleDragOver(e, c)}
                onDragLeave={() => setDropInfo(null)}
                onDrop={(e) => handleDrop(e, c)}
                onToggleVisible={() => onToggleVisible(c.id)}
                onDelete={() => onDelete(c.id)}
                onUnmount={() => onUnmount(c.id)}
                onClick={() => onEditSection(c.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-actions">
        <button className="btn" onClick={onAddSection}><i className="ti ti-plus" /> Add section</button>
      </div>
      {jdTray}
    </div>
  );
}

function dropClassFor(zone) {
  if (zone === "before") return "drop-before";
  if (zone === "after") return "drop-after";
  if (zone === "child") return "drop-child";
  if (zone === "no-child") return "no-child";
  return "";
}

function Chip({ item, isChild, dropClass, dragging, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onToggleVisible, onDelete, onUnmount, onClick }) {
  return (
    <div className={"chip-wrap" + (isChild ? " is-child" : "") + (dropClass ? " " + dropClass : "")}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className={"chip" + (item.visible ? "" : " hidden-chip") + (dragging ? " is-dragging" : "")}
        draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}>
        {isChild && <span className="chip-indent">↳</span>}
        <i className="ti ti-grip-vertical chip-handle" />
        <span className="chip-label">{item.label}</span>
        <button className="chip-eye" onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}>
          <i className={"ti " + (item.visible ? "ti-eye" : "ti-eye-off")} />
        </button>
        {isChild && (
          <button className="chip-unmount" title="Move to root" onClick={(e) => { e.stopPropagation(); onUnmount(); }}>
            <i className="ti ti-corner-up-left" />
          </button>
        )}
        <button className="chip-del" title="Delete section" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <i className="ti ti-trash" />
        </button>
      </div>
    </div>
  );
}

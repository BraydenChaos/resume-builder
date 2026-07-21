"use client";

import { useEffect, useRef, useState } from "react";
import { getJSON, postJSON } from "@/lib/api";
import { deepClone, resolveVariant, buildLinkedSnapshot, coverIsEmpty, COVER_TEMPLATE } from "@/lib/resumeModel";
import { applyInlineEdit } from "@/lib/inlineEditApply";
import { PAGE_MARGINS } from "@/lib/resumeRender";
import { useChat } from "@/hooks/useChat";

import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import ResumeDocument from "./ResumeDocument";
import CoverLetterView from "./CoverLetterView";
import ChatPanel from "./ChatPanel";
import SectionModal from "./SectionModal";
import HeaderModal from "./HeaderModal";
import CoverModal from "./CoverModal";
import AddSectionModal from "./AddSectionModal";
import VariantBrowserModal from "./VariantBrowserModal";
import ProofreadModal from "./ProofreadModal";
import JDBuildTray from "./JDBuildTray";

export default function ResumeApp() {
  const [ready, setReady] = useState(false);
  const [serverUp, setServerUp] = useState(true);

  const [items, setItems] = useState([]);
  const [header, setHeader] = useState({ name: "", title: "", contact: [] });
  const [cover, setCover] = useState(null);
  const [view, setView] = useState("resume");
  const [margins, setMargins] = useState(PAGE_MARGINS);

  const [masterDoc, setMasterDoc] = useState(null); // { id, items, header, notes, margins }
  const [masterNotes, setMasterNotes] = useState({});
  const [masterMode, setMasterMode] = useState(false);
  const linkToMasterRef = useRef(false);

  const [variants, setVariants] = useState([]);
  const idByName = useRef({});
  const [currentVariant, setCurrentVariant] = useState(null);

  const [attachedJD, setAttachedJD] = useState("");
  const [company, setCompany] = useState(""); // hiring company for this variant — drives Save as prefill + PDF filenames
  const [chatOpen, setChatOpen] = useState(true);

  const [editingSectionId, setEditingSectionId] = useState(null);
  const [headerModalOpen, setHeaderModalOpen] = useState(false);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [variantBrowserOpen, setVariantBrowserOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [proof, setProof] = useState({ open: false, loading: false, findings: [], applied: new Set() });

  const pagesWrapRef = useRef(null);
  const preMasterRef = useRef(null);
  const skipAutosaveRef = useRef(true);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const ping = await getJSON("/api/ping").catch(() => ({ ok: false }));
      setServerUp(!!ping.ok);

      const [docsData, masterData, autosaveData] = await Promise.all([
        getJSON("/api/documents").catch(() => ({ ok: false })),
        getJSON("/api/master").catch(() => ({ ok: false })),
        getJSON("/api/autosave").catch(() => ({ ok: false })),
      ]);

      if (docsData.ok) {
        setVariants(docsData.variants || []);
        idByName.current = {};
        (docsData.variants || []).forEach((v) => { idByName.current[v.name.toLowerCase()] = v.id; });
      }

      const md = masterData.ok ? masterData.doc : null;
      setMasterDoc(md);

      if (autosaveData.ok && autosaveData.doc) {
        applyStateDoc(autosaveData.doc, md);
      } else if (md && md.items) {
        newFromMasterWith(md);
      }

      skipAutosaveRef.current = false;
      setReady(true);
    })();
  }, []);

  function applyStateDoc(saved, masterForResolve) {
    setCompany((saved && saved.company) || "");
    if (saved && saved.base === "master" && masterForResolve) {
      const r = resolveVariant(saved, masterForResolve);
      setItems(r.items);
      setHeader(r.header);
      setCover(r.coverLetter);
      linkToMasterRef.current = true;
      setMasterMode(false);
      if (saved.margins) setMargins(saved.margins);
      return;
    }
    if (saved.items && Array.isArray(saved.items)) setItems(saved.items);
    if (saved.header && saved.header.name) setHeader(saved.header);
    setCover(saved.coverLetter && typeof saved.coverLetter === "object" ? saved.coverLetter : null);
    linkToMasterRef.current = false;
    setMasterMode(false);
    if (saved.margins) setMargins(saved.margins);
  }

  function newFromMasterWith(md) {
    const r = resolveVariant({ base: "master" }, md);
    setItems(r.items);
    setHeader(r.header);
    setCover(null);
    setCurrentVariant(null);
    setCompany("");
    setView("resume");
    linkToMasterRef.current = true;
    loadJDFor(null);
  }

  // ── Persistence: stateSnapshot / autosave / save variant ─────────────────
  function stateSnapshot() {
    if (masterMode) return { items: deepClone(items), header: deepClone({ name: header.name, title: header.title, contact: header.contact }), notes: deepClone(masterNotes), margins };
    if (linkToMasterRef.current && masterDoc) return { ...buildLinkedSnapshot(items, header, cover, masterDoc), margins, company };
    const snap = { items: deepClone(items), header: deepClone(header), margins, company };
    if (cover && !coverIsEmpty(cover)) snap.coverLetter = deepClone(cover);
    return snap;
  }

  useEffect(() => {
    if (skipAutosaveRef.current || !ready) return;
    const t = setTimeout(() => {
      if (masterMode) {
        const snap = { items: deepClone(items), header: deepClone({ name: header.name, title: header.title, contact: header.contact }), notes: deepClone(masterNotes) };
        postJSON("/api/master", "PUT", snap).then((r) => { if (r.ok) setMasterDoc(r.doc); });
      } else {
        postJSON("/api/autosave", "PUT", stateSnapshot()).catch(() => {});
        if (currentVariant) saveCurrentVariant();
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, header, cover, masterNotes, masterMode, company]);

  function saveCurrentVariant() {
    if (!currentVariant) return;
    const id = idByName.current[currentVariant.toLowerCase()];
    const snap = stateSnapshot();
    const req = id ? postJSON("/api/documents/" + id, "PATCH", snap) : postJSON("/api/documents", "POST", { name: currentVariant, ...snap });
    req.then((r) => { if (r.ok && r.doc) idByName.current[r.doc.name.toLowerCase()] = r.doc.id; });
  }

  // ── Section mutations ────────────────────────────────────────────────────
  function toggleVisible(id) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, visible: !it.visible } : it)));
  }
  function deleteSection(id) {
    const s = items.find((x) => x.id === id);
    if (!s) return;
    const childCount = items.filter((x) => x.parentId === id).length;
    const msg = childCount > 0
      ? `Permanently delete "${s.label}" and its ${childCount} subsection${childCount > 1 ? "s" : ""}? This cannot be undone.`
      : `Permanently delete "${s.label}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setItems((prev) => prev.filter((x) => x.id !== id && x.parentId !== id));
  }
  function unmountSection(id) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, parentId: null } : x)));
  }
  function reorderSection(dragId, tgtId, zone) {
    setItems((prev) => {
      const list = prev.slice();
      const src = list.find((x) => x.id === dragId);
      const tgt = list.find((x) => x.id === tgtId);
      if (!src || !tgt) return prev;
      const si = list.findIndex((x) => x.id === dragId);
      const [srcItem] = list.splice(si, 1);
      if (zone === "child") {
        srcItem.parentId = tgt.id;
        const ti = list.findIndex((x) => x.id === tgt.id);
        let ins = ti + 1;
        while (ins < list.length && list[ins].parentId === tgt.id) ins++;
        list.splice(ins, 0, srcItem);
      } else {
        srcItem.parentId = tgt.parentId || null;
        const ti2 = list.findIndex((x) => x.id === tgt.id);
        if (zone === "before") list.splice(ti2, 0, srcItem);
        else {
          let ai = ti2 + 1;
          if (!tgt.parentId) while (ai < list.length && list[ai].parentId === tgt.id) ai++;
          list.splice(ai, 0, srcItem);
        }
      }
      return list;
    });
  }
  function addSection({ label, type, parentId }) {
    const id = "custom_" + Date.now();
    const newItem = { id, label, visible: true, parentId };
    if (type === "jobs") { newItem.type = "jobs"; newItem.jobs = [{ org: label, dates: "", title: "", bullets: [""] }]; }
    else if (type === "summary") { newItem.type = "summary"; newItem.content = ""; }
    else { newItem.type = "list"; newItem.items = [""]; }
    setItems((prev) => {
      const list = prev.slice();
      if (parentId) {
        const pIdx = list.findIndex((x) => x.id === parentId);
        let insertAt = pIdx + 1;
        while (insertAt < list.length && list[insertAt].parentId === parentId) insertAt++;
        list.splice(insertAt, 0, newItem);
      } else list.push(newItem);
      return list;
    });
    setAddModalOpen(false);
    setEditingSectionId(id);
  }

  function onInlineCommit(kind, dataset, value) {
    const r = applyInlineEdit(kind, dataset, value, items, header);
    if (r.items !== items) setItems(r.items);
    if (r.header !== header) setHeader(r.header);
  }

  // ── Master mode ───────────────────────────────────────────────────────────
  function enterMasterMode() {
    if (masterMode) return;
    preMasterRef.current = { items, header, cover, currentVariant, view, company };
    setMasterMode(true);
    linkToMasterRef.current = false;
    setCurrentVariant(null);
    setCover(null);
    setCompany("");
    setView("resume");
    loadJDFor(null);
    if (masterDoc && masterDoc.items) {
      setItems(deepClone(masterDoc.items));
      setHeader(deepClone(masterDoc.header));
      setMasterNotes(deepClone(masterDoc.notes || {}));
    } else {
      setItems([]); setHeader({ name: "", title: "", contact: [] }); setMasterNotes({});
    }
  }
  function exitMasterMode() {
    if (!masterMode) return;
    setMasterMode(false);
    const pm = preMasterRef.current;
    if (pm) {
      setItems(pm.items); setHeader(pm.header); setCover(pm.cover);
      setCurrentVariant(pm.currentVariant); setView(pm.view || "resume");
      setCompany(pm.company || "");
      loadJDForVariant(pm.currentVariant);
    }
    preMasterRef.current = null;
  }
  function newFromMaster() { if (masterDoc && masterDoc.items) newFromMasterWith(masterDoc); }

  // ── Open / Save / Save as / variant browser ──────────────────────────────
  async function loadVariant(name) {
    const id = idByName.current[name.toLowerCase()];
    if (!id) return;
    const data = await getJSON("/api/documents/" + id);
    if (!data.ok || !data.doc) return;
    applyStateDoc(data.doc, masterDoc);
    setCurrentVariant(name);
    setVariantBrowserOpen(false);
    loadJDForVariant(name);
  }
  async function deleteVariant(name) {
    if (!window.confirm(`Delete variation "${name}"?`)) return;
    const id = idByName.current[name.toLowerCase()];
    if (!id) return;
    await postJSON("/api/documents/" + id, "DELETE");
    delete idByName.current[name.toLowerCase()];
    setVariants((prev) => prev.filter((v) => v.name !== name));
    if (currentVariant === name) setCurrentVariant(null);
  }
  async function saveAs() {
    if (masterMode) return;
    const name = window.prompt("Name this variation:", currentVariant || company || "");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const snap = stateSnapshot();
    const r = await postJSON("/api/documents", "POST", { name: trimmed, ...snap });
    if (!r.ok) { window.alert(r.error || "Save failed"); return; }
    idByName.current[r.doc.name.toLowerCase()] = r.doc.id;
    setVariants((prev) => [{ id: r.doc.id, name: r.doc.name }, ...prev.filter((v) => v.name !== r.doc.name)]);
    setCurrentVariant(trimmed);
    saveJDForCurrentDoc(trimmed);
  }
  function save() {
    if (masterMode) return; // autosaves continuously
    if (currentVariant) saveCurrentVariant();
    else saveAs();
  }

  // ── Job description: intake (sidebar) vs attached (read-only, under chat) ──
  async function loadJDForVariant(name) {
    if (!name) return loadJDFor(null);
    const id = idByName.current[name.toLowerCase()];
    loadJDFor(id);
  }
  async function loadJDFor(docId) {
    if (!docId) { setAttachedJD(""); return; }
    const data = await getJSON("/api/documents/" + docId + "/jd").catch(() => null);
    setAttachedJD((data && data.ok && data.jd && data.jd.jd_text) || "");
  }
  function saveJDForCurrentDoc(nameOverride) {
    const name = nameOverride || currentVariant;
    if (!name) return;
    const id = idByName.current[name.toLowerCase()];
    if (!id) return;
    postJSON("/api/documents/" + id + "/jd", "PUT", { jd_text: attachedJD }).catch(() => {});
  }

  async function buildFromJD(jdText, onDone) {
    if (building) return;
    if (!masterDoc || !masterDoc.items) { window.alert('Create your Master first (Edit Master)'); return; }
    setBuilding(true);
    // Resolve the fresh master draft directly rather than reading `items`/`header`
    // state right after newFromMasterWith() — React state updates aren't synchronous,
    // so the component's closure would still see the PREVIOUS document at this point
    // and send the wrong resume to /api/build.
    const resolved = resolveVariant({ base: "master" }, masterDoc);
    newFromMasterWith(masterDoc);
    const doc = chatGetDocumentForBuild(resolved.items, resolved.header);
    const r = await postJSON("/api/build", "POST", { doc, jd: jdText }).catch(() => null);
    setBuilding(false);
    if (!r || !r.ok) { window.alert((r && r.message) || "Build failed"); return; }
    applyBuildPlan(r.plan);
    setAttachedJD(jdText);
    setCompany((r.plan.company || "").trim());
    setChatOpen(true);
    chat.appendMessage({
      role: "assistant",
      content: "✅ Built a tailored draft. " + (r.plan.summary_of_changes || "") + "\n\nReview it, then use **Save as** to name it.",
    });
    onDone && onDone();
  }
  function chatGetDocumentForBuild(itemsArg, headerArg) {
    const useItems = itemsArg || items;
    const useHeader = headerArg || header;
    const secs = useItems.filter((it) => it.visible !== false).map((it) => {
      const s = { id: it.id, label: it.label, type: it.type };
      if (it.type === "summary") s.text = it.content || "";
      else if (it.type === "list") s.items = (it.items || []).slice();
      else if (it.type === "skills") s.groups = (it.groups || []).map((g) => ({ label: g.label, items: g.items }));
      else if (it.type === "jobs") s.jobs = (it.jobs || []).map((j, ji) => ({ index: ji, org: j.org, title: j.title, dates: j.dates, bullets: (j.bullets || []).slice() }));
      return s;
    });
    return { header: { name: useHeader.name, title: useHeader.title }, sections: secs };
  }
  function applyBuildPlan(plan) {
    if (!plan) return;
    const visSet = new Set(plan.visible_ids || []);
    setItems((prev) => prev.map((it) => ({ ...it, visible: visSet.has(it.id) })));
    if (plan.summary && String(plan.summary).trim()) {
      setItems((prev) => prev.map((it) => (it.type === "summary" ? { ...it, content: String(plan.summary) } : it)));
    }
    if (plan.title && String(plan.title).trim()) setHeader((h) => ({ ...h, title: String(plan.title) }));
    (plan.bullets || []).forEach((b) => {
      setItems((prev) => prev.map((it) => (it.id === b.section_id && it.type === "jobs"
        ? { ...it, jobs: it.jobs.map((j, i) => (i === b.job_index ? { ...j, bullets: b.bullets.map(String) } : j)) }
        : it)));
    });
  }

  async function proofread(jdText) {
    setProof({ open: true, loading: true, findings: [], applied: new Set() });
    const doc = chatGetDocumentForBuild();
    setAttachedJD(jdText);
    if (currentVariant) saveJDForCurrentDoc(currentVariant);
    const r = await postJSON("/api/proofread", "POST", { doc, jd_text: jdText }).catch(() => null);
    if (!r || !r.ok) { setProof({ open: true, loading: false, findings: [], applied: new Set() }); return; }
    const findings = (r.findings || []).map((f, i) => ({ ...f, _fid: "pf" + i }));
    setProof({ open: true, loading: false, findings, applied: new Set() });
  }
  function applyFinding(f) {
    if (f.field === "header_name") setHeader((h) => ({ ...h, name: f.suggestion }));
    else if (f.field === "header_title") setHeader((h) => ({ ...h, title: f.suggestion }));
    else {
      setItems((prev) => prev.map((it) => {
        if (it.id !== f.section_id) return it;
        const copy = deepClone(it);
        if (f.field === "summary") copy.content = f.suggestion;
        else if (f.field === "job_org") copy.jobs[f.job_index].org = f.suggestion;
        else if (f.field === "job_title") copy.jobs[f.job_index].title = f.suggestion;
        else if (f.field === "job_dates") copy.jobs[f.job_index].dates = f.suggestion;
        else if (f.field === "bullet") copy.jobs[f.job_index].bullets[f.bullet_index] = f.suggestion;
        else if (f.field === "list_item") copy.items[f.list_index] = f.suggestion;
        else if (f.field === "skill_group_label") copy.groups[f.group_index].label = f.suggestion;
        else if (f.field === "skill_group_items") copy.groups[f.group_index].items = f.suggestion;
        return copy;
      }));
    }
    setProof((p) => ({ ...p, applied: new Set([...p.applied, f._fid]) }));
  }

  // ── PDF export ────────────────────────────────────────────────────────────
  function exportPdf() {
    const wrap = pagesWrapRef.current;
    if (!wrap) return;
    const pageEls = wrap.querySelectorAll(".resume-page");
    let combinedHTML = "";
    pageEls.forEach((pg, i) => {
      combinedHTML += '<div class="resume-page"' + (i > 0 ? ' style="page-break-before:always;"' : "") + ">" + pg.innerHTML + "</div>";
    });
    // Browsers use the document <title> as the default "Save as PDF" filename.
    const docTitle = "Brayden Clark - " + (view === "cover" ? "Cover Letter" : "Resume") + (company.trim() ? " - " + company.trim() : "");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(
      "<!DOCTYPE html><html><head><title>" + docTitle + "</title><style>" +
      "* { box-sizing: border-box; margin: 0; padding: 0; }" +
      "body { font-family: Georgia,serif; background: white; color: #111; }" +
      ".resume-page { padding: " + margins.top + "px " + margins.right + "px " + margins.bottom + "px " + margins.left + "px; width: 100%; }" +
      ".r-name { font-size: 26px; font-weight: 700; margin-bottom: 2px; }" +
      ".r-title { font-size: 12.5px; color: #555; margin-bottom: 8px; font-style: italic; }" +
      ".r-contact { font-size: 11px; color: #444; display: flex; flex-wrap: wrap; gap: 3px 14px; margin-bottom: 16px; }" +
      ".r-hr { border: none; border-top: 1.5px solid #111; margin-bottom: 16px; }" +
      ".r-section { margin-bottom: 20px; }" +
      ".r-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 9px; border-bottom: 0.5px solid #ccc; padding-bottom: 3px; }" +
      ".r-job { margin-bottom: 13px; }" +
      ".r-job-head { display: flex; justify-content: space-between; align-items: baseline; }" +
      ".r-org { font-size: 13px; font-weight: 700; }" +
      ".r-dates { font-size: 11px; color: #777; }" +
      ".r-jobtitle { font-size: 12px; color: #444; margin-bottom: 4px; font-style: italic; }" +
      ".r-bullets { padding-left: 14px; }" +
      ".r-bullets li { font-size: 11.5px; color: #333; line-height: 1.55; margin-bottom: 3px; }" +
      ".r-child-section { margin-bottom: 14px; padding-left: 12px; border-left: 2px solid #eee; }" +
      ".r-skills-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }" +
      ".r-skill-label { font-size: 10.5px; font-weight: 700; margin-bottom: 1px; }" +
      ".r-skill-items { font-size: 11px; color: #444; line-height: 1.5; }" +
      ".r-summary { font-size: 12px; color: #333; line-height: 1.62; }" +
      ".r-list { padding-left: 14px; }" +
      ".r-list li { font-size: 11.5px; color: #333; line-height: 1.55; margin-bottom: 3px; }" +
      ".r-letter-salutation { font-size: 12px; color: #222; line-height: 1.62; margin-bottom: 13px; }" +
      ".r-letter-para { font-size: 12px; color: #333; line-height: 1.68; margin-bottom: 13px; white-space: pre-wrap; }" +
      ".r-letter-signoff { font-size: 12px; color: #222; line-height: 1.62; margin-top: 6px; }" +
      ".r-letter-signname { font-size: 12px; color: #111; font-weight: 700; margin-top: 2px; }" +
      "@media print { @page { size: letter; margin: 0; } .resume-page { padding: " + margins.top + "px " + margins.right + "px " + margins.bottom + "px " + margins.left + "px; } }" +
      "</style></head><body>" + combinedHTML + "</body></html>"
    );
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  const chat = useChat({
    items, setItems, header, setHeader, cover, setCover,
    masterMode, masterDoc, setMasterDoc, masterNotes, setMasterNotes,
    saveMaster: (md) => { postJSON("/api/master", "PUT", { items: md.items, header: md.header, notes: md.notes }).then((r) => { if (r.ok) setMasterDoc(r.doc); }); },
    onDocMutated: () => { if (currentVariant) saveCurrentVariant(); },
    attachedJD,
  });

  if (!ready) return <div style={{ padding: 24, fontFamily: "sans-serif" }}>Loading…</div>;

  const editingSection = editingSectionId ? items.find((x) => x.id === editingSectionId) : null;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", width: "100%" }}>
      <Sidebar
        items={items}
        onReorder={reorderSection}
        onToggleVisible={toggleVisible}
        onDelete={deleteSection}
        onUnmount={unmountSection}
        onAddSection={() => setAddModalOpen(true)}
        onEditSection={setEditingSectionId}
        jdTray={<JDBuildTray onBuild={buildFromJD} building={building} />}
      />

      <div className="center-col">
        <TopBar
          view={view} setView={setView}
          onOpen={() => setVariantBrowserOpen(true)}
          onSave={save} onSaveAs={saveAs}
          onAddSection={() => setAddModalOpen(true)}
          masterMode={masterMode}
          onToggleMaster={() => (masterMode ? exitMasterMode() : enterMasterMode())}
          onNewFromMaster={newFromMaster}
          onPdf={exportPdf}
          currentVariant={currentVariant}
          onProofread={() => proofread(attachedJD)}
          hasJD={!!attachedJD.trim()}
        />
        <div className="preview-area">
          {view === "cover" ? (
            <CoverLetterView
              header={header} cover={cover} margins={margins}
              onEdit={() => setCoverModalOpen(true)}
              onEditHeader={() => setHeaderModalOpen(true)}
              onCreate={() => { setCover(deepClone(COVER_TEMPLATE)); setCoverModalOpen(true); }}
            />
          ) : (
            <ResumeDocument
              items={items} header={header} margins={margins}
              onSectionClick={setEditingSectionId}
              onInlineCommit={onInlineCommit}
              pagesWrapRef={pagesWrapRef}
            />
          )}
        </div>
      </div>

      <ChatPanel
        open={chatOpen} onSetOpen={setChatOpen}
        chatHistory={chat.chatHistory} chatBusy={chat.chatBusy}
        onSend={chat.sendMessage} quote={chat.quote} onClearQuote={() => chat.setQuote(null)}
        onClear={chat.clearChat} undoEdit={chat.undoEdit}
        attachedJD={attachedJD} serverUp={serverUp}
      />

      {editingSection && (
        <SectionModal
          section={editingSection} masterMode={masterMode} note={masterNotes[editingSection.id]}
          onClose={() => setEditingSectionId(null)}
          onSave={(newSection, noteText) => {
            setItems((prev) => prev.map((it) => (it.id === editingSection.id ? newSection : it)));
            if (masterMode && noteText !== undefined) {
              setMasterNotes((prev) => {
                const next = { ...prev };
                if (noteText.trim()) next[editingSection.id] = noteText; else delete next[editingSection.id];
                return next;
              });
            }
            setEditingSectionId(null);
          }}
        />
      )}
      {headerModalOpen && (
        <HeaderModal header={header} onClose={() => setHeaderModalOpen(false)} onSave={(h) => { setHeader(h); setHeaderModalOpen(false); }} />
      )}
      {coverModalOpen && (
        <CoverModal cover={cover || deepClone(COVER_TEMPLATE)} headerName={header.name}
          onClose={() => setCoverModalOpen(false)}
          onSave={(c) => { setCover(c); setCoverModalOpen(false); }} />
      )}
      {addModalOpen && (
        <AddSectionModal items={items} onClose={() => setAddModalOpen(false)} onAdd={addSection} />
      )}
      {variantBrowserOpen && (
        <VariantBrowserModal variants={variants} currentVariant={currentVariant}
          onClose={() => setVariantBrowserOpen(false)} onLoad={loadVariant} onDelete={deleteVariant} />
      )}
      {proof.open && (
        <ProofreadModal loading={proof.loading} findings={proof.findings} appliedIds={proof.applied}
          onClose={() => setProof((p) => ({ ...p, open: false }))} onApply={applyFinding} />
      )}
    </div>
  );
}

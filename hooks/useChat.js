"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deepClone, byId } from "@/lib/resumeModel";

// Ported from resume_builder.html's chat panel: chatOutline/chatGetDocument/
// chatGetMaster/chatExecTool/chatRunLoop. The agentic loop streams one assistant
// turn; if it ends by calling tools, the CLIENT executes them against the live
// React state (that's where the document lives) and feeds results back, looping
// until Claude stops calling tools.
//
// `doc` is a small interface the caller (ResumeApp) provides so this hook never
// touches React state directly — it always mutates through refs holding the
// latest value (avoiding stale closures across the async SSE loop) and the
// setters trigger the actual re-render.
export function useChat(doc) {
  const [chatHistory, setChatHistory] = useState([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const chatEditSeq = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;

  function chatOutline() {
    try {
      const d = docRef.current;
      const lines = d.items.map((it) => {
        const v = it.visible === false ? " (hidden)" : "";
        let extra = "";
        if (it.type === "jobs" && it.jobs) extra = " — " + it.jobs.map((j) => j.org).filter(Boolean).slice(0, 3).join("; ");
        return "- " + it.id + " [" + it.type + "] " + (it.label || "") + v + extra;
      });
      return "Header: " + (d.header.name || "") + " — " + (d.header.title || "") + "\nSections:\n" + lines.join("\n");
    } catch (e) { return ""; }
  }

  function chatGetDocument() {
    const d = docRef.current;
    const secs = d.items.filter((it) => it.visible !== false).map((it) => {
      const s = { id: it.id, label: it.label, type: it.type };
      if (it.parentId) s.parent_id = it.parentId;
      if (it.type === "summary") s.text = it.content || "";
      else if (it.type === "list") s.items = (it.items || []).slice();
      else if (it.type === "skills") s.groups = (it.groups || []).map((g) => ({ label: g.label, items: g.items }));
      else if (it.type === "jobs") s.jobs = (it.jobs || []).map((j, ji) => ({ index: ji, org: j.org, title: j.title, dates: j.dates, bullets: (j.bullets || []).slice() }));
      return s;
    });
    const result = { header: { name: d.header.name, title: d.header.title }, sections: secs };
    if (d.cover) result.cover_letter = { salutation: d.cover.salutation, body: (d.cover.body || []).slice(), signoff: d.cover.signoff, signName: d.cover.signName };
    return result;
  }

  function chatGetMaster() {
    const d = docRef.current;
    const src = d.masterMode ? { items: d.items, header: d.header, notes: d.masterNotes || {} } : d.masterDoc;
    if (!src || !src.items) return { error: "No master exists yet. The user should open \"Edit Master\" once to create it." };
    const notes = src.notes || {};
    const secs = (src.items || []).map((it) => {
      const s = { id: it.id, label: it.label, type: it.type };
      if (it.parentId) s.parent_id = it.parentId;
      if (it.type === "summary") s.text = it.content || "";
      else if (it.type === "list") s.items = (it.items || []).slice();
      else if (it.type === "skills") s.groups = (it.groups || []).map((g) => ({ label: g.label, items: g.items }));
      else if (it.type === "jobs") s.jobs = (it.jobs || []).map((j, ji) => ({ index: ji, org: j.org, title: j.title, dates: j.dates, bullets: (j.bullets || []).slice() }));
      if (notes[it.id]) s.context = notes[it.id];
      return s;
    });
    return { sections: secs, header: { name: src.header && src.header.name, title: src.header && src.header.title } };
  }

  function makeDocChip(label, beforeItems, beforeHeader, beforeCover) {
    return {
      id: "e" + (chatEditSeq.current++), label, undone: false, domain: "doc",
      restore: () => {
        docRef.current.setItems(beforeItems);
        docRef.current.setHeader(beforeHeader);
        docRef.current.setCover(beforeCover);
      },
    };
  }
  function makeMasterChip(label, beforeMaster) {
    return {
      id: "e" + (chatEditSeq.current++), label, undone: false, domain: "master",
      restore: () => {
        const d = docRef.current;
        if (d.masterMode) { d.setItems(beforeMaster.items); d.setHeader(beforeMaster.header); d.setMasterNotes(beforeMaster.notes); }
        else d.setMasterDoc(beforeMaster);
      },
    };
  }

  function execTool(name, input) {
    const d = docRef.current;
    try {
      if (name === "get_document") return { ok: true, result: chatGetDocument() };
      if (name === "get_master") { const gm = chatGetMaster(); return gm.error ? { ok: false, result: gm.error } : { ok: true, result: gm }; }

      // ── Master edits: background, on a different document than the visible variant ──
      if (["edit_master", "edit_master_context", "add_master_section", "reorder_master_section"].includes(name)) {
        const live = d.masterMode;
        const target = live ? { items: deepClone(d.items), header: deepClone(d.header), notes: deepClone(d.masterNotes || {}) }
                             : (d.masterDoc ? deepClone(d.masterDoc) : null);
        if (!target) return { ok: false, result: 'No master exists yet. Ask the user to open "Edit Master" once to create it.' };
        const beforeSnap = live ? { items: deepClone(d.items), header: deepClone(d.header), notes: deepClone(d.masterNotes || {}) } : deepClone(d.masterDoc);

        function commitMaster(label) {
          if (live) { d.setItems(target.items); d.setHeader(target.header); d.setMasterNotes(target.notes); }
          else d.setMasterDoc(target);
          d.saveMaster(target);
          return { ok: true, result: label === "context" ? "Updated master context." : "Applied to master.", chip: makeMasterChip("Master · " + label, beforeSnap) };
        }

        if (name === "edit_master_context") {
          const msec = target.items.find((x) => x.id === input.section_id);
          if (!msec) return { ok: false, result: 'No master section with id "' + input.section_id + '". Call get_master for valid ids.' };
          if (!target.notes) target.notes = {};
          if (input.context == null || !String(input.context).trim()) delete target.notes[input.section_id];
          else target.notes[input.section_id] = String(input.context);
          return commitMaster("<b>" + msec.label + "</b>");
        }

        if (name === "edit_master") {
          const msec = target.items.find((x) => x.id === input.section_id);
          if (!msec) return { ok: false, result: 'No master section with id "' + input.section_id + '". Call get_master for valid ids.' };
          if (msec.type === "summary") { if (input.text != null) msec.content = String(input.text); }
          else if (msec.type === "jobs") {
            const mj = (msec.jobs || [])[input.job_index];
            if (!mj) return { ok: false, result: "No job at index " + input.job_index + ' in master section "' + input.section_id + '".' };
            if (input.org != null) mj.org = String(input.org);
            if (input.title != null) mj.title = String(input.title);
            if (input.dates != null) mj.dates = String(input.dates);
            if (Array.isArray(input.bullets)) mj.bullets = input.bullets.map(String);
          } else if (msec.type === "list") { if (Array.isArray(input.items)) msec.items = input.items.map(String); }
          else if (msec.type === "skills") { if (Array.isArray(input.groups)) msec.groups = input.groups.map((g) => ({ label: String(g.label || ""), items: String(g.items || "") })); }
          return commitMaster("<b>" + msec.label + "</b>");
        }

        if (name === "add_master_section") {
          const label = String(input.label || "").trim();
          if (!label) return { ok: false, result: "label is required." };
          const type = input.type === "summary" || input.type === "list" ? input.type : "jobs";
          const parentId = input.parent_id ? String(input.parent_id) : null;
          if (parentId && !target.items.find((x) => x.id === parentId)) return { ok: false, result: 'No master section with id "' + parentId + '". Call get_master for valid ids.' };
          const newId = "custom_" + Date.now();
          const newItem = { id: newId, label, visible: true, parentId, type };
          if (type === "jobs") newItem.jobs = [{ org: input.org != null ? String(input.org) : label, title: input.title != null ? String(input.title) : "", dates: input.dates != null ? String(input.dates) : "", bullets: Array.isArray(input.bullets) ? input.bullets.map(String) : [""] }];
          else if (type === "summary") newItem.content = "";
          else newItem.items = [""];
          if (parentId) {
            const pIdx = target.items.findIndex((x) => x.id === parentId);
            let insertAt = pIdx + 1;
            while (insertAt < target.items.length && target.items[insertAt].parentId === parentId) insertAt++;
            target.items.splice(insertAt, 0, newItem);
          } else target.items.push(newItem);
          return commitMaster('added <b>' + label + '</b>');
        }

        if (name === "reorder_master_section") {
          const src = target.items.find((x) => x.id === input.section_id);
          if (!src) return { ok: false, result: 'No master section with id "' + input.section_id + '". Call get_master for valid ids.' };
          const newParent = input.parent_id != null && String(input.parent_id).trim() ? String(input.parent_id) : null;
          if (newParent && !target.items.find((x) => x.id === newParent)) return { ok: false, result: 'No master section with id "' + newParent + '". Call get_master for valid ids.' };
          if (newParent === input.section_id) return { ok: false, result: "A section cannot be its own parent." };
          const effParent = "parent_id" in input ? newParent : src.parentId;
          const si = target.items.findIndex((x) => x.id === input.section_id);
          const moved = target.items.splice(si, 1)[0];
          moved.parentId = effParent;
          if (input.after_id) {
            const ai = target.items.findIndex((x) => x.id === input.after_id);
            if (ai < 0) { target.items.splice(si, 0, moved); return { ok: false, result: 'No master section with id "' + input.after_id + '" to place after.' }; }
            target.items.splice(ai + 1, 0, moved);
          } else if (effParent) {
            const pi = target.items.findIndex((x) => x.id === effParent);
            target.items.splice(pi + 1, 0, moved);
          } else target.items.unshift(moved);
          return commitMaster('reordered <b>' + src.label + '</b>');
        }
      }

      // ── Visible-document edits ──────────────────────────────────────────────
      const beforeItems = deepClone(d.items), beforeHeader = deepClone(d.header), beforeCover = d.cover ? deepClone(d.cover) : null;
      const items = deepClone(d.items);
      let header = deepClone(d.header);
      let cover = d.cover ? deepClone(d.cover) : null;
      let label = null, s;

      if (name === "set_summary") {
        s = byId(items, input.section_id);
        if (!s || s.type !== "summary") return { ok: false, result: 'No summary section with id "' + input.section_id + '".' };
        s.content = String(input.text == null ? "" : input.text);
        label = "Rewrote <b>" + s.label + "</b>";
      } else if (name === "update_job") {
        s = byId(items, input.section_id);
        if (!s || s.type !== "jobs") return { ok: false, result: 'No jobs section with id "' + input.section_id + '".' };
        const j = (s.jobs || [])[input.job_index];
        if (!j) return { ok: false, result: "No job at index " + input.job_index + ' in section "' + input.section_id + '".' };
        if (input.org != null) j.org = String(input.org);
        if (input.title != null) j.title = String(input.title);
        if (input.dates != null) j.dates = String(input.dates);
        if (Array.isArray(input.bullets)) j.bullets = input.bullets.map(String);
        label = "Updated <b>" + (j.org || s.label) + "</b>";
      } else if (name === "set_list_items") {
        s = byId(items, input.section_id);
        if (!s || s.type !== "list") return { ok: false, result: 'No list section with id "' + input.section_id + '".' };
        if (!Array.isArray(input.items)) return { ok: false, result: "items must be an array of strings." };
        s.items = input.items.map(String);
        label = "Updated <b>" + s.label + "</b>";
      } else if (name === "set_skill_groups") {
        s = byId(items, input.section_id);
        if (!s || s.type !== "skills") return { ok: false, result: 'No skills section with id "' + input.section_id + '".' };
        if (!Array.isArray(input.groups)) return { ok: false, result: "groups must be an array." };
        s.groups = input.groups.map((g) => ({ label: String(g.label || ""), items: String(g.items || "") }));
        label = "Updated <b>" + s.label + "</b>";
      } else if (name === "set_section_visibility") {
        s = byId(items, input.section_id);
        if (!s) return { ok: false, result: 'No section with id "' + input.section_id + '".' };
        s.visible = !!input.visible;
        label = (input.visible ? "Showed" : "Hid") + " <b>" + s.label + "</b>";
      } else if (name === "update_header") {
        if (input.name != null) header.name = String(input.name);
        if (input.title != null) header.title = String(input.title);
        label = "Updated <b>header</b>";
      } else if (name === "update_cover_letter") {
        if (!cover) cover = { salutation: "", body: [""], signoff: "", signName: "" };
        if (input.salutation != null) cover.salutation = String(input.salutation);
        if (Array.isArray(input.body)) cover.body = input.body.map(String);
        if (input.signoff != null) cover.signoff = String(input.signoff);
        if (input.signName != null) cover.signName = String(input.signName);
        label = "Updated <b>cover letter</b>";
      } else {
        return { ok: false, result: 'Unknown tool "' + name + '".' };
      }

      d.setItems(items); d.setHeader(header); d.setCover(cover);
      d.onDocMutated();
      return { ok: true, result: "Applied.", chip: makeDocChip(label, beforeItems, beforeHeader, beforeCover) };
    } catch (e) {
      return { ok: false, result: "Error applying change: " + (e.message || e) };
    }
  }

  function endLoop() { setChatBusy(false); }

  async function runLoop(history, depth, retries) {
    retries = retries || 0;
    if (depth > 16) {
      setChatHistory((h) => [...h, { role: "assistant", content: "⚠ Stopped after too many tool steps." }]);
      return endLoop();
    }

    const apiMsgs = history.map((m) => ({ role: m.role, content: m.content }));
    const asst = { role: "assistant", content: "" };
    setChatHistory((h) => [...h, asst]);

    const reqBody = { messages: apiMsgs };
    if (depth === 0) {
      reqBody.outline = chatOutline();
      const jd = docRef.current.attachedJD;
      if (jd) reqBody.jd = jd.slice(0, 12000);
    }

    let res;
    try {
      res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqBody) });
    } catch (e) {
      setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: "⚠ Could not reach the server." } : m)));
      return endLoop();
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.indexOf("text/event-stream") < 0) {
      const j = await res.json().catch(() => null);
      if (j && j.error === "rate_limit" && retries < 6) {
        const wait = Math.max(2, j.retryAfter || 30);
        setChatHistory((h) => h.filter((m) => m !== asst));
        setTimeout(() => runLoop(history, depth, retries + 1), wait * 1000);
        return;
      }
      setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: "⚠ " + ((j && j.message) || "Chat is unavailable right now.") } : m)));
      return endLoop();
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const blocks = {}, toolJson = {};
    let stopReason = null, streamErr = null;

    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        buf += dec.decode(step.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (line.indexOf("data:") !== 0) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch (e) { continue; }
          if (ev.type === "content_block_start") {
            const cb = ev.content_block || {};
            if (cb.type === "text") blocks[ev.index] = { type: "text", text: "" };
            else if (cb.type === "tool_use") { blocks[ev.index] = { type: "tool_use", id: cb.id, name: cb.name, input: {} }; toolJson[ev.index] = ""; }
          } else if (ev.type === "content_block_delta") {
            const d = ev.delta || {};
            if (d.type === "text_delta" && blocks[ev.index]) {
              blocks[ev.index].text += d.text;
              const text = orderedText(blocks);
              setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: text } : m)));
            } else if (d.type === "input_json_delta") {
              toolJson[ev.index] = (toolJson[ev.index] || "") + (d.partial_json || "");
            }
          } else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) {
            stopReason = ev.delta.stop_reason;
          } else if (ev.type === "error" && ev.error) {
            streamErr = ev.error.message || "stream error";
          }
        }
      }
    } catch (e) {
      // The stream itself broke (network drop, aborted response, etc). Surface it
      // plainly and stop — do NOT fall through to tool execution with whatever
      // partial/incomplete blocks happened to be accumulated so far, which would
      // silently misfire tools with truncated input and cascade into more bad turns.
      setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: "⚠ Connection to the server was interrupted mid-reply: " + (e.message || e) } : m)));
      return endLoop();
    }

    if (streamErr) {
      setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: "⚠ " + streamErr } : m)));
      return endLoop();
    }

    const ordered = orderedBlocks(blocks, toolJson);
    const toolUses = ordered.filter((b) => b.type === "tool_use");
    const finalAsst = { role: "assistant", content: ordered };
    let newHistory = history.concat([finalAsst]);

    if (toolUses.length) {
      const edits = [];
      const results = [];
      toolUses.forEach((tu) => {
        const r = execTool(tu.name, tu.input);
        if (r.chip) edits.push(r.chip);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: typeof r.result === "string" ? r.result : JSON.stringify(r.result), is_error: !r.ok });
      });
      const textOnly = ordered.filter((b) => b.type === "text").map((b) => b.text).join("");
      setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: textOnly, edits } : m)));
      newHistory = newHistory.slice(0, -1).concat([{ role: "assistant", content: ordered, hidden: false }, { role: "user", content: results, hidden: true }]);
      return runLoop(newHistory, depth + 1);
    }

    const textOnly = ordered.filter((b) => b.type === "text").map((b) => b.text).join("");
    setChatHistory((h) => h.map((m) => (m === asst ? { role: "assistant", content: textOnly } : m)));
    endLoop();
  }

  // NOTE: the network call (runLoop) must NOT happen inside a setState updater —
  // React is allowed to invoke updater functions more than once (this was firing
  // the streaming request multiple times concurrently, each racing to append its
  // own assistant bubble — that's what caused the garbled multi-message glitch).
  // Compute the next history from the current closure value and fire runLoop
  // as a plain side effect after the state update is queued.
  const sendMessage = useCallback((text) => {
    if (chatBusy || !text.trim()) return;
    const q = quote;
    setQuote(null);
    const content = q ? 'Regarding this excerpt from my resume:\n"""\n' + q + '\n"""\n\n' + text : text;
    const userMsg = { role: "user", content, display: text, quote: q };
    const next = [...chatHistory, userMsg];
    setChatBusy(true);
    setChatHistory(next);
    runLoop(next, 0);
  }, [chatBusy, quote, chatHistory]);

  // For flows outside the chat input (e.g. "Build tailored resume") that want to
  // post a result straight into the transcript.
  const appendMessage = useCallback((msg) => {
    setChatHistory((h) => [...h, msg]);
  }, []);

  const undoEdit = useCallback((editId) => {
    let target = null;
    const hitList = [];
    chatHistory.forEach((m) => (m.edits || []).forEach((e) => { hitList.push(e); if (e.id === editId) target = e; }));
    if (!target || target.undone) return;
    if (typeof target.restore === "function") target.restore();
    let reached = false;
    setChatHistory((h) => h.map((m) => {
      if (!m.edits) return m;
      return { ...m, edits: m.edits.map((e) => {
        if (e.id === editId) reached = true;
        return reached && e.domain === target.domain ? { ...e, undone: true } : e;
      }) };
    }));
  }, [chatHistory]);

  return { chatHistory, chatBusy, sendMessage, appendMessage, quote, setQuote, undoEdit, clearChat: () => { setChatHistory([]); setQuote(null); } };
}

function orderedText(blocks) {
  return Object.keys(blocks).sort((a, b) => a - b).map((i) => blocks[i]).filter((b) => b.type === "text").map((b) => b.text).join("");
}
function orderedBlocks(blocks, toolJson) {
  return Object.keys(blocks).sort((a, b) => a - b).map((i) => {
    const b = blocks[i];
    if (b.type === "tool_use") {
      let input = {};
      try { input = JSON.parse(toolJson[i] || "{}"); } catch (e) {}
      return { type: "tool_use", id: b.id, name: b.name, input };
    }
    return b;
  });
}

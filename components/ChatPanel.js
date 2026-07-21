"use client";

import { useEffect, useRef, useState } from "react";
import { renderMarkdownLite } from "@/lib/markdownLite";

function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

export default function ChatPanel({ open, onSetOpen, chatHistory, chatBusy, onSend, quote, onClearQuote, onClear, undoEdit, attachedJD, serverUp }) {
  const [input, setInput] = useState("");
  const [jdExpanded, setJdExpanded] = useState(false);
  const messagesRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chatHistory, chatBusy]);

  function autoGrow() {
    const t = taRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(130, t.scrollHeight) + "px";
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
    requestAnimationFrame(autoGrow);
  }

  return (
    <div className={"chat-col" + (open ? "" : " collapsed")} id="chat-col">
      <div className="chat-panel">
        <div className="chat-header">
          <h2><span className="chat-dot" /> Claude</h2>
          <button title="Clear conversation" onClick={onClear}><i className="ti ti-eraser" /></button>
          <button title="Hide panel" onClick={() => onSetOpen(false)}><i className="ti ti-layout-sidebar-right-collapse" /></button>
        </div>
        <div className="chat-messages" ref={messagesRef}>
          {!chatHistory.length && !chatBusy && (
            <div className="chat-empty">Ask Claude anything about this resume, or ask it to make changes directly.<br /><br />Tip: highlight any text on the page and click <b>&quot;Ask Claude&quot;</b> to discuss it directly.</div>
          )}
          {chatHistory.filter((m) => !m.hidden).map((m, i) => {
            if (m.role === "user") {
              return (
                <div className="chat-msg user" key={i}>
                  {m.quote && <div className="msg-quote">{m.quote}</div>}
                  {m.display != null ? m.display : m.content}
                </div>
              );
            }
            const txt = typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join("") : "");
            return (
              <div key={i}>
                {txt.trim() && <div className="chat-msg assistant" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(txt) }} />}
                {(m.edits || []).map((ed) => (
                  <div className={"chat-edit" + (ed.undone ? " undone" : "")} key={ed.id}>
                    <span className="ce-ico"><i className="ti ti-pencil" /></span>
                    <span className="ce-label" dangerouslySetInnerHTML={{ __html: ed.label }} />
                    {ed.undone ? <span className="ce-done">undone</span> : <button className="ce-undo" onClick={() => undoEdit(ed.id)}>Undo</button>}
                  </div>
                ))}
              </div>
            );
          })}
          {chatBusy && <div className="chat-thinking"><span className="chat-spinner" /> Thinking…</div>}
        </div>
        {!serverUp && (
          <div className="chat-note">Chat needs the Anthropic API key set on the server (ANTHROPIC_API_KEY in .env.local).</div>
        )}
        {quote && (
          <div className="chat-quote-bar">
            <div className="chat-quote-chip">
              <i className="ti ti-quote" style={{ marginTop: 1 }} />
              <span className="q-text">{quote}</span>
              <button onClick={onClearQuote}>&times;</button>
            </div>
          </div>
        )}
        <div className="chat-input-row">
          <textarea className="chat-input" rows={1} placeholder="Ask about your resume…" ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoGrow(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="chat-send" title="Send" onClick={send} disabled={chatBusy}><i className="ti ti-arrow-up" /></button>
        </div>
      </div>
      <div className={"chat-jd-section" + (jdExpanded ? " expanded" : "")} id="chat-jd-tray">
        <div className="chat-jd-head" onClick={() => attachedJD && setJdExpanded((v) => !v)}>
          <i className="ti ti-file-text" /> Job description attached to this resume
          <button style={{ visibility: attachedJD ? "visible" : "hidden" }}><i className="ti ti-chevron-down" /></button>
        </div>
        <div className="chat-jd-text">{attachedJD}</div>
        {!attachedJD && <div className="chat-jd-empty" style={{ display: "block" }}>No job description attached yet — paste one in the sidebar and click Build or Proofread.</div>}
      </div>
    </div>
  );
}

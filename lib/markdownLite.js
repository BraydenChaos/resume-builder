// Ported from resume_builder.html's renderProofFeedback — a tiny markdown-lite
// renderer for chat/proofread text (bold, bullet lists, heading-ish lines).
function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export function renderMarkdownLite(text) {
  const lines = String(text || "").split("\n");
  let html = "", inList = false;
  function closeList() { if (inList) { html += "</ul>"; inList = false; } }
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) { closeList(); return; }
    const b = esc(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^[-*•]\s+/.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + b.replace(/^[-*•]\s+/, "") + "</li>"; return; }
    closeList();
    if (/^#{1,4}\s+/.test(line)) { html += "<h4>" + b.replace(/^#{1,4}\s+/, "") + "</h4>"; return; }
    if (/:$/.test(line) && line.length < 60) { html += "<h4>" + b.replace(/:$/, "") + "</h4>"; return; }
    html += "<p>" + b + "</p>";
  });
  closeList();
  return '<div class="proof-fb">' + html + "</div>";
}

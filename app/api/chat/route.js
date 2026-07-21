import { RESUME_TOOLS, SYSTEM_PROMPT, pruneToolResults } from "@/lib/chatTools";

// Log the usage numbers server.js used to log, without touching the stream the
// browser actually consumes. tee() splits the upstream body into two INDEPENDENT
// streams from the same source — `clientStream` goes straight through unmodified,
// while `logStream` is read separately, off to the side, purely for console output.
// (An earlier version used pipeThrough(TransformStream) to do both in one pass;
// that meant any bug in the logging/parsing code could error the transform and
// abort the client's half of the stream too — which produced exactly the garbled,
// truncated assistant messages this was supposed to just be logging alongside.)
function withUsageLogging(body) {
  const [clientStream, logStream] = body.tee();

  (async () => {
    const reader = logStream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usage = {};
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (line.indexOf("data:") !== 0) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch (e) { continue; }
          if (ev.type === "message_start" && ev.message && ev.message.usage) Object.assign(usage, ev.message.usage);
          if (ev.type === "message_delta" && ev.usage && ev.usage.output_tokens != null) usage.output_tokens = ev.usage.output_tokens;
        }
      }
    } catch (e) { /* logging is best-effort — never let it affect the real response */ }
    console.log("  Chat turn: in=" + (usage.input_tokens || 0) + " cacheRead=" + (usage.cache_read_input_tokens || 0) +
                " cacheWrite=" + (usage.cache_creation_input_tokens || 0) + " out=" + (usage.output_tokens || 0));
  })();

  return clientStream;
}

// POST /api/chat — streaming AI chat via Anthropic API (SSE passthrough).
export async function POST(req) {
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "no_key", message: "Chat needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env.local and restart the server." });
  }

  let history = (Array.isArray(data.messages) ? data.messages : []).filter((m) => {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return false;
    if (typeof m.content === "string") return m.content.trim().length > 0;
    return Array.isArray(m.content) && m.content.length > 0;
  }).slice(-60);
  if (!history.length) return Response.json({ ok: false, error: "no_messages" }, { status: 400 });

  history = pruneToolResults(history);

  const system = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
  const jd = String(data.jd || "").slice(0, 12000);
  if (jd) system.push({ type: "text", text: "The job description the user has pasted/saved for this resume, in case they ask about it or want the resume aligned to it:\n" + jd, cache_control: { type: "ephemeral" } });
  const outline = String(data.outline || "").slice(0, 4000);
  if (outline) system.push({ type: "text", text: "Outline of the document currently on screen (ids and headings only — call get_document for full content):\n" + outline });

  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  if (messages.length) {
    const last = messages[messages.length - 1];
    if (typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
    } else if (Array.isArray(last.content) && last.content.length) {
      const lastBlock = last.content[last.content.length - 1];
      last.content = last.content.slice(0, -1).concat([Object.assign({}, lastBlock, { cache_control: { type: "ephemeral" } })]);
    }
  }

  const model = process.env.ANTHROPIC_CHAT_MODEL || "claude-opus-4-8";
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 8192, stream: true, system, tools: RESUME_TOOLS, messages }),
  });

  if (!upstream.ok) {
    const rateLimited = upstream.status === 429;
    let msg = "Anthropic API error (" + upstream.status + ").";
    try { const j = await upstream.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    const retryAfter = parseInt(upstream.headers.get("retry-after"), 10);
    return Response.json({
      ok: false, error: rateLimited ? "rate_limit" : "api", message: msg,
      retryAfter: rateLimited && retryAfter > 0 ? retryAfter : rateLimited ? 30 : undefined,
    });
  }

  return new Response(withUsageLogging(upstream.body), { headers: { "Content-Type": "text/event-stream" } });
}

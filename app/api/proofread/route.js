import { PROOF_SCHEMA } from "@/lib/chatTools";

// POST /api/proofread — one-shot structured proofread (resume + JD together).
export async function POST(req) {
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: "bad_json", message: "Invalid JSON." }, { status: 400 }); }

  const doc = data.doc;
  if (!doc || !Array.isArray(doc.sections)) {
    return Response.json({ ok: false, error: "empty", message: "Nothing to proofread yet." });
  }
  const jdText = String(data.jd_text || "").slice(0, 12000);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "no_key", message: "Proofreading needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env.local and restart the server." });
  }

  const system =
    "You are a meticulous resume reviewer. Review the resume document (JSON, with stable section ids) below and report real issues as a flat list of findings. " +
    'Two categories only: "technical" (typos, grammar, inconsistent dates or capitalization, metrics that disagree, awkward or weak phrasing) and "alignment" (' +
    (jdText ? "how well the resume matches the job description below — missing keywords, under-emphasized relevant experience, generic wording that should mirror the JD" : "no job description was provided, so skip this category entirely — return only technical findings") +
    "). Be specific: quote or reference the exact offending text in `issue`. Every finding must include the FULL exact replacement text in `suggestion` — not a description of the fix, the actual corrected text for that field. Do not invent problems; if something is already good, do not report it. Never use em-dashes.";
  const userContent = "RESUME DOCUMENT (JSON):\n" + JSON.stringify(doc) + (jdText ? "\n\nJOB DESCRIPTION:\n" + jdText : "\n\n(No job description provided — technical findings only.)");

  const model = process.env.ANTHROPIC_CHAT_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4096,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: userContent }],
      output_config: { format: { type: "json_schema", schema: PROOF_SCHEMA } },
    }),
  });

  if (upstream.status === 429) {
    const retryAfter = parseInt(upstream.headers.get("retry-after"), 10);
    return Response.json({ ok: false, error: "rate_limit", message: "Rate limited.", retryAfter: retryAfter > 0 ? retryAfter : 30 });
  }

  const j = await upstream.json();
  if (j.error) return Response.json({ ok: false, error: "api", message: j.error.message || "Anthropic API error." });
  const textBlock = (j.content || []).find((b) => b.type === "text") || {};
  let parsed;
  try { parsed = JSON.parse(textBlock.text || ""); }
  catch (e) { return Response.json({ ok: false, error: "parse", message: "The model did not return valid findings." }); }

  const u = j.usage || {};
  console.log("  Proofread: in=" + (u.input_tokens || 0) + " cacheRead=" + (u.cache_read_input_tokens || 0) +
              " out=" + (u.output_tokens || 0) + "  |  " + ((parsed.findings || []).length) + " findings");

  return Response.json({ ok: true, findings: parsed.findings || [], usage: u });
}

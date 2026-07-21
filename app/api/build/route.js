import { BUILD_SCHEMA } from "@/lib/chatTools";

// POST /api/build — one-shot JD tailoring via structured outputs. A single API
// call: send the document + JD, get back a tailoring plan. No agentic loop.
export async function POST(req) {
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ ok: false, error: "no_key", message: "Building needs an Anthropic API key (ANTHROPIC_API_KEY)." });

  const doc = data.doc;
  const jd = String(data.jd || "").slice(0, 12000);
  if (!doc || !Array.isArray(doc.sections) || !jd.trim()) {
    return Response.json({ ok: false, error: "bad_input", message: "Need a document and a job description." });
  }

  const system =
    "You are a resume-tailoring engine. Given a resume document (JSON, with stable section ids) and a job description, produce a tailoring PLAN as structured JSON. " +
    "Decide which sections stay visible (relevant to the target role) and which are hidden; rewrite the profile/summary and the header tagline to match the role; rewrite the bullets of the most relevant jobs to emphasize fit. " +
    "Stay strictly truthful — never invent experience, employers, titles, or metrics; only reshape and re-emphasize what is already there. Keep language tight and specific. Never use em-dashes.";
  const userContent = "JOB DESCRIPTION:\n" + jd + "\n\nRESUME DOCUMENT (JSON):\n" + JSON.stringify(doc);

  const model = process.env.ANTHROPIC_CHAT_MODEL || "claude-opus-4-8";
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4096,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: userContent }],
      output_config: { format: { type: "json_schema", schema: BUILD_SCHEMA } },
    }),
  });

  if (upstream.status === 429) {
    const retryAfter = parseInt(upstream.headers.get("retry-after"), 10);
    return Response.json({ ok: false, error: "rate_limit", message: "Rate limited.", retryAfter: retryAfter > 0 ? retryAfter : 30 });
  }

  const j = await upstream.json();
  if (j.error) return Response.json({ ok: false, error: "api", message: j.error.message || "Anthropic API error." });
  const textBlock = (j.content || []).find((b) => b.type === "text") || {};
  let plan;
  try { plan = JSON.parse(textBlock.text || ""); }
  catch (e) { return Response.json({ ok: false, error: "parse", message: "The model did not return a valid plan." }); }

  const u = j.usage || {};
  const hidden = doc.sections.length - (plan.visible_ids || []).length;
  console.log("  Build: in=" + (u.input_tokens || 0) + " cacheRead=" + (u.cache_read_input_tokens || 0) +
              " out=" + (u.output_tokens || 0) + "  |  " + (plan.visible_ids || []).length + " shown / " +
              (hidden < 0 ? 0 : hidden) + " hidden, " + ((plan.bullets || []).length) + " bullet rewrites");

  return Response.json({ ok: true, plan, usage: u });
}

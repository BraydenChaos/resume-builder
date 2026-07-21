// Ported verbatim from server.js — tool schemas declared to the Anthropic API.
// The tools run in the BROWSER (the live document state lives there); the server
// only declares schemas and forwards them, the client executes each call.
export const RESUME_TOOLS = [
  {
    name: 'get_document',
    description: 'Read the current resume as structured data with stable section ids and zero-based job indices. Call this FIRST before any edit so you target the correct ids and see current content. Returns sections (id, label, type, and their content), the header, and the cover letter if one exists.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_summary',
    description: 'Replace the full text of a summary/profile section.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string', description: 'Id of a section whose type is "summary".' },
        text: { type: 'string', description: 'The new summary text.' },
      },
      required: ['section_id', 'text'],
    },
  },
  {
    name: 'update_job',
    description: 'Update one job entry inside a jobs-type section. Only fields you pass are changed. To edit bullets, pass the FULL new bullets array — it replaces every bullet for that job.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        job_index: { type: 'integer', description: "Zero-based index of the job within the section's jobs array." },
        org: { type: 'string' },
        title: { type: 'string' },
        dates: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' }, description: 'Full replacement list of bullet strings.' },
      },
      required: ['section_id', 'job_index'],
    },
  },
  {
    name: 'set_list_items',
    description: 'Replace all items in a list-type section (e.g. certifications, speaking engagements). Pass the full new list.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['section_id', 'items'],
    },
  },
  {
    name: 'set_skill_groups',
    description: 'Replace the skill groups of a skills-type section. Each group has a label (category) and an items string of comma-separated skills.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, items: { type: 'string', description: 'Comma-separated skills.' } },
            required: ['label', 'items'],
          },
        },
      },
      required: ['section_id', 'groups'],
    },
  },
  {
    name: 'set_section_visibility',
    description: 'Show or hide a section on the resume. Hidden sections stay in the document but are not printed. This is the key tool for tailoring: drop projects and sections that are not relevant to the target role, and keep the ones that are.',
    input_schema: {
      type: 'object',
      properties: { section_id: { type: 'string' }, visible: { type: 'boolean' } },
      required: ['section_id', 'visible'],
    },
  },
  {
    name: 'update_header',
    description: 'Update the resume header. Only fields you pass are changed.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, title: { type: 'string', description: 'The tagline shown under the name.' } },
    },
  },
  {
    name: 'update_cover_letter',
    description: 'Update the cover letter. Only fields you pass are changed. body is the full ordered list of paragraphs.',
    input_schema: {
      type: 'object',
      properties: {
        salutation: { type: 'string' },
        body: { type: 'array', items: { type: 'string' }, description: 'Full list of paragraphs, in order.' },
        signoff: { type: 'string' },
        signName: { type: 'string' },
      },
    },
  },
  {
    name: 'get_master',
    description: "Read the MASTER resume (the canonical source all variants draw from) as structured data: section ids, types, current content, AND each section's private context note. Call this before edit_master or edit_master_context so you target the right section id and can preserve existing context. Master section ids can differ from the current variant's, so never assume — read them here.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'edit_master',
    description: "Edit the MASTER resume's content in the background (does not touch the variant the user is viewing). Use this to improve the canonical record of a role or project so all future variants benefit. Pass section_id and only the fields for that section's type: summary -> text; a jobs section -> job_index plus any of org/title/dates/bullets (bullets replaces every bullet for that job); list -> items; skills -> groups.",
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        job_index: { type: 'integer', description: 'Zero-based job index, for jobs sections.' },
        text: { type: 'string' },
        org: { type: 'string' },
        title: { type: 'string' },
        dates: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
        items: { type: 'array', items: { type: 'string' } },
        groups: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, items: { type: 'string' } }, required: ['label', 'items'] } },
      },
      required: ['section_id'],
    },
  },
  {
    name: 'edit_master_context',
    description: 'Set the private plain-English CONTEXT note on a MASTER section (never printed on any resume). Use this whenever the user tells you background about a role or project — its real scope, their actual role, results, metrics, who to contact — so future tailoring is better informed. Call get_master first and pass the FULL note you want stored (existing context plus the new detail); this overwrites the section\'s note.',
    input_schema: {
      type: 'object',
      properties: { section_id: { type: 'string' }, context: { type: 'string', description: 'The full context note to store for this section.' } },
      required: ['section_id', 'context'],
    },
  },
  {
    name: 'add_master_section',
    description: 'Add a brand-new entry to the MASTER resume\'s background: a company/employer, or a client/project nested under an existing company. Call get_master first to see existing ids (use one as parent_id to nest a client under a company). Only a "jobs" type entry may have a parent.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Section label shown in the sidebar, e.g. the company or project name.' },
        type: { type: 'string', enum: ['jobs', 'summary', 'list'], description: 'Almost always "jobs" for a company or client entry.' },
        parent_id: { type: 'string', description: 'Id of an existing master section to nest this under (e.g. add a client under its company). Omit for a top-level entry.' },
        org: { type: 'string', description: 'Jobs type only: organization/client name. Defaults to label.' },
        title: { type: 'string', description: 'Jobs type only: role/title.' },
        dates: { type: 'string', description: 'Jobs type only: date range.' },
        bullets: { type: 'array', items: { type: 'string' }, description: 'Jobs type only: bullet points.' },
      },
      required: ['label', 'type'],
    },
  },
  {
    name: 'reorder_master_section',
    description: 'Move a MASTER section to a new position, and optionally re-parent it (e.g. move a client to sit under a different company, or promote it to a top-level entry). Call get_master first for valid ids. Some fixed sections (skills/certifications/engagements/references) cannot be re-parented.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string', description: 'Id of the master section to move.' },
        parent_id: { type: 'string', description: 'Id of the new parent section, so this becomes its child (e.g. a client under a company). Pass empty string to make it a top-level entry.' },
        after_id: { type: 'string', description: 'Id of the sibling (within the same parent) to place this section immediately after. Omit to place it first among its siblings.' },
      },
      required: ['section_id'],
    },
  },
];

export const SYSTEM_PROMPT =
  'You are a resume and career assistant embedded in a resume builder app. ' +
  'You help the user tailor their resume and cover letter to specific roles: sharpening bullets, quantifying impact, adjusting positioning, and giving honest feedback. ' +
  'You can edit the document DIRECTLY with the provided tools. When the user asks for a change, MAKE it with the tools rather than only describing it. ' +
  'You do NOT have the document inline — always call get_document first to get exact section ids and current content before editing or giving specific feedback. ' +
  'Make the smallest edit that satisfies the request; never rewrite sections the user did not ask about. After editing, confirm what you changed in one short line. ' +
  'When the user only asks a question or wants advice, just answer — do not edit. ' +
  'To tailor a resume to a specific role, use set_section_visibility to hide the projects and sections that are not relevant and keep the ones that are, then sharpen the summary and the most relevant bullets and align the header title. ' +
  "The MASTER is the canonical resume every variant draws from. When the user shares background about a role or project (its real scope, their actual role, results, metrics, context) rather than requesting a specific edit to the visible resume, quietly record it on the master with edit_master_context so future tailoring benefits — call get_master first to see the section ids and existing notes, and append to what is already there. Use edit_master to improve the master's actual content when a change should apply to every future variant, not just this one. Use add_master_section to record a brand-new company or client the user tells you about (nest a client under its company with parent_id), and reorder_master_section to reorder or re-parent entries (e.g. move a client under a different company, or reorder companies/clients). These master tools work in the background and do not alter the variant the user is viewing. " +
  'If a job description is included below (the user pasted/saved one for this resume), use it to answer questions about the role and to judge how well the resume aligns — quote or reference it directly, no need to ask the user to repaste it. ' +
  'Be concise — this renders in a narrow side panel. Use short paragraphs and bullets. Never use em-dashes.';

// Replace large tool-result payloads in older turns with a short stub. The big
// ones are get_document/get_master dumps; once a couple of turns have passed
// they're stale weight — the model can call the read tool again if it needs
// fresh detail. Only the last few messages keep their full results.
export function pruneToolResults(history) {
  const KEEP_FULL = 4;
  const STUB_OVER = 400;
  const cut = history.length - KEEP_FULL;
  if (cut <= 0) return history;
  return history.map((m, i) => {
    if (i >= cut || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((b) => {
      if (b && b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > STUB_OVER) {
        changed = true;
        return Object.assign({}, b, { content: '[earlier result omitted to save tokens — call the read tool again if you need current detail]' });
      }
      return b;
    });
    return changed ? Object.assign({}, m, { content }) : m;
  });
}

export const PROOF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['technical', 'alignment'], description: '"technical" = typos, grammar, inconsistent dates/capitalization, disagreeing metrics, awkward phrasing. "alignment" = how well this resume matches the job description — missing keywords, under-emphasized relevant experience, generic wording that should mirror the JD.' },
          field: { type: 'string', enum: ['summary', 'header_name', 'header_title', 'job_org', 'job_title', 'job_dates', 'bullet', 'list_item', 'skill_group_label', 'skill_group_items'], description: 'Which field this finding targets.' },
          section_id: { type: 'string', description: 'Section id this finding targets. Empty string for header_name/header_title.' },
          job_index: { type: 'integer', description: 'Required when field is job_org/job_title/job_dates/bullet.' },
          bullet_index: { type: 'integer', description: 'Required when field is bullet.' },
          list_index: { type: 'integer', description: 'Required when field is list_item.' },
          group_index: { type: 'integer', description: 'Required when field is skill_group_label/skill_group_items.' },
          issue: { type: 'string', description: 'One short sentence: what is wrong or misaligned, quoting the offending text.' },
          suggestion: { type: 'string', description: 'The exact full replacement text for this field. This is what gets written if the user approves the finding.' },
        },
        required: ['category', 'field', 'section_id', 'issue', 'suggestion'],
      },
    },
  },
  required: ['findings'],
};

export const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    company: { type: 'string', description: 'The hiring company\'s name, extracted from the job description. Empty string if it genuinely cannot be determined.' },
    visible_ids: { type: 'array', items: { type: 'string' }, description: 'Ids of the sections that should be VISIBLE for this role. Every section id NOT in this list is hidden. Keep the profile/summary and the most relevant experience; drop unrelated projects and roles.' },
    summary: { type: 'string', description: 'Rewritten profile/summary text tailored to the role. Empty string to leave the current summary unchanged.' },
    title: { type: 'string', description: 'Header tagline aligned to the role. Empty string to leave it unchanged.' },
    bullets: {
      type: 'array',
      description: "Bullet rewrites for the most relevant jobs only. Each entry fully replaces that job's bullet list. Leave empty to keep all bullets as they are.",
      items: {
        type: 'object', additionalProperties: false,
        properties: { section_id: { type: 'string' }, job_index: { type: 'integer' }, bullets: { type: 'array', items: { type: 'string' } } },
        required: ['section_id', 'job_index', 'bullets'],
      },
    },
    summary_of_changes: { type: 'string', description: 'One or two plain sentences describing what you tailored and why.' },
  },
  required: ['company', 'visible_ids', 'summary', 'title', 'bullets', 'summary_of_changes'],
};

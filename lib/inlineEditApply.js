// Ported from resume_builder.html's ieAccessor — maps a [data-ie] element's kind +
// dataset to a mutation against items/header. Returns { items, header } (only the
// one that actually changed differs from what was passed in); callers setState
// only the piece that changed.
import { deepClone } from "./resumeModel";

export function applyInlineEdit(kind, dataset, value, items, header) {
  const sid = dataset.sid;
  const ji = dataset.ji != null ? parseInt(dataset.ji, 10) : -1;
  const bi = dataset.bi != null ? parseInt(dataset.bi, 10) : -1;
  const gi = dataset.gi != null ? parseInt(dataset.gi, 10) : -1;
  const li = dataset.li != null ? parseInt(dataset.li, 10) : -1;
  const ci = dataset.ci != null ? parseInt(dataset.ci, 10) : -1;

  let newItems = items, newHeader = header;

  function withSection(mutator) {
    newItems = items.map((it) => (it.id === sid ? mutator(deepClone(it)) : it));
  }

  switch (kind) {
    case "label": withSection((it) => { it.label = value || it.label; return it; }); break;
    case "summary": withSection((it) => { it.content = value; return it; }); break;
    case "job-org": withSection((it) => { if (it.jobs && it.jobs[ji]) it.jobs[ji].org = value; return it; }); break;
    case "job-dates": withSection((it) => { if (it.jobs && it.jobs[ji]) it.jobs[ji].dates = value; return it; }); break;
    case "job-title": withSection((it) => { if (it.jobs && it.jobs[ji]) it.jobs[ji].title = value; return it; }); break;
    case "job-bullet": withSection((it) => {
      if (it.jobs && it.jobs[ji]) {
        if (value.trim() === "") it.jobs[ji].bullets.splice(bi, 1);
        else it.jobs[ji].bullets[bi] = value;
      }
      return it;
    }); break;
    case "skill-label": withSection((it) => { if (it.groups && it.groups[gi]) it.groups[gi].label = value; return it; }); break;
    case "skill-items": withSection((it) => { if (it.groups && it.groups[gi]) it.groups[gi].items = value; return it; }); break;
    case "list-item": withSection((it) => {
      if (li >= 0 && it.items) {
        if (value.trim() === "") it.items.splice(li, 1);
        else it.items[li] = value;
      }
      return it;
    }); break;
    case "h-name": newHeader = { ...header, name: value || header.name }; break;
    case "h-title": newHeader = { ...header, title: value }; break;
    case "h-contact": {
      const contact = header.contact.slice();
      if (contact[ci]) {
        if (value.trim() === "") contact.splice(ci, 1);
        else contact[ci] = { ...contact[ci], text: value };
      }
      newHeader = { ...header, contact };
      break;
    }
    default: break;
  }
  return { items: newItems, header: newHeader };
}

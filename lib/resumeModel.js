// Ported from resume_builder.html — the master/variant resolution model, section
// mutation helpers, and misc small helpers shared across the React components.

export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

export const FIXED_ROOT = ['engagement', 'certs', 'refs', 'skills'];
export const OVERRIDE_FIELDS = ['type', 'content', 'jobs', 'groups', 'items'];

export const COVER_TEMPLATE = {
  salutation: 'Dear Hiring Team,',
  body: [''],
  signoff: 'Sincerely,',
  signName: '',
};

export function coverIsEmpty(cover) {
  if (!cover) return true;
  const hasBody = (cover.body || []).some((p) => String(p).trim());
  return !hasBody && !(cover.salutation && String(cover.salutation).trim());
}

// Resolve a live-linked variant against the master: inherit everything, apply overrides.
export function resolveVariant(variant, master) {
  const mItems = deepClone(master.items || []);
  const byid = {};
  mItems.forEach((it) => { byid[it.id] = it; });
  const ov = variant.overrides || {};
  Object.keys(ov).forEach((id) => {
    const o = ov[id];
    if (byid[id]) {
      const it = byid[id];
      if ('label' in o) it.label = o.label;
      OVERRIDE_FIELDS.forEach((f) => { if (f in o) it[f] = deepClone(o[f]); });
    } else {
      const ni = deepClone(o);
      ni.id = id;
      if (!('label' in ni)) ni.label = id;
      mItems.push(ni);
      byid[id] = ni;
    }
  });
  const removedSet = {};
  (variant.removed || []).forEach((id) => { removedSet[id] = 1; });
  let result;
  if (variant.structure && variant.structure.length) {
    const seen = {};
    result = [];
    variant.structure.forEach((st) => {
      const it = byid[st.id];
      if (!it) return;
      it.parentId = 'parentId' in st ? st.parentId : it.parentId || null;
      result.push(it);
      seen[st.id] = true;
    });
    mItems.forEach((it) => { if (!seen[it.id] && !removedSet[it.id]) result.push(it); });
  } else {
    result = mItems.filter((it) => !removedSet[it.id]);
  }
  const vis = variant.visible || {};
  result.forEach((it) => { if (it.id in vis) it.visible = vis[it.id]; });
  const hdr = variant.header || master.header;
  return { items: result, header: deepClone(hdr), coverLetter: variant.coverLetter || null };
}

// Diff the current doc against the master to produce a compact live-linked snapshot.
export function buildLinkedSnapshot(items, header, cover, master) {
  const mById = {};
  (master.items || []).forEach((it) => { mById[it.id] = it; });
  const overrides = {}, visible = {}, structure = [];
  items.forEach((it) => {
    structure.push({ id: it.id, parentId: it.parentId || null });
    visible[it.id] = !!it.visible;
    const m = mById[it.id];
    if (!m) {
      const c = deepClone(it);
      delete c.visible; delete c.parentId; delete c.id;
      overrides[it.id] = c;
    } else {
      const o = {};
      if (it.label !== m.label) o.label = it.label;
      OVERRIDE_FIELDS.forEach((f) => {
        if (f in it && JSON.stringify(it[f]) !== JSON.stringify(m[f])) o[f] = deepClone(it[f]);
      });
      if (Object.keys(o).length) overrides[it.id] = o;
    }
  });
  const present = {};
  items.forEach((it) => { present[it.id] = 1; });
  const removed = (master.items || []).filter((m) => !present[m.id]).map((m) => m.id);
  const snap = {
    base: 'master', structure, visible, overrides, removed,
    header: deepClone({ name: header.name, title: header.title, contact: header.contact }),
  };
  if (cover && !coverIsEmpty(cover)) snap.coverLetter = deepClone(cover);
  return snap;
}

export function roots(items) { return items.filter((x) => !x.parentId); }
export function kids(items, pid) { return items.filter((x) => x.parentId === pid); }
export function byId(items, id) { return items.find((x) => x.id === id); }

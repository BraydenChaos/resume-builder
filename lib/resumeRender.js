// Ported from resume_builder.html's sectionBody/buildBlocks/renderResume. The
// pagination algorithm measures rendered block heights against a hidden DOM
// surface (a printed resume's page breaks can't be computed without knowing how
// tall a paragraph of Georgia serif actually renders), so this stays HTML-string
// based and DOM-measured rather than a purely declarative React tree — the
// component wiring it up (ResumeDocument) supplies the hidden measure element and
// calls these as pure functions of (items, header, margins).

export const FIXED_ROOT = ['engagement', 'certs', 'refs', 'skills'];

export function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Like esc(), but renders inline **bold** as <strong>.
export function fmt(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function roots(items) { return items.filter((x) => !x.parentId); }
export function kids(items, pid) { return items.filter((x) => x.parentId === pid); }
export function byId(items, id) { return items.find((x) => x.id === id); }

export function sectionBody(s) {
  var html = '';
  var sid = esc(s.id);
  if (s.type === 'summary') {
    html += '<div class="r-summary" data-ie="summary" data-sid="' + sid + '">' + fmt(s.content) + '</div>';
  } else if (s.type === 'jobs') {
    (s.jobs || []).forEach(function (j, ji) {
      html += '<div class="r-job"><div class="r-job-head"><span class="r-org" data-ie="job-org" data-sid="' + sid + '" data-ji="' + ji + '">' + fmt(j.org) + '</span>' +
        (j.dates ? '<span class="r-dates" data-ie="job-dates" data-sid="' + sid + '" data-ji="' + ji + '">' + esc(j.dates) + '</span>' : '') + '</div>' +
        '<div class="r-jobtitle" data-ie="job-title" data-sid="' + sid + '" data-ji="' + ji + '">' + esc(j.title) + '</div>' +
        '<ul class="r-bullets">' + (j.bullets || []).map(function (b, bi) { return '<li data-ie="job-bullet" data-sid="' + sid + '" data-ji="' + ji + '" data-bi="' + bi + '">' + fmt(b) + '</li>'; }).join('') + '</ul></div>';
    });
  } else if (s.type === 'skills') {
    html += '<div class="r-skills-grid">' + (s.groups || []).map(function (g, gi) {
      return '<div><div class="r-skill-label" data-ie="skill-label" data-sid="' + sid + '" data-gi="' + gi + '">' + esc(g.label) + '</div>' +
        '<div class="r-skill-items" data-ie="skill-items" data-sid="' + sid + '" data-gi="' + gi + '">' + esc(g.items) + '</div></div>';
    }).join('') + '</div>';
  } else if (s.type === 'list') {
    html += '<ul class="r-list">' + (s.items || []).map(function (it, li) { return '<li data-ie="list-item" data-sid="' + sid + '" data-li="' + li + '">' + fmt(it) + '</li>'; }).join('') + '</ul>';
  }
  return html;
}

// A "block" is the smallest unit paginated across pages. Each block carries:
// html, parentId (null = root), isParentHeader (the section title row of a parent
// that has children — never allowed to be the last item on a page, i.e. orphan
// prevention), isChild/isLastChild.
export function buildBlocks(items) {
  var blocks = [];
  roots(items).filter(function (r) { return r.visible; }).forEach(function (r) {
    var children = kids(items, r.id).filter(function (c) { return c.visible; });
    var hasChildren = children.length > 0;
    if (hasChildren) {
      blocks.push({
        id: r.id,
        isParentHeader: true,
        html: '<div class="r-section r-section-open" data-id="' + r.id + '"><div class="r-section-title" data-ie="label" data-sid="' + esc(r.id) + '">' + esc(r.label) + '</div>' + sectionBody(r),
      });
      children.forEach(function (c, ci) {
        var isLast = ci === children.length - 1;
        blocks.push({
          id: c.id,
          isChild: true,
          isLastChild: isLast,
          parentId: r.id,
          html: '<div class="r-child-section" data-id="' + c.id + '">' + sectionBody(c) + '</div>' + (isLast ? '</div>' : ''),
        });
      });
    } else {
      blocks.push({
        id: r.id,
        isParentHeader: false,
        html: '<div class="r-section" data-id="' + r.id + '"><div class="r-section-title" data-ie="label" data-sid="' + esc(r.id) + '">' + esc(r.label) + '</div>' + sectionBody(r) + '</div>',
      });
    }
  });
  return blocks;
}

export function buildHeaderHTML(header) {
  var contactSpans = (header.contact || []).map(function (c, ci) {
    var inner = '<span data-ie="h-contact" data-ci="' + ci + '">' + esc(c.text) + '</span>';
    if (c.url) return '<a href="' + esc(c.url) + '" style="color:inherit;text-decoration:none;">' + inner + '</a>';
    return inner;
  }).join('');
  return '<div class="r-header-wrap" id="r-header-click" style="cursor:pointer;" title="Click text to edit · click elsewhere for full header editor">' +
    '<div class="r-name" data-ie="h-name">' + esc(header.name) + '</div>' +
    '<div class="r-title" data-ie="h-title">' + esc(header.title) + '</div>' +
    '<div class="r-contact">' + contactSpans + '</div>' +
    '</div>' +
    '<hr class="r-hr">';
}

// US Letter page content height at our screen scale (760px wide)
export const PAGE_MARGINS = { top: 52, right: 58, bottom: 52, left: 58 };
export const PAGE_H = 984 - PAGE_MARGINS.top - PAGE_MARGINS.bottom;
// Overflow tolerance: lets a borderline entry stay on the page instead of bumping
// to the next one over a few px of estimation slack. Stays within the bottom margin.
export const PAGE_TOL = 26;

export function pageStyleFromMargins(p) {
  return {
    padding: p.top + 'px ' + p.right + 'px ' + p.bottom + 'px ' + p.left + 'px',
    '--mg-top': p.top + 'px', '--mg-right': p.right + 'px', '--mg-bottom': p.bottom + 'px', '--mg-left': p.left + 'px',
  };
}

// Paginate blocks (already measured against a hidden DOM surface) into pages of
// { html } chunks. blockHeights[i] must correspond 1:1 with blocks[i]. headerH is
// the measured header block height. Returns an array of pages, each an array of
// { html } chunks — ready to be joined and rendered inside .resume-page wrappers.
export function paginate(items, blocks, blockHeights, headerH, pageH, pageTol) {
  var pages = [];
  var curChunks = [];
  var curH = headerH;
  var openSectionOnPage = false; // true = current page has an unclosed r-section

  function newPage() {
    if (openSectionOnPage && curChunks.length) {
      curChunks[curChunks.length - 1].html += '</div>';
      openSectionOnPage = false;
    }
    pages.push(curChunks);
    curChunks = [];
    curH = 0;
  }
  function push(html, h) {
    curChunks.push({ html: html });
    curH += h;
  }

  blocks.forEach(function (b, bi) {
    var h = (blockHeights[bi] || 0) + 16; // +16 buffer

    if (b.isParentHeader) {
      // Orphan prevention: keep the header from being stranded alone at the bottom,
      // but only require the header plus a small slice of the first child to fit,
      // not the entire (possibly tall) child.
      var nextFull = bi + 1 < blockHeights.length ? (blockHeights[bi + 1] || 0) + 16 : 0;
      var nextH = Math.min(nextFull, 48);
      if (curH + h + nextH > pageH + pageTol && curChunks.length > 0) newPage();
      push(b.html, h);
      openSectionOnPage = true;
    } else if (b.isChild) {
      if (curH + h > pageH + pageTol && curChunks.length > 0) {
        if (openSectionOnPage && curChunks.length) {
          curChunks[curChunks.length - 1].html += '</div>';
          openSectionOnPage = false;
        }
        newPage();
        var parent = byId(items, b.parentId);
        if (parent) {
          var contHTML = '<div class="r-section r-section-open" data-id="' + parent.id + '">' +
            '<div class="r-section-title">' + esc(parent.label) + ' <span style="font-weight:400;font-style:italic;text-transform:none;font-size:9px;letter-spacing:0;color:#999;">(continued)</span></div>';
          push(contHTML, 28);
          openSectionOnPage = true;
        }
      }
      push(b.html, h);
      if (b.isLastChild) openSectionOnPage = false;
    } else {
      if (curH + h > pageH + pageTol && curChunks.length > 0) newPage();
      push(b.html, h);
    }
  });

  if (openSectionOnPage && curChunks.length) curChunks[curChunks.length - 1].html += '</div>';
  if (curChunks.length) pages.push(curChunks);
  return pages;
}

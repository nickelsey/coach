/* Router, page registry and shared helpers. Each page module calls
   Coach.register({ id, title, group, eyebrow, lede, wide, render, mount }).
   Routes are plain hashes: #architecture, or #code-<file-slug> for a sub-view. */
window.Coach = (function () {
  "use strict";
  const pages = [];
  const GROUPS = [["walk", "Walkthrough"], ["plan", "Planning"]];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const h = {
    esc,
    chip: (kind, text) => `<span class="chip ${kind}">${esc(text)}</span>`,
    panel: (inner, { edge = "", title = "", color = "var(--cyan)", cls = "" } = {}) =>
      `<div class="edge ${edge}"><div class="panel ${cls}">${title ? `<div class="ptitle" style="color:${color}">${esc(title)}</div>` : ""}${inner}</div></div>`,
    block: (title, inner) => `<div class="block"><h2>${esc(title)}</h2>${inner}</div>`,
    list: (items, ordered = false) => `<${ordered ? "ol" : "ul"} class="bullets">${items.map((i) => `<li>${i}</li>`).join("")}</${ordered ? "ol" : "ul"}>`,
    cmd: (text) => `<div class="cmd"><pre>${esc(text)}</pre><button class="copy" type="button" data-copy>COPY</button></div>`,
    kv: (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`,
    table: (head, rows) => `<div class="tablebox"><table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
    fileLink: (path) => `<a href="#code-${slug(path)}">${esc(path)}</a>`,
    files: (paths) => `<div class="files">${paths.map((p) => h.fileLink(p)).join("")}</div>`,
  };

  function slug(path) { return path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  function register(p) {
    pages.push(p);
    pages.sort((a, b) => a.order - b.order);
  }

  function route() {
    const hash = decodeURIComponent(location.hash.slice(1));
    for (const p of pages) {
      if (hash === p.id) return { page: p, sub: "" };
      if (hash.startsWith(p.id + "-")) return { page: p, sub: hash.slice(p.id.length + 1) };
    }
    return { page: pages.find((p) => p.id === "overview") || pages[0], sub: "" };
  }

  let current = null;
  function renderNav(active) {
    let n = 0;
    $("#nav").innerHTML = GROUPS.map(([gid, label]) => {
      const items = pages.filter((p) => p.group === gid).map((p) => {
        n++;
        return `<a href="#${p.id}"${p === active ? ' aria-current="page"' : ""}><span class="n">${String(n).padStart(2, "0")}</span>${esc(p.title)}</a>`;
      }).join("");
      return `<div class="navgroup"><h2>${label}</h2>${items}</div>`;
    }).join("");
    const a = $('#nav a[aria-current="page"]');
    if (a && window.matchMedia("(max-width: 900px)").matches) a.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function show() {
    const { page, sub } = route();
    const samePage = current === page;
    current = page;
    renderNav(page);
    const main = $("#page");
    main.classList.toggle("wide", !!page.wide);
    if (!samePage || !page.handlesSub) {
      const idx = pages.indexOf(page);
      const prev = pages[idx - 1], next = pages[idx + 1];
      main.innerHTML = `<div class="page-inner">
        <header class="phead">
          <div class="eyebrow">${String(idx + 1).padStart(2, "0")} · ${esc(page.eyebrow || "")}</div>
          <h1>${esc(page.title)}</h1>
          ${page.lede ? `<p class="lede">${page.lede}</p>` : ""}
        </header>
        ${page.render()}
        <nav class="pager" aria-label="Previous and next page">
          ${prev ? `<a href="#${prev.id}"><span>Previous</span>${esc(prev.title)}</a>` : ""}
          ${next ? `<a class="next" href="#${next.id}"><span>Next</span>${esc(next.title)}</a>` : ""}
        </nav>
      </div>`;
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
    if (page.mount) page.mount(main, sub, samePage);
  }

  // Global handlers shared by all pages.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const pre = b.parentElement.querySelector("pre");
    const done = (ok) => { b.textContent = ok ? "COPIED" : "SELECTED"; setTimeout(() => (b.textContent = "COPY"), 1500); };
    const select = () => { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done(false); };
    try { navigator.clipboard.writeText(pre.textContent).then(() => done(true), select); } catch (_) { select(); }
  });

  function start() {
    window.addEventListener("hashchange", show);
    show();
  }

  return { register, start, h, $, $$, slug, pages, get current() { return current; } };
})();

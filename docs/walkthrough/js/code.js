/* Code page: browses data/code.json, generated from the sources by gen_code_docs.py.
   Routes: #code (first file) or #code-<path-slug>. */
(function () {
  "use strict";
  const { h, $, $$, slug } = Coach;
  const { esc } = h;
  const HLJS_LANG = { go: "go", swift: "swift", sql: "sql", yaml: "yaml", json: "json", bash: "bash", markdown: "markdown", dockerfile: "dockerfile" };
  const LINE = 20; // must match --code-line in style.css
  let data = null;
  let loading = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = fetch("data/code.json").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }).then((d) => {
        d.bySlug = {};
        d.files.forEach((f, i) => { f.slug = slug(f.path); f.index = i; d.bySlug[f.slug] = f; });
        data = d;
        return d;
      });
    }
    return loading;
  }

  function highlight(f) {
    const lang = HLJS_LANG[f.lang];
    if (window.hljs && lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(f.source, { language: lang, ignoreIllegals: true }).value; } catch (_) { /* fall through */ }
    }
    return esc(f.source);
  }

  Coach.register({
    id: "code", order: 5, group: "walk", title: "Code", eyebrow: "Walkthrough", wide: true, handlesSub: true,
    lede: "Every source file in reading order, with my notes, the file's own doc comment, its documented types and functions, and the highlighted source. Generated from the repo by <code>docs/walkthrough/gen_code_docs.py</code>, so it matches the code at the time it was last run.",
    render() {
      return `<div class="codegrid">
        <aside class="filenav" aria-label="Files">
          <label class="sr" for="code-search">Search files and symbols</label>
          <input id="code-search" type="search" placeholder="Search files and symbols" autocomplete="off">
          <div id="filelist"><p class="muted">Loading…</p></div>
        </aside>
        <div class="stack" id="fileview" style="gap:16px"></div>
      </div>`;
    },
    mount(main, sub, samePage) {
      load().then((d) => {
        if (!samePage || !$("#filelist", main).dataset.ready) setup(main, d);
        const f = d.bySlug[sub] || d.files[0];
        showFile(main, d, f);
      }).catch((err) => {
        $("#fileview", main).innerHTML = h.panel(`<p>Couldn't load <code>data/code.json</code> (${esc(err.message)}). Run <code>python3 docs/walkthrough/gen_code_docs.py</code> and publish again.</p>`, { edge: "amber" });
      });
    },
  });

  function setup(main, d) {
    const list = $("#filelist", main);
    list.dataset.ready = "1";
    const drawList = (q) => {
      q = (q || "").trim().toLowerCase();
      let n = 0;
      list.innerHTML = d.groups.map((g) => {
        const rows = g.files.map((p) => d.files.find((f) => f.path === p)).filter(Boolean).map((f) => {
          n++;
          const symHits = q ? f.symbols.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 4) : [];
          if (q && !f.path.toLowerCase().includes(q) && !symHits.length) return "";
          const name = f.path.split("/").pop();
          return `<button type="button" data-file="${f.slug}" title="${esc(f.path)}"><span class="n">${n}</span><span class="fn">${esc(name)}${symHits.map((s) => `<span class="hit">${esc(s.kind)} ${esc(s.name)}</span>`).join("")}</span></button>`;
        }).join("");
        return rows ? `<div class="fgroup"><h3>${esc(g.title)}</h3>${rows}</div>` : "";
      }).join("") || `<p class="muted">No files or symbols match.</p>`;
      const cur = Coach.current && location.hash.slice(1).replace(/^code-?/, "");
      $$("[data-file]", list).forEach((b) => b.setAttribute("aria-current", String(b.dataset.file === (cur || d.files[0].slug))));
    };
    drawList("");
    $("#code-search", main).addEventListener("input", (e) => drawList(e.target.value));
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-file]");
      if (b) location.hash = "code-" + b.dataset.file;
    });
  }

  function showFile(main, d, f) {
    $$("#filelist [data-file]", main).forEach((b) => b.setAttribute("aria-current", String(b.dataset.file === f.slug)));
    const g = d.groups.find((x) => x.id === f.group);
    const prev = d.files[f.index - 1], next = d.files[f.index + 1];
    const syms = f.symbols;
    const documented = syms.filter((s) => s.doc).length;
    $("#fileview", main).innerHTML = `
      <div class="filehead">
        <div class="eyebrow">${esc(g ? g.title : "")}</div>
        <h2>${esc(f.path)}</h2>
        <div class="chips">${h.chip("vio", f.lang)}${h.chip("plan", f.lines + " lines")}${syms.length ? h.chip("info", `${syms.length} symbols · ${documented} documented`) : ""}</div>
      </div>
      ${g ? `<p class="muted">${esc(g.blurb)}</p>` : ""}
      <div class="callout mag"><p>${esc(f.note)}</p></div>
      ${f.summary ? h.panel(`<p class="docbox">${esc(f.summary)}</p>`, { title: "File doc comment", color: "var(--mint)" }) : ""}
      ${syms.length ? h.panel(`<div class="outline" id="outline">${syms.map((s, i) => `
          <button type="button" class="sym" data-sym="${i}" style="padding-left:${8 + Math.min(s.depth, 3) * 14}px">
            <span class="k">${esc(s.kind)}</span><span class="nm">${esc(s.name)} <span class="ln">L${s.line}</span></span>
            ${s.doc ? `<span class="d">${esc(s.doc)}</span>` : ""}
          </button>`).join("")}</div>`, { title: "Outline · select to jump to the source", color: "var(--magenta)" }) : ""}
      <div class="srcwrap" id="srcwrap" tabindex="0" aria-label="Source of ${esc(f.path)}">
        <div class="src" style="position:relative">
          <div class="gut" aria-hidden="true">${Array.from({ length: Math.max(f.lines, 1) }, (_, i) => i + 1).join("\n")}</div>
          <code class="hljs">${highlight(f)}</code>
          <div class="lineflash" id="lineflash" hidden></div>
        </div>
      </div>
      <div class="pager" style="border-top:0;padding-top:0">
        ${prev ? `<a href="#code-${prev.slug}"><span>Previous file</span>${esc(prev.path)}</a>` : ""}
        ${next ? `<a class="next" href="#code-${next.slug}"><span>Next file</span>${esc(next.path)}</a>` : ""}
      </div>`;

    const wrap = $("#srcwrap", main), flash = $("#lineflash", main);
    $$("[data-sym]", main).forEach((b) => b.addEventListener("click", () => {
      const s = syms[Number(b.dataset.sym)];
      $$(".sym.on", main).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      flash.hidden = false;
      flash.style.top = `${10 + (s.line - 1) * LINE}px`;
      wrap.scrollTo({ top: Math.max(0, (s.line - 4) * LINE), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }));
  }
})();

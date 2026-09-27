// Public-site JS: offline search only. No tracking, no framework.
(function () {
  async function index() {
    try { const r = await fetch('/search-index.json'); return r.ok ? r.json() : []; }
    catch { return []; }
  }
  function run(docs, q) {
    const needle = q.toLowerCase();
    return docs.filter((d) => (d.title + ' ' + d.excerpt + ' ' + d.content).toLowerCase().includes(needle)).slice(0, 20);
  }
  document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('q');
    const out = document.getElementById('results');
    if (!box || !out) return;
    const params = new URLSearchParams(location.search);
    const docs = await index();
    const render = () => {
      const q = box.value.trim();
      if (!q) { out.innerHTML = ''; return; }
      const hits = run(docs, q);
      out.innerHTML = hits.length
        ? '<ul>' + hits.map((h) => '<li><a href="/articles/' + h.slug + '/">' + h.title.replace(/</g, '&lt;') + '</a><p>' + (h.excerpt || '').replace(/</g, '&lt;') + '</p></li>').join('') + '</ul>'
        : '<p>No results.</p>';
    };
    box.addEventListener('input', render);
    if (params.get('q')) { box.value = params.get('q'); render(); }
  });
})();

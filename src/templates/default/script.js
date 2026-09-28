// Public-site JS: offline search, share buttons, TOC scrollspy, reader font size.
// No tracking, no framework. Everything degrades gracefully without JS.
(function () {
  async function index() {
    try { const r = await fetch('/search-index.json'); return r.ok ? r.json() : []; }
    catch { return []; }
  }
  function run(docs, q) {
    const needle = q.toLowerCase();
    return docs.filter((d) => (d.title + ' ' + d.excerpt + ' ' + d.content).toLowerCase().includes(needle)).slice(0, 20);
  }
  function share() {
    document.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-share]') : null;
      if (!btn) return;
      const url = btn.getAttribute('data-url') || location.href;
      const title = btn.getAttribute('data-title') || document.title;
      try {
        if (btn.getAttribute('data-share') === 'native' && navigator.share) {
          await navigator.share({ title: title, text: title, url: url });
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = btn.getAttribute('data-share') === 'native' ? 'Share…' : 'Copy link'; }, 1500);
        }
      } catch (err) { /* user cancelled or clipboard blocked — links still work */ }
    });
  }
  function scrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var current = null;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          if (current) current.classList.remove('active');
          current = map[en.target.id] || null;
          if (current) current.classList.add('active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }
  function readingProgress() {
    var post = document.querySelector('article.post');
    if (!post) return;
    var bar = document.createElement('div');
    bar.className = 'readprogress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      ticking = false;
      var top = post.offsetTop;
      var total = post.offsetHeight - window.innerHeight;
      var done = total > 0 ? Math.max(0, Math.min(1, (window.scrollY - top) / total)) : 0;
      bar.style.transform = 'scaleX(' + done + ')';
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
  function copyCode() {
    document.querySelectorAll('.prose pre').forEach(function (pre) {
      var code = pre.querySelector('code');
      if (!code) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copycode';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code block');
      btn.addEventListener('click', async function () {
        try {
          await navigator.clipboard.writeText(code.innerText);
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
        } catch (err) { btn.textContent = 'Select manually'; }
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }
  function fontSize() {
    var prose = document.querySelector('.prose');
    if (!prose) return;
    var bar = document.createElement('div');
    bar.className = 'fontctl';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Text size');
    bar.innerHTML = '<button type="button" data-fs="down" aria-label="Smaller text">A−</button><span>Text size</span><button type="button" data-fs="up" aria-label="Larger text">A+</button>';
    prose.parentNode.insertBefore(bar, prose);
    var px = 0;
    try { px = parseInt(localStorage.getItem('aw.fs') || '0', 10) || 0; } catch (e) { px = 0; }
    function apply() { prose.style.fontSize = px ? (100 + px * 10) + '%' : ''; }
    apply();
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      px = Math.max(-2, Math.min(3, px + (b.getAttribute('data-fs') === 'up' ? 1 : -1)));
      try { localStorage.setItem('aw.fs', String(px)); } catch (err) { /* private mode */ }
      apply();
    });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    share();
    scrollspy();
    fontSize();
    readingProgress();
    copyCode();
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

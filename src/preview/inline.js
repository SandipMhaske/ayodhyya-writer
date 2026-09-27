// Preview-site helpers — pure functions for turning the in-memory generated site
// (Map<path, content>) into self-contained pages that work from a blob: URL in a new
// tab, with no server. Asset inlining + a click interceptor (path resolution happens
// at click time via a session map, so circular links between pages just work).
// No DOM or URL.createObjectURL here (browser-only) — tested.
export const PREVIEW_MAP_KEY = 'aw.previewMap';

export function inlineAssets(files, html) {
  // Inline fingerprinted CSS/JS so the page renders with zero requests.
  let s = String(html ?? '');
  s = s.replace(/<link\s+rel="stylesheet"\s+href="(\/[^"]+)"\s*\/?>/gi, (tag, href) => {
    const key = href.replace(/^\//, '');
    return files.has(key) ? `<style>${files.get(key)}</style>` : tag;
  });
  s = s.replace(/<script\s+src="(\/[^"]+)"(\s+defer)?\s*><\/script>/gi, (tag, src) => {
    const key = src.replace(/^\//, '');
    return files.has(key) ? `<script>${files.get(key)}</script>` : tag;
  });
  return s;
}

export function blobTypeFor(filePath) {
  const ext = String(filePath).split('.').pop().toLowerCase();
  return ({ html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', xml: 'application/xml', txt: 'text/plain', webmanifest: 'application/manifest+json', svg: 'image/svg+xml' })[ext] || 'text/plain';
}

export function previewInterceptorScript() {
  // Runs inside each blob preview page: reroutes absolute-link clicks and GET forms
  // through the session blob map (written by the app when the preview is built).
  // External links, fragments, and mailto: behave normally.
  return `<script>(function(){var KEY=${JSON.stringify(PREVIEW_MAP_KEY)};`
    + `function map(){try{return JSON.parse(sessionStorage.getItem(KEY)||'{}')}catch(e){return{}}}`
    + `function go(href){if(!href||href.charAt(0)!=='/')return false;`
    + `var q=href.split('#')[0].split('?')[0],suffix=href.slice(q.length);`
    + `var clean=q.replace(/\\/+$/,'')||'/';`
    + `var cands=clean==='/'?['index.html']:[clean.slice(1)+'/index.html',clean.slice(1)+'.html',clean.slice(1)];`
    + `var m=map();for(var i=0;i<cands.length;i++){if(m[cands[i]]){location.href=m[cands[i]]+suffix;return true}}`
    + `if(m['404.html']){location.href=m['404.html']}return true}`
    + `document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a'):null;`
    + `if(!a)return;var href=a.getAttribute('href');if(!href||href.charAt(0)!=='/'||a.target==='_blank')return;`
    + `e.preventDefault();go(href)});`
    + `document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.getAttribute)return;`
    + `var action=f.getAttribute('action')||'/';if(action.charAt(0)!=='/')return;e.preventDefault();`
    + `try{var qs=new URLSearchParams(new FormData(f)).toString()}catch(err){var qs=''}`
    + `go(action+(qs?'?'+qs:''))})})();</script>`;
}

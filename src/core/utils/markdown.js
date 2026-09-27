// Minimal Markdown → HTML (paragraphs, headings, bold/italic/code/link/lists/quotes/rules).
// No dependency; used by editor preview + static builder. Article HTML is still sanitized after.
import { escapeHtml } from './utils.js';

export function markdownToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inList = null; // 'ul' | 'ol'
  let inQuote = false;
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

  const inline = (t) => {
    let s = escapeHtml(t);
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, '<a href="$2" rel="noopener">$1</a>');
    return s;
  };

  for (const raw of lines) {
    const line = raw;
    if (/^\s*$/.test(line)) { closeList(); closeQuote(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList(); closeQuote();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      closeList(); closeQuote(); out.push('<hr>');
    } else if ((m = line.match(/^&gt;|^>/ ))) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${inline(line.replace(/^>\s?/, ''))}</p>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      closeQuote();
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      closeQuote();
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (/^```/.test(line)) {
      closeList(); closeQuote();
      out.push('<pre><code>code block</code></pre>');
    } else if (/^<[^>]+>$/.test(line.trim())) {
      closeList(); closeQuote();
      out.push(line.trim()); // raw html block — sanitizer decides later
    } else {
      closeList(); closeQuote();
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  closeList(); closeQuote();
  return out.join('\n');
}

export function htmlToMarkdown(html) {
  // Lossy but sufficient for editor round-trip of simple content.
  let s = String(html ?? '');
  s = s.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, l, t) => `\n${'#'.repeat(Number(l))} ${t}\n`);
  s = s.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  s = s.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  s = s.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  s = s.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h\d|ul|ol|blockquote|pre)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

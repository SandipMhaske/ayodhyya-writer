// Comment spam scoring (Akismet-style, fully local — no external API, no data leaves).
// Pure heuristics: links, shouting, money/pharma lures, gibberish, length anomalies.
// Returns { score 0–100, reasons[], verdict: 'ham' | 'review' | 'spam' }.
// Thresholds: >= 80 auto-spam, 40–79 hold for review, below that publishable.
const LURES = ['viagra', 'cialis', 'crypto', 'forex', 'casino', 'loan', 'bitcoin', 'earn money', 'work from home', 'weight loss', 'free iphone', 'click here'];

export function scoreSpam({ author = '', content = '', email = '' } = {}) {
  const reasons = [];
  let score = 0;
  const text = String(content || '');
  const plain = text.replace(/<[^>]*>/g, ' ');
  const words = plain.trim().split(/\s+/).filter(Boolean);

  const links = (text.match(/https?:\/\//gi) || []).length + (text.match(/www\./gi) || []).length;
  if (links >= 3) { score += 40; reasons.push(`${links} links`); }
  else if (links >= 1 && words.length < 25) { score += 20; reasons.push('link with almost no text'); }

  const letters = plain.replace(/[^a-zA-Z]/g, '');
  const upper = plain.replace(/[^A-Z]/g, '').length;
  if (letters.length > 20 && upper / letters.length > 0.6) { score += 25; reasons.push('mostly ALL CAPS'); }

  const low = plain.toLowerCase();
  const lures = LURES.filter((w) => low.includes(w));
  if (lures.length) { score += 25 * lures.length; reasons.push(`lure words: ${lures.slice(0, 3).join(', ')}`); }

  if (words.length > 0 && words.length < 5) { score += 10; reasons.push('too short to be real'); }
  if (words.length > 500) { score += 10; reasons.push('suspiciously long'); }
  if (/<a\s+href/i.test(text)) { score += 15; reasons.push('raw HTML links'); }
  if (/\d{7,}/.test(plain)) { score += 10; reasons.push('number salad'); }
  if (String(author).length > 50 || /https?:\/\//i.test(String(author))) { score += 20; reasons.push('author looks like a URL'); }

  score = Math.min(100, score);
  return { score, reasons, verdict: score >= 80 ? 'spam' : score >= 40 ? 'review' : 'ham' };
}

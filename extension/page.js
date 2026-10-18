// Sekmede çalışır (chrome.scripting.executeScript ile enjekte edilir). Dışarıdaki hiçbir
// şeye başvurmaz; tüm yardımcılar içeride tanımlıdır.

/**
 * Sayfanın metnini ve sayfaya gömülü yapılandırılmış veriyi (JSON-LD) okur.
 * İlan sitelerinin çoğu son başvuru, etkinlik tarihi, kurum ve konumu bu veride
 * makine için yazar; tahmin edilmeden buradan alınır.
 */
export function readPage() {
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const pad = (n) => String(n).padStart(2, '0');

  /** "2026-10-24" → "24 Ekim 2026"; saatliyse yerel saatle "24 Ekim 2026 17:00". */
  function trDate(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const v = value.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (dateOnly) return `${Number(dateOnly[3])} ${MONTHS[Number(dateOnly[2]) - 1]} ${dateOnly[1]}`;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${time === '00:00' ? '' : ` ${time}`}`;
  }

  const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null);
  const nameOf = (v) => (Array.isArray(v) ? nameOf(v[0]) : typeof v === 'string' ? text(v) : v && typeof v === 'object' ? text(v.name) : null);
  function placeOf(loc) {
    if (Array.isArray(loc)) return placeOf(loc[0]);
    if (!loc || typeof loc !== 'object') return text(loc);
    if (loc['@type'] === 'VirtualLocation') return 'Çevrim içi';
    const a = loc.address;
    const addr = typeof a === 'string' ? a : a && [a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter((x) => typeof x === 'string').join(', ');
    return [text(loc.name), text(addr)].filter(Boolean).join(', ') || null;
  }
  const types = (n) => [].concat(n?.['@type'] ?? []).map(String);

  /** JSON-LD içindeki tüm düğümler (@graph ve diziler açılır). */
  function nodes(root, out = []) {
    if (Array.isArray(root)) root.forEach((r) => nodes(r, out));
    else if (root && typeof root === 'object') {
      out.push(root);
      if (root['@graph']) nodes(root['@graph'], out);
    }
    return out;
  }

  const all = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      nodes(JSON.parse(s.textContent || ''), all);
    } catch {
      // Bozuk JSON-LD atlanır.
    }
  }

  const lines = [];
  const add = (label, value) => value && lines.push(`${label}: ${value}`);
  for (const n of all) {
    const t = types(n);
    if (t.includes('JobPosting')) {
      add('Tür', 'İş ilanı');
      add('Başlık', text(n.title));
      add('Kurum', nameOf(n.hiringOrganization));
      add('Son başvuru', trDate(n.validThrough));
      add('Konum', placeOf(n.jobLocation) || (n.jobLocationType === 'TELECOMMUTE' ? 'Uzaktan' : null));
      add('Çalışma şekli', [].concat(n.employmentType ?? []).join(', ') || null);
      add('İlanın yayın tarihi (son tarih değildir)', trDate(n.datePosted));
    } else if (t.some((x) => /Event$/.test(x))) {
      add('Tür', 'Etkinlik');
      add('Başlık', text(n.name));
      add('Düzenleyen', nameOf(n.organizer));
      add('Etkinlik başlangıcı', trDate(n.startDate));
      add('Etkinlik bitişi', trDate(n.endDate));
      add('Konum', placeOf(n.location));
      const offer = [].concat(n.offers ?? [])[0];
      add('Kayıt son tarihi', trDate(offer?.validThrough));
    } else if (t.includes('Course') || t.includes('EducationalOccupationalProgram') || t.includes('Scholarship')) {
      add('Tür', 'Program / burs');
      add('Başlık', text(n.name));
      add('Kurum', nameOf(n.provider));
      add('Son başvuru', trDate(n.applicationDeadline));
      add('Başlangıç', trDate(n.startDate));
    }
  }

  const root = document.querySelector('article, main, [role="main"]') || document.body;
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
  const description = meta('og:description') || meta('description');
  return {
    url: location.href,
    title: meta('og:title') || document.title,
    text: [description, root ? root.innerText : ''].filter(Boolean).join('\n\n').slice(0, 150000),
    selection: String(window.getSelection?.() || '').slice(0, 20000),
    structured: [...new Set(lines)].join('\n').slice(0, 5000),
  };
}

/**
 * Kaydedilmiş sayfada son tarih cümlesini vurgular ve köşeye küçük bir etiket koyar.
 * Sekmede çalışır; dışarıya başvurmaz.
 */
export function highlightEvidence(evidence, label) {
  if (document.getElementById('rafta-badge')) return false;
  const norm = (s) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const target = norm(evidence || '');
  let mark = null;
  if (target.length >= 4) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    // Önce tek metin düğümünde ara; bulunamazsa cümleyi içeren en küçük öğeyi işaretle.
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const raw = n.nodeValue || '';
      const idx = norm(raw).indexOf(target);
      if (idx === -1) continue;
      // Boşluk farkları olabilir; kaba konum yeterli: düğümün tamamını işaretle.
      mark = document.createElement('mark');
      mark.style.cssText = 'background:rgba(242,107,29,.22);color:inherit;border-bottom:2px solid #F26B1D;border-radius:3px;padding:0 2px';
      n.parentNode.replaceChild(mark, n);
      mark.appendChild(n);
      break;
    }
    if (!mark) {
      const candidates = [...document.querySelectorAll('p, li, span, div, td, dd, h1, h2, h3, h4')].filter((el) => norm(el.innerText || '').includes(target));
      const smallest = candidates.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
      if (smallest) {
        smallest.style.outline = '2px solid #F26B1D';
        smallest.style.outlineOffset = '2px';
        smallest.style.borderRadius = '4px';
        mark = smallest;
      }
    }
  }
  const badge = document.createElement('button');
  badge.id = 'rafta-badge';
  badge.type = 'button';
  badge.textContent = label;
  badge.style.cssText =
    'position:fixed;top:14px;right:14px;z-index:2147483647;font:600 13px/1.3 system-ui,sans-serif;background:#5B4FE9;color:#fff;border:0;border-radius:10px;padding:8px 12px;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer';
  badge.title = mark ? 'Son tarih cümlesine git' : 'Rafta';
  badge.onclick = () => {
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else badge.remove();
  };
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 15000);
  return Boolean(mark);
}

import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';

/** PDF'in metin katmanını çıkarır. Taranmış (görüntü) PDF'lerde boş döner. */
export async function pdfText(data: Buffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/[ \t]+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** Bu kadar metin varsa PDF'i görsel olarak değil, metin olarak gönderiyoruz. */
export const PDF_MIN_TEXT = 200;

/** Taranmış PDF'te modele en fazla bu kadar sayfa görüntüsü gönderilir. */
export const PDF_MAX_PAGES = 2;

/**
 * Metni olmayan (taranmış) PDF'in ilk sayfalarını PNG'ye çevirir; görsel destekli
 * model bunları ekran görüntüsü gibi okur. Çeviremezse boş liste döner.
 */
export async function pdfPageImages(data: Buffer, maxPages = PDF_MAX_PAGES): Promise<Buffer[]> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const pages: Buffer[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      const png = await renderPageAsImage(pdf, n, { canvasImport: () => import('@napi-rs/canvas'), width: 1400 });
      pages.push(Buffer.from(png));
    }
    return pages;
  } catch {
    return [];
  }
}

// Rafta simgelerini üretir: mor zemin, iki raf ve üst rafta safran bir kutu.
// Kullanım: npx tsx scripts/make-icons.ts
import { writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';

const INK = '#5B4FE9';
const SAFFRON = '#F26B1D';
const SHELF = '#FFFFFF';

/** `maskable`: Android uyarlanabilir simgeleri için kenarlarda güvenli boşluk bırakır. */
function icon(size: number, { maskable = false } = {}): Buffer {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = INK;
  if (maskable) {
    g.fillRect(0, 0, size, size);
  } else {
    g.beginPath();
    g.roundRect(0, 0, size, size, size * 0.24);
    g.fill();
  }
  // Maskeli simgede içerik ortadaki %70'lik alana sığmalı.
  const s = maskable ? size * 0.7 : size;
  const o = maskable ? (size - s) / 2 : 0;
  const shelfW = s * 0.62;
  const shelfH = Math.max(1.5, s * 0.07);
  const x = o + (s - shelfW) / 2;
  const radius = shelfH / 2;
  const bar = (y: number) => {
    g.fillStyle = SHELF;
    g.beginPath();
    g.roundRect(x, y, shelfW, shelfH, radius);
    g.fill();
  };
  const upper = o + s * 0.47;
  const lower = o + s * 0.72;
  bar(upper);
  bar(lower);
  // Üst rafta duran kutu.
  const box = s * 0.24;
  g.fillStyle = SAFFRON;
  g.beginPath();
  g.roundRect(x + shelfW * 0.12, upper - box - s * 0.015, box, box, Math.max(1, s * 0.035));
  g.fill();
  return c.toBuffer('image/png');
}

for (const size of [16, 32, 48, 128]) writeFileSync(`extension/icons/icon${size}.png`, icon(size));
writeFileSync('web/icon.png', icon(192));
writeFileSync('web/icon-512.png', icon(512));
writeFileSync('web/icon-maskable.png', icon(512, { maskable: true }));
writeFileSync('web/favicon.png', icon(32));
writeFileSync('docs/rafta-logo.png', icon(256));
console.log('simgeler yazıldı');

// Uzantı ve panel simgelerini üretir: yuvarlak köşeli zemin üzerinde yer imi.
// Kullanım: npx tsx scripts/make-icons.ts
import { writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';

const BG = '#0F766E';
const FG = '#FFFFFF';

function icon(size: number): Buffer {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  const r = size * 0.22;
  g.fillStyle = BG;
  g.beginPath();
  g.roundRect(0, 0, size, size, r);
  g.fill();
  // Yer imi: üstte düz, altta V kesikli.
  const w = size * 0.42;
  const h = size * 0.56;
  const x = (size - w) / 2;
  const y = size * 0.2;
  g.fillStyle = FG;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h);
  g.lineTo(x + w / 2, y + h - w * 0.38);
  g.lineTo(x, y + h);
  g.closePath();
  g.fill();
  return c.toBuffer('image/png');
}

for (const size of [16, 32, 48, 128]) writeFileSync(`extension/icons/icon${size}.png`, icon(size));
writeFileSync('web/icon.png', icon(192));
writeFileSync('web/favicon.png', icon(32));
console.log('simgeler yazıldı');

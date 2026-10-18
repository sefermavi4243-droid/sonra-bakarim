import 'dotenv/config';

/**
 * Bağlantı kodunu Telegram'a gitmeden verir; tarayıcı uzantısını ya da paneli bu
 * bilgisayarda bağlamak için. Bot açık olmalı. Kullanım: npm run bagla
 */
const adminPort = Number(process.env.ADMIN_PORT?.trim() || 3001);
try {
  const res = await fetch(`http://127.0.0.1:${adminPort}/bagla`, { method: 'POST', signal: AbortSignal.timeout(5_000) });
  const text = await res.text();
  if (!res.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(`Bağlantı kodun: ${text.slice(0, 3)} ${text.slice(3)} (10 dakika geçerli, tek kullanımlık)`);
} catch {
  console.error('Bot çalışmıyor gibi görünüyor. Önce botu başlat (npm start).');
  process.exit(1);
}

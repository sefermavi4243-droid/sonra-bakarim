import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

/** Medya dosyaları özel bir alanda tutulur; herkese açık link verilmez (SPEC bölüm 13). */
export interface MediaStorage {
  put(userId: string, data: Buffer, mimeType: string): Promise<string>;
  remove(paths: string[]): Promise<void>;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
};

export function createSupabaseStorage(url: string, serviceKey: string, bucket: string): MediaStorage {
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  let ensured = false;

  async function ensureBucket() {
    if (ensured) return;
    const { data } = await client.storage.getBucket(bucket);
    if (!data) {
      const { error } = await client.storage.createBucket(bucket, { public: false });
      if (error && !/exists/i.test(error.message)) throw error;
    }
    ensured = true;
  }

  return {
    async put(userId, data, mimeType) {
      await ensureBucket();
      const base = mimeType.split(';')[0]!.trim();
      const path = `${userId}/${randomUUID()}.${EXT[base] ?? 'bin'}`;
      const { error } = await client.storage.from(bucket).upload(path, data, { contentType: base, upsert: false });
      if (error) throw error;
      return path;
    },
    async remove(paths) {
      if (paths.length === 0) return;
      await ensureBucket();
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) throw error;
    },
  };
}

/** Supabase yokken medya yerel klasöre yazılır (yalnızca bu makineden erişilir). */
export function createLocalStorage(dir: string): MediaStorage {
  const root = resolve(dir);
  const full = (path: string) => {
    const p = resolve(join(root, path));
    if (!p.startsWith(root)) throw new Error('Geçersiz medya yolu');
    return p;
  };
  return {
    async put(userId, data, mimeType) {
      const base = mimeType.split(';')[0]!.trim();
      const path = `${userId}/${randomUUID()}.${EXT[base] ?? 'bin'}`;
      await mkdir(dirname(full(path)), { recursive: true });
      await writeFile(full(path), data);
      return path;
    },
    async remove(paths) {
      for (const p of paths) await rm(full(p), { force: true });
    },
  };
}

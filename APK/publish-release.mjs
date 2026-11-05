#!/usr/bin/env node
/**
 * Publica un APK en el canal de ALFA-Admin (tabla landlord.pos_apk_releases).
 *
 * Uso:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node APK/publish-release.mjs APK/Clic-Pos-1.1.374-release.apk \
 *     [--version-name 1.1.374] [--version-code 1374] \
 *     [--base-url https://alfa-admin-nine.vercel.app] \
 *     [--changelog "texto"] [--status available] [--dry-run]
 *
 * Requiere la service role key de PRODUCCIÓN: es la única credencial que puede
 * escribir landlord.pos_apk_releases (la anon key no tiene permiso).
 *
 * Valores por defecto: versión deducida del nombre del APK, sha256 calculado del
 * archivo, URL {base}/apk/<nombre del APK> y estado `available` con is_latest=true.
 * La operación es idempotente por version_code.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const apkPath = args.find(arg => !arg.startsWith('--') && arg.endsWith('.apk'));
if (!apkPath) {
  console.error('ERROR: indica la ruta del APK. Ejemplo: node APK/publish-release.mjs APK/Clic-Pos-1.1.374-release.apk');
  process.exit(1);
}
if (!fs.existsSync(apkPath)) {
  console.error(`ERROR: no existe ${apkPath}`);
  process.exit(1);
}

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const dryRun = has('dry-run');

// La fuente de verdad de la versión es build.gradle, no el nombre del archivo.
const readGradleVersion = () => {
  try {
    const gradle = fs.readFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'android', 'app', 'build.gradle'),
      'utf8',
    );
    return {
      name: gradle.match(/versionName\s+"([^"]+)"/)?.[1] || null,
      code: Number(gradle.match(/versionCode\s+(\d+)/)?.[1]) || null,
    };
  } catch {
    return { name: null, code: null };
  }
};

const file = path.basename(apkPath);
const fromGradle = readGradleVersion();
const versionName = flag('version-name', fromGradle.name);
const versionCode = Number(flag('version-code', fromGradle.code)) || null;
const baseUrl = flag('base-url', 'https://alfa-admin-nine.vercel.app').replace(/\/$/, '');
const status = flag('status', 'available');
const changelog = flag('changelog', `APK ${versionName} publicado desde el POS.`);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
const apkUrl = `${baseUrl}/apk/${file}`;

if (!versionName || !versionCode) {
  console.error('ERROR: no pude deducir la versión. Usa --version-name 1.1.374 --version-code 1374');
  process.exit(1);
}

const row = {
  version_name: versionName,
  version_code: versionCode,
  apk_url: apkUrl,
  direct_download_url: apkUrl,
  checksum_sha256: sha256,
  changelog,
  release_type: flag('release-type', 'feature'),
  release_status: status,
  is_latest: status === 'available',
  published_at: new Date().toISOString(),
};

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  'Accept-Profile': 'landlord',
  'Content-Profile': 'landlord',
  Prefer: 'return=representation',
};

const api = (query, init = {}) => fetch(`${supabaseUrl}/rest/v1/pos_apk_releases${query}`, {
  ...init,
  headers: { ...headers, ...(init.headers || {}) },
});

console.log(`[publish] APK   : ${apkPath}`);
console.log(`[publish] versión: ${versionName} (${versionCode})`);
console.log(`[publish] sha256 : ${sha256}`);
console.log(`[publish] url    : ${apkUrl}`);
console.log(`[publish] estado : ${status}${dryRun ? ' (dry-run: sin escribir)' : ''}`);

if (dryRun) {
  console.log('[publish] dry-run: no se modificó la base.');
  process.exit(0);
}

if (!supabaseUrl || !serviceKey) {
  console.error('ERROR: faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

// Solo una fila puede ser "la última": se limpia antes de publicar.
const resetRes = await api('?is_latest=eq.true', {
  method: 'PATCH',
  body: JSON.stringify({ is_latest: false }),
});
if (!resetRes.ok) {
  console.error(`ERROR al limpiar is_latest: HTTP ${resetRes.status} ${await resetRes.text()}`);
  process.exit(1);
}

const existingRes = await api(`?version_code=eq.${versionCode}&select=id`);
const existing = existingRes.ok ? await existingRes.json() : [];
const writeRes = existing.length > 0
  ? await api(`?version_code=eq.${versionCode}`, { method: 'PATCH', body: JSON.stringify(row) })
  : await api('', { method: 'POST', body: JSON.stringify(row) });

if (!writeRes.ok) {
  console.error(`ERROR al registrar el release: HTTP ${writeRes.status} ${await writeRes.text()}`);
  process.exit(1);
}

const saved = await writeRes.json();
console.log(`[publish] ${existing.length > 0 ? 'actualizado' : 'creado'} registro:`, JSON.stringify(saved[0] || saved).slice(0, 220));

const checkRes = await fetch(`${baseUrl}/api/pos-apk/latest`, { headers: { Accept: 'application/json' } });
const check = checkRes.ok ? await checkRes.json() : null;
const release = check?.release || null;
console.log(`[publish] /api/pos-apk/latest => ${release ? `${release.version_name} (${release.version_code}) · ${release.direct_download_url}` : 'sin release'}`);

if (!release || Number(release.version_code) !== versionCode) {
  console.error('[publish] AVISO: el canal todavía no reporta la versión publicada (revisa el estado o el deploy).');
  process.exit(2);
}
console.log('[publish] OK: el canal ya sirve esta versión.');

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const validators = {
  'ALFA-RMS': ['data-integrity', 'security'],
  'ALFA-POS': ['sync-validator', 'offline-validator', 'performance', 'security'],
  'ALFA-ADMIN': ['tenant-integrity', 'security'],
};
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const load = file => JSON.parse(readFileSync(file, 'utf8'));

export function classify(files, matrix) {
  ensure(validators[matrix.product], 'Producto desconocido');
  ensure(files.length > 0 && files.every(file => typeof file === 'string' && file.length > 0), 'Diff vacío o inválido');
  const gates = new Set(['review', 'qa', 'integration', 'release']);
  const matched = new Set();
  let risk = 'LOW';
  for (const file of files) {
    ensure(!file.startsWith('/') && !file.split('/').includes('..'), 'Ruta fuera del repo');
    // Protocol-only changes still need independent review and QA.
    if (/^(AGENTS\.md|WORKFLOW\.md|CODEX_HANDOVER\.md)$/.test(file) || (/^(docs\/|\.codex\/)/.test(file) && /\.(md|toml)$/.test(file))) continue;
    if (/^\.codex\//.test(file) || /^\.github\/workflows\//.test(file)) {
      risk = levels.indexOf(risk) < levels.indexOf('HIGH') ? 'HIGH' : risk;
      gates.add('security');
      matched.add('workflow-infrastructure');
      continue;
    }
    let known = false;
    for (const rule of matrix.rules) {
      if (!new RegExp(rule.pattern, 'i').test(file)) continue;
      known = true;
      matched.add(rule.name);
      rule.gates.forEach(gate => gates.add(gate));
      if (levels.indexOf(rule.risk) > levels.indexOf(risk)) risk = rule.risk;
    }
    if (!known) {
      // UI can indirectly mutate business data; only the analyst may justify fewer tests,
      // but the mandatory gates below cannot be removed by an edited evidence file.
      const ui = /\.(tsx|css)$/.test(file) && /^(src\/|components\/)/.test(file);
      const next = ui ? 'MEDIUM' : 'HIGH';
      if (levels.indexOf(next) > levels.indexOf(risk)) risk = next;
      if (!ui) validators[matrix.product].forEach(gate => gates.add(gate));
      matched.add(ui ? 'ui-unclassified' : 'unknown-functional');
    }
    if (/(delete|reset|drop|secret|keystore|signing)/i.test(file)) {
      risk = 'CRITICAL';
      gates.add('security');
    }
  }
  return { risk, gates: [...gates].sort(), rules: [...matched].sort() };
}

export function makeScope({ product, baseCommit, sourceCommit, diff, files }) {
  const scope = { product, baseCommit, sourceCommit, files: [...files].sort(), diffHash: digest(diff) };
  return { ...scope, scopeHash: digest(JSON.stringify(scope)) };
}

export function validateEvidence(item) {
  ensure(item && typeof item.path === 'string' && item.path.startsWith('/'), 'Evidencia requiere ruta absoluta local archivada');
  ensure(/^[a-f0-9]{64}$/.test(item.sha256 || ''), 'Evidencia requiere SHA-256');
  ensure(statSync(item.path).isFile(), 'Evidencia no es archivo');
  ensure(digest(readFileSync(item.path)) === item.sha256, 'Hash de evidencia no coincide');
}

export function validateArtifact(artifact) {
  ensure(artifact && typeof artifact === 'object', 'Falta artefacto aprobado');
  for (const field of ['apk', 'versionName', 'buildId', 'applicationId']) {
    ensure(typeof artifact[field] === 'string' && artifact[field].trim(), `Artefacto: falta ${field}`);
  }
  ensure(Number.isSafeInteger(artifact.versionCode) && artifact.versionCode > 0, 'versionCode inválido');
  ensure(Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes > 0, 'Tamaño APK inválido');
  for (const field of ['sha256', 'certificateSha256']) ensure(/^[a-f0-9]{64}$/.test(artifact[field] || ''), `Artefacto: ${field} inválido`);
  ensure(/^[a-f0-9]{40}$/.test(artifact.sourceCommit || ''), 'Commit APK inválido');
  ensure(artifact.apk.startsWith('/'), 'APK requiere ruta absoluta');
  const bytes = readFileSync(artifact.apk);
  ensure(bytes.length === artifact.sizeBytes, 'Tamaño APK distinto');
  ensure(digest(bytes) === artifact.sha256, 'SHA-256 APK distinto');
  ensure(bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'APK no es ZIP');
  return digest(JSON.stringify(Object.fromEntries(Object.keys(artifact).sort().map(key => [key, artifact[key]]))));
}

export function verify(report, scope, policy, stage) {
  ensure(['internal', 'deployed-internal', 'production', 'released-production'].includes(stage), 'Estado de verificación desconocido');
  ensure(report.schemaVersion === 1 && report.product === scope.product, 'Schema/producto inválido');
  ensure(report.scopeHash === scope.scopeHash && report.sourceCommit === scope.sourceCommit, 'Evidencia obsoleta: SHA/diff distintos');
  ensure(Array.isArray(report.developerIds) && report.developerIds.length > 0 && report.developerIds.every(id => typeof id === 'string' && id.trim()), 'Identifica todos los agentes autores');
  ensure(levels.includes(report.risk) && levels.indexOf(report.risk) >= levels.indexOf(policy.risk), 'No puede reducir riesgo');
  ensure(Array.isArray(report.extraGates) && report.extraGates.every(gate => [...validators[scope.product], 'integration', 'security'].includes(gate)), 'Gates adicionales inválidos');
  const escalationGates = levels.indexOf(report.risk) > levels.indexOf(policy.risk) && levels.indexOf(report.risk) >= levels.indexOf('HIGH') ? validators[scope.product] : [];
  const gates = [...new Set([...policy.gates, ...report.extraGates, ...escalationGates, ...(report.risk === 'CRITICAL' ? ['security'] : [])])];
  ensure(Array.isArray(report.records), 'Faltan registros');
  const required = ['analysis', 'plan', 'implementation', ...gates.filter(gate => gate !== 'release'), 'release', 'internal-approval'];
  if (stage !== 'internal') {
    required.push(scope.product === 'ALFA-POS' ? 'internal-deploy' : 'internal-release');
  }
  if (stage === 'production' || stage === 'released-production') required.push('internal-testing', 'production-approval');
  if (stage === 'released-production') required.push('production-release');
  const orderedGroups = [['analysis'], ['plan'], ['implementation'], gates.filter(gate => gate !== 'release'), ['release'], ['internal-approval'], [scope.product === 'ALFA-POS' ? 'internal-deploy' : 'internal-release'], ['internal-testing'], ['production-approval'], ['production-release']];
  let previousMax = -Infinity;
  const artifactHash = scope.product === 'ALFA-POS' ? validateArtifact(report.artifact) : null;
  if (artifactHash) ensure(report.artifact.sourceCommit === scope.sourceCommit, 'APK construido desde otro commit');
  const seen = new Set();
  const validatorIds = new Set();
  const independentGates = new Set([...gates, 'internal-testing', 'production-approval']);
  for (const record of report.records) {
    ensure(required.includes(record.gate), `Registro fuera del estado: ${record.gate}`);
    ensure(!seen.has(record.gate), `Gate duplicado: ${record.gate}`);
    seen.add(record.gate);
  }
  for (const group of orderedGroups) {
    const active = group.filter(gate => required.includes(gate));
    if (!active.length) continue;
    const times = [];
    for (const gate of active) {
      const record = report.records.find(item => item.gate === gate);
      ensure(record, `Falta gate: ${gate}`);
      ensure(record.result === 'PASS', `Gate ${gate}: ${record.result || 'sin resultado'}`);
      ensure(record.scopeHash === scope.scopeHash && record.sourceCommit === scope.sourceCommit, `Gate ${gate} obsoleto`);
      ensure(typeof record.agentId === 'string' && record.agentId.trim(), `Gate ${gate}: falta agentId`);
      if (gate === 'implementation') ensure(report.developerIds.includes(record.agentId), 'Implementation no corresponde a autor registrado');
      else ensure(!report.developerIds.includes(record.agentId), `Autor no puede aprobar ${gate}`);
      if (independentGates.has(gate)) {
        ensure(!validatorIds.has(record.agentId), `Un mismo agente no puede validar gates distintos: ${gate}`);
        validatorIds.add(record.agentId);
      }
      ensure(Array.isArray(record.evidence) && record.evidence.length > 0, `Gate ${gate}: falta evidencia`);
      record.evidence.forEach(validateEvidence);
      ensure(typeof record.summary === 'string' && record.summary.trim(), `Gate ${gate}: falta resumen`);
      const time = Date.parse(record.completedAt);
      ensure(Number.isFinite(time) && time <= Date.now(), `Gate ${gate}: fecha inválida/futura`);
      ensure(time >= previousMax, `Gate ${gate}: se ejecutó antes de su predecesor`);
      if (artifactHash && ['release', 'internal-approval', 'internal-deploy', 'internal-testing', 'production-approval', 'production-release'].includes(gate)) ensure(record.artifactHash === artifactHash, `Gate ${gate}: artefacto distinto`);
      times.push(time);
    }
    previousMax = Math.max(...times);
  }
  return { result: { internal: 'APPROVED_FOR_INTERNAL_TESTING', 'deployed-internal': 'DEPLOYED_FOR_INTERNAL_TESTING', production: 'APPROVED_FOR_PRODUCTION', 'released-production': 'RELEASED_FOR_PRODUCTION' }[stage], product: scope.product, sourceCommit: scope.sourceCommit, scopeHash: scope.scopeHash, gates, artifactHash };
}

export function currentScope(baseRef, matrix) {
  ensure(!git('status', '--porcelain'), 'Se requiere árbol limpio y todos los cambios committed');
  const sourceCommit = git('rev-parse', 'HEAD');
  const baseCommit = git('merge-base', baseRef, sourceCommit);
  // Include both old/new paths on renames and deleted files.
  const files = git('diff', '--no-renames', '--name-only', baseCommit, sourceCommit).split('\n').filter(Boolean);
  const diff = git('diff', '--no-ext-diff', '--binary', baseCommit, sourceCommit);
  return makeScope({ product: matrix.product, baseCommit, sourceCommit, diff, files });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, baseRef, reportPath, stage] = process.argv.slice(2);
    ensure(baseRef && ['plan', 'verify'].includes(command), 'Uso: node .codex/workflow.mjs plan <base-ref> | verify <base-ref> <report.json> <internal|deployed-internal|production|released-production>');
    const matrix = load(resolve(root, '.codex/risk-matrix.json'));
    const scope = currentScope(baseRef, matrix);
    const policy = classify(scope.files, matrix);
    if (command === 'plan') console.log(JSON.stringify({ schemaVersion: 1, ...scope, ...policy }, null, 2));
    else {
      ensure(reportPath && stage, 'Falta informe/estado');
      console.log(JSON.stringify(verify(load(resolve(reportPath)), scope, policy, stage), null, 2));
    }
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}

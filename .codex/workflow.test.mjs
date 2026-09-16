import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, makeScope, verify, validateArtifact, validateEvidence } from './workflow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const matrix = JSON.parse(readFileSync(join(here, 'risk-matrix.json'), 'utf8'));
const commit = 'a'.repeat(40);
const base = 'b'.repeat(40);
const clone = value => structuredClone(value);
const qaDir = mkdtempSync(join(tmpdir(), 'alfa-workflow-evidence-'));
after(() => rmSync(qaDir, { recursive: true, force: true }));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const logPath = join(qaDir, 'archived-evidence.log');
writeFileSync(logPath, 'Independent archived QA evidence for fixture scope.\n');
const archivedEvidence = { path: logPath, sha256: hash(readFileSync(logPath)) };
// A structurally valid minimal ZIP with one empty entry, not an Android package or signed APK.
const name = Buffer.from('fixture.txt');
const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(name.length, 26);
const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(name.length, 28);
const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length, 16);
const zipBytes = Buffer.concat([local, name, central, name, end]);
const apkPath = join(qaDir, 'fixture-release.apk'); writeFileSync(apkPath, zipBytes);
const specialist = {
  'ALFA-RMS': ['data-integrity', 'security'],
  'ALFA-POS': ['sync-validator', 'offline-validator', 'performance', 'security'],
  'ALFA-ADMIN': ['tenant-integrity', 'security'],
};
function fixture(product = matrix.product, stage = 'internal', files = ['services/new-business-logic.mjs']) {
  const policy = classify(files, { ...matrix, product });
  const scope = makeScope({ product, baseCommit: base, sourceCommit: commit, diff: 'reviewed change', files });
  const report = { schemaVersion: 1, product, scopeHash: scope.scopeHash, sourceCommit: commit,
    developerIds: ['developer-A', 'developer-B'], risk: policy.risk, extraGates: [], records: [] };
  let artifactHash;
  if (product === 'ALFA-POS') {
    report.artifact = { apk: apkPath, versionName: '1.2.3', versionCode: 123,
      buildId: 'qa-build-123', applicationId: 'com.example.pos', sizeBytes: zipBytes.length,
      sha256: hash(zipBytes), certificateSha256: 'd'.repeat(64), sourceCommit: commit };
    artifactHash = validateArtifact(report.artifact);
  }
  const groups = [['analysis'], ['plan'], ['implementation'], policy.gates.filter(g => g !== 'release'), ['release'], ['internal-approval']];
  if (stage !== 'internal') groups.push([product === 'ALFA-POS' ? 'internal-deploy' : 'internal-release']);
  if (['production', 'released-production'].includes(stage)) groups.push(['internal-testing'], ['production-approval']);
  if (stage === 'released-production') groups.push(['production-release']);
  groups.forEach((gates, index) => gates.forEach(gate => report.records.push({
    gate, result: 'PASS', agentId: gate === 'implementation' ? 'developer-A' : `${gate}-independent`,
    scopeHash: scope.scopeHash, sourceCommit: commit, completedAt: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString(),
    evidence: [clone(archivedEvidence)], summary: `Verified ${gate}`, ...(artifactHash ? { artifactHash } : {}),
  })));
  return { scope, policy, report, stage };
}
const run = f => verify(f.report, f.scope, f.policy, f.stage);

for (const product of Object.keys(specialist)) {
  test(`${product}: complete independent evidence approves only requested stage`, () => {
    for (const stage of ['internal', 'deployed-internal', 'production', 'released-production']) {
      const f = fixture(product, stage);
      const expected = { internal: 'APPROVED_FOR_INTERNAL_TESTING', 'deployed-internal': 'DEPLOYED_FOR_INTERNAL_TESTING',
        production: 'APPROVED_FOR_PRODUCTION', 'released-production': 'RELEASED_FOR_PRODUCTION' }[stage];
      assert.equal(run(f).result, expected);
    }
  });
  test(`${product}: unknown functional changes require every product specialist`, () => {
    const policy = classify(['services/unmapped-business.mjs'], { product, rules: [] });
    assert.equal(policy.risk, 'HIGH');
    assert.ok(policy.rules.includes('unknown-functional'));
    for (const gate of specialist[product]) assert.ok(policy.gates.includes(gate), gate);
    for (const gate of ['review', 'qa', 'integration', 'release']) assert.ok(policy.gates.includes(gate), gate);
  });
}

test('every registered author is forbidden from approving any independent gate', () => {
  const original = fixture();
  for (const author of original.report.developerIds) {
    for (const record of original.report.records.filter(r => r.gate !== 'implementation')) {
      const f = clone(original);
      f.report.records.find(r => r.gate === record.gate).agentId = author;
      assert.throws(() => run(f), /Autor no puede aprobar/, `${author} cannot approve ${record.gate}`);
    }
  }
});

test('implementation cannot be attributed to an unregistered author', () => {
  const f = fixture(); f.report.records.find(r => r.gate === 'implementation').agentId = 'outsider';
  assert.throws(() => run(f), /Implementation no corresponde/);
});

test('approval is invalidated by changed SHA, changed patch, changed base, deletion or renamed path', () => {
  const original = fixture();
  for (const change of [ {sourceCommit: 'e'.repeat(40)}, {diff: 'new patch'}, {baseCommit: 'f'.repeat(40)},
    {files: ['services/renamed.mjs']}, {files: ['services/new-business-logic.mjs', 'services/deleted.mjs']} ]) {
    const f = clone(original);
    f.scope = makeScope({ product: matrix.product, baseCommit: base, sourceCommit: commit,
      diff: 'reviewed change', files: original.scope.files, ...change });
    assert.throws(() => run(f), /Evidencia obsoleta/);
  }
});

test('stale per-gate SHA or diff invalidates otherwise current report', () => {
  for (const field of ['sourceCommit', 'scopeHash']) {
    const f = fixture(); f.report.records.find(r => r.gate === 'qa')[field] = 'obsolete';
    assert.throws(() => run(f), /Gate qa obsoleto/);
  }
});

test('each missing or failed mandatory gate blocks approval', () => {
  const original = fixture();
  for (const record of original.report.records) {
    const missing = clone(original); missing.report.records = missing.report.records.filter(r => r.gate !== record.gate);
    assert.throws(() => run(missing), /Falta gate/, `missing ${record.gate}`);
    const failed = clone(original); failed.report.records.find(r => r.gate === record.gate).result = 'FAIL';
    assert.throws(() => run(failed), /Gate .*: FAIL/, `failed ${record.gate}`);
  }
});

test('a reviewer cannot discard mandatory specialists or lower classified risk', () => {
  const f = fixture(); f.report.risk = 'LOW';
  assert.throws(() => run(f), /No puede reducir riesgo/);
  const g = fixture(); g.report.extraGates = ['imaginary-check'];
  assert.throws(() => run(g), /Gates adicionales inválidos/);
});

test('overlapping rules union gates and retain maximum risk independent of rule order', () => {
  const rules = [ {name:'one', pattern:'business', risk:'MEDIUM', gates:['security']},
    {name:'two', pattern:'logic', risk:'CRITICAL', gates:[specialist[matrix.product][0]]} ];
  const a = classify(['business-logic.mjs'], {product:matrix.product, rules});
  const b = classify(['business-logic.mjs'], {product:matrix.product, rules:[...rules].reverse()});
  assert.deepEqual(a,b); assert.equal(a.risk,'CRITICAL');
  assert.ok(a.gates.includes('security')); assert.ok(a.gates.includes(specialist[matrix.product][0]));
});

test('critical filenames cannot remain low risk and unsafe paths are rejected', () => {
  const p = classify(['src/delete-record.tsx'], {product:matrix.product,rules:[]});
  assert.equal(p.risk,'CRITICAL'); assert.ok(p.gates.includes('security'));
  for (const file of ['/outside.ts','../outside.ts','src/../outside.ts'])
    assert.throws(() => classify([file],matrix), /Ruta fuera/);
  assert.throws(() => classify([],matrix), /Diff vacío/);
});

test('chronology blocks QA before implementation and release before the final specialist', () => {
  for (const gate of ['qa','release','internal-approval']) {
    const f = fixture(); f.report.records.find(r => r.gate === gate).completedAt = '2019-12-31T23:59:00Z';
    assert.throws(() => run(f), /antes de su predecesor/, gate);
  }
  const f = fixture(); f.report.records.find(r => r.gate === 'qa').completedAt = '2999-01-01T00:00:00Z';
  assert.throws(() => run(f), /fecha inválida\/futura/);
});

test('internal approval does not authorize deployment or production', () => {
  const f = fixture(); assert.equal(run(f).result,'APPROVED_FOR_INTERNAL_TESTING');
  for (const stage of ['deployed-internal','production','released-production']) {
    const g = clone(f); g.stage = stage; assert.throws(() => run(g), /Falta gate/);
  }
  const prod = fixture(matrix.product,'production');
  prod.report.records = prod.report.records.filter(r => r.gate !== 'internal-testing');
  assert.throws(() => run(prod), /Falta gate: internal-testing/);
});

test('duplicate, absent evidence and unrecognized stage records are rejected', () => {
  const f = fixture(); f.report.records.push(clone(f.report.records[0])); assert.throws(() => run(f), /Gate duplicado/);
  const g = fixture(); g.report.records.find(r => r.gate === 'qa').evidence = []; assert.throws(() => run(g), /falta evidencia/);
  const h = fixture(); h.report.records.push({...h.report.records[0],gate:'production-approval'});
  assert.throws(() => run(h), /Registro fuera del estado/);
});

test('APK metadata, exact source commit and artifact digest bind all release/deployment approvals', () => {
  const original = fixture('ALFA-POS','released-production');
  for (const field of ['sha256','certificateSha256','versionName','versionCode','buildId','applicationId','sizeBytes','apk']) {
    const f = clone(original); f.report.artifact[field] = typeof f.report.artifact[field] === 'number'
      ? f.report.artifact[field] + 1 : field.endsWith('Sha256') || field === 'sha256' ? 'e'.repeat(64) : `${f.report.artifact[field]}-changed`;
    assert.throws(() => run(f), /artefacto distinto|SHA-256 APK distinto|Tamaño APK distinto|ENOENT/, field);
  }
  const stale = clone(original); stale.report.artifact.sourceCommit = 'e'.repeat(40);
  assert.throws(() => run(stale), /APK construido desde otro commit/);
  for (const gate of ['release','internal-approval','internal-deploy','internal-testing','production-approval','production-release']) {
    const f = clone(original); delete f.report.records.find(r => r.gate === gate).artifactHash;
    assert.throws(() => run(f), /artefacto distinto/, gate);
  }
  for (const change of [{versionCode:0},{sizeBytes:0},{sha256:'abc'},{certificateSha256:''},{sourceCommit:'not-a-sha'}]) {
    assert.throws(() => validateArtifact({...original.report.artifact,...change}));
  }
});

test('Git scope preserves deleted and both renamed paths so critical old path cannot disappear', () => {
  const dir = mkdtempSync(join(tmpdir(),'alfa-workflow-scope-'));
  const git = (...args) => execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try {
    git('init','--quiet');git('config','user.email','qa@example.invalid');git('config','user.name','Workflow QA');
    mkdirSync(join(dir,'.codex'));copyFileSync(join(here,'workflow.mjs'),join(dir,'.codex/workflow.mjs'));
    mkdirSync(join(dir,'src'));writeFileSync(join(dir,'src/delete-sensitive.ts'),'export const retained = 1;\n');
    writeFileSync(join(dir,'src/auth-old.ts'),'export const removed = 1;\n');git('add','.');git('commit','--quiet','-m','fixture base');
    const baseRef = git('rev-parse','HEAD');
    git('mv','src/delete-sensitive.ts','src/view.ts');git('rm','--quiet','src/auth-old.ts');git('commit','--quiet','-m','fixture rename and deletion');
    const script = `import {currentScope,classify} from './.codex/workflow.mjs'; const m=${JSON.stringify(matrix)}; const s=currentScope('${baseRef}',m); console.log(JSON.stringify({scope:s,policy:classify(s.files,m)}));`;
    const result = JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,encoding:'utf8'}));
    assert.deepEqual(result.scope.files,['src/auth-old.ts','src/delete-sensitive.ts','src/view.ts']);
    assert.equal(result.policy.risk,'CRITICAL');assert.ok(result.policy.gates.includes('security'));
    writeFileSync(join(dir,'src/dirty.ts'),'unreviewed');
    assert.throws(() => execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,encoding:'utf8',stdio:'pipe'}), /árbol limpio/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('archived evidence must exist locally and match its SHA-256; placeholders and changed bytes block approval', () => {
  const f = fixture(); f.report.records.find(r => r.gate === 'qa').evidence = ['QA PASSED'];
  assert.throws(() => run(f), /ruta absoluta local archivada/);
  for (const evidence of [ {path:'relative.log',sha256:archivedEvidence.sha256},
    {path:logPath,sha256:'a'.repeat(64)}, {path:logPath,sha256:'bad'},
    {path:join(qaDir,'missing.log'),sha256:archivedEvidence.sha256},
    {path:qaDir,sha256:archivedEvidence.sha256} ]) {
    assert.throws(() => validateEvidence(evidence));
  }
  const changedPath = join(qaDir,'changed.log'); writeFileSync(changedPath,'initial log');
  const changed = {path:changedPath,sha256:hash(readFileSync(changedPath))};
  validateEvidence(changed); writeFileSync(changedPath,'tampered log');
  const g = fixture();g.report.records.find(r => r.gate === 'qa').evidence = [changed];
  assert.throws(() => run(g), /Hash de evidencia no coincide/);
});

test('executable or policy changes in docs/.codex cannot bypass classification as prose', () => {
  for (const file of ['docs/migrate-database.mjs','docs/deploy.sh','.codex/workflow.mjs',
    '.codex/workflow.test.mjs','.codex/risk-matrix.json','.github/workflows/deploy.yml']) {
    const p = classify([file],matrix);
    assert.ok(['HIGH','CRITICAL'].includes(p.risk),`${file} must not be LOW`);
    assert.ok(p.gates.includes('security'),`${file} requires security`);
  }
  for (const file of ['AGENTS.md','WORKFLOW.md','docs/architecture/SYSTEM_MAP.md','.codex/agents/reviewer.toml']) {
    const p = classify([file],matrix); assert.equal(p.risk,'LOW',file);
    for(const gate of ['review','qa','integration','release']) assert.ok(p.gates.includes(gate));
  }
});

test('analyst escalation to HIGH or CRITICAL automatically adds every product specialist', () => {
  for (const product of Object.keys(specialist)) {
    for (const risk of ['HIGH','CRITICAL']) {
      const f = fixture(product,'internal',['docs/architecture/SYSTEM_MAP.md']);
      f.report.risk = risk;
      assert.throws(() => run(f), /Falta gate/, `${product} ${risk} requires specialists`);
      for (const gate of specialist[product]) {
        const qa = clone(f.report.records.find(r=>r.gate==='qa'));
        f.report.records.push({...qa,gate,agentId:`${gate}-escalated-independent`});
      }
      const result = run(f);
      for (const gate of specialist[product]) assert.ok(result.gates.includes(gate));
      assert.ok(result.gates.includes('security'));
    }
  }
});

test('one validator cannot approve distinct validation gates, including post-deployment testing', () => {
  const f = fixture();
  f.report.records.find(r=>r.gate==='review').agentId = 'single-validator';
  f.report.records.find(r=>r.gate==='qa').agentId = 'single-validator';
  assert.throws(() => run(f), /Un mismo agente no puede validar gates distintos/);
  const g = fixture(matrix.product,'production');
  g.report.records.find(r=>r.gate==='internal-testing').agentId = g.report.records.find(r=>r.gate==='security').agentId;
  assert.throws(() => run(g), /Un mismo agente no puede validar gates distintos/);
});

test('APK byte tampering, nonexistent path, relative path and non-ZIP content block validation', () => {
  const f = fixture('ALFA-POS');const path = join(qaDir,'tamper.apk');
  writeFileSync(path,zipBytes);const artifact={...f.report.artifact,apk:path};validateArtifact(artifact);
  const changed=Buffer.from(zipBytes);changed[changed.length-1]^=1;writeFileSync(path,changed);
  assert.throws(()=>validateArtifact(artifact),/SHA-256 APK distinto/);
  writeFileSync(path,zipBytes.subarray(0,zipBytes.length-1));
  assert.throws(()=>validateArtifact(artifact),/Tamaño APK distinto/);
  assert.throws(()=>validateArtifact({...artifact,apk:'relative.apk'}),/ruta absoluta/);
  assert.throws(()=>validateArtifact({...artifact,apk:join(qaDir,'absent.apk')}),/ENOENT/);
  const notZip=Buffer.from('plain text artifact');writeFileSync(path,notZip);
  assert.throws(()=>validateArtifact({...artifact,sizeBytes:notZip.length,sha256:hash(notZip)}),/APK no es ZIP/);
});

test('artifact byte replacement with refreshed metadata still invalidates approved release bindings', () => {
  const f=fixture('ALFA-POS','released-production');const path=join(qaDir,'replacement.apk');
  const replacement=Buffer.concat([zipBytes,Buffer.from('changed bytes')]);writeFileSync(path,replacement);
  f.report.artifact={...f.report.artifact,apk:path,sizeBytes:replacement.length,sha256:hash(replacement)};
  validateArtifact(f.report.artifact);
  assert.throws(()=>run(f),/artefacto distinto/);
});

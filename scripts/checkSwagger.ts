/**
 * Validates the generated OpenAPI spec.
 *
 * Run with `npx tsx scripts/checkSwagger.ts`. Fails if a route is registered in
 * `app.ts` but missing from the spec, or if a `$ref` points at a schema that
 * does not exist — both of which produce a docs page that silently lies.
 */
import path from 'path';
import fs from 'fs';
import spec from '../config/swagger';

type Spec = {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
};

const s = spec as Spec;
const documented = Object.keys(s.paths || {});
const schemas = Object.keys(s.components?.schemas || {});

// ── Broken $refs ──
const refs = [...new Set((JSON.stringify(s).match(/#\/components\/schemas\/[A-Za-z0-9_]+/g) || []))];
const brokenRefs = refs.map(r => r.split('/').pop()!).filter(n => !schemas.includes(n));

// ── Registered routes vs documented paths ──
// Read the mount prefixes from app.ts, then each router's own paths, and
// normalise Express ':param' to OpenAPI '{param}'.
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');
const mounts = [...appSrc.matchAll(/app\.use\('\/api\/([a-zA-Z]+)',\s*([a-zA-Z]+Routes)\)/g)]
  .map(m => ({ prefix: `/${m[1]}`, file: m[2].replace(/Routes$/, '') }));

const fileFor = (name: string) => {
  const dir = path.join(__dirname, '..', 'routes');
  const candidates = [name, name.replace(/s$/, ''), `${name}s`, 'jobCards', 'users'];
  for (const c of candidates) {
    const p = path.join(dir, `${c}.ts`);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const registered: string[] = [];
for (const { prefix, file } of mounts) {
  const p = fileFor(file);
  if (!p) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/router\.(?:route|get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    const raw = m[1] === '/' ? '' : m[1];
    registered.push((prefix + raw).replace(/:([a-zA-Z]+)/g, '{$1}'));
  }
}

const undocumented = [...new Set(registered)].filter(r => !documented.includes(r)).sort();

console.log(`documented paths : ${documented.length}`);
console.log(`registered routes: ${new Set(registered).size}`);
console.log(`schemas          : ${schemas.length}`);
console.log(`security schemes : ${Object.keys(s.components?.securitySchemes || {}).join(', ')}`);
console.log(`broken $refs     : ${brokenRefs.length ? brokenRefs.join(', ') : 'none'}`);
console.log(`undocumented     : ${undocumented.length ? undocumented.join(', ') : 'none'}`);

if (brokenRefs.length || undocumented.length) process.exit(1);
console.log('\nOpenAPI spec is complete and internally consistent.');

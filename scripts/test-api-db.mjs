/** Run the same pgTAP suite via stdin, avoiding Docker Desktop host bind mounts. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
process.chdir(new URL('../',import.meta.url).pathname);
const project=readFileSync('supabase/config.toml','utf8').match(/^project_id = "([a-zA-Z0-9_-]+)"/m)[1];
for (const file of readdirSync('supabase/tests/database').filter(name=>name.endsWith('.sql')).sort()) {
const suite=readFileSync(`supabase/tests/database/${file}`,'utf8');
console.log(`Database suite: ${file}`);
const output=execFileSync('docker',['exec','-i',`supabase_db_${project}`,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-Atq'],{input:suite,encoding:'utf8',stdio:['pipe','pipe','pipe']});
console.log(output.trim());
assert.doesNotMatch(output,/^not ok /m,'pgTAP failed');
const plan=output.match(/^1\.\.(\d+)$/m);
assert.ok(plan,'pgTAP emitted a plan');
assert.equal([...output.matchAll(/^ok \d+/gm)].length,Number(plan[1]),'all planned pgTAP assertions passed');
console.log('PASS: pgTAP transaction rolled back.');
}

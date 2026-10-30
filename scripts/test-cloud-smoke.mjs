/** Read-only security smoke for an explicitly supplied deployment. Never writes data.
 * SMOKE_SUPABASE_URL/SMOKE_SUPABASE_KEY are public connection settings.
 * Optional SUPABASE_USER_ACCESS_TOKEN verifies a provisioned individual's snapshot. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url=process.env.SMOKE_SUPABASE_URL,key=process.env.SMOKE_SUPABASE_KEY;
if(!url||!key||!/^https?:\/\//.test(url))throw new Error('Set explicit SMOKE_SUPABASE_URL and SMOKE_SUPABASE_KEY; this script never guesses a cloud destination');
const request=async(path,body,token=key)=>{
 const response=await fetch(`${url.replace(/\/$/,'')}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:response.status,data:await response.json()};
};
for(const [path,body] of [['rpc/app_snapshot',{}],['rpc/app_export',{}],['rpc/app_command',{p_command_id:randomUUID(),p_operation:'invalid_operation',p_payload:{}}],['orders?select=id&limit=1'],['clients?select=id&limit=1'],['financial_movements?select=id&limit=1']]){
 const result=await request(path,body);assert.ok([401,403].includes(result.status),`Anonymous ${path} must be rejected (HTTP ${result.status})`);
}
console.log('PASS: anonymous operational RPCs and table reads rejected; no business data written.');
if(process.env.SUPABASE_USER_ACCESS_TOKEN){
 const result=await request('rpc/app_snapshot',{},process.env.SUPABASE_USER_ACCESS_TOKEN);assert.equal(result.status,200);assert.ok(['admin','responsable'].includes(result.data.profile?.role));
 if(result.data.profile.role==='responsable'){assert.equal(Object.hasOwn(result.data,'members'),false);assert.ok(result.data.orders.every(o=>o.location_id===result.data.profile.location_id));assert.ok(result.data.stock.every(s=>s.location_id===result.data.profile.location_id));assert.ok(result.data.locations.every(l=>l.id===result.data.profile.location_id));}
 console.log(`PASS: authenticated ${result.data.profile.role} snapshot respects profile scope.`);
}else console.log('Authenticated scope check omitted: SUPABASE_USER_ACCESS_TOKEN not supplied.');

/** Local-only destructive-fixture integration suite. Fixture rows are removed in finally.
 * Uses separate HTTP fetches/connections for real database contention. Never accepts remote URLs.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const root = new URL('../', import.meta.url);
if (process.env.TEST_LEGACY_PRE_AUTH !== '1') {
 console.log('Legacy anonymous contract superseded; running current isolated authenticated backend suite. Set TEST_LEGACY_PRE_AUTH=1 only against historical migrations.');
 await import('./test-kalak-backend.mjs');
 process.exit(0);
}
process.chdir(root.pathname);
const status = JSON.parse(execFileSync('npx', ['supabase','status','-o','json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const url = status.API_URL;
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url), 'Only local Supabase is allowed');
const anon = status.ANON_KEY;
assert.ok(anon,'Local anonymous key available');
const project = readFileSync('supabase/config.toml','utf8').match(/^project_id = "([a-zA-Z0-9_-]+)"/m)[1];
const container = `supabase_db_${project}`;
const sql = statement => execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const headers = {'apikey':anon,'Authorization':`Bearer ${anon}`,'Content-Type':'application/json'};
const ids = [];
async function request(path,body,method='POST') {
  const res = await fetch(`${url}/rest/v1/${path}`, {method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message || JSON.stringify(data)),{status:res.status});
  return data;
}
async function cmd(operation,payload,version=null,commandId=randomUUID()) {
  ids.push(commandId);
  return request('rpc/app_command',{p_command_id:commandId,p_operation:operation,p_payload:payload,p_expected_version:version});
}
const snapshot = ()=>request('rpc/app_snapshot',{});
const expectError = async (promise,code)=>assert.rejects(promise,new RegExp(code));
const itemPayload = (kind,name,unit='unidad',price='10')=>({kind,name,unit,price,minimum:'0',active:true});
let checks = 0;
const check = (name,fn)=>async()=>{await fn();checks++;console.log(`ok ${checks} - ${name}`);};
let baseline;
try {
  baseline=await snapshot();
  assert.ok(baseline.locations.some(l=>l.id==='cocina')); // Configurable pickup locations.
  // Existing workspace data is supported; cleanup only removes commands/entities owned by this run.
  const client=(await cmd('save_client',{name:`API fixture ${randomUUID()}`})).id;
  const flour=(await cmd('save_item',itemPayload('ingredient','API harina','g','0'))).id;
  const milk=(await cmd('save_item',itemPayload('ingredient','API leche','ml','0'))).id;
  const product=(await cmd('save_item',itemPayload('product','API producto'))).id;
  const recipe=(await cmd('save_recipe',{product_id:product,yield_quantity:10,lines:[{ingredient_id:flour,quantity:'1',unit:'kg'},{ingredient_id:milk,quantity:'1',unit:'l'}]},0)).id;
  const purchase=(await cmd('save_purchase',{supplier:'',expected_date:'2026-01-01',notes:'',lines:[{ingredient_id:flour,quantity:'1',unit:'kg',unit_price:'5'},{ingredient_id:milk,quantity:'1',unit:'l',unit_price:'2'}]})).id;
  await check('purchase receipt retry is exactly once and converts kg/l',async()=>{
    const beforeRevision=Number((await request('workspace_events?select=revision',undefined,'GET'))[0].revision);
    const id=randomUUID(); const results=await Promise.all(Array.from({length:5},()=>cmd('receive_purchase',{id:purchase},1,id)));
    results.forEach(r=>assert.deepEqual(r,results[0]));
    assert.ok(Number((await request('workspace_events?select=revision',undefined,'GET'))[0].revision)>=beforeRevision+1,'receipt transaction emits realtime invalidation');
    const s=await snapshot();for(const i of [flour,milk]) assert.equal(Number(s.stock.find(b=>b.item_id===i&&b.location_id==='cocina').on_hand),1000);
    await expectError(cmd('receive_purchase',{id:purchase},1), 'VERSION_CONFLICT');
  })();
  const productionPayload={product_id:product,recipe_id:recipe,planned_date:'2026-01-01',target_quantity:10,notes:''};
  const runs=await Promise.all([cmd('plan_production',productionPayload),cmd('plan_production',productionPayload)]);
  let winner;
  await check('competing starts serialize and cannot over-consume',async()=>{
    const res=await Promise.allSettled(runs.map(r=>cmd('start_production',{id:r.id},1)));
    assert.equal(res.filter(r=>r.status==='fulfilled').length,1);
    assert.match(res.find(r=>r.status==='rejected').reason.message,/INSUFFICIENT_STOCK/);
    winner=runs[res.findIndex(r=>r.status==='fulfilled')].id;
    const s=await snapshot(); assert.equal(Number(s.stock.find(b=>b.item_id===flour).on_hand),0);
    assert.equal(s.movements.filter(m=>m.event_id===winner&&m.kind==='production_consumption').length,2);
  })();
  await check('finish outputs centrally once; immutable recipe revision retained',async()=>{
    const retry=randomUUID();await cmd('finish_production',{id:winner,actual_quantity:10},2,retry);await cmd('finish_production',{id:winner,actual_quantity:10},2,retry);
    const next=(await cmd('save_recipe',{product_id:product,yield_quantity:10,lines:[{ingredient_id:flour,quantity:'2',unit:'kg'}]},1)).id;
    assert.notEqual(next,recipe);const s=await snapshot();assert.equal(s.productions.find(p=>p.id===winner).recipe_id,recipe);assert.equal(s.movements.filter(m=>m.event_id===winner&&m.kind==='production_output').length,1);
    await expectError(cmd('save_item',{id:flour,...itemPayload('ingredient','API harina','kg','0')},1),'VALIDATION_ERROR');
  })();
  await cmd('transfer_stock',{item_id:product,from_location_id:'cocina',to_location_id:'mendieta',quantity:10,reason:'API entrega'});
  const orderPayload=(date,quantity=7,location='mendieta')=>({client_id:client,pickup_date:date,location_id:location,payment_method:'efectivo',notes:'',lines:[{product_id:product,quantity}]});
  const later=(await cmd('save_order',orderPayload('2026-12-31'))).id;
  const earlier=(await cmd('save_order',orderPayload('2026-11-01'))).id;
  await check('canonical nearest-pickup reservations partial and transfer only free stock',async()=>{
    let s=await snapshot();assert.equal(s.orders.find(o=>o.id===earlier).lines[0].reserved,7);assert.equal(s.orders.find(o=>o.id===later).lines[0].reserved,3);
    await expectError(cmd('transfer_stock',{item_id:product,from_location_id:'mendieta',to_location_id:'salta',quantity:1,reason:'API'}),'INSUFFICIENT_STOCK');
    await expectError(cmd('deliver_order',{id:later},1),'INSUFFICIENT_RESERVED_STOCK');
    await cmd('adjust_stock',{item_id:product,location_id:'mendieta',quantity:'-2',reason:'API merma'});
    s=await snapshot();assert.equal(s.orders.find(o=>o.id===later).lines[0].reserved,1);assert.equal(s.orders.find(o=>o.id===earlier).lines[0].reserved,7);
  })();
  await check('double delivery from independent connections is all-or-nothing',async()=>{
    const results=await Promise.allSettled([cmd('deliver_order',{id:earlier},1),cmd('deliver_order',{id:earlier},1)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);
    const s=await snapshot();assert.equal(s.movements.filter(m=>m.event_id===earlier).length,1);assert.equal(Number(s.stock.find(b=>b.item_id===product&&b.location_id==='mendieta').on_hand),1);
    const delivered=s.orders.find(o=>o.id===earlier);assert.equal(delivered.pickup_date,'2026-11-01');assert.equal(s.orders.filter(o=>o.id===earlier&&o.status==='entregado'&&o.pickup_date.startsWith('2026-11')).reduce((n,o)=>n+Number(o.total),0),70);
    assert.notEqual(delivered.delivered_at.slice(0,7),delivered.pickup_date.slice(0,7),'monthly report uses pickup date, not delivery month');
  })();
  await check('order cancellation reallocates; outlet editing moves reservations',async()=>{
    const atSalta=(await cmd('save_order',orderPayload('2026-10-01',1,'salta'))).id;let s=await snapshot();assert.equal(s.orders.find(o=>o.id===atSalta).lines[0].reserved,0);
    await cmd('save_order',{id:atSalta,...orderPayload('2026-10-01',1)},1);s=await snapshot();assert.equal(s.orders.find(o=>o.id===atSalta).lines[0].reserved,1);assert.equal(s.orders.find(o=>o.id===later).lines[0].reserved,0);
    await cmd('cancel_order',{id:atSalta},2);s=await snapshot();assert.equal(s.orders.find(o=>o.id===later).lines[0].reserved,1);
  })();
  await check('catalog price snapshot retained, optimistic conflicts and command hash collisions',async()=>{
    await cmd('save_item',{id:product,...itemPayload('product','API producto','unidad','20')},1);
    await cmd('save_order',{id:later,...orderPayload('2026-12-31',8)},1);let s=await snapshot();assert.equal(s.orders.find(o=>o.id===later).lines[0].unit_price,'10.000000');
    await expectError(cmd('save_order',{id:later,...orderPayload('2026-12-31',8)},1),'VERSION_CONFLICT');
    const token=randomUUID();await cmd('save_client',{name:'API collision'},null,token);await expectError(cmd('save_client',{name:'API collision changed'},null,token),'IDEMPOTENCY_CONFLICT');
    await expectError(cmd('save_client',{name:'API collision'},1,token),'IDEMPOTENCY_CONFLICT');
    const newOrder=(await cmd('save_order',orderPayload('2027-01-01',1))).id;s=await snapshot();assert.equal(s.orders.find(o=>o.id===newOrder).lines[0].unit_price,'20.000000');
  })();
  await check('failure after first ingredient consumption rolls entire command back',async()=>{
    // First recipe ingredient can consume; second lacks stock. SQL transaction must undo first movement.
    const ordered=[flour,milk].sort();
    await cmd('adjust_stock',{item_id:ordered[0],location_id:'cocina',quantity:'1000',reason:'API rollback'});
    const r=(await cmd('save_recipe',{product_id:product,yield_quantity:1,lines:ordered.map(ingredient_id=>({ingredient_id,quantity:'100',unit:ingredient_id===flour?'g':'ml'}))},2)).id;
    const p=(await cmd('plan_production',{product_id:product,recipe_id:r,planned_date:'2026-01-01',target_quantity:1,notes:''})).id;
    const before=await snapshot();await expectError(cmd('start_production',{id:p},1),'INSUFFICIENT_STOCK');const after=await snapshot();
    assert.equal(after.movements.filter(m=>m.event_id===p).length,0);assert.equal(after.productions.find(v=>v.id===p).version,1);assert.equal(after.stock.find(b=>b.item_id===ordered[0]).on_hand,before.stock.find(b=>b.item_id===ordered[0]).on_hand);
  })();
  await check('anonymous direct writes, internal RPC, price tampering and fractional stock denied',async()=>{
    await expectError(request('items',{name:'bypass'}),'permission denied');
    await expectError(request('workspace_events',{id:1,revision:999}),'permission denied');
    await expectError(cmd(null,{name:'invalid'}),'VALIDATION_ERROR');
    await expectError(request('rpc/rebalance',{}),'Could not find');
    await expectError(cmd('save_order',{...orderPayload('2026-01-01'),lines:[{product_id:product,quantity:1,unit_price:'0'}]}),'VALIDATION_ERROR');
    await expectError(cmd('adjust_stock',{item_id:product,location_id:'cocina',quantity:'0.5',reason:'API'}),'VALIDATION_ERROR');
    await expectError(cmd('adjust_stock',{item_id:flour,location_id:'salta',quantity:'1',reason:'API'}),'VALIDATION_ERROR');
    const s=await snapshot();for(const i of s.items) assert.equal(typeof i.price,'string');for(const b of s.stock)for(const k of ['on_hand','reserved','shortage'])assert.equal(typeof b[k],'string');for(const m of s.movements)assert.equal(typeof m.quantity,'string');
  })();
  await check('anonymous realtime invalidation reaches a second client',async()=>{
    const second=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const baselineRevision=Number((await request('workspace_events?select=revision',undefined,'GET'))[0].revision);
    let resolveEvent;
    const received=new Promise(resolve=>{resolveEvent=resolve;});
    const channel=second.channel(`api-test-${randomUUID()}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'workspace_events'},event=>{if(Number(event.new.revision)>baselineRevision)resolveEvent(event);});
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Realtime subscribe timed out')),15000);
        channel.subscribe(state=>{if(state==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(state==='CHANNEL_ERROR'){clearTimeout(timer);reject(new Error('Realtime channel error'));}});
      });
      const previous=Number((await request('workspace_events?select=revision',undefined,'GET'))[0].revision);
      await cmd('save_client',{name:'API realtime'});
      let timer;
      const event=await Promise.race([received,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Realtime update timed out')),15000);})]).finally(()=>clearTimeout(timer));
      assert.ok(Number(event.new.revision)>=previous+1);
    } finally { await second.removeAllChannels(); second.realtime.disconnect(); }
  })();
  await check('ledger and recipe history deny privileged mutation too',async()=>{
    assert.throws(()=>sql(`update public.movements set reason='tamper' where event_id='${winner}';`),/INVALID_TRANSITION/);
    assert.throws(()=>sql(`update public.recipes set yield_quantity=20 where id='${recipe}';`),/INVALID_TRANSITION/);
  })();
} finally {
  // Only results associated with this run's command UUIDs are fixtures. Transactional
  // replication role is privileged and local-only, to remove immutable fixture history.
  if(ids.length) {
    const list=[...new Set(ids)].map(id=>`'${id}'::uuid`).join(',');
    sql(`begin; set local session_replication_role=replica;
      create temporary table fixture_results as select result->>'id' id from app_private.commands where id in (${list});
      create temporary table fixture_ids as select id::uuid from fixture_results where id ~ '^[0-9a-f-]{36}$';
      delete from public.audit_events where command_id in (${list});
      delete from public.financial_movements where id in (select id from fixture_ids) or order_id in (select id from fixture_ids) or purchase_id in (select id from fixture_ids);
      delete from public.movement_batches where movement_id in (select id from public.movements where event_id in (select id from fixture_ids)) or batch_id in (select id from public.batches where item_id in (select id from fixture_ids) or production_id in (select id from fixture_ids));
      delete from public.batches where item_id in (select id from fixture_ids) or production_id in (select id from fixture_ids);
      delete from public.production_ingredients where production_id in (select id from fixture_ids);
      delete from public.movements where event_id in (select id from fixture_ids);
      delete from public.order_lines where order_id in (select id from fixture_ids);
      delete from public.orders where id in (select id from fixture_ids);
      delete from public.purchase_lines where purchase_id in (select id from fixture_ids);
      delete from public.purchases where id in (select id from fixture_ids);
      delete from public.productions where id in (select id from fixture_ids);
      delete from public.recipe_lines where recipe_id in (select id from fixture_ids);
      delete from public.recipes where id in (select id from fixture_ids);
      delete from public.items where id in (select id from fixture_ids);
      delete from public.clients where id in (select id from fixture_ids);
      delete from public.locations where id in (select id from fixture_results);
      delete from app_private.commands where id in (${list}); commit;`);
    if(baseline) { const after=await snapshot();for(const key of ['clients','items','recipes','orders','purchases','productions','movements','batches','movement_batches','financial_movements','audit_events','locations'])assert.equal(after[key].length,baseline[key].length,`cleanup ${key}`); }
  }
}
console.log(`PASS: ${checks} API scenarios; isolated fixtures removed.`);

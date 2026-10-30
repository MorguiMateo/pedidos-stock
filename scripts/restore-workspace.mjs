/** Restore v2 export into an EMPTY, already migrated LOCAL PostgreSQL database only.
 * No shell interpolation. All content is sent through psql stdin in one transaction.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const input = value('--file');
if (!input || !args.includes('--replace-initial-catalog')) throw new Error('Usage: RESTORE_DATABASE_URL=postgresql://... node scripts/restore-workspace.mjs --file backup.json --replace-initial-catalog');
const target = new URL(process.env.RESTORE_DATABASE_URL || '');
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Restore accepts LOCAL databases only; never use an operational cloud database');
const body = readFileSync(input, 'utf8');
const backup = JSON.parse(body);
const sidecarExists = existsSync(`${input}.sha256`);
if (sidecarExists && readFileSync(`${input}.sha256`, 'utf8').trim() !== createHash('sha256').update(body).digest('hex')) throw new Error('Backup integrity checksum does not match');
if (backup.integrity) {
  const { integrity, ...payload } = backup;
  if (integrity.algorithm !== 'SHA-256' || integrity.payload_hash !== createHash('sha256').update(JSON.stringify(payload)).digest('hex')) throw new Error('Embedded backup integrity checksum does not match');
}
if (!sidecarExists && !backup.integrity) throw new Error('Missing integrity checksum; export a verified backup from the app or backup-workspace.mjs');
if (backup.format !== 'pedidos-stock' || backup.schema_version !== 2 || !backup.raw_tables || !backup.data?.stock || !Array.isArray(backup.idempotency_commands)) throw new Error('Unrecognized export schema');
// Earlier v2 backups predate date-specific pickup closures.
if (!Object.hasOwn(backup.raw_tables, 'pickup_closures')) backup.raw_tables.pickup_closures = [];
const hasPriceHistory = Object.hasOwn(backup.raw_tables, 'product_prices');
backup.raw_tables.app_members ??= [];
backup.raw_tables.product_prices ??= [];
backup.raw_tables.production_plans ??= [];
backup.raw_tables.production_plan_receipts ??= [];
for (const item of backup.raw_tables.items ?? []) item.first_purchase_gift_eligible ??= false;
for (const line of backup.raw_tables.order_lines ?? []) {
  line.future_reserved ??= '0';
  line.is_gift ??= false;
  line.list_unit_price ??= line.unit_price;
}
// Commercial history predates its explicit marker. Do not reinterpret a current
// backup's explicit null (for example, a delivered complimentary sample).
for (const order of backup.raw_tables.orders ?? []) if (!Object.hasOwn(order, 'first_purchase_commercial_at')) {
  order.first_purchase_commercial_at = (order.status === 'entregado' || order.delivered_at != null) && order.payment_method !== 'gratis' && Number(order.total) > 0
    ? order.delivered_at ?? order.created_at : null;
}
// Pre-identity exports never recorded client acquisition dates; unknown is not today.
for (const client of backup.raw_tables.clients ?? []) if (!Object.hasOwn(client,'created_at')) client.created_at = null;
const tables = ['app_members', 'product_prices', 'locations', 'pickup_closures', 'clients', 'items', 'recipes', 'recipe_lines', 'orders', 'order_lines', 'purchases', 'purchase_lines', 'productions', 'production_ingredients', 'production_plans', 'movements', 'production_plan_receipts', 'batches', 'movement_batches', 'financial_movements', 'audit_events', 'workspace_events'];
for (const name of tables) if (!Array.isArray(backup.raw_tables[name])) throw new Error(`Missing table ${name}`);
// v2 exporters deliberately stringify decimals. Never silently round JSON numbers
// above Number.MAX_SAFE_INTEGER during the JavaScript parse/restore roundtrip.
const decimals = { production_plans: ['quantity', 'fulfilled_quantity', 'actual_quantity'], production_plan_receipts: ['quantity'], product_prices: ['price'], items: ['price', 'minimum', 'weight_kg', 'package_size'], recipe_lines: ['quantity'], orders: ['total'], order_lines: ['quantity', 'reserved', 'shortage', 'future_reserved', 'product_package_size', 'unit_price', 'list_unit_price'], purchases: ['total'], purchase_lines: ['quantity', 'unit_price'], production_ingredients: ['quantity', 'waste_quantity'], movements: ['quantity'], movement_batches: ['quantity'], financial_movements: ['amount'] };
for (const [table, columns] of Object.entries(decimals)) for (const row of backup.raw_tables[table]) for (const column of columns) {
  if (['weight_kg','package_size','product_package_size','actual_quantity'].includes(column) && row[column] == null) continue;
  if (table === 'order_lines' && ['quantity','reserved','shortage','future_reserved'].includes(column) && Number.isSafeInteger(row[column])) row[column] = String(row[column]);
  if (typeof row[column] !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(row[column])) throw new Error(`Invalid decimal representation ${table}.${column}; use an unmodified v2 export`);
}
const literal = text => `'${text.replace(/'/g, "''")}'`;
const inserts = tables.map(name => `DO $import$ DECLARE source jsonb := ${literal(JSON.stringify(backup.raw_tables[name]))}::jsonb; cols text; BEGIN
  IF jsonb_array_length(source)>0 THEN
    SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum) INTO cols FROM pg_attribute a
    WHERE a.attrelid='public.${name}'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(source) row WHERE row ? a.attname);
    EXECUTE format('INSERT INTO public.${name} (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.${name},$1)',cols,cols) USING source;
  END IF; END $import$;`).join('\n');
const expectedStock = JSON.stringify(backup.data.stock.map(({item_id, location_id, on_hand}) => ({item_id, location_id, on_hand})));
const sql = `BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(742019630182::bigint);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.clients) OR EXISTS (SELECT FROM public.orders) OR EXISTS (SELECT FROM public.purchases)
    OR EXISTS (SELECT FROM public.productions) OR EXISTS (SELECT FROM public.recipes) OR EXISTS (SELECT FROM public.movements)
    OR EXISTS (SELECT FROM public.production_plans) OR EXISTS (SELECT FROM public.production_plan_receipts)
    OR EXISTS (SELECT FROM public.financial_movements) OR EXISTS (SELECT FROM public.audit_events)
    OR EXISTS (SELECT FROM public.pickup_closures)
    OR EXISTS (SELECT FROM public.app_members)
    OR EXISTS (SELECT FROM app_private.commands)
  THEN RAISE EXCEPTION 'Target not empty: restore refused'; END IF;
END $$;
-- Auth accounts/passwords are not part of a business-data backup. Original IDs
-- must already exist in this isolated recovery destination before restoring access.
DO $identity$ BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(${literal(JSON.stringify(backup.raw_tables.app_members))}::jsonb) m WHERE NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=(m->>'id')::uuid))
 THEN RAISE EXCEPTION 'Auth identity prerequisite missing: provision original Auth user IDs separately; passwords are never restored by this tool'; END IF;
END $identity$;
SET LOCAL session_replication_role = replica;
DELETE FROM public.product_prices;
DELETE FROM public.items;
DELETE FROM public.locations;
DELETE FROM public.workspace_events;
${inserts}
${hasPriceHistory ? '' : "INSERT INTO public.product_prices(product_id,price,effective_on) SELECT id,price,'0001-01-01' FROM public.items WHERE kind='product';"}
INSERT INTO app_private.commands SELECT * FROM jsonb_populate_recordset(NULL::app_private.commands, ${literal(JSON.stringify(backup.idempotency_commands))}::jsonb);
SET LOCAL session_replication_role = origin;
-- FK triggers were bypassed to avoid batch allocation twice. Verify all references.
DO $refs$ DECLARE c record; matches text; present text; broken boolean; BEGIN
  FOR c IN SELECT * FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'app_private'::regnamespace) LOOP
    SELECT string_agg(format('child.%I = parent.%I', ca.attname, pa.attname), ' AND '),
           string_agg(format('child.%I IS NOT NULL', ca.attname), ' AND ')
    INTO matches,present
    FROM unnest(c.conkey,c.confkey) AS k(child_key,parent_key)
    JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.child_key
    JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.parent_key;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s child WHERE %s AND NOT EXISTS (SELECT 1 FROM %s parent WHERE %s))', c.conrelid::regclass,present,c.confrelid::regclass,matches) INTO broken;
    IF broken THEN RAISE EXCEPTION 'Broken reference %; restore rolled back', c.conname; END IF;
  END LOOP;
END $refs$;
DO $verify$ DECLARE actual jsonb; expected jsonb; BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'location_id',location_id,'on_hand',on_hand::text) ORDER BY item_id,location_id),'[]'::jsonb) INTO actual FROM public.stock_balances;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'item_id',value->>'location_id'),'[]'::jsonb) INTO expected FROM jsonb_array_elements(${literal(expectedStock)}::jsonb);
  IF actual <> expected THEN RAISE EXCEPTION 'Physical stock reconciliation failed; transaction rolled back'; END IF;
  IF EXISTS (SELECT 1 FROM public.items i WHERE i.kind='product' AND NOT EXISTS (SELECT 1 FROM public.product_prices p WHERE p.product_id=i.id AND p.effective_on<=(now() at time zone 'America/Argentina/Mendoza')::date))
  THEN RAISE EXCEPTION 'Missing effective product price; restore rolled back'; END IF;
  -- Reservations are a date-sensitive projection, not historical balances. A valid
  -- old backup may now contain expired lots; never compare its stale assignments.
  -- Keep raw order_lines unchanged and verify today's canonical allocation view.
  IF EXISTS (SELECT 1 FROM public.stock_balances WHERE on_hand < 0 OR reserved < 0 OR shortage < 0 OR reserved > app_private.usable_balance(item_id,location_id))
  THEN RAISE EXCEPTION 'Invalid restored usable balance or reservation'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_allocations a
    JOIN public.order_lines l ON l.id=a.line_id JOIN public.orders o ON o.id=l.order_id
    WHERE a.reserved < 0 OR a.shortage < 0 OR a.future_reserved < 0
       OR (o.status='pendiente_entrega' AND o.deleted_at IS NULL AND a.reserved+a.future_reserved+a.shortage<>l.quantity)
       OR ((o.status<>'pendiente_entrega' OR o.deleted_at IS NOT NULL) AND (a.reserved<>0 OR a.future_reserved<>0 OR a.shortage<>0))
  ) THEN RAISE EXCEPTION 'Invalid restored line allocation'; END IF;
END $verify$;
COMMIT;
SELECT 'Restore committed: physical balances and historical prices preserved; reservations recalculated for current lot expiry';
`;
const psql = process.env.PSQL_BIN || (existsSync('/opt/homebrew/opt/postgresql@16/bin/psql') ? '/opt/homebrew/opt/postgresql@16/bin/psql' : 'psql');
const output = execFileSync(psql, ['--host', target.hostname.replace(/^\[|\]$/g, ''), '--port', target.port || '5432', '--username', decodeURIComponent(target.username), '--dbname', decodeURIComponent(target.pathname.slice(1)), '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password), PGCONNECT_TIMEOUT: '10' },
});
console.log(output.trim());

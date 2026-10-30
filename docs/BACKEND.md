# Supabase backend

## Current KALAK contract

Read [KALAK.md](KALAK.md) and [README](../README.md) first. Apply all migrations in order, including the managed Auth permission bridge `20261024152000_hosted_auth_bridge.sql`. `20261023180000_kalak_identity_sales.sql` replaces anonymous access with authenticated, assigned users, preserves historical data, adds kg quantities, price/packaging snapshots, per-person audit, immediate sales and shortage confirmation. `app_snapshot`, `app_command` and `app_export` require Auth; exports and catalog/inventory administration require admin. The publishable key alone cannot access business data.

Current isolated verification: `node scripts/test-kalak-backend.mjs`. No operational reset is needed. Orders use decimal string quantities in JSON, not integer-only counts. `stock.usable` excludes expired lots; `on_hand` is physical stock. `product_prices` records dated prices. Full-only new payments coexist with preserved historical partial receipts.

The details below document the original architecture and historical modules; current business rules in KALAK.md take precedence.


## Local use

Requires Node, Docker running, and npm dependencies installed. From the project root:

```sh
npx supabase start
npx supabase test db
# If Docker Desktop cannot bind-mount the test directory:
node scripts/test-api-db.mjs
node scripts/test-api.mjs
```

`supabase start` applies migrations on a new local database. After changing a migration during development, `npx supabase db reset --local` resets **all local data**. Do not use reset on a working business database. The only seeded business records are the four fixed locations; an internal singleton `workspace_events` row enables realtime invalidation. No sample business data is installed.

Obtain the local URL and anonymous key with `npx supabase status`. Configure the app's existing `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` environment variables. Use the anonymous key, never a service-role or secret key. Android emulator must use `http://10.0.2.2:54321` to reach the host; a physical device needs a reachable host LAN address. Local Supabase must be running while testing locally.

## Deploy to an existing project

Create/select a Supabase project yourself; this repository does not create cloud infrastructure. With the CLI logged in, run:

```sh
SUPABASE_PROJECT_REF=your_existing_project_ref bash scripts/deploy-supabase.sh
# Review the dry-run, then explicitly apply:
SUPABASE_PROJECT_REF=your_existing_project_ref bash scripts/deploy-supabase.sh --apply
```

Set the app's public URL and anonymous key to the existing hosted project's values and rebuild the app. Do not commit `.env` files. Configure Supabase Auth, bootstrap the first administrator and sign in with an assigned individual account; anonymous access is no longer permitted.

## Contract and transactional guarantees

The fixed contract is in `docs/CONTRACT.md` and `src/lib/types.ts`. Public entry points:

- `app_snapshot()` returns one MVCC-consistent JSON snapshot; arrays always exist. All money, ingredient quantities, stock, and movement decimals are JSON **strings**. Product/order counts and recipe yields are integer JSON numbers.
- `app_command(uuid, operation, payload, expected_version)` performs one atomic command. All domain writes acquire the same transaction advisory lock **before reads**, preventing cross-operation races. Database-generated IDs and timestamps are authoritative.
- Successful new commands increment the `workspace_events` singleton revision in the same transaction. This SELECT-only table is published through `supabase_realtime`; clients subscribe to updates and refetch the snapshot. Identical command retries emit no extra invalidation.
- Reuse the **same command UUID and payload/version** for retries. SHA-256 includes operation, normalized JSON payload and expected version. Identical retries return their original response before checking current versions. Reusing an ID with different content gives `IDEMPOTENCY_CONFLICT`.
- Every edit/transition requires the current entity `version`. Recipe saves require the latest revision, or `0` for a first recipe. Stale/missing versions give `VERSION_CONFLICT`. Creation, adjustments and transfers do not use entity versions.
- Reservations are recomputed atomically after commands, by pickup date, creation timestamp, order UUID and line UUID. Partial allocation is allowed. `allocation_version` increments when an order's reservation changes; it is separate from the user-edit version. `affected_order_ids` includes changed allocations and a directly edited order.
- Delivery consumes all lines exclusively from the chosen pickup outlet and requires complete reservation. Transfers can move finished goods only and cannot move reserved units. Negative adjustments can consume reserved stock but cannot make physical stock negative; reservations are then reallocated.
- Ingredients live only in Cocina. Purchases accept g/kg and ml/l conversion into catalog units. Supplier is optional and normalizes to an empty string. Unit price means price per **entered purchase unit**. Different dimensions and unidad conversions are rejected. Converted purchase/recipe quantities must be exactly representable to 6 catalog-unit decimal places; finer conversions are rejected, never silently rounded. The catalog unit cannot change after a movement, recipe use **or purchase-line use**, protecting history and pending receipts.
- Recipes are immutable revisions. Planned production points at one immutable revision. Starting consumes target/yield-scaled ingredients once; finalizing adds actual finished products once to Cocina. Cancellation does not restore already consumed ingredients. Actual yield does not retroactively change ingredient consumption.
- Quantities, ingredient reference prices and purchase unit costs support up to 6 decimal places, 18 integer digits. Product catalog prices allow at most 2 decimal places (extra precision is rejected). Purchase document totals are rounded once to 2 decimals after summing exact quantity × unit-cost lines; order totals naturally remain in cents because product counts are integers. Production requirements round to 6 catalog-unit decimal places; requirements rounding to zero are rejected. Finished products are positive integer counts; adjustments accept signed integer deltas for products.
- Retained order product lines keep their original unit prices after edits; newly introduced lines snapshot the then-current catalog price. Arbitrary order prices are rejected. Recipe and purchase history are also retained.
- Reports must group orders by `pickup_date`, not `delivered_at`/creation time. Payment method is descriptive; it is not a paid/unpaid ledger.

## Access model

This is explicitly a public, no-login workspace. Anyone possessing/reaching the project endpoint can read all business data and invoke validated commands. The public anonymous key is not a password. There are intentionally no hidden user sessions or owner-only branches.

Business tables have SELECT-only grants plus read RLS policies for `anon` and `authenticated`; all direct writes are denied. Only `app_command` and `app_snapshot` are exposed as security-definer functions with a fixed trusted search path. They run as a restricted no-login, non-superuser role with operation-specific table grants, not as postgres; no API role can create objects in public. Internal helpers and the payload/hash command log are in a non-exposed schema with revoked schema/function privileges. The ledger and recipe tables also reject UPDATE/DELETE through immutable triggers. Service-role credentials must never be included in the app.

Validation errors contain `VALIDATION_ERROR`, `INSUFFICIENT_STOCK`, `INSUFFICIENT_RESERVED_STOCK`, `INVALID_TRANSITION`, `VERSION_CONFLICT` or `IDEMPOTENCY_CONFLICT`. A failed command rolls back every domain write and its command-log entry.

## Verification

`supabase/tests/database/backend.test.sql` runs pgTAP in a rolled-back transaction: seeded locations, role grants, internal access restrictions, unit conversion, numeric validation, exact retry behavior and price-payload restrictions.

`scripts/test-api.mjs` uses separate local HTTP requests for true multi-connection competition. It covers repeated purchase receipt, competing production starts, immutable recipe snapshots, exactly-once completion, partial nearest-pickup reservations, loss reallocation, free-stock transfer rules, double delivery, outlet edits, cancellation reallocation, pickup-date reporting, historical prices, optimistic/idempotency conflicts, forced rollback after partial ingredient work, anonymous write denial, and live anonymous websocket invalidation between clients. It refuses non-local URLs, creates UUID-isolated fixtures, and removes only its own fixture entities and command IDs in `finally`. Cleanup uses a privileged, local-only transaction to remove otherwise immutable fixture history. Existing business rows are not reset. A final count check verifies cleanup.

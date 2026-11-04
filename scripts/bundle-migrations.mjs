#!/usr/bin/env node
// Builds two files from supabase/migrations/*.sql (filename order):
// - supabase/all_migrations.sql: paste into the Supabase SQL Editor and run.
//   Each migration records itself in private.applied_migrations, so every run
//   applies only the ones that are new, and any error rolls the whole run back.
// - supabase/migration_status.sql: a read-only query showing, migration by
//   migration, whether its marker object (below) exists in a database.
// Run `npm run db:bundle` after adding a migration; --check fails (e.g. in CI)
// when either file is out of date.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// One object each migration creates, used to tell whether it is in a database.
// Every new migration needs an entry; pick something it creates and nothing
// earlier does.
const MARKERS = {
  '0001': ['table', 'profiles'],
  '0002': ['column', 'profiles.handle'],
  '0003': ['function', 'generate_referral_code'],
  '0004': ['column', 'profiles.last_seen_at'],
  '0005': ['column', 'profiles.business_logo_url'],
  '0006': ['column', 'conversations.seller_last_read_at'],
  '0007': ['column', 'profiles.buyer_avg_rating'],
  '0008': ['column', 'offers.delivery_speed'],
  '0009': ['realtime', 'verification_requests'],
  '0010': ['column', 'messages.is_read'],
  '0011': ['column', 'offers.delivery_type'],
  '0012': ['column', 'offers.variants'],
  '0013': ['column', 'listings.services_included'],
  '0014': ['table', 'notifications'],
  '0016': ['function', 'record_payment_as_pending'],
  '0017': ['table', 'message_attachments'],
  '0018': ['function', 'notify_order_confirmed'],
  '0019': ['bucket', 'message-attachments'],
  '0020': ['table', 'disputes'],
  '0021': ['function', 'get_admin_dashboard'],
  '0022': ['function', 'mark_profile_as_seller_on_listing'],
  '0023': ['column', 'notifications.related_dispute_id'],
  '0024': ['policy', 'Admins can insert marketing notifications'],
  '0025': ['function', 'mark_conversation_read'],
  '0026': ['function', 'share_offer_delivery_address'],
  '0027': ['column', 'profiles.paystack_recipient_code'],
  '0028': ['table', 'profile_contacts'],
  '0029': ['table', 'transaction_references'],
  '0030': ['column', 'transaction_references.original_reference'],
  '0031': ['constraint', 'transaction_references_reference_format'],
  '0032': ['constraint', 'listings_price_valid'],
  '0033': ['column', 'profiles.payout_connected'],
  '0034': ['table', 'admin_audit_log'],
  '0035': ['function', 'consume_rate_limit'],
  '0036': ['policy_with_check', 'Users update own avatars'],
  '0037': ['function', 'chat_contact_violation'],
}
// Migrations with nothing unique to check. They are safe to run again, so on a
// database without history they simply run.
const NO_MARKER = new Set(['0015'])

// The live database was built by pasting 0001-0027 into the SQL Editor before
// history was tracked, and some of those never fully applied. On a database
// with the schema but no history, each of them is recorded as applied only if
// its marker exists; the rest run in their normal place in the order.
const LEGACY_LAST = '0027'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const bundlePath = join(root, 'supabase', 'all_migrations.sql')
const statusPath = join(root, 'supabase', 'migration_status.sql')

function fail(message) {
  console.error(message)
  process.exit(1)
}

const files = readdirSync(migrationsDir).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()
const numbers = files.map((name) => name.slice(0, 4))
const duplicate = numbers.find((n, i) => numbers.indexOf(n) !== i)
if (duplicate) fail(`Two migrations share number ${duplicate}; renumber one so the order is unambiguous.`)
const unmarked = numbers.filter((n) => !MARKERS[n] && !NO_MARKER.has(n))
if (unmarked.length) fail(`Add a MARKERS entry in scripts/bundle-migrations.mjs for migration ${unmarked.join(', ')}.`)

const quote = (text) => `'${text.replaceAll("'", "''")}'`

// SQL that is true when the marker object exists.
function markerSql([kind, name]) {
  switch (kind) {
    case 'table':
      return `to_regclass(${quote(`public.${name}`)}) is not null`
    case 'column': {
      const [table, column] = name.split('.')
      return `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = ${quote(table)} and column_name = ${quote(column)})`
    }
    case 'function':
      return `exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ${quote(name)})`
    case 'constraint':
      return `exists (select 1 from pg_constraint where conname = ${quote(name)})`
    case 'policy':
      return `exists (select 1 from pg_policies where policyname = ${quote(name)})`
    case 'policy_with_check':
      return `exists (select 1 from pg_policies where policyname = ${quote(name)} and with_check is not null)`
    case 'realtime':
      return `exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = ${quote(name)})`
    case 'bucket':
      return `exists (select 1 from storage.buckets where id = ${quote(name)})`
    default:
      return fail(`Unknown marker kind "${kind}".`)
  }
}

const sections = files.map((name) => {
  const sql = readFileSync(join(migrationsDir, name), 'utf8').trimEnd()
  const tag = `$m${name.slice(0, 4)}$`
  if (sql.includes(tag) || sql.includes('$bundle$')) fail(`${name} contains ${tag} or $bundle$; rename that dollar-quote tag.`)
  if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) fail(`${name} manages its own transaction; remove begin/commit, the bundle runs in one.`)

  return `-- >>> ${name}
do $bundle$
begin
  if exists (select 1 from private.applied_migrations where name = ${quote(name)}) then
    return;
  end if;
  execute ${tag}
${sql}
${tag};
  insert into private.applied_migrations (name) values (${quote(name)});
  raise notice 'Applied %', ${quote(name)};
exception when others then
  raise exception 'Migration % failed: %', ${quote(name)}, sqlerrm;
end
$bundle$;
`
})

const legacy = files.filter((name) => name.slice(0, 4) <= LEGACY_LAST && MARKERS[name.slice(0, 4)])

const bundle = `-- GENERATED by \`npm run db:bundle\` from supabase/migrations. Do not edit by hand:
-- add the next numbered file there and re-run the script, which appends it here.
-- Paste into the Supabase SQL Editor and run. Already-applied migrations are
-- skipped, so it is safe to run again; any error rolls the whole run back.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.applied_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- Existing database built before history was tracked: record the early
-- migrations whose marker objects exist. Missing ones run below, in order.
do $bundle$
declare
  v_recorded integer;
begin
  if to_regclass('public.profiles') is not null
     and not exists (select 1 from private.applied_migrations) then
    insert into private.applied_migrations (name)
    select legacy.name from (values
${legacy.map((name) => `      (${quote(name)}, ${markerSql(MARKERS[name.slice(0, 4)])})`).join(',\n')}
    ) as legacy(name, present)
    where legacy.present;
    get diagnostics v_recorded = row_count;
    raise notice 'Recorded % of % early migrations as already applied', v_recorded, ${legacy.length};
  end if;
end
$bundle$;

${sections.join('\n')}
commit;
`

const status = `-- GENERATED by \`npm run db:bundle\`. Read-only: run it in the Supabase SQL
-- Editor to see which migrations a database has. Each row checks one object the
-- migration creates; "applied" is true when it exists.${[...NO_MARKER].length ? `
-- Not listed (nothing unique to check, safe to re-run): ${[...NO_MARKER].join(', ')}.` : ''}
select m.migration, m.checks_for, m.applied
from (values
${files.filter((name) => MARKERS[name.slice(0, 4)]).map((name) => {
  const marker = MARKERS[name.slice(0, 4)]
  return `  (${quote(name.slice(0, 4))}, ${quote(`${marker[0]} ${marker[1]}`)}, ${markerSql(marker)})`
}).join(',\n')}
) as m(migration, checks_for, applied)
order by m.migration;
`

if (process.argv.includes('--check')) {
  const stale = [[bundlePath, bundle], [statusPath, status]]
    .filter(([path, content]) => (existsSync(path) ? readFileSync(path, 'utf8') : '') !== content)
  if (stale.length) fail('supabase/all_migrations.sql or migration_status.sql is out of date. Run `npm run db:bundle`.')
  console.log(`all_migrations.sql and migration_status.sql are up to date (${files.length} migrations).`)
} else {
  writeFileSync(bundlePath, bundle)
  writeFileSync(statusPath, status)
  console.log(`Wrote supabase/all_migrations.sql (${files.length} migrations, ${files[0]} … ${files.at(-1)}) and supabase/migration_status.sql.`)
}

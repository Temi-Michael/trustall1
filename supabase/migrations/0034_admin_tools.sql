-- Admin tooling: an audit log of every admin change, atomic verification and
-- warning actions, listing approval enforced by the database, and user search
-- and detail lookups for the admin dashboard.

-- ---------------------------------------------------------------------------
-- 1. Audit log: written by triggers whenever an admin changes a watched table.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_created on public.admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_log_record on public.admin_audit_log (table_name, record_id);

-- Read-only for admins; rows are only ever added by the trigger below.
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
drop policy if exists "Admins read the audit log" on public.admin_audit_log;
create policy "Admins read the audit log" on public.admin_audit_log for select using (public.is_admin());

create or replace function public.log_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_noise text[] := array['updated_at', 'last_seen_at', 'id_number_encrypted'];
  v_changes jsonb;
begin
  if not public.is_admin() then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value))
      into v_changes
    from jsonb_each(v_new)
    where key <> all (v_noise) and (v_old -> key) is distinct from value;
    if v_changes is null then
      return new;
    end if;
  else
    v_changes := coalesce(v_new, v_old) - v_noise;
  end if;

  insert into public.admin_audit_log (actor_id, action, table_name, record_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(v_new, v_old) ->> 'id', v_changes);
  return coalesce(new, old);
end;
$$;

revoke execute on function public.log_admin_change() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'verification_requests', 'listings', 'orders', 'disputes', 'reports',
    'account_warnings', 'promotions', 'payout_transfers', 'blog_posts', 'transaction_references'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists trg_audit_admin_change on public.%I', v_table);
      execute format(
        'create trigger trg_audit_admin_change after insert or update or delete on public.%I
           for each row execute function public.log_admin_change()', v_table);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Seller verification: one atomic review action, with a reason on rejection.
-- ---------------------------------------------------------------------------
alter table public.verification_requests
  add column if not exists rejection_reason text,
  add column if not exists document_deleted_at timestamptz;

create or replace function public.admin_review_verification(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.verification_requests%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can review verification requests' using errcode = '42501';
  end if;

  select * into v_request from public.verification_requests where id = p_request_id for update;
  if v_request.id is null then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'This request has already been reviewed');
  end if;
  if not p_approve and v_reason is null then
    return jsonb_build_object('success', false, 'error', 'Give a reason so the seller knows what to fix');
  end if;

  update public.verification_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = case when p_approve then null else left(v_reason, 500) end
  where id = p_request_id;

  if p_approve then
    update public.profiles
    set verified_seller = true,
        seller_level = greatest(coalesce(seller_level, 0), 1)
    where id = v_request.seller_id;
  end if;

  return jsonb_build_object('success', true, 'document_path', v_request.document_url);
end;
$$;

revoke execute on function public.admin_review_verification(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_verification(uuid, boolean, text) to authenticated;

-- Rejected ID documents are deleted from storage by the admin dashboard.
drop policy if exists "Admins delete verification docs" on storage.objects;
create policy "Admins delete verification docs" on storage.objects
  for delete using (bucket_id = 'verification-docs' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Warnings: record the warning, bump the count and resolve the report together.
-- ---------------------------------------------------------------------------
create or replace function public.admin_issue_warning(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports%rowtype;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can issue warnings' using errcode = '42501';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if v_report.id is null then
    return jsonb_build_object('success', false, 'error', 'Report not found');
  end if;
  if v_report.status not in ('open', 'reviewing') then
    return jsonb_build_object('success', false, 'error', 'This report is already closed');
  end if;

  insert into public.account_warnings (profile_id, reason, issued_by)
  values (
    v_report.reported_id,
    v_report.reason || coalesce(' — ' || nullif(v_report.details, ''), ''),
    auth.uid()
  );

  update public.profiles
  set warning_count = coalesce(warning_count, 0) + 1,
      status = case when coalesce(warning_count, 0) + 1 >= 3 then 'suspended' else 'warned' end
  where id = v_report.reported_id
  returning warning_count into v_count;

  update public.reports set status = 'resolved' where id = p_report_id;

  return jsonb_build_object('success', true, 'warning_count', v_count, 'suspended', v_count >= 3);
end;
$$;

revoke execute on function public.admin_issue_warning(uuid) from public, anon;
grant execute on function public.admin_issue_warning(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Listings: only admins can publish, reject or restore a removed listing.
-- ---------------------------------------------------------------------------
-- Uses jsonb so it works whether or not the live-only moderation columns exist.
create or replace function public.guard_listing_moderation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_status text := v_new ->> 'status';
  v_status_changed boolean := tg_op = 'INSERT' or v_status is distinct from (v_old ->> 'status');
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new;
  end if;

  -- Sellers may clear an old rejection note when resubmitting, but never set one,
  -- and never touch the removal record.
  if (v_new ->> 'moderation_reason') is not null
     and (v_new -> 'moderation_reason') is distinct from (v_old -> 'moderation_reason') then
    raise exception 'Only admins can set moderation notes' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(array['removed_reason', 'removed_by', 'removed_at']) as k
    where (v_new -> k) is distinct from coalesce(v_old -> k, case when v_new ? k then 'null'::jsonb end)
  ) then
    raise exception 'Only admins can change removal details' using errcode = '42501';
  end if;

  if v_new ? 'status' then
    if v_status_changed and coalesce(v_status, '') not in ('draft', 'pending_review') then
      raise exception 'Listings can only be published by Trustall after review' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.is_active := false;
    elsif new.is_active and not old.is_active and v_status is not null and v_status <> 'published' then
      raise exception 'This listing goes live once it has been approved' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.is_active and not old.is_active and (v_old ->> 'removed_by') is not null then
    raise exception 'This listing was removed by Trustall and can only be restored by an admin' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_listing_moderation on public.listings;
create trigger trg_guard_listing_moderation
  before insert or update on public.listings
  for each row execute function public.guard_listing_moderation();

-- ---------------------------------------------------------------------------
-- 5. Admin user directory: search and full details, including email.
-- ---------------------------------------------------------------------------
create or replace function public.admin_search_users(
  p_query text default '',
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, full_name text, business_name text, handle text, email text,
  is_seller boolean, verified_seller boolean, status text, role text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Escape LIKE wildcards so the search text matches literally.
  v_pattern text := '%' || replace(replace(replace(coalesce(trim(p_query), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not public.is_admin() then
    raise exception 'Only admins can search users' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name::text, p.business_name::text, p.handle::text, u.email::text,
         coalesce(p.is_seller, false), coalesce(p.verified_seller, false), p.status::text, p.role::text, p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where (p_filter = 'all'
         or (p_filter = 'sellers' and coalesce(p.is_seller, false))
         or (p_filter = 'buyers' and not coalesce(p.is_seller, false))
         or (p_filter = 'suspended' and p.status::text = 'suspended'))
    and (coalesce(trim(p_query), '') = ''
         or p.full_name ilike v_pattern or p.business_name ilike v_pattern
         or p.handle ilike v_pattern or u.email ilike v_pattern
         or p.id::text = trim(p_query))
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_search_users(text, text, integer, integer) from public, anon;
grant execute on function public.admin_search_users(text, text, integer, integer) to authenticated;

create or replace function public.admin_get_user_details(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view user details' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'profile', to_jsonb(p),
    'account', jsonb_build_object(
      'email', u.email,
      'email_confirmed_at', u.email_confirmed_at,
      'last_sign_in_at', u.last_sign_in_at,
      'signed_up_at', u.created_at
    ),
    'phone', (select c.phone from public.profile_contacts c where c.id = p.id),
    'listings', jsonb_build_object(
      'total', (select count(*) from public.listings l where l.seller_id = p.id),
      'live', (select count(*) from public.listings l where l.seller_id = p.id and l.is_active)
    ),
    'orders', jsonb_build_object(
      'as_buyer', (select count(*) from public.orders o where o.buyer_id = p.id),
      'as_seller', (select count(*) from public.orders o where o.seller_id = p.id),
      'seller_payouts_confirmed', (select coalesce(sum(o.seller_payout), 0) from public.orders o
                                   where o.seller_id = p.id and o.status in ('confirmed', 'complete'))
    ),
    'verification', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'status', v.status, 'id_type', v.id_type, 'id_number_last4', v.id_number_last4,
        'submitted_at', v.created_at, 'reviewed_at', v.reviewed_at, 'rejection_reason', v.rejection_reason,
        'document_deleted', v.document_deleted_at is not null
      ) order by v.created_at desc)
      from public.verification_requests v where v.seller_id = p.id
    ), '[]'::jsonb),
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object('reason', w.reason, 'issued_at', w.created_at) order by w.created_at desc)
      from public.account_warnings w where w.profile_id = p.id
    ), '[]'::jsonb),
    'reports_against', (select count(*) from public.reports r where r.reported_id = p.id),
    'open_reports_against', (select count(*) from public.reports r where r.reported_id = p.id and r.status in ('open', 'reviewing'))
  )
  into v_result
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user_id;

  return v_result;
end;
$$;

revoke execute on function public.admin_get_user_details(uuid) from public, anon;
grant execute on function public.admin_get_user_details(uuid) to authenticated;

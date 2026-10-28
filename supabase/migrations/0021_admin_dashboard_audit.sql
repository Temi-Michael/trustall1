-- Admin dashboard access and bounded analytics.

alter table public.notifications
  add column if not exists delivery_status jsonb not null default '{}'::jsonb;

alter table public.notifications enable row level security;
drop policy if exists "Users view own notifications" on public.notifications;
create policy "Users view own notifications" on public.notifications
  for select using (recipient_id = auth.uid() or public.is_admin());
drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications
  for update using (recipient_id = auth.uid() or public.is_admin())
  with check (recipient_id = auth.uid() or public.is_admin());

create or replace function public.get_admin_dashboard(p_since timestamptz, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'profiles', coalesce((select jsonb_agg(to_jsonb(p)) from (
      select id, created_at, is_seller, verified_seller, pro_vendor, pro_buyer, status
      from public.profiles where created_at >= p_since order by created_at desc limit 1000
    ) p), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(to_jsonb(l)) from (
      select id, category, is_active, created_at from public.listings
      where created_at >= p_since order by created_at desc limit 1000
    ) l), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o)) from (
      select id, amount, delivery_fee, seller_fee, buyer_fee, seller_payout, status,
        dispute_status, escrow_release_at, released_at, created_at
      from public.orders where created_at >= p_since order by created_at desc limit 1000
    ) o), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(to_jsonb(d)) from (
      select id, status, created_at, resolved_at, order_id from public.disputes
      order by created_at desc limit v_limit
    ) d), '[]'::jsonb),
    'referrals', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select id, referrer_id, amount, status, created_at from public.referral_bonuses
      where created_at >= p_since order by created_at desc limit 1000
    ) r), '[]'::jsonb),
    'verification', coalesce((select jsonb_agg(to_jsonb(v)) from (
      select id, status, created_at, reviewed_at from public.verification_requests
      where created_at >= p_since order by created_at desc limit 1000
    ) v), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, reason, status, reported_id, order_id, created_at from public.reports
      order by created_at desc limit v_limit
    ) x), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(to_jsonb(w)) from (
      select id, profile_id, created_at from public.account_warnings
      where created_at >= p_since order by created_at desc limit 1000
    ) w), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from (
      select id, is_email_sent, is_push_sent, delivery_status, created_at
      from public.notifications where created_at >= p_since order by created_at desc limit 1000
    ) n), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_dashboard(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(timestamptz, integer) to authenticated;
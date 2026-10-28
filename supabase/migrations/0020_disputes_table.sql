-- The disputes table was created outside migrations, but 0021 and 0023 depend
-- on it. This recreates it from how the app uses it, so a fresh database can be
-- built from migrations alone. On a database that already has disputes it does
-- nothing, so live columns and policies are left untouched.
do $$
begin
  if to_regclass('public.disputes') is not null then
    return;
  end if;

  create table public.disputes (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    filed_by uuid not null references public.profiles(id) on delete cascade,
    reason text not null,
    status text not null default 'open',
    assigned_judge_id uuid references public.profiles(id) on delete set null,
    resolution text,
    resolved_at timestamptz,
    created_at timestamptz not null default now()
  );

  create index idx_disputes_order on public.disputes (order_id);

  alter table public.disputes enable row level security;

  create policy "Parties, judge and admins view disputes" on public.disputes
    for select using (
      filed_by = auth.uid()
      or assigned_judge_id = auth.uid()
      or public.is_admin()
      or exists (
        select 1 from public.orders o
        where o.id = disputes.order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
      )
    );

  create policy "Order parties file disputes" on public.disputes
    for insert with check (
      filed_by = auth.uid()
      and status = 'open'
      and exists (
        select 1 from public.orders o
        where o.id = disputes.order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
      )
    );

  create policy "Judge and admins update disputes" on public.disputes
    for update using (assigned_judge_id = auth.uid() or public.is_admin())
    with check (assigned_judge_id = auth.uid() or public.is_admin());
end $$;

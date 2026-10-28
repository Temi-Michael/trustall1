alter table public.profiles
  add column if not exists paystack_recipient_code text;
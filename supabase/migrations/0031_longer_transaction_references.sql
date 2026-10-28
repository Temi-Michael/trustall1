-- Transaction references get a 12-character suffix that always contains at
-- least one letter and one digit, e.g. TRUST-PAY-YBENA62B67JS.

create or replace function private.random_reference_suffix()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  -- 32 symbols without 0/O/1/I, so one random byte & 31 maps to a symbol without bias.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_suffix text;
begin
  -- About 3% of draws lack a digit (or, very rarely, a letter); redrawing keeps
  -- the result uniform over the suffixes that have both.
  loop
    v_bytes := gen_random_bytes(12);
    v_suffix := '';
    for i in 0..11 loop
      v_suffix := v_suffix || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
    end loop;
    exit when v_suffix ~ '[2-9]' and v_suffix ~ '[A-Z]';
  end loop;
  return v_suffix;
end;
$$;

-- NOT VALID: enforced for new references only, so any 8-character references
-- already issued stay valid.
alter table public.transaction_references drop constraint if exists transaction_references_reference_check;
alter table public.transaction_references drop constraint if exists transaction_references_reference_format;
alter table public.transaction_references add constraint transaction_references_reference_format
  check (
    reference ~ '^TRUST-[A-Z]{3}-[A-HJ-NP-Z2-9]{12}$'
    and split_part(reference, '-', 3) ~ '[2-9]'
    and split_part(reference, '-', 3) ~ '[A-Z]'
  ) not valid;

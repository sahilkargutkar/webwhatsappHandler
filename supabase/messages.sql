-- Create table to log WhatsApp messages
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  kind text not null, -- incoming | status | reply
  "from" text null,
  "to" text null,
  type text null, -- text | interactive | others
  body text null,
  message_id text null,
  reply_to_message_id text null,
  status text null,
  timestamp text null,
  interactive_selection jsonb null,
  raw jsonb null,
  created_at timestamptz not null default now()
);

-- Helpful index for querying latest per sender
create index if not exists messages_from_created_at_idx on public.messages ("from", created_at desc);

-- Contacts table to track per-phone aggregates
create table if not exists public.contacts (
  id bigint generated always as identity primary key,
  phone text unique not null,
  last_message_id text null,
  last_body text null,
  last_type text null,
  last_kind text null,
  last_direction text null, -- incoming | reply
  last_timestamp timestamptz null,
  total_messages int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists contacts_phone_idx on public.contacts (phone);

-- RLS setup (optional, enable if using auth)
-- alter table public.messages enable row level security;
-- create policy "Allow all inserts from service role" on public.messages for insert to public using (true) with check (true);

-- If you plan to insert from server with service key, RLS can remain disabled
-- Create table to log WhatsApp messages
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  kind text not null, -- incoming | status | reply
  from text null,
  to text null,
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

-- RLS setup (optional, enable if using auth)
-- alter table public.messages enable row level security;
-- create policy "Allow all inserts from service role" on public.messages for insert to public using (true) with check (true);

-- If you plan to insert from server with service key, RLS can remain disabled
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
  phone text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null
);

-- Helpful index for querying latest per sender
create index if not exists messages_from_created_at_idx on public.messages ("from", created_at desc);

-- Contacts table to track per-phone aggregates
create table if not exists public.contacts (
  id bigint generated always as identity primary key,
  phone text unique not null,
  name text null,
  last_message_id text null,
  last_body text null,
  last_type text null,
  last_kind text null,
  last_direction text null, -- incoming | reply
  last_sender_id text null, -- whatsapp sender id (from)
  last_recipient_phone text null, -- phone we sent reply to
  last_timestamp timestamptz null,
  total_messages int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists contacts_phone_idx on public.contacts (phone);


ALTER TABLE public.messages 
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone text;

-- Create index on message_id for fast status lookups
CREATE INDEX IF NOT EXISTS messages_message_id_idx ON public.messages (message_id);

-- RLS setup (optional, enable if using auth)
-- alter table public.messages enable row level security;
-- create policy "Allow all inserts from service role" on public.messages for insert to public using (true) with check (true);

-- If you plan to insert from server with service key, RLS can remain disabled
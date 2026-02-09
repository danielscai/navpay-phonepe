-- Invite codes + multi-level commissions (V1)
-- Notes:
-- - SQLite: use TEXT for money values (same as existing schema).
-- - Invite codes are 6 chars [A-Z0-9]. We backfill deterministically from UUID-based id.

-- 1) Payment persons: invite + immutable upline pointer
alter table payment_persons add column invite_code text;
alter table payment_persons add column inviter_person_id text;

-- Backfill invite_code for existing rows (UUID-derived, unique, alnum).
-- Example id: pp_550e8400-e29b-41d4-a716-446655440000
-- Take first 6 hex chars from UUID part.
update payment_persons
set invite_code = upper(substr(replace(replace(id, 'pp_', ''), '-', ''), 1, 6))
where invite_code is null or invite_code = '';

create unique index if not exists payment_persons_invite_code_ux on payment_persons(invite_code);
create index if not exists payment_persons_inviter_idx on payment_persons(inviter_person_id);

-- 2) Orders: channel fee + success timestamp (for "today" stats)
alter table collect_orders add column channel_fee text not null default '0.00';
alter table collect_orders add column success_at_ms integer;
create index if not exists collect_orders_success_idx on collect_orders(status, success_at_ms);
create index if not exists collect_orders_assigned_success_idx on collect_orders(assigned_payment_person_id, status, success_at_ms);

alter table payout_orders add column channel_fee text not null default '0.00';
alter table payout_orders add column success_at_ms integer;
create index if not exists payout_orders_success_idx on payout_orders(status, success_at_ms);
create index if not exists payout_orders_locked_success_idx on payout_orders(locked_payment_person_id, status, success_at_ms);

-- 3) Commission logs: fee + rebates (idempotent per order)
create table if not exists payment_person_commission_logs (
  id text primary key,
  person_id text not null,
  kind text not null, -- fee_collect | fee_payout | rebate_l1 | rebate_l2 | rebate_l3
  amount text not null,
  order_type text not null, -- collect | payout
  order_id text not null,
  source_person_id text, -- whose activity generated this commission (e.g. downline)
  created_at_ms integer not null default (unixepoch() * 1000)
);

create unique index if not exists payment_person_commission_logs_ux
  on payment_person_commission_logs(person_id, kind, order_type, order_id);
create index if not exists payment_person_commission_logs_person_idx
  on payment_person_commission_logs(person_id, created_at_ms);
create index if not exists payment_person_commission_logs_order_idx
  on payment_person_commission_logs(order_type, order_id);


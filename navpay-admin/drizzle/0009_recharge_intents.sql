-- Recharge intents: merchant creates a recharge order first, then chain events confirm it.

CREATE TABLE `recharge_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL,
  `merchant_order_no` text NOT NULL,
  `chain` text NOT NULL, -- tron | bsc
  `asset` text NOT NULL DEFAULT 'USDT',
  `address` text NOT NULL,
  `expected_amount` text NOT NULL,
  `status` text NOT NULL DEFAULT 'CREATED', -- CREATED | CONFIRMING | SUCCESS | FAILED | EXPIRED
  `expires_at_ms` integer NOT NULL,

  -- Populated after a "chain event" is observed (or simulated)
  `tx_hash` text,
  `from_address` text,
  `to_address` text,
  `block_number` integer,
  `confirmations` integer NOT NULL DEFAULT 0,
  `confirmations_required` integer NOT NULL DEFAULT 15,
  `credited_at_ms` integer,

  `created_at_ms` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at_ms` integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX `recharge_intents_merchant_idx` ON `recharge_intents` (`merchant_id`);
CREATE INDEX `recharge_intents_status_idx` ON `recharge_intents` (`status`);
CREATE INDEX `recharge_intents_created_idx` ON `recharge_intents` (`created_at_ms`);
CREATE UNIQUE INDEX `recharge_intents_chain_tx_ux` ON `recharge_intents` (`chain`, `tx_hash`);
CREATE UNIQUE INDEX `recharge_intents_chain_address_active_ux` ON `recharge_intents` (`chain`, `address`, `status`);


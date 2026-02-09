-- Recharge (crypto deposit) orders + merchant deposit address allocation.

ALTER TABLE `merchants` ADD COLUMN `deposit_index_tron` integer;
ALTER TABLE `merchants` ADD COLUMN `deposit_index_bsc` integer;

CREATE TABLE `merchant_deposit_addresses` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL,
  `chain` text NOT NULL, -- tron | bsc
  `addr_index` integer NOT NULL,
  `address` text NOT NULL,
  `created_at_ms` integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX `merchant_deposit_addresses_merchant_chain_ux` ON `merchant_deposit_addresses` (`merchant_id`, `chain`);
CREATE UNIQUE INDEX `merchant_deposit_addresses_chain_address_ux` ON `merchant_deposit_addresses` (`chain`, `address`);
CREATE INDEX `merchant_deposit_addresses_chain_idx` ON `merchant_deposit_addresses` (`chain`);

CREATE TABLE `recharge_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `merchant_id` text NOT NULL,
  `chain` text NOT NULL, -- tron | bsc
  `asset` text NOT NULL DEFAULT 'USDT',
  `address` text NOT NULL,
  `tx_hash` text NOT NULL,
  `from_address` text,
  `to_address` text,
  `amount` text NOT NULL,
  `status` text NOT NULL DEFAULT 'CONFIRMING', -- CONFIRMING | SUCCESS | FAILED
  `block_number` integer,
  `confirmations` integer NOT NULL DEFAULT 0,
  `confirmations_required` integer NOT NULL DEFAULT 15,
  `credited_at_ms` integer,
  `created_at_ms` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at_ms` integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX `recharge_orders_chain_tx_ux` ON `recharge_orders` (`chain`, `tx_hash`);
CREATE INDEX `recharge_orders_merchant_idx` ON `recharge_orders` (`merchant_id`);
CREATE INDEX `recharge_orders_status_idx` ON `recharge_orders` (`status`);
CREATE INDEX `recharge_orders_created_idx` ON `recharge_orders` (`created_at_ms`);


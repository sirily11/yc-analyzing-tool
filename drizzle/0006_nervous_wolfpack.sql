ALTER TABLE `credit_reservations` ADD `close_requested_success` integer;--> statement-breakpoint
ALTER TABLE `credit_reservations` ADD `close_requested_report_fee` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_reservations` ADD `close_requested_at` integer;
CREATE TABLE `chat_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`metadata` text NOT NULL,
	`object_key` text NOT NULL,
	`extracted_object_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_documents_object_key_unique` ON `chat_documents` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_documents_extracted_object_key_unique` ON `chat_documents` (`extracted_object_key`);--> statement-breakpoint
CREATE INDEX `chat_documents_chat_status_idx` ON `chat_documents` (`chat_id`,`status`);
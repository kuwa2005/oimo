CREATE TABLE `evolution` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`workspace_fingerprint` text,
	`repository_ids` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`artifact_ids` text NOT NULL,
	`consent` text,
	`baseline` text,
	`result` text,
	`title` text,
	`routing` text,
	`brief_path` text,
	`brief_content_hash` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evolution_project_updated_idx` ON `evolution` (`project_id`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `evolution_status_idx` ON `evolution` (`status`);
--> statement-breakpoint
CREATE TABLE `evolution_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`evolution_id` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`detail` text,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evolution_audit_evolution_idx` ON `evolution_audit` (`evolution_id`,`time_created`);
--> statement-breakpoint
CREATE INDEX `evolution_audit_project_idx` ON `evolution_audit` (`project_id`,`time_created`);

CREATE TABLE `autonomy_run` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_fingerprint` text,
	`repository_ids` text NOT NULL,
	`changeset_id` text,
	`profile` text NOT NULL,
	`learning_lenses` text NOT NULL,
	`phase` text NOT NULL,
	`revision` integer NOT NULL,
	`user_request` text NOT NULL,
	`locked_scope` text,
	`active_gate_id` text,
	`evidence_manifest_id` text,
	`budgets` text NOT NULL,
	`counters` text NOT NULL,
	`stop_reason` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autonomy_run_session_idx` ON `autonomy_run` (`session_id`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `autonomy_run_project_idx` ON `autonomy_run` (`project_id`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `autonomy_run_phase_idx` ON `autonomy_run` (`phase`);
--> statement-breakpoint
CREATE TABLE `autonomy_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`proposal_hash` text NOT NULL,
	`question_request_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autonomy_gate_run_idx` ON `autonomy_gate` (`run_id`,`time_updated`);
--> statement-breakpoint
CREATE TABLE `autonomy_run_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`detail` text,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autonomy_run_audit_run_idx` ON `autonomy_run_audit` (`run_id`,`time_created`);

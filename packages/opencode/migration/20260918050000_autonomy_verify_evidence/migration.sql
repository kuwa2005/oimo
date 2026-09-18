CREATE TABLE `autonomy_test_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`command` text NOT NULL,
	`cwd_repository_id` text,
	`environment_fingerprint` text NOT NULL,
	`code_revision` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`exit_code` integer,
	`status` text NOT NULL,
	`failure_signature` text,
	`failure_class` text,
	`stdout_artifact` text,
	`stderr_artifact` text
);
--> statement-breakpoint
CREATE INDEX `autonomy_test_attempt_run_idx` ON `autonomy_test_attempt` (`run_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `autonomy_test_attempt_sig_idx` ON `autonomy_test_attempt` (`run_id`,`failure_signature`);
--> statement-breakpoint
CREATE TABLE `autonomy_evidence_manifest` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`locked_scope_hash` text NOT NULL,
	`payload` text NOT NULL,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autonomy_evidence_manifest_run_idx` ON `autonomy_evidence_manifest` (`run_id`,`time_created`);

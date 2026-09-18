CREATE TABLE `repo_workspace_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`workspace_fingerprint` text NOT NULL,
	`execution_scope` text NOT NULL,
	`change_set` text,
	`approval_fingerprint` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `repo_workspace_state_updated_idx` ON `repo_workspace_state` (`time_updated`);

CREATE TABLE `evolution_scheduler` (
	`project_id` text NOT NULL,
	`track` text NOT NULL,
	`last_run_ms` integer,
	`lease_until_ms` integer,
	`lease_owner` text,
	`time_updated` integer NOT NULL,
	PRIMARY KEY(`project_id`, `track`)
);

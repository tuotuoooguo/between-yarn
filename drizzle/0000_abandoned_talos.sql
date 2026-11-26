CREATE TABLE `yarn_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`yarn_a_name` text NOT NULL,
	`yarn_b_name` text NOT NULL,
	`yarn_a_key` text NOT NULL,
	`yarn_b_key` text NOT NULL,
	`preview_key` text NOT NULL,
	`color_a` text NOT NULL,
	`color_b` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

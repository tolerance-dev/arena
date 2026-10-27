-- Per-user run limits the admin page changes without a deploy (internal/admin): runs a non-admin may start in 24
-- hours, and how many non-admins' runs may wait in the queue at once (0 = no cap) before new ones are refused.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS daily_runs_per_user integer NOT NULL DEFAULT 3;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_queue_cap integer NOT NULL DEFAULT 20;

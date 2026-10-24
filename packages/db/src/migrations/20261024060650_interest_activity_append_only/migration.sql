-- Brief §5: stage changes, assignments and the rest of a lead's history are
-- activities, never overwrites. Reuses reject_history_change() from M2.
CREATE TRIGGER interest_activity_append_only
	BEFORE UPDATE OR DELETE ON interest_activity
	FOR EACH ROW EXECUTE FUNCTION reject_history_change();
--> statement-breakpoint
CREATE TRIGGER interest_activity_no_truncate
	BEFORE TRUNCATE ON interest_activity
	FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();

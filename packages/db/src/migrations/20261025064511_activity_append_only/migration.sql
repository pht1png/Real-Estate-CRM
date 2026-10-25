-- Brief §5: status and stage changes, assignments, conversions and the rest
-- of a lead's history are activities, never overwrites. Reuses
-- reject_history_change() from M2.
CREATE TRIGGER activity_append_only
	BEFORE UPDATE OR DELETE ON activity
	FOR EACH ROW EXECUTE FUNCTION reject_history_change();
--> statement-breakpoint
CREATE TRIGGER activity_no_truncate
	BEFORE TRUNCATE ON activity
	FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();

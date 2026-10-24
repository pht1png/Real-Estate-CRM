-- Brief §5/§6: price history is kept; changes are new rows, never overwrites.
CREATE FUNCTION reject_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER unit_price_history_append_only
	BEFORE UPDATE OR DELETE ON unit_price_history
	FOR EACH ROW EXECUTE FUNCTION reject_history_change();
--> statement-breakpoint
CREATE TRIGGER unit_price_history_no_truncate
	BEFORE TRUNCATE ON unit_price_history
	FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();

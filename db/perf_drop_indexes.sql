-- =====================================================================================================
-- perf_drop_indexes.sql  --  removes the indexes created by perf_indexes.sql (back to the "before" state)
-- =====================================================================================================
DROP INDEX IF EXISTS ix_show_seat_booking;
DROP INDEX IF EXISTS ix_payment_paid_at;

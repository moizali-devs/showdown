-- =====================================================================================================
-- perf_indexes.sql  --  the "after" indexes for the query-performance page (NOT applied at startup)
-- Lab topics: B-tree indexes, partial indexes, covering indexes (INCLUDE), index-only scans (Lab 3 / Lab 7).
-- Undo with perf_drop_indexes.sql. Run db/queries/*.sql under EXPLAIN ANALYZE before and after.
-- =====================================================================================================

-- seat_search.sql: find the show_seat rows of one booking without reading the whole table.
-- Partial: only rows that belong to a booking (FREE seats have booking_id NULL), so the index is smaller.
CREATE INDEX IF NOT EXISTS ix_show_seat_booking
    ON show_seat (booking_id)
    WHERE booking_id IS NOT NULL;

-- sales_report.sql: range scan on paid_at. INCLUDE carries booking_id and amount so the query never has to
-- visit the table (Index Only Scan); the WHERE clause keeps only PAID rows, matching the query's filter.
CREATE INDEX IF NOT EXISTS ix_payment_paid_at
    ON payment (paid_at)
    INCLUDE (booking_id, amount)
    WHERE status = 'PAID';

-- Refresh planner statistics for the new indexes. (The seed is followed by VACUUM ANALYZE in migrate.ts, which
-- sets the visibility map that lets the index-only scan skip table visits.)
ANALYZE show_seat;
ANALYZE payment;

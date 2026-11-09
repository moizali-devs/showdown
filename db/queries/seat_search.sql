-- =====================================================================================================
-- seat_search.sql  --  perf query 1 of 2 ("my tickets": every seat a customer holds or has booked)
-- Lab topics: EXPLAIN ANALYZE, sequential scan vs index scan, nested-loop vs hash join (Lab 3 / Lab 7).
--
-- Customer 60 is a seeded shopper (ids 54..2053). Literal values on purpose, so the file runs as-is
-- (the server wraps it in EXPLAIN (ANALYZE, FORMAT JSON)).
--
-- Why it is slow before: booking has an index on customer_id, but show_seat is only indexed by its primary key
-- (showtime_id, seat_id) and seat_id. Joining on show_seat.booking_id cannot use either, so Postgres reads
-- all ~165,000 show_seat rows (Seq Scan + Hash Join).
-- Fixed by: ix_show_seat_booking in perf_indexes.sql (Nested Loop + Index/Bitmap Scan on show_seat).
-- =====================================================================================================
SELECT st.starts_at,
       m.title,
       h.name                 AS hall,
       s.row_label || s.seat_no AS seat,
       ss.status,
       b.booking_id
  FROM booking   b
  JOIN show_seat ss ON ss.booking_id = b.booking_id          -- the join column that has no index at first
  JOIN seat      s  ON s.seat_id     = ss.seat_id
  JOIN showtime  st ON st.showtime_id = ss.showtime_id
  JOIN movie     m  ON m.movie_id    = st.movie_id
  JOIN hall      h  ON h.hall_id     = st.hall_id
 WHERE b.customer_id = 60
   AND ss.status IN ('HELD', 'BOOKED')
 ORDER BY st.starts_at DESC, s.row_label, s.seat_no;

-- =====================================================================================================
-- sales_report.sql  --  perf query 2 of 2 (revenue per movie per day for the last 3 days)
-- Lab topics: EXPLAIN ANALYZE, range predicate on a timestamp, aggregation (GROUP BY), index-only scan
--             on a partial covering index (Lab 3 / Lab 7).
--
-- Only PAID payments count. About 3 of the 98 seeded days match (~3% of payment rows).
--
-- Why it is slow before: payment is indexed by booking_id only, so the paid_at range filter needs a full
-- Seq Scan over every payment row before joining and grouping.
-- Fixed by: ix_payment_paid_at in perf_indexes.sql, a partial covering index (Index Only Scan).
-- =====================================================================================================
SELECT (p.paid_at AT TIME ZONE 'Asia/Karachi')::date AS sale_day,
       m.title,
       count(*)                                      AS payments,
       sum(p.amount)                                 AS revenue
  FROM payment  p
  JOIN booking  b  ON b.booking_id  = p.booking_id
  JOIN showtime st ON st.showtime_id = b.showtime_id
  JOIN movie    m  ON m.movie_id    = st.movie_id
 WHERE p.status = 'PAID'
   AND p.paid_at >= now() - INTERVAL '3 days'
 GROUP BY sale_day, m.title
 ORDER BY sale_day DESC, revenue DESC;

-- =====================================================================================================
-- 03_seed.sql  --  demo data (run once on an empty database; migrate.ts skips it when `movie` has rows)
-- Lab topics covered: INSERT ... SELECT, generate_series() set-based loading, CROSS JOIN, CTEs, temporary
--                     tables, sequences, window of realistic data for the indexing lab (Lab 3 / Lab 7).
--
-- What gets created (numbers are approximate; they come from generate_series, not from hand-written rows):
--   8 movies, 3 halls x 140 seats (A-J x 14, row J = RECLINER), 53 + 2,000 customers,
--   1,176 showings (3 halls x 4 slots x 98 days: 90 days back .. 7 days ahead)  ->  ~165,000 show_seat rows,
--   ~42,000 CONFIRMED bookings with PAID payments for past showings, ~2,000 cancelled bookings,
--   and the demo showing (Dune: Part Three, Hall 1, today 19:15 Asia/Karachi) with its seat_history.
-- Future showings are completely free so tests and demos never collide with random bookings.
-- =====================================================================================================

-- ---------- Movies (real titles; art = palette + motif consumed by the front end) --------------------
INSERT INTO movie (title, genre, release_year, art) VALUES
    ('The Odyssey',                              'Epic',      2026, '{"palette":["#1B3A5C","#E4B363","#F3E9D2"],"motif":"sail"}'),
    ('Dune: Part Three',                         'Sci-fi',    2026, '{"palette":["#C46A2B","#F0C27B","#3B2A20"],"motif":"dune"}'),
    ('Avengers: Doomsday',                       'Superhero', 2026, '{"palette":["#16213E","#E94560","#F5F5F5"],"motif":"burst"}'),
    ('The Hunger Games: Sunrise on the Reaping', 'Dystopian', 2026, '{"palette":["#2B2B2B","#E8A33D","#8C1C13"],"motif":"flame"}'),
    ('Spider-Man: Brand New Day',                'Superhero', 2026, '{"palette":["#B5121B","#1D3557","#F1FAEE"],"motif":"web"}'),
    ('Project Hail Mary',                        'Sci-fi',    2026, '{"palette":["#0B132B","#5BC0BE","#F7F7F2"],"motif":"star"}'),
    ('Toy Story 5',                              'Animation', 2026, '{"palette":["#2F6FEB","#F2C230","#E5484D"],"motif":"blocks"}'),
    ('Supergirl',                                'Superhero', 2026, '{"palette":["#1F4E9E","#D7263D","#F9DC5C"],"motif":"cape"}');

-- ---------- Halls and seats ---------------------------------------------------------------------------
INSERT INTO hall (name, rows, seats_per_row) VALUES ('Hall 1', 10, 14), ('Hall 2', 10, 14), ('Hall 3', 10, 14);

-- Every hall: rows A..J x 14 seats. chr(64 + 1) = 'A'. The last row (J) is the recliner row.
INSERT INTO seat (hall_id, row_label, seat_no, seat_type)
SELECT h.hall_id,
       chr(64 + r),
       n,
       CASE WHEN r = h.rows THEN 'RECLINER' ELSE 'STANDARD' END
  FROM hall h
  CROSS JOIN LATERAL generate_series(1, h.rows) AS r
  CROSS JOIN LATERAL generate_series(1, h.seats_per_row) AS n
 ORDER BY h.hall_id, r, n;

-- ---------- Customers ---------------------------------------------------------------------------------
-- ids 1..3 are fixed: the two racing customers and the website guest; 4..53 are the rush-hour bots.
INSERT INTO customer (name, email) VALUES
    ('Customer A', 'customer.a@showdown.test'),
    ('Customer B', 'customer.b@showdown.test'),
    ('Guest',      NULL);

INSERT INTO customer (name, email)
SELECT 'Bot ' || to_char(i, 'FM00'), NULL
  FROM generate_series(1, 50) AS i;

-- ids 54..2053: ordinary shoppers who own the historical bookings.
INSERT INTO customer (name, email)
SELECT 'Shopper ' || to_char(i, 'FM0000'), 'shopper' || to_char(i, 'FM0000') || '@example.com'
  FROM generate_series(1, 2000) AS i;

-- ---------- Showtimes: 3 halls x 4 slots x (90 days back .. 7 days ahead), Asia/Karachi wall clock ----
WITH slots (slot_no, local_time) AS (
    VALUES (1, TIME '13:00'), (2, TIME '16:15'), (3, TIME '19:15'), (4, TIME '22:30')
), days AS (
    SELECT d AS day_offset, (now() AT TIME ZONE 'Asia/Karachi')::date + d AS local_date
      FROM generate_series(-90, 7) AS d
)
INSERT INTO showtime (movie_id, hall_id, starts_at, price_standard, price_recliner)
SELECT -- spread the 8 films over days / halls / slots; keep Dune off Hall 1 19:15 so the demo showing is unique
       CASE WHEN h.hall_id = 1 AND s.slot_no = 3 AND pick = 2 THEN 3 ELSE pick END,
       h.hall_id,
       (days.local_date + s.local_time) AT TIME ZONE 'Asia/Karachi',
       1800.00,
       3200.00
  FROM days
  CROSS JOIN slots s
  CROSS JOIN hall h
  CROSS JOIN LATERAL (SELECT 1 + ((days.day_offset + 90) * 3 + h.hall_id * 5 + s.slot_no * 2) % 8 AS pick) AS p
 ORDER BY 3, h.hall_id;

-- The demo showing: Dune: Part Three, Hall 1, today 7:15 PM.
UPDATE showtime
   SET movie_id = (SELECT movie_id FROM movie WHERE title = 'Dune: Part Three')
 WHERE hall_id = (SELECT hall_id FROM hall WHERE name = 'Hall 1')
   AND starts_at = ((now() AT TIME ZONE 'Asia/Karachi')::date + TIME '19:15') AT TIME ZONE 'Asia/Karachi';

-- ---------- Plan which seats are booked (temporary tables, dropped at the end) ----------------------
-- Past showings: every showing gets its own popularity (25%..75% of seats sold). Future showings: nothing sold.
-- The demo showing gets the hand-picked pattern below. Seats are sold in groups of up to 3 neighbours
-- (grp) that share one booking, like a family buying together.
CREATE TEMP TABLE _popularity AS
SELECT showtime_id, 0.25 + 0.50 * random() AS p FROM showtime;

CREATE TEMP TABLE _plan AS
SELECT st.showtime_id,
       s.seat_id,
       s.row_label,
       s.seat_no,
       ((s.seat_no - 1) / 3) AS grp,
       st.starts_at,
       CASE s.seat_type WHEN 'RECLINER' THEN st.price_recliner ELSE st.price_standard END AS price,
       CASE
           WHEN st.showtime_id = (SELECT demo_showtime_id()) THEN   -- uncorrelated subquery: evaluated once
                (s.row_label || s.seat_no) IN ('A3','A4','B8','B9','B10','C2','C3','D5','D6','D11','E7','E8',
                                               'F4','F12','F13','G6','G9','H3','H4','H10','H11','I7','I8','J5','J6')
           WHEN st.starts_at < now() THEN random() < pop.p
           ELSE false
       END AS booked
  FROM showtime st
  JOIN _popularity pop ON pop.showtime_id = st.showtime_id
  JOIN seat s ON s.hall_id = st.hall_id;

-- One booking per (showing, row, group) that has at least one sold seat. nextval() reserves the booking id now
-- so show_seat can point at it in the next statement.
CREATE TEMP TABLE _bk AS
SELECT nextval('booking_booking_id_seq')::int AS booking_id,
       g.*,
       54 + floor(random() * 2000)::int AS customer_id
  FROM (SELECT showtime_id, row_label, grp,
               sum(price)                                                   AS total,
               min(starts_at)                                               AS starts_at,
               bool_or(showtime_id = (SELECT demo_showtime_id()))                  AS is_demo
          FROM _plan
         WHERE booked
         GROUP BY showtime_id, row_label, grp
         ORDER BY showtime_id, row_label, grp) AS g;

INSERT INTO booking (booking_id, customer_id, showtime_id, status, total, created_at)
SELECT booking_id, customer_id, showtime_id, 'CONFIRMED', total,
       LEAST(starts_at, now()) - random() * INTERVAL '3 days' - INTERVAL '10 minutes'
  FROM _bk;

-- Every confirmed booking was paid a few minutes after it was made.
INSERT INTO payment (booking_id, amount, status, paid_at)
SELECT booking_id, total, 'PAID', created_at + (1 + random() * 4) * INTERVAL '1 minute'
  FROM booking;

-- ---------- show_seat: one row per (showing, seat) -----------------------------------------------------
INSERT INTO show_seat (showtime_id, seat_id, status, booking_id, held_until, version)
SELECT p.showtime_id,
       p.seat_id,
       CASE WHEN p.booked THEN 'BOOKED' ELSE 'FREE' END,
       b.booking_id,
       NULL,
       CASE WHEN p.booked THEN 3 ELSE 1 END          -- FREE -> HELD -> BOOKED = two version bumps
  FROM _plan p
  LEFT JOIN _bk b ON b.showtime_id = p.showtime_id AND b.row_label = p.row_label AND b.grp = p.grp AND p.booked
 ORDER BY p.showtime_id, p.seat_id;

-- ---------- Some cancelled / failed bookings so the sales report has something to filter out ----------
WITH cancelled AS (
    INSERT INTO booking (customer_id, showtime_id, status, total, created_at)
    SELECT 54 + floor(random() * 2000)::int,
           st.showtime_id,
           'CANCELLED',
           1800.00 * (1 + floor(random() * 3)),
           LEAST(st.starts_at, now()) - random() * INTERVAL '30 days'
      FROM (SELECT showtime_id, starts_at FROM showtime WHERE starts_at < now() ORDER BY random() LIMIT 2000) AS st
    RETURNING booking_id, total, created_at
)
INSERT INTO payment (booking_id, amount, status, paid_at)
SELECT booking_id, total, 'FAILED', created_at + INTERVAL '2 minutes' FROM cancelled;

-- ---------- Demo showing: an "evening" of seat_history, ending consistent with show_seat ---------------
-- Each sold seat went FREE -> HELD -> BOOKED somewhere in the 75 minutes before seed time.
CREATE TEMP TABLE _demo_events AS
SELECT p.showtime_id, p.seat_id, b.booking_id,
       now() - INTERVAL '5 minutes' - random() * INTERVAL '70 minutes' AS held_at
  FROM _plan p
  JOIN _bk b ON b.showtime_id = p.showtime_id AND b.row_label = p.row_label AND b.grp = p.grp
 WHERE p.booked AND b.is_demo;

INSERT INTO seat_history (showtime_id, seat_id, old_status, new_status, booking_id, changed_at, changed_by)
SELECT showtime_id, seat_id, 'FREE', 'HELD', booking_id, held_at, 'web' FROM _demo_events
UNION ALL
SELECT showtime_id, seat_id, 'HELD', 'BOOKED', booking_id, held_at + (20 + random() * 80) * INTERVAL '1 second', 'web'
  FROM _demo_events;

-- Seats that were held and then given back (C7 and C8 end up FREE, as the demo needs).
WITH ghost AS (
    INSERT INTO booking (customer_id, showtime_id, status, total, created_at)
    SELECT 3, demo_showtime_id(), 'CANCELLED', 1800.00, now() - INTERVAL '53 minutes'
      FROM generate_series(1, 2)
    RETURNING booking_id
), numbered AS (
    SELECT booking_id, row_number() OVER (ORDER BY booking_id) AS n FROM ghost
), seats AS (
    SELECT n.booking_id, n.n, s.seat_id
      FROM numbered n
      JOIN seat s ON s.hall_id = (SELECT hall_id FROM hall WHERE name = 'Hall 1')
                 AND s.row_label = 'C' AND s.seat_no = CASE n.n WHEN 1 THEN 7 ELSE 8 END
)
INSERT INTO seat_history (showtime_id, seat_id, old_status, new_status, booking_id, changed_at, changed_by)
SELECT demo_showtime_id(), seat_id, 'FREE', 'HELD', booking_id, now() - (55 - 25 * (n - 1)) * INTERVAL '1 minute', 'web' FROM seats
UNION ALL
SELECT demo_showtime_id(), seat_id, 'HELD', 'FREE', booking_id, now() - (52 - 25 * (n - 1)) * INTERVAL '1 minute', 'web' FROM seats;

-- Keep the demo booking timestamps consistent with the history we just wrote.
UPDATE booking b
   SET created_at = e.first_hold
  FROM (SELECT booking_id, min(held_at) AS first_hold FROM _demo_events GROUP BY booking_id) e
 WHERE b.booking_id = e.booking_id;
UPDATE payment p
   SET paid_at = b.created_at + INTERVAL '1 minute'
  FROM booking b
 WHERE p.booking_id = b.booking_id AND b.booking_id IN (SELECT booking_id FROM _demo_events);

DROP TABLE _demo_events;
DROP TABLE _bk;
DROP TABLE _plan;
DROP TABLE _popularity;

-- =====================================================================================================
-- 02_functions.sql  --  PL/pgSQL routines and the audit trigger
-- Lab topics covered: PL/SQL-style stored procedures + triggers (Lab 8, PL/SQL), transactions and row locking
--                     with SELECT ... FOR UPDATE (Lab 4/5, Concurrency Control), exception handling.
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS, so the file can be re-run safely.
-- =====================================================================================================


-- -----------------------------------------------------------------------------------------------------
-- 1. Seat history trigger.
--    Every change of show_seat.status or show_seat.booking_id appends one row to seat_history. The
--    "time machine" (Lab 5, snapshot report) replays this table. changed_by is the connection's
--    application_name, e.g. 'showdown-A' or 'bot-07', so we can tell who changed a seat.
--    (Seeding uses INSERT, which this AFTER UPDATE trigger does not see.)
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_show_seat_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO seat_history (showtime_id, seat_id, old_status, new_status, booking_id, changed_by)
    VALUES (NEW.showtime_id, NEW.seat_id, OLD.status, NEW.status,
            COALESCE(NEW.booking_id, OLD.booking_id),          -- keep the booking when a seat is released
            current_setting('application_name', true));
    RETURN NULL;                                              -- AFTER trigger: return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_show_seat_history ON show_seat;
CREATE TRIGGER trg_show_seat_history
    AFTER UPDATE OF status, booking_id ON show_seat
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.booking_id IS DISTINCT FROM NEW.booking_id)
    EXECUTE FUNCTION fn_show_seat_history();


-- -----------------------------------------------------------------------------------------------------
-- 2. book_seats(): hold several seats for a customer, all or nothing.
--    * Locks the wanted show_seat rows with SELECT ... FOR UPDATE in a fixed order (row, number). Two
--      callers who want overlapping seats therefore queue on the same first seat instead of deadlocking.
--    * A HELD seat whose hold has expired counts as free (and its old PENDING booking is cancelled).
--    * If any seat is BOOKED or validly HELD the function raises 'SEAT_TAKEN:<label>' (SQLSTATE P0001);
--      nothing has been written yet, and the caller's transaction/statement rolls back as a whole.
--    * Returns the new booking_id; the seats are HELD until now() + p_hold_minutes.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_seats(
    p_showtime      int,
    p_customer      int,
    p_seats         text[],
    p_hold_minutes  int DEFAULT 5
) RETURNS int
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
    v_std        numeric(10,2);
    v_rec        numeric(10,2);
    v_until      timestamptz := clock_timestamp() + make_interval(mins => p_hold_minutes);
    v_wanted     int;
    v_ids        int[]   := '{}';
    v_labels     text[]  := '{}';
    v_stale      int[]   := '{}';        -- bookings whose expired hold we are taking over
    v_total      numeric(10,2) := 0;
    v_booking    int;
    r            record;
    v_missing    text;
BEGIN
    IF p_seats IS NULL OR cardinality(p_seats) = 0 THEN
        RAISE EXCEPTION 'NO_SEATS' USING ERRCODE = 'P0001';
    END IF;

    SELECT price_standard, price_recliner INTO v_std, v_rec FROM showtime WHERE showtime_id = p_showtime;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SHOWTIME_UNKNOWN:%', p_showtime USING ERRCODE = 'P0001';
    END IF;

    SELECT count(DISTINCT label) INTO v_wanted FROM unnest(p_seats) AS label;

    -- Lock in deterministic order. LockRows sits above the Sort node, so rows are locked in ORDER BY order.
    FOR r IN
        SELECT ss.seat_id, s.row_label || s.seat_no AS label, s.seat_type,
               ss.status, ss.held_until, ss.booking_id
          FROM show_seat ss
          JOIN seat s ON s.seat_id = ss.seat_id
         WHERE ss.showtime_id = p_showtime
           AND s.row_label || s.seat_no = ANY (p_seats)
         ORDER BY s.row_label, s.seat_no
           FOR UPDATE OF ss
    LOOP
        IF r.status = 'BOOKED'
           OR (r.status = 'HELD' AND r.held_until >= clock_timestamp()) THEN
            RAISE EXCEPTION 'SEAT_TAKEN:%', r.label USING ERRCODE = 'P0001';
        END IF;
        IF r.status = 'HELD' AND r.booking_id IS NOT NULL THEN
            v_stale := v_stale || r.booking_id;                 -- expired hold: free to take over
        END IF;
        v_ids    := v_ids || r.seat_id;
        v_labels := v_labels || r.label;
        v_total  := v_total + CASE r.seat_type WHEN 'RECLINER' THEN v_rec ELSE v_std END;
    END LOOP;

    IF cardinality(v_ids) <> v_wanted THEN                       -- some requested label does not exist
        SELECT label INTO v_missing FROM unnest(p_seats) AS label WHERE label <> ALL (v_labels) LIMIT 1;
        RAISE EXCEPTION 'SEAT_UNKNOWN:%', v_missing USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO booking (customer_id, showtime_id, status, total)
    VALUES (p_customer, p_showtime, 'PENDING', v_total)
    RETURNING booking_id INTO v_booking;

    UPDATE show_seat
       SET status = 'HELD', held_until = v_until, booking_id = v_booking, version = version + 1
     WHERE showtime_id = p_showtime AND seat_id = ANY (v_ids);

    IF cardinality(v_stale) > 0 THEN
        UPDATE booking SET status = 'CANCELLED'
         WHERE booking_id = ANY (v_stale) AND status = 'PENDING';
    END IF;

    RETURN v_booking;
END;
$$;


-- -----------------------------------------------------------------------------------------------------
-- 3. release_expired_holds(): the sweeper. Frees HELD seats whose held_until has passed and cancels the
--    PENDING bookings that owned them. Returns what it freed (showtime, "C7"-style label).
--    FOR UPDATE SKIP LOCKED: seats another transaction is touching right now are left for the next sweep.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_expired_holds()
RETURNS TABLE (showtime_id int, seat_label text)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH expired AS (
        SELECT ss.showtime_id, ss.seat_id, ss.booking_id
          FROM show_seat ss
         WHERE ss.status = 'HELD' AND ss.held_until < clock_timestamp()
           FOR UPDATE SKIP LOCKED
    ), freed AS (
        UPDATE show_seat ss
           SET status = 'FREE', booking_id = NULL, held_until = NULL, version = ss.version + 1
          FROM expired e
         WHERE ss.showtime_id = e.showtime_id AND ss.seat_id = e.seat_id
        RETURNING ss.showtime_id, ss.seat_id
    ), cancelled AS (
        UPDATE booking b SET status = 'CANCELLED'
         WHERE b.booking_id IN (SELECT booking_id FROM expired) AND b.status = 'PENDING'
        RETURNING b.booking_id
    )
    SELECT f.showtime_id, s.row_label || s.seat_no
      FROM freed f
      JOIN seat s ON s.seat_id = f.seat_id
     ORDER BY f.showtime_id, s.row_label, s.seat_no;
END;
$$;


-- -----------------------------------------------------------------------------------------------------
-- 4. demo_showtime_id(): the showing used by the live demo = Dune: Part Three, Hall 1, 7:15 PM
--    (Asia/Karachi). The seed creates exactly one such showing. Returns NULL before seeding.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION demo_showtime_id() RETURNS int
LANGUAGE sql STABLE AS $$
    SELECT st.showtime_id
      FROM showtime st
      JOIN movie m ON m.movie_id = st.movie_id
      JOIN hall  h ON h.hall_id  = st.hall_id
     WHERE m.title = 'Dune: Part Three'
       AND h.name  = 'Hall 1'
       AND (st.starts_at AT TIME ZONE 'Asia/Karachi')::time = TIME '19:15'
     ORDER BY st.starts_at DESC      -- if the database outlives its seed day, prefer the newest
     LIMIT 1;
$$;

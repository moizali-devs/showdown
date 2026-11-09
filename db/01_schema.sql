-- =====================================================================================================
-- 01_schema.sql  --  Showdown cinema booking schema (PostgreSQL 17)
-- Lab topics covered: DDL + integrity constraints (PK / FK / UNIQUE / CHECK / DEFAULT), normalisation (3NF),
--                     B-tree indexes on foreign keys (Lab 3, File Organization and Indexing).
-- Idempotent: every statement is IF NOT EXISTS, so the file can be re-run safely.
--
-- Normal form notes (3NF): every non-key column depends on the key, the whole key and nothing but the key.
--   * seat prices live on `showtime` (a function of the showing), not on `seat` or `show_seat`.
--   * a seat's physical facts (row, number, type) live once in `seat`; `show_seat` only holds per-showing state.
--   * `booking.total` is a stored snapshot of what the customer was charged at booking time (price lists can
--     change later), so it is intentionally not recomputed from show_seat.
-- =====================================================================================================

-- ---------- Catalogue: what is shown, and where -----------------------------------------------------

CREATE TABLE IF NOT EXISTS movie (
    movie_id      serial       CONSTRAINT pk_movie PRIMARY KEY,
    title         text         NOT NULL CONSTRAINT uq_movie_title UNIQUE,
    genre         text         NOT NULL,
    release_year  int          NOT NULL CONSTRAINT ck_movie_year CHECK (release_year BETWEEN 1888 AND 2100),
    art           jsonb        -- {"palette":[hex,..],"motif":"dune"} used by the front end for original poster art
);

CREATE TABLE IF NOT EXISTS hall (
    hall_id        serial  CONSTRAINT pk_hall PRIMARY KEY,
    name           text    NOT NULL CONSTRAINT uq_hall_name UNIQUE,
    rows           int     NOT NULL CONSTRAINT ck_hall_rows CHECK (rows BETWEEN 1 AND 26),
    seats_per_row  int     NOT NULL CONSTRAINT ck_hall_seats_per_row CHECK (seats_per_row > 0)
);

-- One physical seat in a hall, e.g. hall 1, row 'C', number 7 ("C7").
CREATE TABLE IF NOT EXISTS seat (
    seat_id    serial   CONSTRAINT pk_seat PRIMARY KEY,
    hall_id    int      NOT NULL CONSTRAINT fk_seat_hall REFERENCES hall (hall_id),
    row_label  char(1)  NOT NULL,
    seat_no    int      NOT NULL CONSTRAINT ck_seat_no CHECK (seat_no > 0),
    seat_type  text     NOT NULL CONSTRAINT ck_seat_type CHECK (seat_type IN ('STANDARD', 'RECLINER')),
    -- The UNIQUE constraint also creates the index that serves "all seats of a hall" (FK seat.hall_id).
    CONSTRAINT uq_seat_position UNIQUE (hall_id, row_label, seat_no)
);

-- One screening of a movie in a hall. Prices are per showing (3NF: price depends on the showing).
CREATE TABLE IF NOT EXISTS showtime (
    showtime_id      serial         CONSTRAINT pk_showtime PRIMARY KEY,
    movie_id         int            NOT NULL CONSTRAINT fk_showtime_movie REFERENCES movie (movie_id),
    hall_id          int            NOT NULL CONSTRAINT fk_showtime_hall  REFERENCES hall (hall_id),
    starts_at        timestamptz    NOT NULL,
    price_standard   numeric(10,2)  NOT NULL CONSTRAINT ck_showtime_price_std CHECK (price_standard >= 0),
    price_recliner   numeric(10,2)  NOT NULL CONSTRAINT ck_showtime_price_rec CHECK (price_recliner >= 0),
    -- A hall cannot show two films at the same moment; also indexes (hall_id, starts_at).
    CONSTRAINT uq_showtime_hall_start UNIQUE (hall_id, starts_at)
);
CREATE INDEX IF NOT EXISTS ix_showtime_movie ON showtime (movie_id, starts_at);   -- FK index + "upcoming shows of a movie"

-- ---------- People and money ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer (
    customer_id  serial  CONSTRAINT pk_customer PRIMARY KEY,
    name         text    NOT NULL,
    email        text    CONSTRAINT uq_customer_email UNIQUE      -- NULLs allowed (guests), duplicates are not
);

CREATE TABLE IF NOT EXISTS booking (
    booking_id   serial         CONSTRAINT pk_booking PRIMARY KEY,
    customer_id  int            NOT NULL CONSTRAINT fk_booking_customer REFERENCES customer (customer_id),
    showtime_id  int            NOT NULL CONSTRAINT fk_booking_showtime REFERENCES showtime (showtime_id),
    status       text           NOT NULL CONSTRAINT ck_booking_status
                                CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED')),
    total        numeric(10,2)  NOT NULL DEFAULT 0 CONSTRAINT ck_booking_total CHECK (total >= 0),
    created_at   timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_booking_customer ON booking (customer_id);          -- FK index

CREATE TABLE IF NOT EXISTS payment (
    payment_id  serial         CONSTRAINT pk_payment PRIMARY KEY,
    booking_id  int            NOT NULL CONSTRAINT fk_payment_booking REFERENCES booking (booking_id),
    amount      numeric(10,2)  NOT NULL CONSTRAINT ck_payment_amount CHECK (amount >= 0),
    status      text           NOT NULL CONSTRAINT ck_payment_status CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
    paid_at     timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_payment_booking ON payment (booking_id);            -- FK index

-- ---------- Seat state per showing (the row that concurrency control fights over) -------------------

-- One row per (showing, seat). status moves FREE -> HELD -> BOOKED. `version` is the optimistic-locking counter.
-- Deliberately NOT indexed beyond the primary key: booking_id / status / held_until indexes are added by
-- db/perf_indexes.sql for the EXPLAIN ANALYZE before/after demo (Lab 7).
CREATE TABLE IF NOT EXISTS show_seat (
    showtime_id  int          NOT NULL CONSTRAINT fk_show_seat_showtime REFERENCES showtime (showtime_id),
    seat_id      int          NOT NULL CONSTRAINT fk_show_seat_seat     REFERENCES seat (seat_id),
    status       text         NOT NULL DEFAULT 'FREE' CONSTRAINT ck_show_seat_status
                              CHECK (status IN ('FREE', 'HELD', 'BOOKED')),
    booking_id   int          CONSTRAINT fk_show_seat_booking REFERENCES booking (booking_id),
    held_until   timestamptz,
    version      int          NOT NULL DEFAULT 1,
    CONSTRAINT pk_show_seat PRIMARY KEY (showtime_id, seat_id)
);
CREATE INDEX IF NOT EXISTS ix_show_seat_seat ON show_seat (seat_id);              -- FK index

-- ---------- Audit trail written by trigger trg_show_seat_history (see 02_functions.sql) --------------

CREATE TABLE IF NOT EXISTS seat_history (
    history_id   bigserial    CONSTRAINT pk_seat_history PRIMARY KEY,
    showtime_id  int          NOT NULL CONSTRAINT fk_seat_history_showtime REFERENCES showtime (showtime_id),
    seat_id      int          NOT NULL CONSTRAINT fk_seat_history_seat     REFERENCES seat (seat_id),
    old_status   text,
    new_status   text         NOT NULL,
    booking_id   int,                                   -- no FK: history must survive deletes of bookings
    changed_at   timestamptz  NOT NULL DEFAULT clock_timestamp(),
    changed_by   text                                   -- application_name of the session that made the change
);
-- "Time machine" lookup: latest event per seat of one showing up to time t.
CREATE INDEX IF NOT EXISTS ix_seat_history_show_time ON seat_history (showtime_id, changed_at);

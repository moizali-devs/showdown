# Showdown — build contract (source of truth between agents)

Spec: `../BUILD-BRIEF.md`. Design: `../design/v2-approved/*.dc.html` + `DESIGN-BRIEF-V2.md`. This file fixes the seams
(folder layout, ownership, SQL schema, REST, WebSocket, shared types, Hall3D props). Do not change a contract item
without saying so in your report. `package.json` and `node_modules` are already set up (deps: react 18, react-router-dom 6,
vite 6, @vitejs/plugin-react, express 4, ws 8, pg 8, embedded-postgres 17.5.0-beta.15, tsx, vitest 2, typescript 5).
If you need another npm package, `npm install` it locally (never global) and mention it in your report.
Rules for every agent: do not git commit/push; do not touch anything outside `adbms-project/`; do not edit files owned
by another agent (ask in your report instead); leave no background processes running (stop embedded Postgres cleanly).

## 1. Layout and ownership
```
showdown-app/
  package.json                (orchestrator; scripts: dev, reset-db, test, typecheck, build)
  tsconfig.json               (BE-DB)   server + tests, module NodeNext/ESNext, strict
  vitest.config.ts            (BE-DB)   globalSetup tests/setup/global.ts, testTimeout 60000, fileParallelism false
  db/                         (BE-DB)   graded SQL, applied in this order:
    01_schema.sql             9 tables, PK/FK/CHECK/UNIQUE, base indexes needed by FKs
    02_functions.sql          book_seats(), seat history trigger fn + trigger, helpers
    03_seed.sql               movies, halls, seats, showtimes, show_seat (generate_series), customers, bookings, payments, demo history
    perf_indexes.sql          the "after" indexes for feature 10 (NOT applied at startup)
    perf_drop_indexes.sql     drops them
    queries/                  seat_search.sql, sales_report.sql (the two EXPLAIN'd queries, with $1.. params documented)
  server/src/
    db/postgres.ts            (BE-DB)   startDatabase(opts) -> { connectionString, stop() }
    db/migrate.ts             (BE-DB)   migrate(connStr, {reset?:boolean}) applies db/0*.sql idempotently
    db/pool.ts                (BE-DB)   createPool(connStr)
    scripts/reset-db.ts       (BE-DB)
    engine/**                 (BE-ENGINE) sessions, modes, showdown manager, locks
    lab/**                    (BE-ENGINE) deadlock, rush, history, perf
    hall/**                   (BE-ENGINE) hold, pay, expiry sweeper
    http/**, ws/**            (BE-ENGINE)
    app.ts                    (BE-ENGINE) createApp({connectionString}) -> { server: http.Server, close() } (no Vite)
    main.ts                   (BE-ENGINE) dev entry: startDatabase -> migrate -> createApp -> Vite middleware -> listen
  shared/types.ts             (BE-ENGINE writes; FE imports via relative path or alias "@shared/types")
  tests/                      (BE-DB: setup/, db.test.ts; BE-ENGINE: engine/lab/hall tests; FE-LAB: serializability.test.ts)
  web/                        (FE-CORE owns index.html, vite.config.ts, tsconfig.json, src/main.tsx, src/App.tsx,
                               src/styles/, src/components/, src/lib/api.ts, src/lib/ws.ts, src/pages/Home|Films|Movie|Hall)
    src/pages/Showdown.tsx    (FE-SHOWDOWN) + src/pages/showdown/**
    src/pages/Lab.tsx         (FE-LAB) + src/pages/lab/** + src/lib/serializability.ts
  verification/               screenshots from browser QA
  README.md                   (orchestrator, at the end)
```
Paths: Vite root = `web/`; alias `@shared` -> `showdown-app/shared`. TS server runs with `tsx` (ESM). Use `.js`
extensions or extensionless imports consistently — tsx handles both; prefer extensionless + `"moduleResolution": "Bundler"`.

## 2. Runtime
- `npm run dev` = `tsx server/src/main.ts`: starts embedded Postgres (data dir `showdown-app/.pgdata`, port 54329,
  user `postgres`, password `postgres`, db `showdown`, flags `-c max_connections=200`), unless `DATABASE_URL` is set
  (then use that server, never start embedded). Then migrate (schema/functions create-if-missing; seed only if `movie`
  is empty), then ONE http server on **port 5173** (env `PORT`): Express API under `/api`, WebSocket at `/ws`, Vite in
  middleware mode for everything else. SIGINT/SIGTERM/`beforeExit`: close WS, end all pg clients, `pg.stop()`, exit.
- `npm run reset-db`: start DB (if embedded), drop + recreate schema `public`, migrate + seed, stop.
- Tests: own cluster `showdown-app/.pgdata-test`, port 54331 (so tests run while dev is up). globalSetup starts, migrates
  with reset, exports `process.env.TEST_DATABASE_URL` (via `provide`/env), teardown stops it.
- `.gitignore`: `.pgdata*`, `node_modules`, `dist`.

## 3. Database (Postgres 17, schema `public`)
```
movie(movie_id serial PK, title text unique not null, genre text not null, release_year int not null, art jsonb)   -- art: {palette:[hex..], motif:'dune'|'sail'|...} for original CSS art
hall(hall_id serial PK, name text unique not null, rows int not null, seats_per_row int not null)
seat(seat_id serial PK, hall_id FK, row_label char(1), seat_no int, seat_type text CHECK IN ('STANDARD','RECLINER'), UNIQUE(hall_id,row_label,seat_no))
showtime(showtime_id serial PK, movie_id FK, hall_id FK, starts_at timestamptz not null, price_standard numeric(10,2), price_recliner numeric(10,2))
customer(customer_id serial PK, name text not null, email text unique)
booking(booking_id serial PK, customer_id FK, showtime_id FK, status text CHECK IN ('PENDING','CONFIRMED','CANCELLED','FAILED'), total numeric(10,2) default 0, created_at timestamptz default now())
show_seat(showtime_id FK, seat_id FK, status text CHECK IN ('FREE','HELD','BOOKED') default 'FREE', booking_id FK null, held_until timestamptz null, version int not null default 1, PRIMARY KEY(showtime_id, seat_id))
payment(payment_id serial PK, booking_id FK, amount numeric(10,2), status text CHECK IN ('PENDING','PAID','FAILED'), paid_at timestamptz default now())
seat_history(history_id bigserial PK, showtime_id, seat_id, old_status text, new_status text, booking_id int null, changed_at timestamptz default clock_timestamp(), changed_by text)  -- changed_by = current_setting('application_name')
```
- Hall layout: every hall rows A–J × 14 seats (aisle between 7|8), row J = RECLINER. Seat label = row_label||seat_no ("C7").
- Halls: "Hall 1", "Hall 2", "Hall 3". Films (real titles, genre word, year 2026, no runtimes/cast): The Odyssey (Epic),
  Dune: Part Three (Sci-fi), Avengers: Doomsday (Superhero), The Hunger Games: Sunrise on the Reaping (Dystopian),
  Spider-Man: Brand New Day (Superhero), Project Hail Mary (Sci-fi), Toy Story 5 (Animation), Supergirl (Superhero).
- Prices Rs 1800 standard / Rs 3200 recliner (numeric). Times relative to `current_date` at seed time: past 30 days +
  next 7 days, 3–4 slots/day (labels like 1:00 PM, 4:15 PM, 7:15 PM, 10:30 PM, Asia/Karachi), so show_seat ≥ ~150k rows.
  Past shows get random BOOKED seats + CONFIRMED bookings + PAID payments (realistic sales report).
- **Demo showtime**: Dune: Part Three, Hall 1, today 7:15 PM Asia/Karachi. Some seats pre-booked/held like the Hall
  design (booked: A3 A4 B8 B9 B10 C2 C3 D5 D6 D11 E7 E8 F4 F12 F13 G6 G9 H3 H4 H10 H11 I7 I8 J5 J6), **C7 and C8 FREE**.
  Its seat_history is seeded with an "evening" of transitions spread over the 75 minutes before seed time (consistent
  with final show_seat state). Lookup helper: `SELECT demo_showtime_id()` (SQL function in 02_functions.sql).
- Customers: 1 "Customer A", 2 "Customer B", 3 "Guest", 4..53 "Bot 01".."Bot 50", plus some seeded shoppers.
- Trigger `trg_show_seat_history` AFTER UPDATE OF status, booking_id ON show_seat FOR EACH ROW (when changed) inserts seat_history.
- `book_seats(p_showtime int, p_customer int, p_seats text[], p_hold_minutes int default 5) RETURNS int` (PL/pgSQL):
  creates PENDING booking, locks the seats with `SELECT … FOR UPDATE` in seat-label order (deadlock-safe), treats HELD
  with held_until < now() as free, raises `SEAT_TAKEN:<label>` (SQLSTATE 'P0001') if any seat is not free (whole call
  rolls back), else sets them HELD + held_until + booking_id, version+1, sets booking.total, returns booking_id.
- `release_expired_holds() RETURNS TABLE(showtime_id int, seat_label text)` frees HELD seats past held_until, cancels their PENDING bookings.

## 4. Concurrency engine (BE-ENGINE) — semantics tests rely on
Customer session = dedicated `pg.Client` (application_name `showdown-A` / `showdown-B` / `bot-NN`), keyed by
`${showtimeId}:${customer}`; ops on one session run serially (promise queue). Every statement goes through
`session.exec(sql, params)` which times it and emits a SqlLine (below). Default isolation READ COMMITTED.
Two phases so a transaction can stay open between clicks (two-window mode):
| mode | begin(seat) | confirm() |
|---|---|---|
| off | BEGIN; SELECT status,version (no lock); if not FREE -> ROLLBACK, Refused | INSERT booking CONFIRMED; UPDATE show_seat SET status='BOOKED', booking_id, version+1 WHERE pk (no status check); COMMIT -> "Booked" |
| lock | BEGIN; SELECT … FOR UPDATE (emits wait/grant when blocked); if not FREE -> ROLLBACK, Refused | INSERT booking; UPDATE; COMMIT |
| atomic | BEGIN | INSERT booking; UPDATE … WHERE pk AND status='FREE'; rowCount 1 -> COMMIT Booked, 0 -> ROLLBACK Refused |
| optimistic | BEGIN; SELECT status,version -> v | INSERT booking; UPDATE … SET version=v+1 WHERE pk AND version=v; 0 rows -> ROLLBACK, re-read (retry ≤3) -> taken -> Refused |
Off-mode double booking is detected after both finish: both committed "Booked" -> both statuses become "Double booked",
seat status CONFLICT, result "Double booked. Lost update." (DB truth: two CONFIRMED bookings for C7 in booking/seat_history,
show_seat.booking_id = last writer.) Results: off "Double booked. Lost update." / lock "One booked. B waited." /
atomic "One booked. No waiting." / optimistic "One booked. B retried." (use actual winner/loser letters).
Single-page Run = server-driven interleaving: A.begin, B.begin (not awaited — may block), A.confirm, then B.confirm,
with ~500 ms pauses so the UI can animate. Reset = abort open txs, set seat FREE (booking_id null, version kept),
cancel the race bookings, clear feeds. Mode change resets.
Lock table: while a showdown/lab run is active poll every 250 ms with an admin connection:
`pg_locks` joined to `pg_stat_activity` for the session pids + `pg_blocking_pids(pid)`; map pid -> customer.

## 5. Shared types (`shared/types.ts`)
```ts
export type Mode = 'off' | 'lock' | 'atomic' | 'optimistic';
export type Customer = 'A' | 'B';
export type DbSeatStatus = 'FREE' | 'HELD' | 'BOOKED';
export interface SeatInfo { seat: string; row: string; number: number; type: 'STANDARD'|'RECLINER'; status: DbSeatStatus; heldUntil: string|null; bookingId: number|null; price: number }
export interface Movie { id: number; title: string; genre: string; year: number; art: { palette: string[]; motif: string } }
export interface Showtime { id: number; movieId: number; movieTitle: string; hall: string; startsAt: string; label: string; priceStandard: number; priceRecliner: number; free: number }
export interface SqlLine { at: number; customer: Customer|'RUSH'|'LAB'|'WEB'; kind: 'stmt'|'result'|'wait'|'grant'|'commit'|'rollback'|'error'|'info'; text: string; ms?: number; code?: string }
export interface LockRow { pid: number; customer: string|null; locktype: string; relation: string|null; mode: string; granted: boolean; blockedBy: number[] }
export interface CustomerState { attached: boolean; pid: number|null; phase: 'idle'|'begun'|'waiting'|'ready'|'done';
  steps: string[]; status: 'Booked'|'Refused'|'Double booked'|null; sql: SqlLine[]; waitMs: number; totalMs: number|null }
export interface ShowdownState { showtimeId: number; seat: string; mode: Mode; running: boolean;
  seatStatus: 'FREE'|'HELD'|'BOOKED'|'CONFLICT'; customers: Record<Customer, CustomerState>; result: string|null; locks: LockRow[] }
```
`steps` are the short design lines, max 4: 'SELECT · seat free', 'SELECT … FOR UPDATE', 'lock acquired', 'waiting on A…',
'lock granted', 'UPDATE · 1 row', 'UPDATE · 0 rows', 'UPDATE … WHERE free', 'SELECT · v3', 'UPDATE · v3 → v4',
'version changed', 'retry · seat taken', 'seat taken', 'COMMIT', 'ROLLBACK'. Real version numbers.

## 6. REST (JSON, prefix /api; errors `{error, code?, seat?}` with 4xx/5xx)
- `GET /health` -> `{ok:true, db:'embedded'|'external'}`
- `GET /movies` -> `Movie[]`; `GET /movies/:id` -> `{movie: Movie, showtimes: Showtime[]}` (upcoming only)
- `GET /demo` -> `{showtimeId, seat:'C7'}`
- `GET /showtimes/:id` -> `{showtime: Showtime, seats: SeatInfo[]}` (140 seats, A1..J14 order)
- `POST /showtimes/:id/hold {seats: string[]}` -> `{bookingId, heldUntil, total, sql: string[]}`; 409 `{error, code:'SEAT_TAKEN', seat}`. Uses book_seats() with customer 3.
- `POST /bookings/:id/pay {decline?: boolean, failSeat?: string}` -> `{status:'CONFIRMED'|'PARTIAL'|'FAILED', booked: string[], released: string[], amount, sql: string[]}`.
  One tx: BEGIN; INSERT payment PENDING; per seat `SAVEPOINT seat_<label>`; UPDATE HELD->BOOKED; if label==failSeat
  `ROLLBACK TO SAVEPOINT` + release that seat; else `RELEASE SAVEPOINT`. decline=true -> whole `ROLLBACK`, then a
  second tx releases all seats, booking FAILED, payment FAILED. Else payment PAID (amount of booked seats), booking CONFIRMED (or PARTIAL reported when some released).
- `POST /bookings/:id/cancel` -> releases held seats.
- Showdown (state also pushed over WS): `GET /showdown/:showtimeId` -> ShowdownState;
  `POST /showdown/:showtimeId/mode {mode}`; `POST /showdown/:showtimeId/reset`; `POST /showdown/:showtimeId/run`;
  `POST /showdown/:showtimeId/:customer/attach` (window opened; marks attached); `/:customer/begin`, `/:customer/confirm`, `/:customer/abort`.
  Action endpoints return `202 {accepted:true}` immediately; progress/results arrive as WS `showdown` messages.
- Lab: `POST /lab/deadlock {ordered: boolean}` -> `{deadlock: boolean, victim: Customer|null, code: '40P01'|null,
  edges: {from:Customer,to:Customer,seat:string}[], timeline: {t:number, customer:Customer, text:string}[], result: string, ms: number}`
  (resets C7/C8 FREE first; A locks C7 then C8, B locks C8 then C7; ordered=true both lock C7 then C8).
- `POST /lab/rush {bots?: 50, mode?: Mode (default 'lock'), seat?: 'C7'}` -> `{tried, booked, refused, errors, totalMs,
  throughputTps, avgResponseMs, lockWaitRatio, bots: {i:number, ok:boolean, ms:number, waitMs:number}[]}` (50 dedicated
  connections, barrier then fire together; formulas per Lab 5 handout; resets seat first).
- `GET /lab/history/:showtimeId` -> `{from, to, events: {seat, oldStatus, newStatus, at}[]}`;
  `GET /lab/history/:showtimeId/at?t=ISO` -> `{at, seats: Record<label, DbSeatStatus>, sql}` (DISTINCT ON over seat_history, real query).
- `GET /lab/perf` -> `{indexed: boolean, queries: {name:'seat_search'|'sales_report', sql, node: string, ms: number, rows: number, plan: unknown}[]}`;
  `POST /lab/perf/indexes {create: boolean}` -> same shape after applying perf_indexes.sql / perf_drop_indexes.sql. Real `EXPLAIN (ANALYZE, FORMAT JSON)`.

## 7. WebSocket `/ws` (JSON text frames)
Client -> server: `{type:'subscribe', showtimeId}` (may resubscribe), `{type:'ping'}`.
Server -> client:
- `{type:'seats', showtimeId, changes: {seat, status: DbSeatStatus, bookingId, heldUntil}[]}` — after ANY committed seat change (hold, pay, release, expiry, showdown, lab, reset).
- `{type:'showdown', state: ShowdownState}` — every state change of that showtime's race.
- `{type:'sql', showtimeId, line: SqlLine}` — live feed (also included in state.customers[x].sql).
- `{type:'locks', showtimeId, rows: LockRow[]}` — while polling is active.
- `{type:'pong'}`.

## 8. Front end (React 18 + Vite + TS, react-router-dom)
Routes: `/` Home · `/films` list · `/films/:movieId` film + showtime picker · `/hall/:showtimeId` seat selection, hold & pay ·
`/showdown?show=<id>&customer=A|B` (no `customer` = one page drives both; with it = that customer's window only) · `/lab`.
Tokens (`web/src/styles/tokens.css`, CSS vars): --ground #ECEAE5, --surface #F6F5F2, --ink #141414, --muted #6B6862,
--line #D6D2CA, --clay #DAD6CE, --clay-side #C5C0B6, --clay-shade #B3ADA2, --held #E8A33D, --booked #1F8A5B,
--conflict #E5484D, --cust-a #2F6FEB, --cust-b #F2730A. Font Geist / Geist Mono via Google Fonts link in index.html.
Shared UI in `web/src/components/`: `Nav`, `Footer` (credit line), `Label` (11px uppercase .12em muted), `Pill` button,
`Segmented`, `Hall3D`, `Seat3D`.
`web/src/lib/api.ts`: typed fetch helpers for every endpoint above. `web/src/lib/ws.ts`: `useShowtimeSocket(showtimeId, onMessage)`
hook with auto-reconnect (one shared socket is fine).

### Hall3D (web/src/components/Hall3D.tsx) — the hero object, used by Home, Hall, Showdown, Lab time machine
```ts
export type SeatVisual = 'free' | 'held' | 'booked' | 'yours' | 'conflict';
export interface HallPin { id: 'A'|'B'; seat: string; state: 'idle'|'down'|'wait' }   // A blue, B orange, offset left/right
export interface Hall3DProps {
  seats: Record<string, SeatVisual>;      // label -> visual; missing = 'free'. Layout fixed: A–J × 14, aisle 7|7, J recliners
  xray?: boolean;                         // wireframe; seats listed in `focus` stay solid
  focus?: string[];                       // e.g. ['C7']
  lifted?: string[];                      // translateZ(+10px) with 300ms cubic-bezier(.2,.8,.2,1)
  pins?: HallPin[];
  ring?: { seat: string; kind: 'held' | 'pulse' } | null;
  seatLabel?: string | null;              // small mono label floating at a seat (e.g. 'C7')
  onSeatClick?: (seat: string) => void;   // only when interactive; drag > 5px must not count as click
  onSeatHover?: (seat: string | null) => void;
  interactive?: boolean;                  // seats focusable role=button with aria-label "Seat C7, free"
  height?: number;                        // stage height px (responsive defaults per design)
  scale?: number;                         // model scale (responsive defaults per design)
  sway?: boolean;                         // default true; stops after first drag; none under prefers-reduced-motion
  shake?: boolean;                        // brief shake animation (deadlock victim)
  showOrbitHint?: boolean;                // "Drag to orbit" label, default true
  ariaLabel?: string;
}
```
Recipe per DESIGN-BRIEF-V2 + Hall.dc.html (stepped tiers translateZ(r*9px), seat = base + backrest faces, curved 5-panel
screen on a stand, floor light, contact shadow, pointer-drag orbit on the stage element only, memoized face styles so drag
only changes the scene transform). `Seat3D` = one seat box `{state: SeatVisual, size?: number, solid?: boolean}` for Lab exhibits and Home mode cards.

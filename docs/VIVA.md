# Five-minute demo script

Before starting: `npm run dev`, then open `http://localhost:5173/api/demo` once to read the `showtimeId` (call it S).

| Time | Step |
| --- | --- |
| 0:00 | One sentence: two customers, one seat, real PostgreSQL, one connection per window. Show Home. |
| 0:30 | Open two browser windows side by side: `/showdown?show=S&customer=A` and `/showdown?show=S&customer=B`. |
| 0:45 | Mode **Off**: A Begin, B Begin, A Confirm, B Confirm. Both say "Booked", the seat turns red: "Double booked. Lost update." Open X-Ray: both did `SELECT` then `UPDATE` with no check. |
| 1:30 | Mode **Lock**: repeat. B's `SELECT ... FOR UPDATE` waits. Point at the lock table (`pg_locks`, `pg_blocking_pids`) showing B blocked by A. A confirms; B is refused. |
| 2:15 | Mode **Atomic**, then **Optimistic**: one wins, no waiting (atomic: `UPDATE ... WHERE status='FREE'` returns 0 rows; optimistic: `version` mismatch, retry, seat taken). The single-page `/showdown?show=S` with Run does the same race on its own. |
| 2:45 | `/hall/S`: pick C7 and C8, hold, tick "Decline card" (whole payment rolls back, seats freed). Hold again, fail one seat: SAVEPOINT rolls back only that seat; the other is paid. |
| 3:20 | `/lab`, Deadlock: run unordered (A: C7 then C8, B: C8 then C7). PostgreSQL kills one with `40P01`; the wait-for graph shows the loop. Tick fixed lock order and run again: B just waits, no deadlock. |
| 3:50 | Rush hour: 50 bots, Lock mode. 1 booked, 49 refused; read throughput, average response, lock-wait ratio. Switch to Off to show more than one booking. |
| 4:20 | Time machine: drag the slider; the hall rebuilds from `seat_history` (filled by the trigger). |
| 4:35 | Serializability: type `R1(A) W2(A) R2(B) W1(B)`, see the precedence-graph cycle (not serializable); try a serial schedule. Say it is simulated in the browser. |
| 4:50 | Indexes: run the two EXPLAIN ANALYZE queries, create the indexes, run again (Seq Scan becomes Index Scan / Index Only Scan). |

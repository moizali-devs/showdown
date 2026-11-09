import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';

const url = inject('testDatabaseUrl') ?? process.env.TEST_DATABASE_URL!;
let db: pg.Client;
let farShow: number; // latest showing: nobody else books there, so these tests cannot disturb others

async function scalar<T = number>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query(sql, params);
  return Object.values(r.rows[0])[0] as T;
}
const newClient = async (app: string) => {
  const c = new pg.Client({ connectionString: url, application_name: app });
  await c.connect();
  return c;
};
async function resetSeats(labels: string[]) {
  await db.query(
    `UPDATE show_seat ss SET status = 'FREE', booking_id = NULL, held_until = NULL
       FROM seat s WHERE s.seat_id = ss.seat_id AND ss.showtime_id = $1 AND s.row_label || s.seat_no = ANY($2)`,
    [farShow, labels],
  );
}
const statusOf = async (showtime: number, label: string) =>
  scalar<string>(
    `SELECT ss.status FROM show_seat ss JOIN seat s USING (seat_id)
      WHERE ss.showtime_id = $1 AND s.row_label || s.seat_no = $2`,
    [showtime, label],
  );

beforeAll(async () => {
  db = await newClient('test-main');
  farShow = await scalar('SELECT showtime_id FROM showtime ORDER BY starts_at DESC, hall_id DESC LIMIT 1');
});
afterAll(async () => {
  await resetSeats(['A1', 'A2', 'A3', 'B1', 'B2']);
  await db.end();
});

describe('schema and seed', () => {
  it('has the 9 tables', async () => {
    const r = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
    );
    expect(r.rows.map((x) => x.table_name)).toEqual([
      'booking', 'customer', 'hall', 'movie', 'payment', 'seat', 'seat_history', 'show_seat', 'showtime',
    ]);
  });

  it('seeds enough data', async () => {
    expect(await scalar('SELECT count(*)::int FROM movie')).toBe(8);
    expect(await scalar('SELECT count(*)::int FROM hall')).toBe(3);
    expect(await scalar('SELECT count(*)::int FROM seat')).toBe(420);
    expect(await scalar('SELECT count(*)::int FROM show_seat')).toBeGreaterThanOrEqual(150000);
    expect(await scalar('SELECT count(*)::int FROM customer')).toBeGreaterThanOrEqual(53);
    expect(await scalar('SELECT count(*)::int FROM payment WHERE status = \'PAID\'')).toBeGreaterThan(1000);
    expect(await scalar("SELECT name FROM customer WHERE customer_id = 3")).toBe('Guest');
    expect(await scalar("SELECT name FROM customer WHERE customer_id = 54 - 1")).toBe('Bot 50');
  });

  it('every showing has 140 seats; row J is recliner', async () => {
    expect(await scalar('SELECT count(DISTINCT n)::int FROM (SELECT count(*) n FROM show_seat GROUP BY showtime_id) x')).toBe(1);
    expect(await scalar("SELECT count(*)::int FROM seat WHERE seat_type = 'RECLINER' AND row_label <> 'J'")).toBe(0);
  });

  it('demo showing: Dune, Hall 1, C7 and C8 free, 25 seats booked', async () => {
    const id = await scalar<number>('SELECT demo_showtime_id()');
    expect(id).toBeGreaterThan(0);
    const info = await db.query(
      `SELECT m.title, h.name, to_char(st.starts_at AT TIME ZONE 'Asia/Karachi', 'HH24:MI') AS t
         FROM showtime st JOIN movie m USING (movie_id) JOIN hall h USING (hall_id) WHERE showtime_id = $1`,
      [id],
    );
    expect(info.rows[0]).toEqual({ title: 'Dune: Part Three', name: 'Hall 1', t: '19:15' });
    expect(await statusOf(id, 'C7')).toBe('FREE');
    expect(await statusOf(id, 'C8')).toBe('FREE');
    expect(await statusOf(id, 'C2')).toBe('BOOKED');
    expect(await scalar("SELECT count(*)::int FROM show_seat WHERE showtime_id = $1 AND status = 'BOOKED'", [id])).toBe(25);
    // exactly one such showing, so the helper is unambiguous
    expect(await scalar("SELECT count(*)::int FROM showtime st JOIN movie m USING (movie_id) WHERE m.title = 'Dune: Part Three' AND st.hall_id = 1 AND (st.starts_at AT TIME ZONE 'Asia/Karachi')::time = '19:15'")).toBe(1);
  });

  it('demo seat_history is consistent with show_seat', async () => {
    const id = await scalar<number>('SELECT demo_showtime_id()');
    // replay: latest event per seat must equal the seat's current status
    const bad = await scalar(
      `SELECT count(*)::int FROM (
         SELECT DISTINCT ON (seat_id) seat_id, new_status FROM seat_history WHERE showtime_id = $1 ORDER BY seat_id, changed_at DESC, history_id DESC
       ) h JOIN show_seat ss ON ss.showtime_id = $1 AND ss.seat_id = h.seat_id WHERE ss.status <> h.new_status`,
      [id],
    );
    expect(bad).toBe(0);
    expect(await scalar('SELECT count(*)::int FROM seat_history WHERE showtime_id = $1', [id])).toBeGreaterThanOrEqual(50);
    expect(await scalar('SELECT count(*)::int FROM seat_history WHERE showtime_id = $1 AND changed_at < now() - interval \'76 minutes\'', [id])).toBe(0);
  });

  it('migrate is idempotent (second run changes nothing)', async () => {
    const { migrate } = await import('../server/src/db/migrate');
    const before = await scalar('SELECT count(*)::int FROM show_seat');
    const r = await migrate(url);
    expect(r.seeded).toBe(false);
    expect(await scalar('SELECT count(*)::int FROM show_seat')).toBe(before);
  });
});

describe('seat_history trigger', () => {
  it('writes a row on status change with changed_by = application_name, and none for other columns', async () => {
    const c = await newClient('trigger-test');
    try {
      const before = await scalar('SELECT count(*)::int FROM seat_history WHERE showtime_id = $1', [farShow]);
      await c.query(
        `UPDATE show_seat SET status = 'HELD', held_until = now() + interval '5 minutes', version = version + 1
          WHERE showtime_id = $1 AND seat_id = (SELECT seat_id FROM seat WHERE hall_id = (SELECT hall_id FROM showtime WHERE showtime_id = $1) AND row_label = 'B' AND seat_no = 1)`,
        [farShow],
      );
      const h = await db.query(
        `SELECT old_status, new_status, changed_by FROM seat_history WHERE showtime_id = $1 ORDER BY history_id DESC LIMIT 1`,
        [farShow],
      );
      expect(h.rows[0]).toEqual({ old_status: 'FREE', new_status: 'HELD', changed_by: 'trigger-test' });
      // version-only update must not log
      await c.query(`UPDATE show_seat SET version = version + 1 WHERE showtime_id = $1`, [farShow]);
      expect(await scalar('SELECT count(*)::int FROM seat_history WHERE showtime_id = $1', [farShow])).toBe(before + 1);
    } finally {
      await c.end();
      await resetSeats(['B1']);
    }
  });
});

describe('book_seats()', () => {
  it('holds seats and is all-or-nothing', async () => {
    const id1 = await scalar<number>(`SELECT book_seats($1, 3, ARRAY['A1','A2'], 5)`, [farShow]);
    expect(id1).toBeGreaterThan(0);
    expect(await statusOf(farShow, 'A1')).toBe('HELD');
    const b = await db.query('SELECT status, total FROM booking WHERE booking_id = $1', [id1]);
    expect(b.rows[0]).toEqual({ status: 'PENDING', total: '3600.00' });

    // A3 is free but A2 is held -> whole call fails, A3 must stay FREE and no booking row is added
    const bookings = await scalar('SELECT count(*)::int FROM booking');
    await expect(db.query(`SELECT book_seats($1, 3, ARRAY['A3','A2'], 5)`, [farShow])).rejects.toMatchObject({
      code: 'P0001',
      message: 'SEAT_TAKEN:A2',
    });
    expect(await statusOf(farShow, 'A3')).toBe('FREE');
    expect(await scalar('SELECT count(*)::int FROM booking')).toBe(bookings);
    await resetSeats(['A1', 'A2']);
  });

  it('rejects unknown seats and prices recliners higher', async () => {
    await expect(db.query(`SELECT book_seats($1, 3, ARRAY['A1','Z9'], 5)`, [farShow])).rejects.toMatchObject({
      message: 'SEAT_UNKNOWN:Z9',
    });
    expect(await statusOf(farShow, 'A1')).toBe('FREE');
    const id = await scalar<number>(`SELECT book_seats($1, 3, ARRAY['J1'], 5)`, [farShow]);
    expect(await scalar<string>('SELECT total FROM booking WHERE booking_id = $1', [id])).toBe('3200.00');
    await resetSeats(['J1']);
  });

  it('a second caller waits on the lock and is refused once the first commits', async () => {
    const a = await newClient('showdown-A');
    const b = await newClient('showdown-B');
    try {
      await a.query('BEGIN');
      await a.query(`SELECT book_seats($1, 1, ARRAY['B2'], 5)`, [farShow]);
      let settled = false;
      const pb = b.query(`SELECT book_seats($1, 2, ARRAY['B2'], 5)`, [farShow]).then(
        () => { settled = true; return 'ok'; },
        (e: Error) => { settled = true; return e.message; },
      );
      await new Promise((r) => setTimeout(r, 600));
      expect(settled).toBe(false); // B is blocked behind A's row lock
      await a.query('COMMIT');
      expect(await pb).toBe('SEAT_TAKEN:B2');
    } finally {
      await a.end();
      await b.end();
      await resetSeats(['B2']);
    }
  });

  it('treats an expired hold as free and cancels the stale booking', async () => {
    const stale = await scalar<number>(`SELECT book_seats($1, 1, ARRAY['A3'], -1)`, [farShow]); // already expired
    const fresh = await scalar<number>(`SELECT book_seats($1, 2, ARRAY['A3'], 5)`, [farShow]);
    expect(fresh).not.toBe(stale);
    expect(await scalar<string>('SELECT status FROM booking WHERE booking_id = $1', [stale])).toBe('CANCELLED');
    expect(await scalar<number>(`SELECT booking_id FROM show_seat ss JOIN seat s USING (seat_id) WHERE ss.showtime_id = $1 AND s.row_label || s.seat_no = 'A3'`, [farShow])).toBe(fresh);
    await resetSeats(['A3']);
  });
});

describe('release_expired_holds()', () => {
  it('frees only expired HELD seats and cancels their PENDING bookings', async () => {
    const expired = await scalar<number>(`SELECT book_seats($1, 3, ARRAY['A1','A2'], -1)`, [farShow]);
    const live = await scalar<number>(`SELECT book_seats($1, 3, ARRAY['B1'], 5)`, [farShow]);
    const r = await db.query('SELECT * FROM release_expired_holds()');
    const mine = r.rows.filter((x) => x.showtime_id === farShow).map((x) => x.seat_label);
    expect(mine).toEqual(['A1', 'A2']);
    expect(await statusOf(farShow, 'A1')).toBe('FREE');
    expect(await statusOf(farShow, 'B1')).toBe('HELD');
    expect(await scalar<string>('SELECT status FROM booking WHERE booking_id = $1', [expired])).toBe('CANCELLED');
    expect(await scalar<string>('SELECT status FROM booking WHERE booking_id = $1', [live])).toBe('PENDING');
    // second sweep finds nothing of ours
    const again = await db.query('SELECT * FROM release_expired_holds()');
    expect(again.rows.filter((x) => x.showtime_id === farShow)).toEqual([]);
    await resetSeats(['B1']);
  });
});

describe('perf scripts', () => {
  it('create and drop the demo indexes', async () => {
    const { readSqlFile } = await import('../server/src/db/migrate');
    const count = () => scalar<number>("SELECT count(*)::int FROM pg_indexes WHERE indexname IN ('ix_show_seat_booking','ix_payment_paid_at')");
    await db.query(readSqlFile('perf_indexes.sql'));
    expect(await count()).toBe(2);
    for (const f of ['seat_search', 'sales_report']) {
      const r = await db.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + readSqlFile('queries', f + '.sql'));
      expect(r.rows[0]['QUERY PLAN'][0]['Execution Time']).toBeGreaterThan(0);
    }
    await db.query(readSqlFile('perf_drop_indexes.sql'));
    expect(await count()).toBe(0);
  });
});

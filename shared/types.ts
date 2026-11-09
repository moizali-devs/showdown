// Shared types between server and web (CONTRACT section 5). Keep in sync with CONTRACT.md.
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

// ---- Additions (not in section 5): WS frames and lab response shapes from sections 6/7 ----
export interface SeatChange { seat: string; status: DbSeatStatus; bookingId: number|null; heldUntil: string|null }
export type WsServerMsg =
  | { type: 'seats'; showtimeId: number; changes: SeatChange[] }
  | { type: 'showdown'; state: ShowdownState }
  | { type: 'sql'; showtimeId: number; line: SqlLine }
  | { type: 'locks'; showtimeId: number; rows: LockRow[] }
  | { type: 'pong' };
export type WsClientMsg = { type: 'subscribe'; showtimeId: number } | { type: 'ping' };

export interface DeadlockResult {
  deadlock: boolean; victim: Customer|null; code: '40P01'|null;
  edges: { from: Customer; to: Customer; seat: string }[];
  timeline: { t: number; customer: Customer; text: string }[];
  result: string; ms: number;
}
export interface RushResult {
  tried: number; booked: number; refused: number; errors: number; totalMs: number;
  throughputTps: number; avgResponseMs: number; lockWaitRatio: number;
  bots: { i: number; ok: boolean; ms: number; waitMs: number }[];
}
export interface HistoryEvents { from: string; to: string; events: { seat: string; oldStatus: string|null; newStatus: string; at: string }[] }
export interface HistoryAt { at: string; seats: Record<string, DbSeatStatus>; sql: string }
export interface PerfQuery { name: 'seat_search'|'sales_report'; sql: string; node: string; ms: number; rows: number; plan: unknown }
export interface PerfResult { indexed: boolean; queries: PerfQuery[] }
export interface HoldResult { bookingId: number; heldUntil: string|null; total: number; sql: string[] }
export interface PayResult { status: 'CONFIRMED'|'PARTIAL'|'FAILED'; booked: string[]; released: string[]; amount: number; sql: string[] }

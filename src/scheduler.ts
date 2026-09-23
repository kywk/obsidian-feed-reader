/** Reader presence owns refreshing; a delayed timer performs only one catch-up. */
export class ReaderScheduler {
  private timer?: number;
  private present = false;
  private disposed = false;
  private pending = false;
  private lastRun = 0;
  constructor(private readonly refresh: () => Promise<void>, private readonly interval = 30 * 60 * 1000, private readonly onError: (error: unknown) => void = () => {}) {}
  setPresent(present: boolean): void {
    if (this.disposed || this.present === present) return;
    this.present = present;
    if (present) {
      void this.run();
      this.timer = window.setInterval(() => this.check(), Math.min(this.interval, 60_000));
    } else {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  check(): void {
    if (this.present && Date.now() - this.lastRun >= this.interval) void this.run();
  }
  async run(): Promise<void> {
    if (this.disposed || this.pending) return;
    this.pending = true;
    this.lastRun = Date.now();
    try { await this.refresh(); } catch (error) { if (!this.disposed) this.onError(error); } finally { this.pending = false; }
  }
  dispose(): void {
    this.disposed = true;
    this.present = false;
    window.clearInterval(this.timer);
  }
}

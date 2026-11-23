// Inputs → lanes, with the time of the physical action:
//   · keyboard, mouse, touch: event.timeStamp (same clock as performance.now)
//   · gamepad: gamepad.timestamp of the state change, polled every image and every 4 ms
// so a press is judged at the moment it happened, whatever the frame rate.

export interface LaneInput {
  lane: number;
  down: boolean;
  /** performance.now() time of the action (ms). */
  at: number;
  source: 'key' | 'pad' | 'pointer';
}

export type ActionInput = 'pause' | 'restart' | 'skip';

export interface InputConfig {
  lanes: number;
  keys: string[][];
  pad: number[][];
}

export class InputRouter {
  onLane: ((e: LaneInput) => void) | null = null;
  onAction: ((a: ActionInput) => void) | null = null;
  private cfg: InputConfig = { lanes: 4, keys: [], pad: [] };
  private readonly keyToLane = new Map<string, number>();
  /** Lanes held, counted per source (two keys on one lane: down while any is held). */
  private readonly held: number[] = [];
  private readonly keysDown = new Set<string>();
  private readonly padPrev = new Map<number, boolean[]>();
  private readonly pointerLane = new Map<number, number>();
  private timer = 0;
  private attached = false;
  private target: HTMLElement | null = null;
  laneAt: ((x: number, y: number) => number) | null = null;

  configure(cfg: InputConfig): void {
    this.releaseAll(performance.now());
    this.cfg = cfg;
    this.keyToLane.clear();
    cfg.keys.forEach((codes, lane) => codes.forEach((c) => this.keyToLane.set(c, lane)));
    this.held.length = 0;
    for (let i = 0; i < cfg.lanes; i++) this.held.push(0);
  }

  attach(target: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    this.target = target;
    window.addEventListener('keydown', this.keydown, { capture: true });
    window.addEventListener('keyup', this.keyup, { capture: true });
    window.addEventListener('blur', this.blur);
    target.addEventListener('pointerdown', this.pdown);
    target.addEventListener('pointerup', this.pup);
    target.addEventListener('pointercancel', this.pup);
    target.addEventListener('contextmenu', this.noMenu);
    this.timer = window.setInterval(() => this.pollPads(), 4);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.releaseAll(performance.now());
    window.removeEventListener('keydown', this.keydown, { capture: true });
    window.removeEventListener('keyup', this.keyup, { capture: true });
    window.removeEventListener('blur', this.blur);
    const t = this.target;
    if (t) {
      t.removeEventListener('pointerdown', this.pdown);
      t.removeEventListener('pointerup', this.pup);
      t.removeEventListener('pointercancel', this.pup);
      t.removeEventListener('contextmenu', this.noMenu);
    }
    clearInterval(this.timer);
  }

  private change(lane: number, down: boolean, at: number, source: LaneInput['source']): void {
    if (lane < 0 || lane >= this.cfg.lanes) return;
    const before = this.held[lane];
    this.held[lane] = Math.max(0, before + (down ? 1 : -1));
    // only edges reach the game: a second key on a held lane does nothing
    if (down && before === 0) this.onLane?.({ lane, down: true, at, source });
    if (!down && before > 0 && this.held[lane] === 0) this.onLane?.({ lane, down: false, at, source });
  }

  private readonly keydown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'Pause') {
      e.preventDefault();
      if (!e.repeat) this.onAction?.('pause');
      return;
    }
    // restart: Backspace, away from the lanes (² sits right next to 1)
    if (e.code === 'Backspace' && !e.repeat) {
      this.onAction?.('restart');
      return;
    }
    const lane = this.keyToLane.get(e.code);
    if (lane === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || this.keysDown.has(e.code)) return;
    this.keysDown.add(e.code);
    this.change(lane, true, e.timeStamp, 'key');
  };

  private readonly keyup = (e: KeyboardEvent) => {
    const lane = this.keyToLane.get(e.code);
    if (lane === undefined || !this.keysDown.has(e.code)) return;
    e.preventDefault();
    this.keysDown.delete(e.code);
    this.change(lane, false, e.timeStamp, 'key');
  };

  private readonly blur = () => this.releaseAll(performance.now());

  private readonly noMenu = (e: Event) => e.preventDefault();

  private readonly pdown = (e: PointerEvent) => {
    if (!this.laneAt) return;
    const lane = this.laneAt(e.clientX, e.clientY);
    if (lane < 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.pointerLane.set(e.pointerId, lane);
    this.change(lane, true, e.timeStamp, 'pointer');
  };

  private readonly pup = (e: PointerEvent) => {
    const lane = this.pointerLane.get(e.pointerId);
    if (lane === undefined) return;
    this.pointerLane.delete(e.pointerId);
    this.change(lane, false, e.timeStamp, 'pointer');
  };

  /** Polled every 4 ms and on every image. */
  pollPads(): void {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const prev = this.padPrev.get(gp.index) ?? [];
      const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      const at = gp.timestamp || performance.now();
      for (let b = 0; b < now.length; b++) {
        if (now[b] === !!prev[b]) continue;
        if (b === 9 && now[b]) this.onAction?.('pause');
        this.cfg.pad.forEach((buttons, lane) => {
          if (buttons.includes(b)) this.change(lane, now[b], at, 'pad');
        });
      }
      this.padPrev.set(gp.index, now);
    }
  }

  releaseAll(at: number): void {
    for (let l = 0; l < this.held.length; l++) {
      if (this.held[l] > 0) {
        this.held[l] = 1;
        this.change(l, false, at, 'key');
      }
    }
    this.keysDown.clear();
    this.pointerLane.clear();
  }
}

/** Keyboard and mouse state. Actions fire once per press through `pressed`. */
export class Input {
  private held = new Set<string>();
  private justPressed = new Set<string>();
  lookX = 0;
  lookY = 0;
  wheel = 0;
  /** The mouse button went down on the game this frame. */
  clicked = false;
  locked = false;
  dragging = false;
  enabled = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!e.repeat) this.justPressed.add(e.code);
      this.held.add(e.code);
      if (this.enabled && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
    canvas.addEventListener("mousedown", () => {
      if (this.enabled && !this.locked) this.requestLock();
      this.dragging = true;
      this.clicked = true;
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    window.addEventListener("mousemove", (e) => {
      if (this.locked || this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    canvas.addEventListener("wheel", (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener("pointerlockerror", () => {
      this.locked = false;
    });
  }

  requestLock(): void {
    // Some embedded browsers refuse pointer lock; drag-to-look still works there.
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch?.(() => {});
    } catch {
      /* drag to look */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  pressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.justPressed.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.clicked = false;
  }
}

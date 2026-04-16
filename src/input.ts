export class InputState {
  readonly keys = new Set<string>();
  readonly mouseButtons = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;

  constructor() {
    document.addEventListener("keydown", (e) => this.keys.add(e.code));
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    document.addEventListener("mousemove", (e) => {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("mousedown", (e) => this.mouseButtons.add(e.button));
    document.addEventListener("mouseup", (e) => this.mouseButtons.delete(e.button));
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  consumeMouse(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  clearAll(): void {
    this.keys.clear();
    this.mouseButtons.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

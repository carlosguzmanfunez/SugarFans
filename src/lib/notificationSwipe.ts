// A vertical scroll, a short drag or an interrupted pointer never removes an alert.
export class NotificationSwipe {
  private drag: { id: number; x: number; y: number; width: number; axis: 'pending' | 'x' | 'y'; offset: number; moved: boolean } | null = null;

  get pointerId() { return this.drag?.id; }

  begin(id: number, x: number, y: number, width: number) {
    if (this.drag) return false;
    this.drag = { id, x, y, width, axis: 'pending', offset: 0, moved: false };
    return true;
  }

  move(id: number, x: number, y: number) {
    const d = this.drag;
    if (!d || d.id !== id) return null;
    const dx = x - d.x;
    const dy = y - d.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
      d.moved = true;
      if (d.axis === 'pending') d.axis = Math.abs(dx) > Math.abs(dy) * 1.25 ? 'x' : 'y';
    }
    d.offset = d.axis === 'x' ? Math.max(-d.width, Math.min(d.width, dx)) : 0;
    return { offset: d.offset, horizontal: d.axis === 'x', moved: d.moved };
  }

  end(id: number) {
    const d = this.drag;
    if (!d || d.id !== id) return null;
    this.drag = null;
    return { dismiss: d.axis === 'x' && Math.abs(d.offset) >= Math.min(96, Math.max(64, d.width * 0.28)), offset: d.offset, moved: d.moved };
  }

  cancel(id?: number) {
    if (id === undefined || this.drag?.id === id) this.drag = null;
  }
}

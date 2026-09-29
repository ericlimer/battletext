// Screen stack. Modal screens render over the screen beneath (which is drawn dimmed and inert).

import { Display } from '../engine/display';
import { UI } from '../engine/ui';
import { Input } from '../engine/input';
import { C } from '../engine/color';

export interface Screen {
  modal?: boolean;
  render(ui: UI, dt: number): void;
  onEnter?(): void;
}

export class App {
  stack: Screen[] = [];
  constructor(public d: Display, public ui: UI, public inp: Input) {}

  push(s: Screen): void { this.stack.push(s); s.onEnter?.(); }
  pop(): void { this.stack.pop(); this.stack[this.stack.length - 1]?.onEnter?.(); }
  replace(s: Screen): void { this.stack.pop(); this.push(s); }
  reset(s: Screen): void { this.stack = []; this.push(s); }
  top(): Screen | undefined { return this.stack[this.stack.length - 1]; }

  frame(dt: number): void {
    const { d, ui } = this;
    d.clear(C.bg);
    ui.beginFrame(dt);
    let base = this.stack.length - 1;
    while (base > 0 && this.stack[base].modal) base--;
    for (let i = base; i < this.stack.length; i++) {
      const top = i === this.stack.length - 1;
      ui.enabled = top;
      if (top && i > base) ui.dimAll(0.4);
      this.stack[i].render(ui, dt);
    }
    ui.enabled = true;
    ui.endFrame();
  }
}

export let app: App;
export function setApp(a: App): void { app = a; }

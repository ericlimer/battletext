// Screen stack. Modal screens render over the screen beneath (which is drawn dimmed and inert).

import { Display } from '../engine/display';
import { UI } from '../engine/ui';
import { Input } from '../engine/input';
import { C } from '../engine/color';
import { setScreen, tick, count, currentScreen } from '../game/telemetry';
import { BookmarkScreen, openBookmark } from './bookmark';

export interface Screen {
  modal?: boolean;
  /** State worth recording with a bookmark (day, funds, round, selection…). */
  describe?(): Record<string, unknown>;
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
    const topS = this.top();
    if (topS) setScreen(topS.constructor.name);
    tick(dt);
    for (const e of this.inp.keys) if (!e.used) count('key', `${currentScreen()}:${e.key}`);

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
    // Backquote drops a bookmark on whatever is under the mouse, from any screen (checked after drawing,
    // so the bookmark can record what this frame showed)
    if (!(topS instanceof BookmarkScreen) && !ui.focus && ui.key('`')) openBookmark(this, topS);
  }
}

export let app: App;
export function setApp(a: App): void { app = a; }

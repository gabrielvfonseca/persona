import type { BotState } from "@persona/core";

export class MemoryBotState implements BotState {
  paused = false;

  setPaused(v: boolean): void {
    this.paused = v;
  }
}

import "./localization/english";
import { Game } from "./app/game";
import { bn } from "./localization/bn";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const ui = document.getElementById("ui") as HTMLElement;
  const fail = (message: string): void => {
    ui.innerHTML = `<div class="fatal"><div class="fatal-title">${bn.title}</div><p>${message}</p></div>`;
  };
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) {
    fail(bn.unsupported);
    return;
  }
  try {
    const game = new Game(canvas, ui);
    (window as unknown as { __game: Game }).__game = game; // console and test access
    await game.start();
  } catch (err) {
    console.error(err);
    fail(bn.loadFailed);
  }
}

void boot();

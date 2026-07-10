// Phaser bootstrap. Locked 1920x1080 design space, Scale.FIT for any TV.
import BootScene from './scenes/BootScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import GameScene from './scenes/GameScene.js';
import ResultScene from './scenes/ResultScene.js';
import UnoScene from './scenes/UnoScene.js';
import Net from './net.js';
import { DESIGN } from './config.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0e1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN.W,
    height: DESIGN.H,
  },
  scene: [BootScene, LobbyScene, GameScene, ResultScene, UnoScene],
});

// Opt-in debug handles for automated smoke tests (only with ?debug in the URL).
if (window.location.search.includes('debug')) {
  window.__game = game;
  window.__net = Net;
}

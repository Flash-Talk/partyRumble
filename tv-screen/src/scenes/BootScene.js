// Connects to the server, requests a room, then hands off to the lobby.
import Net from '../net.js';
import { DESIGN } from '../config.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    this.add.text(DESIGN.W / 2, DESIGN.H / 2, 'Connecting…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '48px', color: '#8b93a7',
    }).setOrigin(0.5);

    Net.init();

    if (Net.roomCode) {
      this.scene.start('LobbyScene');
    } else {
      Net.events.once('room_ready', () => this.scene.start('LobbyScene'));
    }
  }
}

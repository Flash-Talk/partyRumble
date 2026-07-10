// Final standings + rematch. SHOOT (any player) starts another match.
import Net from '../net.js';
import { DESIGN, CONFIG, hexToNum } from '../config.js';

export default class ResultScene extends Phaser.Scene {
  constructor() {
    super('ResultScene');
  }

  init(data) {
    this.standings = data.standings || [];
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    this.prevAnyShoot = true;
    this.spaceKey = this.input.keyboard.addKey('SPACE');

    this.add.text(DESIGN.W / 2, 90, 'FULL TIME', {
      fontFamily: 'system-ui, sans-serif', fontSize: '70px', fontStyle: 'bold', color: '#8b93a7',
    }).setOrigin(0.5);

    const winner = this.standings[0];
    if (winner) {
      this.add.text(DESIGN.W / 2, 210, `${winner.name} WINS`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '96px', fontStyle: 'bold', color: winner.color,
      }).setOrigin(0.5);
      this.add.text(DESIGN.W / 2, 290, `goal difference ${signed(winner.diff)}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '34px', color: '#8b93a7',
      }).setOrigin(0.5);
    }

    // Standings table (fits up to 8 rows).
    const rowH = Math.min(88, Math.floor(560 / Math.max(1, this.standings.length)));
    const fs = this.standings.length > 5 ? 36 : 44;
    const startY = 400;
    this.standings.forEach((row, i) => {
      const y = startY + i * rowH;
      this.add.rectangle(DESIGN.W / 2 - 430, y, 36, 36, hexToNum(row.color));
      this.add.text(DESIGN.W / 2 - 390, y, `${i + 1}.  ${row.name}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: `${fs}px`, color: '#eef1f7',
      }).setOrigin(0, 0.5);
      this.add.text(DESIGN.W / 2 + 430, y, `${signed(row.diff)}    scored ${row.scored} · let in ${row.conceded}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: `${fs - 6}px`, color: '#8b93a7',
      }).setOrigin(1, 0.5);
    });

    this.add.text(DESIGN.W / 2, DESIGN.H - 90, 'Press SHOOT on any phone to play again', {
      fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#4ade80',
    }).setOrigin(0.5);
  }

  update() {
    let anyShoot = this.spaceKey.isDown;
    for (const slot of Net.players.keys()) if (Net.getInput(slot).shoot) anyShoot = true;

    if (anyShoot && !this.prevAnyShoot) {
      if (Net.players.size >= CONFIG.MIN_PLAYERS) this.scene.start('GameScene');
      else this.scene.start('LobbyScene');
    }
    this.prevAnyShoot = anyShoot;
  }
}

function signed(n) { return (n > 0 ? '+' : '') + n; }

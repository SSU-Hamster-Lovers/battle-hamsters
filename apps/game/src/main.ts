import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create() {
    this.add.text(400, 300, 'Battle Hamsters', {
      fontSize: '32px',
      color: '#fff',
    }).setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scene: MainScene,
});

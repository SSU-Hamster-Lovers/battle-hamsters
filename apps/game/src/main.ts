import Phaser from 'phaser'
import type {
  JoinRoomMessage,
  PlayerInputMessage,
  PlayerSnapshot,
  RoomSnapshotMessage,
  ServerToClientMessage,
  WorldSnapshotMessage,
} from '@battle-hamsters/shared'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const ROOM_ID = 'room_alpha'
const WS_URL =
  import.meta.env.VITE_SERVER_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8081/ws`
const PLAYER_NAME_STORAGE_KEY = 'battle-hamsters-player-name'
const INPUT_SEND_INTERVAL_MS = 50
const GROUND_TOP_Y = 540
const PIT_LEFT_X = 330
const PIT_RIGHT_X = 470
const ONE_WAY_PLATFORM_TOP_Y = 380
const ONE_WAY_PLATFORM_LEFT_X = 250
const ONE_WAY_PLATFORM_WIDTH = 300

type RenderedPlayer = {
  body: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
}

function getOrCreatePlayerName(): string {
  const existing = window.sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const generated = `hammy-${Math.random().toString(36).slice(2, 6)}`
  window.sessionStorage.setItem(PLAYER_NAME_STORAGE_KEY, generated)
  return generated
}

class MainScene extends Phaser.Scene {
  private socket: WebSocket | null = null
  private statusText!: Phaser.GameObjects.Text
  private infoText!: Phaser.GameObjects.Text
  private connectionText!: Phaser.GameObjects.Text
  private renderedPlayers = new Map<string, RenderedPlayer>()
  private playerName = getOrCreatePlayerName()
  private localPlayerId: string | null = null
  private latestTick = 0
  private sequence = 0
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private keys!: {
    w: Phaser.Input.Keyboard.Key
    a: Phaser.Input.Keyboard.Key
    s: Phaser.Input.Keyboard.Key
    d: Phaser.Input.Keyboard.Key
    q: Phaser.Input.Keyboard.Key
    space: Phaser.Input.Keyboard.Key
  }

  constructor() {
    super('MainScene')
  }

  create() {
    this.cameras.main.setBackgroundColor('#111827')
    this.drawStage()

    this.statusText = this.add
      .text(24, 20, 'Battle Hamsters', {
        fontSize: '28px',
        color: '#f9fafb',
      })
      .setDepth(10)

    this.connectionText = this.add
      .text(24, 58, `Connecting to ${WS_URL}`, {
        fontSize: '16px',
        color: '#93c5fd',
      })
      .setDepth(10)

    this.infoText = this.add
      .text(24, 88, '', {
        fontSize: '14px',
        color: '#d1d5db',
        lineSpacing: 6,
      })
      .setDepth(10)

    this.add.text(24, GAME_HEIGHT - 70, 'Move: A / D or Arrow Left / Right', {
      fontSize: '14px',
      color: '#9ca3af',
    })
    this.add.text(24, GAME_HEIGHT - 46, 'Jump: W / Space / Up  |  Down: S / Down', {
      fontSize: '14px',
      color: '#9ca3af',
    })
    this.add.text(24, GAME_HEIGHT - 22, 'Q: Drop Weapon  |  Mouse: Aim / Attack', {
      fontSize: '14px',
      color: '#9ca3af',
    })

    const keyboard = this.input.keyboard
    if (!keyboard) {
      throw new Error('Keyboard input is unavailable in this Phaser scene')
    }

    this.cursors = keyboard.createCursorKeys()
    this.keys = {
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    }

    this.time.addEvent({
      delay: INPUT_SEND_INTERVAL_MS,
      loop: true,
      callback: () => this.sendLatestInput(),
    })

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.socket?.close())
    this.events.on(Phaser.Scenes.Events.DESTROY, () => this.socket?.close())

    this.connect()
  }

  private drawStage() {
    this.add.rectangle(PIT_LEFT_X / 2, GROUND_TOP_Y + 30, PIT_LEFT_X, 120, 0x1f2937)
    this.add.rectangle(
      PIT_RIGHT_X + (GAME_WIDTH - PIT_RIGHT_X) / 2,
      GROUND_TOP_Y + 30,
      GAME_WIDTH - PIT_RIGHT_X,
      120,
      0x1f2937,
    )
    this.add.rectangle((PIT_LEFT_X + PIT_RIGHT_X) / 2, GAME_HEIGHT - 20, PIT_RIGHT_X - PIT_LEFT_X, 80, 0x7f1d1d)
    this.add.rectangle(
      ONE_WAY_PLATFORM_LEFT_X + ONE_WAY_PLATFORM_WIDTH / 2,
      ONE_WAY_PLATFORM_TOP_Y,
      ONE_WAY_PLATFORM_WIDTH,
      12,
      0x60a5fa,
    )
    this.add.text(ONE_WAY_PLATFORM_LEFT_X, ONE_WAY_PLATFORM_TOP_Y - 24, '원웨이 플랫폼', {
      fontSize: '12px',
      color: '#93c5fd',
    })
    this.add.text(24, GROUND_TOP_Y + 12, '바닥', {
      fontSize: '12px',
      color: '#d1d5db',
    })
    this.add.text(PIT_LEFT_X + 8, GAME_HEIGHT - 58, '낙사 구역', {
      fontSize: '12px',
      color: '#fecaca',
    })
  }

  private connect() {
    this.socket = new WebSocket(WS_URL)

    this.socket.addEventListener('open', () => {
      this.connectionText.setText(`Connected as ${this.playerName}`)
      this.connectionText.setColor('#86efac')
      this.send({
        type: 'join_room',
        timestamp: Date.now(),
        payload: {
          roomId: ROOM_ID,
          playerName: this.playerName,
        },
      } satisfies JoinRoomMessage)
    })

    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as ServerToClientMessage
      this.handleServerMessage(message)
    })

    this.socket.addEventListener('close', () => {
      this.connectionText.setText('Disconnected from server. Retrying in 2s...')
      this.connectionText.setColor('#fca5a5')
      this.localPlayerId = null
      this.clearRenderedPlayers()
      this.time.delayedCall(2000, () => {
        if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
          this.connect()
        }
      })
    })

    this.socket.addEventListener('error', () => {
      this.connectionText.setText('WebSocket error. Check the Rust server.')
      this.connectionText.setColor('#fca5a5')
    })
  }

  private handleServerMessage(message: ServerToClientMessage) {
    switch (message.type) {
      case 'welcome': {
        this.connectionText.setText(
          `Connected (${message.payload.connectionId}) / waiting for room join...`,
        )
        this.connectionText.setColor('#86efac')
        return
      }
      case 'room_snapshot': {
        this.applyRoomSnapshot(message)
        return
      }
      case 'world_snapshot': {
        this.applyWorldSnapshot(message)
        return
      }
      case 'player_joined': {
        this.connectionText.setText(`Player joined: ${message.payload.name}`)
        this.connectionText.setColor('#93c5fd')
        return
      }
      case 'player_left': {
        this.removeRenderedPlayer(message.payload.playerId)
        this.connectionText.setText(`Player left: ${message.payload.playerId}`)
        this.connectionText.setColor('#fca5a5')
        return
      }
      case 'pong': {
        return
      }
      case 'error': {
        this.connectionText.setText(`Server error: ${message.payload.code}`)
        this.connectionText.setColor('#fca5a5')
      }
    }
  }

  private applyRoomSnapshot(message: RoomSnapshotMessage) {
    if (message.payload.selfPlayerId) {
      this.localPlayerId = message.payload.selfPlayerId
    }
    this.renderPlayers(message.payload.players)
    this.captureLocalPlayer(message.payload.players)
    this.updateInfoText(message.payload.players, 'waiting', null)
  }

  private applyWorldSnapshot(message: WorldSnapshotMessage) {
    this.latestTick = message.payload.serverTick
    this.renderPlayers(message.payload.players)
    this.captureLocalPlayer(message.payload.players)
    this.updateInfoText(
      message.payload.players,
      message.payload.matchState,
      message.payload.timeRemainingMs,
    )
  }

  private updateInfoText(
    players: PlayerSnapshot[],
    matchState: string,
    timeRemainingMs: number | null,
  ) {
    const localPlayer = players.find((player) => player.id === this.localPlayerId)
    this.infoText.setText([
      `room: ${ROOM_ID}`,
      `players: ${players.length}`,
      `match: ${matchState}`,
      `self: ${this.localPlayerId ?? 'unknown'}`,
      `grounded: ${localPlayer?.grounded ?? false}`,
      `state: ${localPlayer?.state ?? 'unknown'}`,
      `jumps used: ${localPlayer?.jumpCountUsed ?? 0}`,
      `lives: ${localPlayer?.lives ?? 0}`,
      `tick: ${this.latestTick}`,
      `time remaining: ${timeRemainingMs === null ? 'waiting' : `${Math.ceil(timeRemainingMs / 1000)}s`}`,
    ])
  }

  private captureLocalPlayer(players: PlayerSnapshot[]) {
    if (this.localPlayerId) {
      return
    }

    const local = players.find((player) => player.name === this.playerName)
    if (local) {
      this.localPlayerId = local.id
    }
  }

  private renderPlayers(players: PlayerSnapshot[]) {
    const nextIds = new Set(players.map((player) => player.id))

    for (const player of players) {
      let rendered = this.renderedPlayers.get(player.id)
      if (!rendered) {
        rendered = {
          body: this.add.rectangle(player.position.x, player.position.y, 28, 28, 0xf59e0b),
          label: this.add.text(player.position.x, player.position.y - 28, player.name, {
            fontSize: '12px',
            color: '#f9fafb',
          }),
        }
        this.renderedPlayers.set(player.id, rendered)
      }

      const isLocalPlayer = player.id === this.localPlayerId
      const baseColor = isLocalPlayer ? 0x34d399 : 0xf59e0b
      const color = player.state === 'respawning' ? 0x94a3b8 : baseColor

      rendered.body.setFillStyle(color)
      rendered.body.setPosition(player.position.x, player.position.y)
      rendered.label.setText(player.state === 'respawning' ? `${player.name} (리스폰 중)` : player.name)
      rendered.label.setPosition(player.position.x - rendered.label.width / 2, player.position.y - 32)
      rendered.body.setAlpha(player.state === 'alive' ? 1 : 0.35)
    }

    for (const [playerId] of this.renderedPlayers) {
      if (!nextIds.has(playerId)) {
        this.removeRenderedPlayer(playerId)
      }
    }
  }

  private removeRenderedPlayer(playerId: string) {
    const rendered = this.renderedPlayers.get(playerId)
    if (!rendered) {
      return
    }

    rendered.body.destroy()
    rendered.label.destroy()
    this.renderedPlayers.delete(playerId)
  }

  private clearRenderedPlayers() {
    for (const playerId of [...this.renderedPlayers.keys()]) {
      this.removeRenderedPlayer(playerId)
    }
  }

  private sendLatestInput() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    const localPlayer = this.localPlayerId ? this.renderedPlayers.get(this.localPlayerId) : null
    const pointer = this.input.activePointer
    const originX = localPlayer?.body.x ?? GAME_WIDTH / 2
    const originY = localPlayer?.body.y ?? GAME_HEIGHT / 2
    const aimX = pointer.worldX - originX
    const aimY = pointer.worldY - originY
    const aimLength = Math.hypot(aimX, aimY) || 1

    const moveX =
      Number(this.cursors.right.isDown || this.keys.d.isDown) -
      Number(this.cursors.left.isDown || this.keys.a.isDown)
    const moveY = Number(this.cursors.down.isDown || this.keys.s.isDown)

    this.send({
      type: 'player_input',
      timestamp: Date.now(),
      payload: {
        sequence: ++this.sequence,
        move: { x: moveX, y: moveY },
        aim: { x: aimX / aimLength, y: aimY / aimLength },
        jump:
          Phaser.Input.Keyboard.JustDown(this.keys.space) ||
          Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
          Phaser.Input.Keyboard.JustDown(this.keys.w),
        attack: pointer.isDown,
        dropWeapon: Phaser.Input.Keyboard.JustDown(this.keys.q),
      },
    } satisfies PlayerInputMessage)
  }

  private send(message: JoinRoomMessage | PlayerInputMessage) {
    this.socket?.send(JSON.stringify(message))
  }

  update() {
    this.statusText.setText(`Battle Hamsters  |  server tick ${this.latestTick}  |  room ${ROOM_ID}`)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#111827',
  scene: MainScene,
})

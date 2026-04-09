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

type RenderedPlayer = {
  body: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
}

function getOrCreatePlayerName(): string {
  const existing = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const generated = `hammy-${Math.random().toString(36).slice(2, 6)}`
  window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, generated)
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

    this.add.text(24, GAME_HEIGHT - 70, 'Move: WASD / Arrow Keys', {
      fontSize: '14px',
      color: '#9ca3af',
    })
    this.add.text(24, GAME_HEIGHT - 46, 'Jump: Space / Up  |  Drop Weapon: Q', {
      fontSize: '14px',
      color: '#9ca3af',
    })
    this.add.text(24, GAME_HEIGHT - 22, 'Aim / Attack: Mouse', {
      fontSize: '14px',
      color: '#9ca3af',
    })

    const keyboard = this.input.keyboard
    if (!keyboard) {
      throw new Error('Keyboard input is unavailable in this Phaser scene')
    }

    this.cursors = keyboard.createCursorKeys()
    this.keys = keyboard.addKeys('W,A,S,D,Q,SPACE') as MainScene['keys']

    this.time.addEvent({
      delay: INPUT_SEND_INTERVAL_MS,
      loop: true,
      callback: () => this.sendLatestInput(),
    })

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.socket?.close())
    this.events.on(Phaser.Scenes.Events.DESTROY, () => this.socket?.close())

    this.connect()
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
    this.renderPlayers(message.payload.players)
    this.captureLocalPlayer(message.payload.players)
    this.infoText.setText([
      `room: ${message.payload.roomId}`,
      `players: ${message.payload.players.length}`,
      `match: ${message.payload.matchState}`,
      'tick: waiting',
    ])
  }

  private applyWorldSnapshot(message: WorldSnapshotMessage) {
    this.latestTick = message.payload.serverTick
    this.renderPlayers(message.payload.players)
    this.captureLocalPlayer(message.payload.players)
    this.infoText.setText([
      `room: ${message.payload.roomId}`,
      `players: ${message.payload.players.length}`,
      `match: ${message.payload.matchState}`,
      `tick: ${message.payload.serverTick}`,
      `time remaining: ${Math.ceil(message.payload.timeRemainingMs / 1000)}s`,
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

      const isLocalPlayer = player.id === this.localPlayerId || player.name === this.playerName
      rendered.body.setFillStyle(isLocalPlayer ? 0x34d399 : 0xf59e0b)
      rendered.body.setPosition(player.position.x, player.position.y)
      rendered.label.setText(player.name)
      rendered.label.setPosition(player.position.x - rendered.label.width / 2, player.position.y - 32)
      rendered.body.setAlpha(player.state === 'alive' ? 1 : 0.5)
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
    const moveY =
      Number(this.cursors.down.isDown || this.keys.s.isDown) -
      Number(this.cursors.up.isDown || this.keys.w.isDown)

    this.send({
      type: 'player_input',
      timestamp: Date.now(),
      payload: {
        sequence: ++this.sequence,
        move: { x: moveX, y: moveY },
        aim: { x: aimX / aimLength, y: aimY / aimLength },
        jump:
          Phaser.Input.Keyboard.JustDown(this.keys.space) ||
          Phaser.Input.Keyboard.JustDown(this.cursors.up),
        attack: pointer.isDown,
        dropWeapon: Phaser.Input.Keyboard.JustDown(this.keys.q),
      },
    } satisfies PlayerInputMessage)
  }

  private send(message: JoinRoomMessage | PlayerInputMessage) {
    this.socket?.send(JSON.stringify(message))
  }

  update() {
    this.statusText.setText(
      `Battle Hamsters  |  server tick ${this.latestTick}  |  room ${ROOM_ID}`,
    )
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#111827',
  scene: MainScene,
})

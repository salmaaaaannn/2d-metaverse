import Phaser from 'phaser'
import Player from './Player'
import MyPlayer from './MyPlayer'
import { sittingShiftData } from './Player'
import WebRTC from '../web/WebRTC'
import { Event, phaserEvents } from '../events/EventCenter'

export default class OtherPlayer extends Player {
  private targetPosition: [number, number]
  private lastUpdateTimestamp?: number
  private connectionBufferTime = 0
  private connected = false
  private playContainerBody: Phaser.Physics.Arcade.Body
  private myPlayer?: MyPlayer
  private onPlayerDisconnectedListener: (id: string) => void

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    id: string,
    name: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, id, frame)
    this.targetPosition = [x, y]

    this.playerName.setText(name)
    this.playContainerBody = this.playerContainer.body as Phaser.Physics.Arcade.Body

    // Reset connected flag when the call is ended by Game.ts (proximity lost)
    this.onPlayerDisconnectedListener = (disconnectedId: string) => {
      if (disconnectedId === this.playerId) {
        this.connected = false
        this.connectionBufferTime = 0 // Reset buffer to avoid immediate re-call flicker
      }
    }
    phaserEvents.on(Event.PLAYER_DISCONNECTED, this.onPlayerDisconnectedListener)
  }

  /**
   * makeCall is triggered by Game.ts proximity check.
   * Uses a tie‑breaker (higher ID calls) to avoid duplicate calls.
   */
  makeCall(myPlayer: MyPlayer, webRTC: WebRTC) {
    this.myPlayer = myPlayer
    const myPlayerId = myPlayer.playerId

    // Log the conditions (useful for debugging)
    console.log(`[OtherPlayer] makeCall ${this.playerId}:
      connected=${this.connected},
      buffer=${this.connectionBufferTime},
      myPlayer.ready=${myPlayer.readyToConnect},
      this.ready=${this.readyToConnect},
      myPlayer.video=${myPlayer.videoConnected},
      idCondition=${myPlayerId > this.playerId}`)

    // Conditions for initiating a call:
    // - Not already connected
    // - Buffer time > 100ms (reduced from 750ms for faster response)
    // - Both players are ready and have video connected
    // - ID tie‑breaker: only the player with the higher ID initiates
    if (
      !this.connected &&
      this.connectionBufferTime >= 100 && // <-- Reduced for faster call start
      myPlayer.readyToConnect &&
      this.readyToConnect &&
      myPlayer.videoConnected &&
      myPlayerId > this.playerId
    ) {
      console.log(`🎥 Proximity call initiated: ${myPlayerId} -> ${this.playerId}`)
      webRTC.connectToNewUser(this.playerId)
      this.connected = true
      this.connectionBufferTime = 0
    }
  }

  updateOtherPlayer(field: string, value: number | string | boolean) {
    switch (field) {
      case 'name':
        if (typeof value === 'string') this.playerName.setText(value)
        break
      case 'x':
        if (typeof value === 'number') this.targetPosition[0] = value
        break
      case 'y':
        if (typeof value === 'number') this.targetPosition[1] = value
        break
      case 'anim':
        if (typeof value === 'string') this.anims.play(value, true)
        break
      case 'readyToConnect':
        if (typeof value === 'boolean') this.readyToConnect = value
        break
      case 'videoConnected':
        if (typeof value === 'boolean') this.videoConnected = value
        break
    }
  }

  destroy(fromScene?: boolean) {
    phaserEvents.off(Event.PLAYER_DISCONNECTED, this.onPlayerDisconnectedListener)
    this.playerContainer.destroy()
    super.destroy(fromScene)
  }

  preUpdate(t: number, dt: number) {
    super.preUpdate(t, dt)

    // Snap logic if tab inactive (prevents players from "flying" across screen)
    if (this.lastUpdateTimestamp && t - this.lastUpdateTimestamp > 750) {
      this.lastUpdateTimestamp = t
      this.x = this.targetPosition[0]
      this.y = this.targetPosition[1]
      this.playerContainer.x = this.targetPosition[0]
      this.playerContainer.y = this.targetPosition[1] - 30
      return
    }

    this.lastUpdateTimestamp = t
    this.setDepth(this.y)

    // Sitting animation depth adjustment
    const animParts = this.anims.currentAnim.key.split('_')
    const animState = animParts[1]
    if (animState === 'sit') {
      const animDir = animParts[2]
      const sittingShift = sittingShiftData[animDir]
      if (sittingShift) {
        this.setDepth(this.depth + sittingShiftData[animDir][2])
      }
    }

    // Movement interpolation
    const speed = 200
    const delta = (speed / 1000) * dt
    let dx = this.targetPosition[0] - this.x
    let dy = this.targetPosition[1] - this.y

    if (Math.abs(dx) < delta) {
      this.x = this.targetPosition[0]
      this.playerContainer.x = this.targetPosition[0]
      dx = 0
    }
    if (Math.abs(dy) < delta) {
      this.y = this.targetPosition[1]
      this.playerContainer.y = this.targetPosition[1] - 30
      dy = 0
    }

    let vx = 0, vy = 0
    if (dx > 0) vx += speed
    else if (dx < 0) vx -= speed
    if (dy > 0) vy += speed
    else if (dy < 0) vy -= speed

    this.setVelocity(vx, vy)
    this.body.velocity.setLength(speed)
    this.playContainerBody.setVelocity(vx, vy)
    this.playContainerBody.velocity.setLength(speed)

    // Increment buffer time so makeCall knows how long the player has been near
    this.connectionBufferTime += dt
  }
}

/** Register the otherPlayer factory for easy use in Game.ts */
declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      otherPlayer(
        x: number, y: number, texture: string,
        id: string, name: string, frame?: string | number
      ): OtherPlayer
    }
  }
}

Phaser.GameObjects.GameObjectFactory.register(
  'otherPlayer',
  function (this: Phaser.GameObjects.GameObjectFactory, x, y, texture, id, name, frame) {
    const sprite = new OtherPlayer(this.scene, x, y, texture, id, name, frame)
    this.displayList.add(sprite)
    this.updateList.add(sprite)
    this.scene.physics.world.enableBody(sprite, Phaser.Physics.Arcade.DYNAMIC_BODY)

    const collisionScale = [6, 4]
    sprite.body
      .setSize(sprite.width * collisionScale[0], sprite.height * collisionScale[1])
      .setOffset(
        sprite.width * (1 - collisionScale[0]) * 0.5,
        sprite.height * (1 - collisionScale[1]) * 0.5 + 17
      )

    return sprite
  }
)
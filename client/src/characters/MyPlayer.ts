import Phaser from 'phaser'
import PlayerSelector from './PlayerSelector'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import { sittingShiftData } from './Player'
import Player from './Player'
import Network from '../services/Network'
import Chair from '../items/Chair'
import Computer from '../items/Computer'
import Whiteboard from '../items/Whiteboard'

import { phaserEvents, Event } from '../events/EventCenter'
import store from '../stores'
import { pushPlayerJoinedMessage } from '../stores/ChatStore'
import { setPlayerNameMap } from '../stores/UserStore' // <-- ADD THIS IMPORT
import { ItemType } from '../../../types/Items'
import { NavKeys } from '../../../types/KeyboardState'
import { JoystickMovement } from '../components/Joystick'
import { openURL } from '../utils/helpers'

export default class MyPlayer extends Player {
  private playContainerBody: Phaser.Physics.Arcade.Body
  private chairOnSit?: Chair
  public joystickMovement?: JoystickMovement
  
  private pendingChair?: Chair
  private sitRequestTime?: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    id: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, id, frame)
    this.playContainerBody = this.playerContainer.body as Phaser.Physics.Arcade.Body

    phaserEvents.on(Event.ITEM_USER_ADDED, this.onItemUserAdded, this)
    phaserEvents.on('chair-occupied', this.onChairOccupied, this)
  }

  private onItemUserAdded(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.CHAIR && playerId === this.playerId) {
      if (this.pendingChair && this.pendingChair.id === itemId) {
        this.performSit(this.pendingChair)
        this.pendingChair = undefined
      }
    }
  }

  private onChairOccupied(chairId: string) {
    if (this.pendingChair && this.pendingChair.id === chairId) {
      this.pendingChair = undefined
      this.showTemporaryMessage('Seat occupied!')
    }
  }

  destroy(fromScene?: boolean) {
    phaserEvents.off(Event.ITEM_USER_ADDED, this.onItemUserAdded, this)
    phaserEvents.off('chair-occupied', this.onChairOccupied, this)
    super.destroy(fromScene)
  }

  setPlayerName(name: string) {
    this.playerName.setText(name)
    phaserEvents.emit(Event.MY_PLAYER_NAME_CHANGE, name)
    store.dispatch(pushPlayerJoinedMessage(name))
    // Store local player's name in Redux so whiteboard shows it correctly
    store.dispatch(setPlayerNameMap({ id: this.playerId, name }))
  }

  setPlayerTexture(texture: string) {
    this.playerTexture = texture
    this.anims.play(`${this.playerTexture}_idle_down`, true)
    phaserEvents.emit(Event.MY_PLAYER_TEXTURE_CHANGE, this.x, this.y, this.anims.currentAnim.key)
  }

  handleJoystickMovement(movement: JoystickMovement) {
    this.joystickMovement = movement
  }

  update(
    playerSelector: PlayerSelector,
    cursors: NavKeys,
    keyE: Phaser.Input.Keyboard.Key,
    keyR: Phaser.Input.Keyboard.Key,
    network: Network
  ) {
    if (!cursors) return

    const item = playerSelector.selectedItem

    if (Phaser.Input.Keyboard.JustDown(keyR)) {
      switch (item?.itemType) {
        case ItemType.COMPUTER:
          const computer = item as Computer
          computer.openDialog(this.playerId, network)
          break
        case ItemType.WHITEBOARD:
          const whiteboard = item as Whiteboard
          whiteboard.openDialog(network)
          break
        case ItemType.VENDINGMACHINE:
          const url = 'https://www.buymeacoffee.com/skyoffice'
          openURL(url)
          break
      }
    }

    switch (this.playerBehavior) {
      case PlayerBehavior.IDLE:
        if (Phaser.Input.Keyboard.JustDown(keyE) && item?.itemType === ItemType.CHAIR) {
          const chairItem = item as Chair

          if (chairItem.currentUsers && chairItem.currentUsers.size > 0) {
            this.showTemporaryMessage('Seat occupied')
            return
          }

          if (chairItem.id) {
            network.connectToChair(chairItem.id)
            this.pendingChair = chairItem
            this.sitRequestTime = this.scene.time.now

            this.scene.time.addEvent({
              delay: 2000,
              callback: () => {
                if (this.pendingChair === chairItem) {
                  this.pendingChair = undefined
                  if (this.playerBehavior === PlayerBehavior.IDLE) {
                    this.showTemporaryMessage('Failed to sit (Timeout)')
                  }
                }
              },
            })
          }
          return
        }

        const speed = 200
        let vx = 0
        let vy = 0

        let joystickLeft = false
        let joystickRight = false
        let joystickUp = false
        let joystickDown = false

        if (this.joystickMovement?.isMoving) {
          joystickLeft = this.joystickMovement.direction.left
          joystickRight = this.joystickMovement.direction.right
          joystickUp = this.joystickMovement.direction.up
          joystickDown = this.joystickMovement.direction.down
        }

        if (cursors.left?.isDown || cursors.A?.isDown || joystickLeft) vx -= speed
        if (cursors.right?.isDown || cursors.D?.isDown || joystickRight) vx += speed
        if (cursors.up?.isDown || cursors.W?.isDown || joystickUp) {
          vy -= speed
          this.setDepth(this.y)
        }
        if (cursors.down?.isDown || cursors.S?.isDown || joystickDown) {
          vy += speed
          this.setDepth(this.y)
        }
        this.setVelocity(vx, vy)
        this.body.velocity.setLength(speed)
        this.playContainerBody.setVelocity(vx, vy)
        this.playContainerBody.velocity.setLength(speed)

        if (vx !== 0 || vy !== 0) network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
        if (vx > 0) {
          this.play(`${this.playerTexture}_run_right`, true)
        } else if (vx < 0) {
          this.play(`${this.playerTexture}_run_left`, true)
        } else if (vy > 0) {
          this.play(`${this.playerTexture}_run_down`, true)
        } else if (vy < 0) {
          this.play(`${this.playerTexture}_run_up`, true)
        } else {
          const parts = this.anims.currentAnim.key.split('_')
          parts[1] = 'idle'
          const newAnim = parts.join('_')
          if (this.anims.currentAnim.key !== newAnim) {
            this.play(parts.join('_'), true)
            network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
          }
        }
        break

      case PlayerBehavior.SITTING:
        if (Phaser.Input.Keyboard.JustDown(keyE)) {
          const parts = this.anims.currentAnim.key.split('_')
          parts[1] = 'idle'
          this.play(parts.join('_'), true)
          this.playerBehavior = PlayerBehavior.IDLE

          if (this.chairOnSit) {
            if (this.chairOnSit.id) {
              network.disconnectFromChair(this.chairOnSit.id)
            }
            this.chairOnSit.removeCurrentUser(this.playerId)
            this.chairOnSit.clearDialogBox()
            this.chairOnSit = undefined
          }

          playerSelector.setPosition(this.x, this.y)
          playerSelector.update(this, cursors)
          network.updatePlayer(this.x, this.y, this.anims.currentAnim.key)
        }
        break
    }
  }

  private performSit(chairItem: Chair) {
    this.setVelocity(0, 0)
    
    if (chairItem.itemDirection) {
      this.setPosition(
        chairItem.x + sittingShiftData[chairItem.itemDirection][0],
        chairItem.y + sittingShiftData[chairItem.itemDirection][1]
      ).setDepth(chairItem.depth + sittingShiftData[chairItem.itemDirection][2])

      this.playContainerBody.setVelocity(0, 0)
      this.playerContainer.setPosition(
        chairItem.x + sittingShiftData[chairItem.itemDirection][0],
        chairItem.y + sittingShiftData[chairItem.itemDirection][1] - 30
      )
    }

    this.play(`${this.playerTexture}_sit_${chairItem.itemDirection}`, true)
    
    phaserEvents.emit(Event.MY_PLAYER_TEXTURE_CHANGE, this.x, this.y, this.anims.currentAnim.key)

    chairItem.setDialogBox('Press E to leave')
    this.chairOnSit = chairItem
    this.playerBehavior = PlayerBehavior.SITTING
  }

  private showTemporaryMessage(message: string) {
    phaserEvents.emit(Event.UPDATE_DIALOG_BUBBLE, this.playerId, message)
    this.scene.time.addEvent({
      delay: 2000,
      callback: () => {
        phaserEvents.emit(Event.UPDATE_DIALOG_BUBBLE, this.playerId, '')
      },
    })
  }
}

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      myPlayer(x: number, y: number, texture: string, id: string, frame?: string | number): MyPlayer
    }
  }
}

Phaser.GameObjects.GameObjectFactory.register(
  'myPlayer',
  function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    texture: string,
    id: string,
    frame?: string | number
  ) {
    const sprite = new MyPlayer(this.scene, x, y, texture, id, frame)
    this.displayList.add(sprite)
    this.updateList.add(sprite)
    this.scene.physics.world.enableBody(sprite, Phaser.Physics.Arcade.DYNAMIC_BODY)
    const collisionScale = [0.5, 0.2]
    sprite.body
      .setSize(sprite.width * collisionScale[0], sprite.height * collisionScale[1])
      .setOffset(
        sprite.width * (1 - collisionScale[0]) * 0.5,
        sprite.height * (1 - collisionScale[1])
      )
    return sprite
  }
)
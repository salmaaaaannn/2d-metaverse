import { ItemType } from '../../../types/Items'
import Item from './Item'

export default class Chair extends Item {
  id?: string
  itemDirection?: string
  currentUsers = new Set<string>()

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)

    this.itemType = ItemType.CHAIR
  }

  private updateStatus() {
    const numberOfUsers = this.currentUsers.size
    this.clearStatusBox()
    if (numberOfUsers === 1) {
      this.setStatusBox('Occupied')
    } else {
      this.clearStatusBox()
    }
  }

  onOverlapDialog() {
    if (this.currentUsers.size === 0) {
      this.setDialogBox('Press E to sit')
    } else {
      this.setDialogBox('Seat occupied')
    }
  }

  addCurrentUser(userId: string) {
    if (this.currentUsers.has(userId)) return
    this.currentUsers.add(userId)
    this.updateStatus()
  }

  removeCurrentUser(userId: string) {
    if (!this.currentUsers.has(userId)) return
    this.currentUsers.delete(userId)
    this.updateStatus()
  }
}
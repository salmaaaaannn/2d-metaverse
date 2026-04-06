import Phaser from 'phaser'
import { ItemType } from '../../../types/Items'
import store from '../stores'
import Item from './Item'
import Network from '../services/Network'
import { openWhiteboardDialog } from '../stores/WhiteboardStore'

export default class Whiteboard extends Item {
  id?: string
  currentUsers = new Set<string>()

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)
    this.itemType = ItemType.WHITEBOARD
  }

  private updateStatus() {
    if (!this.currentUsers) return
    const count = this.currentUsers.size
    this.clearStatusBox()
    if (count === 1) this.setStatusBox(`${count} user`)
    else if (count > 1) this.setStatusBox(`${count} users`)
  }

  onOverlapDialog() {
    if (this.currentUsers.size === 0) {
      this.setDialogBox('Press R to use whiteboard')
    } else {
      this.setDialogBox('Press R to join')
    }
  }

  addCurrentUser(userId: string) {
    if (!this.currentUsers || this.currentUsers.has(userId)) return
    this.currentUsers.add(userId)
    this.updateStatus()
  }

  removeCurrentUser(userId: string) {
    if (!this.currentUsers || !this.currentUsers.has(userId)) return
    this.currentUsers.delete(userId)
    this.updateStatus()
  }

  openDialog(network: Network) {
    if (!this.id) {
      console.error('Whiteboard ID is missing')
      return
    }
    // Open the React dialog
    store.dispatch(openWhiteboardDialog(this.id))
    // Tell the server we're connected to this whiteboard
    network.connectToWhiteboard(this.id)
  }
}
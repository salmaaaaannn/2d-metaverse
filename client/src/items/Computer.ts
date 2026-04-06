import { ItemType } from '../../../types/Items'
import store from '../stores'
import Item from './Item'
import Network from '../services/Network'
import { openComputerDialog } from '../stores/ComputerStore'

export default class Computer extends Item {
  id?: string
  currentUsers = new Set<string>()

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, frame?: string | number) {
    super(scene, x, y, texture, frame)
    this.itemType = ItemType.COMPUTER
  }

  private updateStatus() {
    if (!this.currentUsers) return
    const numberOfUsers = this.currentUsers.size
    this.clearStatusBox()
    if (numberOfUsers === 1) {
      this.setStatusBox(`${numberOfUsers} user`)
    } else if (numberOfUsers > 1) {
      this.setStatusBox(`${numberOfUsers} users`)
    }
  }

  onOverlapDialog() {
    if (this.currentUsers.size === 0) {
      this.setDialogBox('Press R to use computer')
    } else {
      this.setDialogBox('Press R to request control')
    }
  }

  addCurrentUser(userId: string) {
    if (!this.currentUsers || this.currentUsers.has(userId)) return
    this.currentUsers.add(userId)
    console.log(`[Computer ${this.id}] addCurrentUser: ${userId}`)
    
    // Notify screen share manager if we are currently viewing this computer
    const computerState = store.getState().computer
    if (computerState.computerId === this.id) {
      computerState.shareScreenManager?.onUserJoined?.(userId)
    }
    this.updateStatus()
  }

  removeCurrentUser(userId: string) {
    if (!this.currentUsers || !this.currentUsers.has(userId)) return
    this.currentUsers.delete(userId)
    console.log(`[Computer ${this.id}] removeCurrentUser: ${userId}`)
    
    const computerState = store.getState().computer
    if (computerState.computerId === this.id) {
      computerState.shareScreenManager?.onUserLeft?.(userId)
    }
    this.updateStatus()
  }

  openDialog(playerId: string, network: Network) {
    if (!this.id) return

    // REMOTE CONTROL LOGIC:
    // If computer is occupied by someone else, we request control instead of joining directly.
    if (this.currentUsers.size > 0 && !this.currentUsers.has(playerId)) {
      console.log(`[Computer ${this.id}] requesting control...`)
      network.requestControl(this.id)
      
      // Open dialog (it will show "Waiting for approval" based on ComputerStore state)
      store.dispatch(openComputerDialog({ computerId: this.id, myUserId: playerId }))
      return
    }

    // NORMAL LOGIC:
    // Computer is empty, or we are already using it.
    console.log(`[Computer ${this.id}] connecting normally...`)
    store.dispatch(openComputerDialog({ computerId: this.id, myUserId: playerId }))
    network.connectToComputer(this.id)
  }
}
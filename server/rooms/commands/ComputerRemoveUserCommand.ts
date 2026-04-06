import { Command } from '@colyseus/command'
import { Client } from 'colyseus'
import { OfficeState } from '../schema/OfficeState'

export class ComputerRemoveUserCommand extends Command<OfficeState, { client: Client; computerId: string }> {
  execute({ client, computerId }: { client: Client; computerId: string }) {
    const computer = this.state.computers.get(computerId)
    if (!computer) return

    // Remove the user from the computer's connectedUser set
    computer.connectedUser.delete(client.sessionId)

    // Also clear any control state if this user was controlling or being controlled
    if (computer.controlledBy === client.sessionId) {
      computer.controlledBy = ''
    }
    if (computer.controlRequestedBy === client.sessionId) {
      computer.controlRequestedBy = ''
    }

    // The schema syncs automatically; clients will receive onRemove and update their local state.
  }
}
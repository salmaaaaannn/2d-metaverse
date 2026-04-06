import { Command } from "@colyseus/command"
import { Client } from "colyseus"
import { IOfficeState } from "../../../types/IOfficeState"

export class ComputerAddUserCommand extends Command<IOfficeState, { client: Client; computerId: string }> {
  execute({ client, computerId }: { client: Client; computerId: string }) {
    const computer = this.room.state.computers.get(computerId)
    const clientId = client.sessionId

    if (!computer) {
      console.log(`❌ ComputerAddUserCommand: computer ${computerId} not found`)
      return
    }

    if (computer.connectedUser.has(clientId)) {
      console.log(`⚠️ ComputerAddUserCommand: user ${clientId} already on computer ${computerId}`)
      return
    }

    computer.connectedUser.add(clientId)
    console.log(`✅ ComputerAddUserCommand: user ${clientId} added to computer ${computerId}`)
  }
}
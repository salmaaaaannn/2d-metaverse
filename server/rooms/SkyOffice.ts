import bcrypt from 'bcrypt'
import { Room, Client, ServerError } from 'colyseus'
import { Dispatcher } from '@colyseus/command'
import { Player, OfficeState, Computer, Whiteboard, Chair } from './schema/OfficeState'
import { Message } from '../../types/Messages'
import { IRoomData } from '../../types/Rooms'
import { whiteboardRoomIds } from './schema/OfficeState'
import PlayerUpdateCommand from './commands/PlayerUpdateCommand'
import PlayerUpdateNameCommand from './commands/PlayerUpdateNameCommand'
import { ComputerAddUserCommand, ComputerRemoveUserCommand } from './commands/ComputerUpdateArrayCommand'
import { WhiteboardAddUserCommand, WhiteboardRemoveUserCommand } from './commands/WhiteboardUpdateArrayCommand'
import ChatMessageUpdateCommand from './commands/ChatMessageUpdateCommand'

export class SkyOffice extends Room<OfficeState> {
  private dispatcher = new Dispatcher(this)
  private name!: string
  private description!: string
  private password: string | null = null

  // ── Whiteboard accumulated state ──────────────────────────────────────────
  private whiteboardStates = new Map<string, Map<string, any>>()

  // ── Native agents map (optional OS-level control) ─────────────────────────
  private agents = new Map<string, Client>()

  async onCreate(options: IRoomData) {
    const { name, description, password, autoDispose } = options
    this.name = name
    this.description = description
    this.autoDispose = autoDispose

    let hasPassword = false
    if (password) {
      const salt = await bcrypt.genSalt(10)
      this.password = await bcrypt.hash(password, salt)
      hasPassword = true
    }
    this.setMetadata({ name, description, hasPassword })
    this.setState(new OfficeState())

    // Initialize Computers
    for (let i = 0; i < 5; i++) {
      this.state.computers.set(String(i), new Computer())
    }

    // Initialize Whiteboards and pre‑allocate state maps
    for (let i = 0; i < 3; i++) {
      this.state.whiteboards.set(String(i), new Whiteboard())
      this.whiteboardStates.set(String(i), new Map())
    }

    // Initialize Chairs
    for (let i = 0; i < 60; i++) {
      this.state.chairs.set(`chair_${i}`, new Chair())
    }

    // ==========================================================================
    // WHITEBOARD REAL-TIME SYNC
    // ==========================================================================
    this.onMessage('whiteboard_update', (client, message: {
      whiteboardId: string
      added?: Record<string, any>
      updated?: Record<string, any>
      removed?: Record<string, any>
    }) => {
      const { whiteboardId, added, updated, removed } = message
      const addedCount = Object.keys(added || {}).length
      const updatedCount = Object.keys(updated || {}).length
      const removedCount = Object.keys(removed || {}).length
      
      console.log('📥 SERVER: whiteboard_update from', client.sessionId, 'for whiteboard', whiteboardId, {
        addedCount,
        updatedCount,
        removedCount,
      })

      // Ensure whiteboard state exists
      if (!this.whiteboardStates.has(whiteboardId)) {
        this.whiteboardStates.set(whiteboardId, new Map())
        console.log('📦 SERVER: Created new whiteboard state for', whiteboardId)
      }
      const state = this.whiteboardStates.get(whiteboardId)!

      // Store added shapes
      if (added && addedCount > 0) {
        for (const [id, record] of Object.entries(added)) {
          state.set(id, record)
          console.log(`  ✅ STORED: Shape ${id} (type=${record.type}, author=${record.meta?.authorName})`)
        }
      }
      
      // Store updated shapes
      if (updated && updatedCount > 0) {
        for (const [id, record] of Object.entries(updated)) {
          state.set(id, record)
          console.log(`  🔄 UPDATED: Shape ${id} (type=${record.type}, author=${record.meta?.authorName})`)
        }
      }
      
      // Remove deleted shapes
      if (removed && removedCount > 0) {
        for (const id of Object.keys(removed)) {
          state.delete(id)
          console.log(`  🗑️ DELETED: Shape ${id}`)
        }
      }

      console.log(`📊 SERVER: Whiteboard ${whiteboardId} now has ${state.size} total shapes`)
      
      // Broadcast to all OTHER clients (not sender)
      console.log('📢 SERVER: Broadcasting update to', this.clients.length - 1, 'other clients')
      this.broadcast('whiteboard_update', message, { except: client })
    })

    this.onMessage('request_whiteboard_state', (client, { whiteboardId }: { whiteboardId: string }) => {
      const state = this.whiteboardStates.get(whiteboardId)
      const shapeCount = state?.size || 0
      
      console.log('📥 SERVER: request_whiteboard_state from', client.sessionId, 'for whiteboard', whiteboardId, '| shapes:', shapeCount)
      
      if (!state || state.size === 0) {
        console.log('📤 SERVER: Sending empty whiteboard_full_state')
        client.send('whiteboard_full_state', { whiteboardId, records: {} })
        return
      }
      
      // Convert Map to Object for transmission
      const records: Record<string, any> = {}
      state.forEach((record, id) => {
        records[id] = record
        console.log(`  📦 SENDING: ${id} (type=${record.type}, author=${record.meta?.authorName})`)
      })
      
      console.log(`📤 SERVER: Sending whiteboard_full_state with ${Object.keys(records).length} shapes to ${client.sessionId}`)
      client.send('whiteboard_full_state', { whiteboardId, records })
    })

    // ==========================================================================
    // CHAIR LOGIC
    // ==========================================================================
    this.onMessage(Message.CONNECT_TO_CHAIR, (client, { chairId }: { chairId: string }) => {
      const chair = this.state.chairs.get(chairId)
      if (!chair) return
      if (chair.connectedUser.size === 0) {
        chair.connectedUser.add(client.sessionId)
      } else {
        client.send('chair_occupied', { chairId })
      }
    })

    this.onMessage(Message.DISCONNECT_FROM_CHAIR, (client, { chairId }: { chairId: string }) => {
      const chair = this.state.chairs.get(chairId)
      if (chair) chair.connectedUser.delete(client.sessionId)
    })

    // ==========================================================================
    // COMPUTER LOGIC
    // ==========================================================================
    this.onMessage(Message.CONNECT_TO_COMPUTER, (client, { computerId }: { computerId: string }) => {
      this.dispatcher.dispatch(new ComputerAddUserCommand(), { client, computerId })
    })

    this.onMessage(Message.DISCONNECT_FROM_COMPUTER, (client, { computerId }: { computerId: string }) => {
      this.dispatcher.dispatch(new ComputerRemoveUserCommand(), { client, computerId })
      const computer = this.state.computers.get(computerId)
      if (computer) {
        let ownerId: string | undefined
        computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
        if (!ownerId || ownerId === client.sessionId) {
          if (computer.controlledBy) {
            const ctrl = this.clients.find(c => c.sessionId === computer.controlledBy)
            ctrl?.send('control_ended', { computerId, reason: 'owner_left' })
          }
          computer.controlledBy = ''
          computer.controlRequestedBy = ''
        }
      }
    })

    this.onMessage(Message.STOP_SCREEN_SHARE, (client, { computerId }: { computerId: string }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer) return
      computer.connectedUser.forEach((id: string) => {
        this.clients.forEach((cli) => {
          if (cli.sessionId === id && cli.sessionId !== client.sessionId) {
            cli.send(Message.STOP_SCREEN_SHARE, client.sessionId)
          }
        })
      })
    })

    // ==========================================================================
    // REMOTE CONTROL
    // ==========================================================================
    this.onMessage('request_control', (client, { computerId }: { computerId: string }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer) return

      let ownerId: string | undefined
      computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
      if (!ownerId) return
      if (computer.controlledBy || computer.controlRequestedBy) return
      if (ownerId === client.sessionId) return

      computer.controlRequestedBy = client.sessionId
      const ownerClient = this.clients.find(c => c.sessionId === ownerId)
      ownerClient?.send('control_request', { computerId, requesterId: client.sessionId })
      client.send('control_request_pending', { computerId })
    })

    this.onMessage('grant_control', (client, { computerId, requesterId }: { computerId: string; requesterId: string }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer) return

      let ownerId: string | undefined
      computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
      if (client.sessionId !== ownerId) return
      if (computer.controlRequestedBy !== requesterId) return

      computer.controlledBy = requesterId
      computer.controlRequestedBy = ''
      this.clients.find(c => c.sessionId === requesterId)?.send('control_granted', { computerId })
      client.send('control_grant_ack', { computerId, controllerId: requesterId })
    })

    this.onMessage('deny_control', (client, { computerId }: { computerId: string }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer) return

      let ownerId: string | undefined
      computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
      if (client.sessionId !== ownerId) return

      const requesterId = computer.controlRequestedBy
      computer.controlRequestedBy = ''
      if (requesterId) {
        this.clients.find(c => c.sessionId === requesterId)?.send('control_denied', { computerId })
      }
    })

    this.onMessage('cancel_control_request', (client, { computerId }: { computerId: string }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer) return
      if (computer.controlRequestedBy !== client.sessionId) return

      computer.controlRequestedBy = ''
      let ownerId: string | undefined
      computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
      if (ownerId) {
        this.clients.find(c => c.sessionId === ownerId)?.send('control_request_cancelled', { computerId })
      }
    })

    this.onMessage('release_control', (client, { computerId }: { computerId: string }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer) return

      let ownerId: string | undefined
      computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
      const isOwner = client.sessionId === ownerId
      const isController = computer.controlledBy === client.sessionId
      if (!isOwner && !isController) return

      const prevControllerId = computer.controlledBy
      computer.controlledBy = ''

      if (isOwner && prevControllerId) {
        this.clients.find(c => c.sessionId === prevControllerId)?.send('control_ended', { computerId, reason: 'owner_revoked' })
      } else if (isController && ownerId) {
        this.clients.find(c => c.sessionId === ownerId)?.send('control_ended', { computerId, reason: 'controller_left' })
      }
    })

    this.onMessage('input_event', (client, { computerId, event }: { computerId: string; event: any }) => {
      const computer = this.state.computers.get(computerId)
      if (!computer || computer.controlledBy !== client.sessionId) return

      let ownerId: string | undefined
      computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
      if (!ownerId) return

      const agentClient = this.agents.get(ownerId)
      if (agentClient) {
        agentClient.send('input_event', { computerId, event })
      } else {
        this.clients.find(c => c.sessionId === ownerId)?.send('input_event', { computerId, event })
      }
    })

    // ==========================================================================
    // NATIVE AGENT REGISTRATION
    // ==========================================================================
    this.onMessage('register_agent', (client, { ownerId }: { ownerId: string }) => {
      this.agents.set(ownerId, client)
      client.send('agent_registered', { success: true })
    })

    // ==========================================================================
    // WEBRTC SIGNALING
    // ==========================================================================
    this.onMessage('webrtc_offer', (client, { targetId, sdp, computerId }) => {
      this.clients.find(c => c.sessionId === targetId)?.send('webrtc_offer', { fromId: client.sessionId, sdp, computerId })
    })
    this.onMessage('webrtc_answer', (client, { targetId, sdp }) => {
      this.clients.find(c => c.sessionId === targetId)?.send('webrtc_answer', { fromId: client.sessionId, sdp })
    })
    this.onMessage('webrtc_ice_candidate', (client, { targetId, candidate }) => {
      this.clients.find(c => c.sessionId === targetId)?.send('webrtc_ice_candidate', { fromId: client.sessionId, candidate })
    })

    // ==========================================================================
    // WHITEBOARD ACCESS
    // ==========================================================================
    this.onMessage(Message.CONNECT_TO_WHITEBOARD, (client, { whiteboardId }: { whiteboardId: string }) => {
      this.dispatcher.dispatch(new WhiteboardAddUserCommand(), { client, whiteboardId })
    })
    this.onMessage(Message.DISCONNECT_FROM_WHITEBOARD, (client, { whiteboardId }: { whiteboardId: string }) => {
      this.dispatcher.dispatch(new WhiteboardRemoveUserCommand(), { client, whiteboardId })
    })

    // ==========================================================================
    // PLAYER UPDATES
    // ==========================================================================
    this.onMessage(Message.UPDATE_PLAYER, (client, msg) => {
      this.dispatcher.dispatch(new PlayerUpdateCommand(), { client, x: msg.x, y: msg.y, anim: msg.anim })
    })
    this.onMessage(Message.UPDATE_PLAYER_NAME, (client, msg) => {
      this.dispatcher.dispatch(new PlayerUpdateNameCommand(), { client, name: msg.name })
    })
    this.onMessage(Message.READY_TO_CONNECT, (client) => {
      const player = this.state.players.get(client.sessionId)
      if (player) player.readyToConnect = true
    })
    this.onMessage(Message.VIDEO_CONNECTED, (client) => {
      const player = this.state.players.get(client.sessionId)
      if (player) player.videoConnected = true
    })
    this.onMessage(Message.DISCONNECT_STREAM, (client, msg) => {
      this.clients.forEach((cli) => {
        if (cli.sessionId === msg.clientId) cli.send(Message.DISCONNECT_STREAM, client.sessionId)
      })
    })
    this.onMessage(Message.ADD_CHAT_MESSAGE, (client, msg) => {
      this.dispatcher.dispatch(new ChatMessageUpdateCommand(), { client, content: msg.content })
      this.broadcast(Message.ADD_CHAT_MESSAGE, { clientId: client.sessionId, content: msg.content }, { except: client })
    })
  }

  async onAuth(client: Client, options: { password: string | null }) {
    if (this.password) {
      if (!options.password) throw new ServerError(403, 'Password is required!')
      const valid = await bcrypt.compare(options.password, this.password)
      if (!valid) throw new ServerError(403, 'Password is incorrect!')
    }
    return true
  }

  onJoin(client: Client, options: any) {
    this.state.players.set(client.sessionId, new Player())
    client.send(Message.SEND_ROOM_DATA, { id: this.roomId, name: this.name, description: this.description })
  }

  onLeave(client: Client, consented: boolean) {
    for (const [ownerId, agentClient] of this.agents.entries()) {
      if (agentClient === client) { this.agents.delete(ownerId); break }
    }

    if (this.state.players.has(client.sessionId)) {
      this.state.players.delete(client.sessionId)
    }

    this.state.computers.forEach((computer: Computer, computerId: string) => {
      if (computer.connectedUser.has(client.sessionId)) {
        computer.connectedUser.delete(client.sessionId)
      }
      if (computer.controlledBy === client.sessionId) {
        let ownerId: string | undefined
        computer.connectedUser.forEach((id: string) => { if (!ownerId) ownerId = id })
        if (ownerId) {
          this.clients.find(c => c.sessionId === ownerId)?.send('control_ended', { computerId, reason: 'controller_disconnected' })
        }
        computer.controlledBy = ''
      }
      if (computer.controlRequestedBy === client.sessionId) {
        computer.controlRequestedBy = ''
      }
    })

    this.state.whiteboards.forEach((wb: { connectedUser: { has: (id: string) => boolean; delete: (id: string) => void } }) => {
      if (wb.connectedUser.has(client.sessionId)) wb.connectedUser.delete(client.sessionId)
    })

    // FIX: Also cleanup shapes/assets from whiteboard state when player disconnects
    this.whiteboardStates.forEach((stateMap) => {
      const toDelete: string[] = []
      stateMap.forEach((record, id) => {
        if (record.meta?.authorId === client.sessionId) {
          toDelete.push(id)
        }
      })
      toDelete.forEach(id => stateMap.delete(id))
      if (toDelete.length > 0) {
        console.log(`🗑️ Cleanup: Removed ${toDelete.length} whiteboard shapes from disconnected user ${client.sessionId}`)
      }
    })

    this.state.chairs.forEach((chair: { connectedUser: { has: (id: string) => boolean; delete: (id: string) => void } }) => {
      if (chair.connectedUser.has(client.sessionId)) chair.connectedUser.delete(client.sessionId)
    })
  }

  onDispose() {
    this.state.whiteboards.forEach((wb: { roomId: string }) => {
      if (whiteboardRoomIds.has(wb.roomId)) whiteboardRoomIds.delete(wb.roomId)
    })
    this.whiteboardStates.clear()
    console.log('room', this.roomId, 'disposing...')
    this.dispatcher.stop()
  }
}
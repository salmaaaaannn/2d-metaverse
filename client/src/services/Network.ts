import { Client, Room } from 'colyseus.js'
import { IComputer, IOfficeState, IPlayer, IWhiteboard } from '../../../types/IOfficeState'
import { Message } from '../../../types/Messages'
import { IRoomData, RoomType } from '../../../types/Rooms'
import { ItemType } from '../../../types/Items'
import WebRTC from '../web/WebRTC'
import { phaserEvents, Event } from '../events/EventCenter'
import store from '../stores'
import { setSessionId, setPlayerNameMap, removePlayerNameMap } from '../stores/UserStore'
import {
  setLobbyJoined,
  setJoinedRoomData,
  setAvailableRooms,
  addAvailableRooms,
  removeAvailableRooms,
} from '../stores/RoomStore'
import {
  pushChatMessage,
  pushPlayerJoinedMessage,
  pushPlayerLeftMessage,
} from '../stores/ChatStore'
import { setWhiteboardUrls } from '../stores/WhiteboardStore'
import {
  setPendingControlRequest,
  clearPendingControlRequest,
  setControlRequestPending,
  setActiveControl,
  endActiveControl,
} from '../stores/ComputerStore'

export default class Network {
  private client: Client
  private room?: Room<IOfficeState>
  private lobby!: Room
  webRTC?: WebRTC
  mySessionId!: string

  // Callbacks for WebRTC screen share signaling
  private onWebRTCOfferCallback?: (fromId: string, sdp: RTCSessionDescriptionInit, computerId: string) => void
  private onWebRTCAnswerCallback?: (fromId: string, sdp: RTCSessionDescriptionInit) => void
  private onWebRTCIceCandidateCallback?: (fromId: string, candidate: RTCIceCandidateInit) => void
  private onInputEventCallback?: (event: any) => void

  constructor() {
    const protocol = window.location.protocol.replace('http', 'ws')
    const endpoint =
      process.env.NODE_ENV === 'production'
        ? import.meta.env.VITE_SERVER_URL
        : `${protocol}//${window.location.hostname}:2567`
    this.client = new Client(endpoint)

    this.joinLobbyRoom().then(() => {
      store.dispatch(setLobbyJoined(true))
    })

    phaserEvents.on(Event.MY_PLAYER_NAME_CHANGE, this.updatePlayerName, this)
    phaserEvents.on(Event.MY_PLAYER_TEXTURE_CHANGE, this.updatePlayer, this)
    phaserEvents.on(Event.PLAYER_DISCONNECTED, this.playerStreamDisconnect, this)
  }

  async joinLobbyRoom() {
    this.lobby = await this.client.joinOrCreate(RoomType.LOBBY)

    this.lobby.onMessage('rooms', (rooms) => {
      store.dispatch(setAvailableRooms(rooms))
    })

    this.lobby.onMessage('+', ([roomId, room]) => {
      store.dispatch(addAvailableRooms({ roomId, room }))
    })

    this.lobby.onMessage('-', (roomId) => {
      store.dispatch(removeAvailableRooms(roomId))
    })
  }

  async joinOrCreatePublic() {
    this.room = await this.client.joinOrCreate(RoomType.PUBLIC)
    this.initialize()
  }

  async joinCustomById(roomId: string, password: string | null) {
    this.room = await this.client.joinById(roomId, { password })
    this.initialize()
  }

  async createCustom(roomData: IRoomData) {
    const { name, description, password, autoDispose } = roomData
    this.room = await this.client.create(RoomType.CUSTOM, {
      name,
      description,
      password,
      autoDispose,
    })
    this.initialize()
  }

  initialize() {
    if (!this.room) return

    this.lobby.leave()
    this.mySessionId = this.room.sessionId
    store.dispatch(setSessionId(this.room.sessionId))
    this.webRTC = new WebRTC(this.mySessionId, this)

    // --- PLAYERS ---
    this.room.state.players.onAdd = (player: IPlayer, key: string) => {
      if (key === this.mySessionId) return

      player.onChange = (changes) => {
        changes.forEach((change) => {
          const { field, value } = change
          phaserEvents.emit(Event.PLAYER_UPDATED, field, value, key)

          if (field === 'name' && value !== '') {
            phaserEvents.emit(Event.PLAYER_JOINED, player, key)
            store.dispatch(setPlayerNameMap({ id: key, name: value }))
            store.dispatch(pushPlayerJoinedMessage(value))
          }
        })
      }
    }

    this.room.state.players.onRemove = (player: IPlayer, key: string) => {
      phaserEvents.emit(Event.PLAYER_LEFT, key)
      this.webRTC?.closePeerConnection(key)
      store.dispatch(pushPlayerLeftMessage(player.name))
      store.dispatch(removePlayerNameMap(key))
    }

    // --- COMPUTERS ---
    this.room.state.computers.onAdd = (computer: IComputer, key: string) => {
      console.log(`📥 Network: computer ${key} added`);
      computer.connectedUser.onAdd = (item) => {
        console.log(`📥 Network: ITEM_USER_ADDED for computer ${key}, user ${item}`);
        phaserEvents.emit(Event.ITEM_USER_ADDED, item, key, ItemType.COMPUTER)
      }
      computer.connectedUser.onRemove = (item) => {
        console.log(`📥 Network: ITEM_USER_REMOVED for computer ${key}, user ${item}`);
        phaserEvents.emit(Event.ITEM_USER_REMOVED, item, key, ItemType.COMPUTER)
      }
    }

    // --- WHITEBOARDS ---
    this.room.state.whiteboards.onAdd = (whiteboard: IWhiteboard, key: string) => {
      store.dispatch(setWhiteboardUrls({ whiteboardId: key, roomId: whiteboard.roomId }))
      whiteboard.connectedUser.onAdd = (item) => {
        phaserEvents.emit(Event.ITEM_USER_ADDED, item, key, ItemType.WHITEBOARD)
      }
      whiteboard.connectedUser.onRemove = (item) => {
        phaserEvents.emit(Event.ITEM_USER_REMOVED, item, key, ItemType.WHITEBOARD)
      }
    }

    // --- CHAIRS ---
    if ((this.room.state as any).chairs) {
      ;(this.room.state as any).chairs.onAdd = (chair: any, key: string) => {
        chair.connectedUser.onAdd = (item: string) => {
          phaserEvents.emit(Event.ITEM_USER_ADDED, item, key, ItemType.CHAIR)
        }
        chair.connectedUser.onRemove = (item: string) => {
          phaserEvents.emit(Event.ITEM_USER_REMOVED, item, key, ItemType.CHAIR)
        }
      }
    }

    // --- CHAT ---
    this.room.state.chatMessages.onAdd = (item) => {
      store.dispatch(pushChatMessage(item))
    }

    // --- SERVER MESSAGES ---
    this.room.onMessage(Message.SEND_ROOM_DATA, (content) => {
      store.dispatch(setJoinedRoomData(content))
    })

    this.room.onMessage(Message.ADD_CHAT_MESSAGE, ({ clientId, content }) => {
      phaserEvents.emit(Event.UPDATE_DIALOG_BUBBLE, clientId, content)
    })

    this.room.onMessage(Message.DISCONNECT_STREAM, (clientId: string) => {
      this.webRTC?.closePeerConnection(clientId)
    })

    this.room.onMessage(Message.STOP_SCREEN_SHARE, (clientId: string) => {
      const computerState = store.getState().computer
      computerState.shareScreenManager?.onUserLeft(clientId)
    })

    this.room.onMessage('chair_occupied', ({ chairId }: { chairId: string }) => {
      phaserEvents.emit('chair-occupied', chairId)
    })

    // --- CONFERENCE ZONE UPDATES ---
    this.room.onMessage('conference_zone_update', ({ userId, inZone }: { userId: string; inZone: boolean }) => {
      phaserEvents.emit('conference-zone-update', { userId, inZone })
    })

    // --- WHITEBOARD REAL-TIME SYNC ---
    this.room.onMessage('whiteboard_update', (message) => {
      console.log('📨 Network: whiteboard_update message received from server:', message)
      phaserEvents.emit('whiteboard-update', message)
    })

    // --- WHITEBOARD FULL STATE (for late joiners) ---
    this.room.onMessage('whiteboard_full_state', (message) => {
      console.log('📨 Network: whiteboard_full_state message received from server:', message)
      phaserEvents.emit('whiteboard-full-state', message)
    })

    // --- WHITEBOARD CHAT ---
    this.room.onMessage('whiteboard_chat', ({ senderId, text }) => {
      phaserEvents.emit('whiteboard-chat', { senderId, text })
    })

    // =============================================
    // --- REMOTE CONTROL MESSAGES ---
    // =============================================

    this.room.onMessage('control_request', ({ computerId, requesterId }: { computerId: string; requesterId: string }) => {
      console.log(`📥 Network: received control_request for computer ${computerId} from ${requesterId}`);
      store.dispatch(setPendingControlRequest({ computerId, requesterId }))
    })

    this.room.onMessage('control_request_pending', ({ computerId }: { computerId: string }) => {
      console.log(`📥 Network: received control_request_pending for computer ${computerId}`);
      store.dispatch(setControlRequestPending(true))
    })

    this.room.onMessage('control_granted', ({ computerId }: { computerId: string }) => {
      console.log(`📥 Network: received control_granted for computer ${computerId}`);
      store.dispatch(
        setActiveControl({
          computerId,
          controllerId: this.mySessionId,
          iAmOwner: false,
          remoteStream: null,
        })
      )
      phaserEvents.emit('control_granted', { computerId })
    })

    this.room.onMessage('control_grant_ack', ({ computerId, controllerId }: { computerId: string; controllerId: string }) => {
      console.log(`📥 Network: received control_grant_ack for computer ${computerId}, controller ${controllerId}`);
      store.dispatch(
        setActiveControl({
          computerId,
          controllerId,
          iAmOwner: true,
          remoteStream: null,
        })
      )
      phaserEvents.emit('control_grant_ack', { computerId, controllerId })
      phaserEvents.emit('start_screen_share_webrtc', { computerId, targetId: controllerId })
    })

    this.room.onMessage('control_denied', ({ computerId }: { computerId: string }) => {
      console.log(`📥 Network: received control_denied for computer ${computerId}`);
      store.dispatch(setControlRequestPending(false))
      phaserEvents.emit('control_denied', { computerId })
    })

    this.room.onMessage('control_ended', ({ computerId, reason }: { computerId: string; reason: string }) => {
      console.log(`📥 Network: received control_ended for computer ${computerId}, reason: ${reason}`);
      store.dispatch(endActiveControl())
      phaserEvents.emit('control_ended', { computerId, reason })
      phaserEvents.emit('control_released', { computerId })
    })

    this.room.onMessage('input_event', ({ computerId, event }: { computerId: string; event: any }) => {
      this.onInputEventCallback?.(event)
      phaserEvents.emit('remote_input_event', { computerId, event })
    })

    // =============================================
    // --- WEBRTC SIGNALING MESSAGES ---
    // =============================================

    this.room.onMessage('webrtc_offer', ({ fromId, sdp, computerId }: { fromId: string; sdp: RTCSessionDescriptionInit; computerId: string }) => {
      console.log(`📥 Network: received webrtc_offer from ${fromId} for computer ${computerId}`);
      this.onWebRTCOfferCallback?.(fromId, sdp, computerId)
    })

    this.room.onMessage('webrtc_answer', ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      console.log(`📥 Network: received webrtc_answer from ${fromId}`);
      this.onWebRTCAnswerCallback?.(fromId, sdp)
    })

    this.room.onMessage('webrtc_ice_candidate', ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
      console.log(`📥 Network: received webrtc_ice_candidate from ${fromId}`);
      this.onWebRTCIceCandidateCallback?.(fromId, candidate)
    })
  }

  // =============================================
  // --- REMOTE CONTROL METHODS ---
  // =============================================

  requestControl(computerId: string) {
    console.log(`📤 Network: sending request_control for computer ${computerId}`);
    this.room?.send('request_control', { computerId })
  }

  grantControl(computerId: string, requesterId: string) {
    console.log(`📤 Network: sending grant_control for computer ${computerId} to requester ${requesterId}`);
    this.room?.send('grant_control', { computerId, requesterId })
  }

  denyControl(computerId: string) {
    console.log(`📤 Network: sending deny_control for computer ${computerId}`);
    this.room?.send('deny_control', { computerId })
  }

  cancelControlRequest(computerId: string) {
    console.log(`📤 Network: sending cancel_control_request for computer ${computerId}`);
    this.room?.send('cancel_control_request', { computerId })
  }

  releaseControl(computerId: string) {
    console.log(`📤 Network: sending release_control for computer ${computerId}`);
    this.room?.send('release_control', { computerId })
  }

  sendInputEvent(computerId: string, event: any) {
    this.room?.send('input_event', { computerId, event })
  }

  // =============================================
  // --- WEBRTC SIGNALING METHODS ---
  // =============================================

  sendWebRTCOffer(targetId: string, sdp: RTCSessionDescriptionInit, computerId: string) {
    console.log(`📤 Network: sending webrtc_offer to ${targetId} for computer ${computerId}`);
    this.room?.send('webrtc_offer', { targetId, sdp, computerId })
  }

  sendWebRTCAnswer(targetId: string, sdp: RTCSessionDescriptionInit) {
    console.log(`📤 Network: sending webrtc_answer to ${targetId}`);
    this.room?.send('webrtc_answer', { targetId, sdp })
  }

  sendWebRTCIceCandidate(targetId: string, candidate: RTCIceCandidateInit) {
    console.log(`📤 Network: sending webrtc_ice_candidate to ${targetId}`);
    this.room?.send('webrtc_ice_candidate', { targetId, candidate })
  }

  onWebRTCOffer(callback: (fromId: string, sdp: RTCSessionDescriptionInit, computerId: string) => void) {
    this.onWebRTCOfferCallback = callback
  }

  onWebRTCAnswer(callback: (fromId: string, sdp: RTCSessionDescriptionInit) => void) {
    this.onWebRTCAnswerCallback = callback
  }

  onWebRTCIceCandidate(callback: (fromId: string, candidate: RTCIceCandidateInit) => void) {
    this.onWebRTCIceCandidateCallback = callback
  }

  onRemoteInputEvent(callback: (event: any) => void) {
    this.onInputEventCallback = callback
  }

  // Helper methods to allow components to listen to network events via Phaser's EventCenter
  on(event: string, callback: (...args: any[]) => void, context?: any) {
    phaserEvents.on(event, callback, context)
  }

  off(event: string, callback: (...args: any[]) => void, context?: any) {
    phaserEvents.off(event, callback, context)
  }

  // =============================================
  // --- WHITEBOARD METHODS ---
  // =============================================

  sendWhiteboardUpdate(update: any) {
    console.log('📤 Network: sendWhiteboardUpdate called with:', update)
    this.room?.send('whiteboard_update', update)
  }

  requestWhiteboardState(whiteboardId: string) {
    console.log('📤 Network: requestWhiteboardState for whiteboard:', whiteboardId)
    this.room?.send('request_whiteboard_state', { whiteboardId })
  }

  sendWhiteboardChat(text: string) {
    this.room?.send('whiteboard_chat', { text })
  }

  // =============================================
  // --- EXISTING METHODS (unchanged) ---
  // =============================================

  connectToChair(chairId: string) {
    this.room?.send(Message.CONNECT_TO_CHAIR, { chairId })
  }

  disconnectFromChair(chairId: string) {
    this.room?.send(Message.DISCONNECT_FROM_CHAIR, { chairId })
  }

  onChatMessageAdded(callback: (playerId: string, content: string) => void, context?: any) {
    phaserEvents.on(Event.UPDATE_DIALOG_BUBBLE, callback, context)
  }

  onItemUserAdded(callback: (playerId: string, key: string, itemType: ItemType) => void, context?: any) {
    phaserEvents.on(Event.ITEM_USER_ADDED, callback, context)
  }

  onItemUserRemoved(callback: (playerId: string, key: string, itemType: ItemType) => void, context?: any) {
    phaserEvents.on(Event.ITEM_USER_REMOVED, callback, context)
  }

  onPlayerJoined(callback: (Player: IPlayer, key: string) => void, context?: any) {
    phaserEvents.on(Event.PLAYER_JOINED, callback, context)
  }

  onPlayerLeft(callback: (key: string) => void, context?: any) {
    phaserEvents.on(Event.PLAYER_LEFT, callback, context)
  }

  onMyPlayerReady(callback: (key: string) => void, context?: any) {
    phaserEvents.on(Event.MY_PLAYER_READY, callback, context)
  }

  onMyPlayerVideoConnected(callback: (key: string) => void, context?: any) {
    phaserEvents.on(Event.MY_PLAYER_VIDEO_CONNECTED, callback, context)
  }

  onPlayerUpdated(callback: (field: string, value: number | string, key: string) => void, context?: any) {
    phaserEvents.on(Event.PLAYER_UPDATED, callback, context)
  }

  updatePlayer(currentX: number, currentY: number, currentAnim: string) {
    this.room?.send(Message.UPDATE_PLAYER, { x: currentX, y: currentY, anim: currentAnim })
  }

  updatePlayerName(currentName: string) {
    this.room?.send(Message.UPDATE_PLAYER_NAME, { name: currentName })
  }

  readyToConnect() {
    this.room?.send(Message.READY_TO_CONNECT)
    phaserEvents.emit(Event.MY_PLAYER_READY)
  }

  videoConnected() {
    this.room?.send(Message.VIDEO_CONNECTED)
    phaserEvents.emit(Event.MY_PLAYER_VIDEO_CONNECTED)
  }

  sendConferenceZoneStatus(inZone: boolean) {
    this.room?.send('conference_zone_status', { inZone })
  }

  playerStreamDisconnect(id: string) {
    this.room?.send(Message.DISCONNECT_STREAM, { clientId: id })
    this.webRTC?.closePeerConnection(id)
  }

  connectToComputer(id: string) {
    this.room?.send(Message.CONNECT_TO_COMPUTER, { computerId: id })
  }

  disconnectFromComputer(id: string) {
    this.room?.send(Message.DISCONNECT_FROM_COMPUTER, { computerId: id })
  }

  connectToWhiteboard(id: string) {
    this.room?.send(Message.CONNECT_TO_WHITEBOARD, { whiteboardId: id })
  }

  disconnectFromWhiteboard(id: string) {
    this.room?.send(Message.DISCONNECT_FROM_WHITEBOARD, { whiteboardId: id })
  }

  onStopScreenShare(id: string) {
    this.room?.send(Message.STOP_SCREEN_SHARE, { computerId: id })
  }

  addChatMessage(content: string) {
    this.room?.send(Message.ADD_CHAT_MESSAGE, { content })
  }
}
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import Peer from 'peerjs'
import ScreenShareWebRTC from '../web/ScreenShareWebRTC'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { sanitizeId } from '../util'

export interface PendingControlRequest {
  computerId: string
  requesterId: string
}

export interface ActiveControlSession {
  computerId: string
  controllerId: string
  /** true = I am the owner being controlled; false = I am the controller */
  iAmOwner: boolean
  remoteStream: MediaStream | null
}

interface ComputerState {
  shareScreenManager: any
  computerDialogOpen: boolean
  computerId: null | string
  myStream: null | MediaStream
  peerStreams: Map<
    string,
    {
      stream: MediaStream
      call: Peer.MediaConnection
    }
  >
  screenShareManager: ScreenShareWebRTC | null
  // --- Remote Control ---
  pendingControlRequest: PendingControlRequest | null
  controlRequestPending: boolean
  activeControl: ActiveControlSession | null
}

const initialState: ComputerState = {
  computerDialogOpen: false,
  computerId: null,
  myStream: null,
  peerStreams: new Map(),
  screenShareManager: null,
  pendingControlRequest: null,
  controlRequestPending: false,
  activeControl: null,
  shareScreenManager: undefined
}

export const computerSlice = createSlice({
  name: 'computer',
  initialState,
  reducers: {
    openComputerDialog: (
      state,
      action: PayloadAction<{ computerId: string; myUserId: string }>
    ) => {
      const game = phaserGame.scene.keys.game as Game
      game.disableKeys()
      state.computerDialogOpen = true
      state.computerId = action.payload.computerId
    },

    closeComputerDialog: (state) => {
      const game = phaserGame.scene.keys.game as Game
      game.enableKeys()
      if (state.computerId) {
        game.network.disconnectFromComputer(state.computerId)
      }
      for (const { call } of state.peerStreams.values()) {
        call.close()
      }
      state.screenShareManager?.stopViewing?.()
      state.computerDialogOpen = false
      state.myStream = null
      state.computerId = null
      state.peerStreams.clear()
      state.pendingControlRequest = null
      state.controlRequestPending = false
      state.activeControl = null
    },

    setMyStream: (state, action: PayloadAction<null | MediaStream>) => {
      state.myStream = action.payload
    },

    addVideoStream: (
      state,
      action: PayloadAction<{ id: string; call: Peer.MediaConnection; stream: MediaStream }>
    ) => {
      state.peerStreams.set(sanitizeId(action.payload.id), {
        call: action.payload.call,
        stream: action.payload.stream,
      })
    },

    removeVideoStream: (state, action: PayloadAction<string>) => {
      state.peerStreams.delete(sanitizeId(action.payload))
    },

    setPendingControlRequest: (state, action: PayloadAction<PendingControlRequest>) => {
      state.pendingControlRequest = action.payload
    },

    clearPendingControlRequest: (state) => {
      state.pendingControlRequest = null
    },

    setControlRequestPending: (state, action: PayloadAction<boolean>) => {
      state.controlRequestPending = action.payload
    },

    setActiveControl: (state, action: PayloadAction<ActiveControlSession | null>) => {
      state.activeControl = action.payload
      if (action.payload) {
        state.controlRequestPending = false
        state.pendingControlRequest = null
      }
    },

    setControlRemoteStream: (state, action: PayloadAction<MediaStream | null>) => {
      if (state.activeControl) {
        state.activeControl.remoteStream = action.payload
      }
    },

    endActiveControl: (state) => {
      state.activeControl = null
      state.controlRequestPending = false
      state.pendingControlRequest = null
    },

    setScreenShareManager: (state, action: PayloadAction<ScreenShareWebRTC>) => {
      state.screenShareManager = action.payload
    },
  },
})

export const {
  closeComputerDialog,
  openComputerDialog,
  setMyStream,
  addVideoStream,
  removeVideoStream,
  setPendingControlRequest,
  clearPendingControlRequest,
  setControlRequestPending,
  setActiveControl,
  setControlRemoteStream,
  endActiveControl,
  setScreenShareManager,
} = computerSlice.actions

export default computerSlice.reducer
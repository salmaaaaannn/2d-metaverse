import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

export interface WhiteboardUser {
  id: string
  name: string
  color: string
}

interface WhiteboardState {
  whiteboardDialogOpen: boolean
  whiteboardId: null | string
  whiteboardUrl: null | string
  urls: { [key: string]: string }
  users: WhiteboardUser[]
  currentUser: WhiteboardUser | null
  spotlightUserId: string | null
  snapshot: any
}

const initialState: WhiteboardState = {
  whiteboardDialogOpen: false,
  whiteboardId: null,
  whiteboardUrl: null,
  urls: {},
  users: [],
  currentUser: null,
  spotlightUserId: null,
  snapshot: null,
}

export const whiteboardSlice = createSlice({
  name: 'whiteboard',
  initialState,
  reducers: {
    openWhiteboardDialog: (state, action: PayloadAction<string>) => {
      state.whiteboardDialogOpen = true
      state.whiteboardId = action.payload
      const url = state.urls[action.payload]
      if (url) state.whiteboardUrl = url
      const game = phaserGame.scene.keys.game as Game
      if (game) game.disableKeys()
    },

    closeWhiteboardDialog: (state) => {
      const game = phaserGame.scene.keys.game as Game
      if (game) {
        game.enableKeys()
        if (state.whiteboardId && game.network) {
          game.network.disconnectFromWhiteboard(state.whiteboardId)
        }
      }
      state.whiteboardDialogOpen = false
      state.whiteboardId = null
      state.whiteboardUrl = null
      state.users = []
      state.currentUser = null
      state.spotlightUserId = null
      state.snapshot = null
    },

    setWhiteboardUrls: (
      state,
      action: PayloadAction<{ whiteboardId: string; roomId: string }>
    ) => {
      state.urls[action.payload.whiteboardId] = `https://wbo.ophir.dev/boards/sky-office-${action.payload.roomId}`
    },

    setUsers: (state, action: PayloadAction<WhiteboardUser[]>) => {
      state.users = action.payload
    },

    setCurrentUser: (state, action: PayloadAction<WhiteboardUser>) => {
      state.currentUser = action.payload
    },

    setSpotlightUser: (state, action: PayloadAction<string | null>) => {
      state.spotlightUserId = action.payload
    },

    setSnapshot: (state, action: PayloadAction<any>) => {
      state.snapshot = action.payload
    },
  },
})

export const {
  openWhiteboardDialog,
  closeWhiteboardDialog,
  setWhiteboardUrls,
  setUsers,
  setCurrentUser,
  setSpotlightUser,
  setSnapshot,
} = whiteboardSlice.actions

export default whiteboardSlice.reducer
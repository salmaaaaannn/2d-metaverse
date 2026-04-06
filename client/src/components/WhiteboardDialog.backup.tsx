import React, { useState, useEffect, useRef, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import PersonIcon from '@mui/icons-material/Person'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import PeopleIcon from '@mui/icons-material/People'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

import { useAppSelector, useAppDispatch } from '../hooks'
import { closeWhiteboardDialog } from '../stores/WhiteboardStore'
import { phaserEvents, Event } from '../events/EventCenter'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { sanitizeId } from '../util'

// ── Animations ───────────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.97) translateY(-8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
`

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
`

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.6; }
`

// ── Styled Components ─────────────────────────────────────────────────────────

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  overflow: hidden;
  padding: 16px 180px 16px 16px;
  z-index: 2000;
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  background: #1a1d2e;
  border-radius: 18px;
  padding: 16px;
  color: #eee;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.07),
    0 32px 80px rgba(0, 0, 0, 0.7);
  animation: ${fadeIn} 0.3s ease-out;

  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 10;
    color: #888;
    &:hover { color: #eee; }
  }
`

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-right: 48px;
  margin-top: 4px;
  flex-shrink: 0;
`

const HeaderText = styled.div`
  h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    font-family: system-ui, sans-serif;
  }
  p {
    margin: 0;
    font-size: 12px;
    color: #666;
    font-family: system-ui, sans-serif;
    line-height: 1.5;
  }
`

const HeaderActions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
`

const ActionButton = styled(Button)<{ $danger?: boolean }>`
  && {
    border-color: ${p => p.$danger ? '#ff6b6b' : 'rgba(255,255,255,0.15)'};
    color: ${p => p.$danger ? '#ff6b6b' : '#bbb'};
    text-transform: none;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 8px;

    &:hover {
      background: ${p => p.$danger ? 'rgba(255,107,107,0.1)' : 'rgba(255,255,255,0.05)'};
      border-color: ${p => p.$danger ? '#ff6b6b' : 'rgba(255,255,255,0.3)'};
    }
  }
`

const MainArea = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
`

const WhiteboardWrapper = styled.div`
  flex: 1;
  min-width: 0;
  border-radius: 14px;
  overflow: hidden;
  background: #f5f5f5;
  position: relative;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06);
`

const AuthorBadge = styled.div<{ $color: string }>`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: ${p => p.$color};
  color: #fff;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  white-space: nowrap;
`

// ── User Panel (right side) ───────────────────────────────────────────────────

const UserPanel = styled.div`
  width: 210px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PanelTitle = styled.div`
  font-family: system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: #555;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0 4px;
  display: flex;
  align-items: center;
  gap: 6px;

  svg { font-size: 14px; color: #666; }
`

const UserList = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
`

const UserItem = styled.div<{ $isMe: boolean; $clickable: boolean }>`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 10px;
  background: ${p => p.$isMe ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)'};
  border: 1px solid ${p => p.$isMe ? 'rgba(74,222,128,0.2)' : 'transparent'};
  cursor: ${p => p.$clickable ? 'pointer' : 'default'};
  transition: all 0.15s ease;
  animation: ${slideUp} 0.2s ease-out;

  &:hover {
    background: ${p => p.$clickable
      ? 'rgba(255,255,255,0.09)'
      : p.$isMe ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)'};
    transform: ${p => p.$clickable ? 'translateX(2px)' : 'none'};
  }
`

const UserAvatar = styled.div<{ $color: string }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${p => p.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
`

const UserInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const UserName = styled.div`
  font-size: 13px;
  font-family: system-ui, sans-serif;
  color: #ddd;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const UserBadge = styled.div<{ $me?: boolean }>`
  font-size: 10px;
  color: ${p => p.$me ? '#4ade80' : '#666'};
  margin-top: 1px;
  font-family: system-ui, sans-serif;
`

const ViewButton = styled(IconButton)`
  && {
    color: #666;
    padding: 4px;
    border-radius: 6px;
    &:hover { color: #ddd; background: rgba(255,255,255,0.1); }
    svg { font-size: 16px; }
  }
`

const LiveDot = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  margin-right: 4px;
  animation: ${pulse} 2s ease-in-out infinite;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 20px 12px;
  color: #444;
  font-size: 12px;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
`

// ── Spotlight Overlay ─────────────────────────────────────────────────────────

const SpotlightBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  animation: ${fadeIn} 0.2s ease-out;
`

const SpotlightCard = styled.div`
  width: 88%;
  height: 88%;
  background: #1a1d2e;
  border-radius: 18px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.08),
    0 48px 100px rgba(0,0,0,0.8);
  position: relative;
`

const SpotlightHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 48px;
  flex-shrink: 0;

  h3 { margin: 0; font-size: 16px; color: #fff; font-family: system-ui, sans-serif; }
  p  { margin: 4px 0 0; font-size: 12px; color: #666; font-family: system-ui, sans-serif; }
`

const SpotlightContent = styled.div`
  flex: 1;
  min-height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #f5f5f5;
`

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserColor(sessionId: string): string {
  const hue = (sessionId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 37) % 360
  return `hsl(${hue}, 65%, 58%)`
}

/**
 * Sanitize records for Tldraw - only keep properties Tldraw expects
 * Extract metadata for separate tracking
 */
function sanitizeRecordForTldraw(record: any): { cleanRecord: any; metadata: any } {
  const { meta, ...cleanRecord } = record
  return { cleanRecord: cleanRecord || record, metadata: meta }
}

const customComponents = { ContextMenu: null } as any
const customOptions = { maxPages: 1 }

// ── Main Component ────────────────────────────────────────────────────────────

export default function WhiteboardDialog() {
  const dispatch = useAppDispatch()
  const whiteboardId = useAppSelector((state) => state.whiteboard.whiteboardId)
  const mySessionId = useAppSelector((state) => state.user.sessionId)
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)

  const mySanitizedId = sanitizeId(mySessionId)
  const myName = playerNameMap.get(mySanitizedId) || playerNameMap.get(mySessionId) || 'You'

  const myNameRef = useRef(myName)
  useEffect(() => { myNameRef.current = myName }, [myName])

  const [editorInstance, setEditorInstance] = useState<any>(null)
  const [selectedAuthor, setSelectedAuthor] = useState<{ name: string; color: string } | null>(null)
  const [activeUsers, setActiveUsers] = useState<Map<string, { name: string; color: string }>>(new Map())

  const [spotlightUserId, setSpotlightUserId] = useState<string | null>(null)
  const [spotlightSnapshot, setSpotlightSnapshot] = useState<any>(null)
  const [spotlightUserName, setSpotlightUserName] = useState<string>('')

  const allShapeRecordsRef = useRef<Map<string, any>>(new Map())

  // ── Connect to whiteboard on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!whiteboardId) return
    try {
      const game = phaserGame.scene.keys.game as Game
      if (game?.network) {
        game.network.connectToWhiteboard(whiteboardId)
        console.log(`✅ Connected to whiteboard ${whiteboardId}`)
      }
    } catch (err) {
      console.warn('Failed to connect to whiteboard:', err)
    }

    return () => {
      // Cleanup will be handled by handleClose
    }
  }, [whiteboardId])

  // ── Build active user list ─────────────────────────────────────────────────
  useEffect(() => {
    if (!editorInstance || !whiteboardId) return

    const buildUserList = () => {
      const users = new Map<string, { name: string; color: string }>()

      // Get users from shapes they've drawn
      const shapes = editorInstance.getCurrentPageShapes()
      shapes.forEach((shape: any) => {
        if (shape.meta?.authorId) {
          const id = shape.meta.authorId
          const name = shape.meta.authorName || playerNameMap.get(id) || 'User'
          users.set(id, {
            name,
            color: shape.meta.authorColor || getUserColor(id),
          })
          console.log(`📐 Shape author: ${id} = "${name}" (type: ${shape.type}, hasText: ${!!shape.props?.text})`)
        }
      })

      // Get connected users from server state
      try {
        const game = phaserGame.scene.keys.game as Game
        if (game?.network?.room?.state?.whiteboards) {
          const whiteboard = game.network.room.state.whiteboards.get(whiteboardId)
          if (whiteboard?.connectedUser) {
            whiteboard.connectedUser.forEach((userId: string) => {
              // IMPORTANT: Sanitize the userId for lookup since playerNameMap uses sanitized keys
              const sanitizedUserId = sanitizeId(userId)
              if (!users.has(sanitizedUserId)) {
                const name = playerNameMap.get(sanitizedUserId) || playerNameMap.get(userId) || 'User'
                users.set(sanitizedUserId, { name, color: getUserColor(sanitizedUserId) })
                console.log(`👤 Connected user: ${sanitizedUserId} = "${name}"`)
              }
            })
          }
        }
      } catch (err) {
        // Safe to ignore if network state unavailable
      }

      // Add all users from playerNameMap as fallback
      playerNameMap.forEach((name, id) => {
        if (!users.has(id)) {
          users.set(id, { name, color: getUserColor(id) })
        }
      })

      if (!users.has(mySanitizedId)) {
        users.set(mySanitizedId, { name: myNameRef.current, color: getUserColor(mySanitizedId) })
      }

      setActiveUsers(new Map(users))
    }

    buildUserList()
    const interval = setInterval(buildUserList, 2000)
    
    // Also listen for connected user changes
    const handleUserAdded = () => buildUserList()
    const handleUserRemoved = () => buildUserList()
    phaserEvents.on(Event.ITEM_USER_ADDED, handleUserAdded)
    phaserEvents.on(Event.ITEM_USER_REMOVED, handleUserRemoved)
    
    return () => {
      clearInterval(interval)
      phaserEvents.off(Event.ITEM_USER_ADDED, handleUserAdded)
      phaserEvents.off(Event.ITEM_USER_REMOVED, handleUserRemoved)
    }
  }, [editorInstance, playerNameMap, mySanitizedId, whiteboardId])

  const handleClose = useCallback(() => {
    dispatch(closeWhiteboardDialog())
    try {
      const game = phaserGame.scene.keys.game as Game
      if (game?.network && whiteboardId) {
        game.network.disconnectFromWhiteboard(whiteboardId)
      }
    } catch (err) {
      console.error('Failed to disconnect from whiteboard:', err)
    }
  }, [dispatch, whiteboardId])

  const handleClearAll = useCallback(() => {
    if (!editorInstance) return
    const ids = Array.from(editorInstance.getCurrentPageShapeIds())
    if (ids.length > 0) editorInstance.deleteShapes(ids)
  }, [editorInstance])

  const handleClearMine = useCallback(() => {
    if (!editorInstance) return
    const allIds = editorInstance.getCurrentPageShapeIds()
    const myIds: string[] = []
    allIds.forEach((id: string) => {
      const shape = editorInstance.getShape(id)
      if (shape?.meta?.authorId === mySanitizedId) myIds.push(id)
    })
    if (myIds.length > 0) editorInstance.deleteShapes(myIds)
  }, [editorInstance, mySanitizedId])

  const handleEditorMount = useCallback((editor: any) => {
    console.log('🎨 WhiteboardDialog: Tldraw editor mounted')
    setEditorInstance(editor)

    // Request full state from server immediately
    try {
      const game = phaserGame.scene.keys.game as Game
      if (game?.network && whiteboardId) {
        console.log('📤 CLIENT: Requesting initial whiteboard state for:', whiteboardId)
        game.network.requestWhiteboardState(whiteboardId)
        console.log('📤 CLIENT: Full state request sent')
      } else {
        console.warn('⚠️ CLIENT: Cannot request state - no game or network', { hasGame: !!game, hasNetwork: !!game?.network, whiteboardId })
      }
    } catch (err) {
      console.error('❌ CLIENT: Error requesting whiteboard state:', err)
    }

    editor.sideEffects.registerAfterCreateHandler('shape', (shape: any) => {
      if (!shape.meta?.authorId) {
        editor.updateShape({
          ...shape,
          meta: {
            ...shape.meta,
            authorId: mySanitizedId,
            authorName: myNameRef.current,
            authorColor: getUserColor(mySanitizedId),
            createdAt: Date.now(),
          },
        })
      }
    })

    editor.sideEffects.registerBeforeChangeHandler('shape', (prev: any, next: any) => {
      if (prev.meta?.authorId && prev.meta.authorId !== mySanitizedId) return prev
      return next
    })
    editor.sideEffects.registerBeforeDeleteHandler('shape', (shape: any) => {
      if (shape.meta?.authorId && shape.meta.authorId !== mySanitizedId) return false
    })

    editor.store.listen((entry: any) => {
      console.log('🔄 Editor store listener triggered:', { source: entry.source, changesCount: entry.changes ? Object.keys(entry.changes).length : 0 })
      
      const selectedIds = Array.from(editor.getSelectedShapeIds()) as string[]
      if (selectedIds.length === 1) {
        const shape: any = editor.getShape(selectedIds[0])
        if (shape?.meta?.authorName) {
          setSelectedAuthor({ name: shape.meta.authorName, color: shape.meta.authorColor || '#4a4f6e' })
        } else {
          setSelectedAuthor(null)
        }
      } else {
        setSelectedAuthor(null)
      }

      if (entry.source !== 'user') {
        console.log('ℹ️ Ignoring non-user source:', entry.source)
        return
      }

      const { added, updated, removed } = entry.changes

      const filterRecords = (recs: Record<string, any> | undefined) => {
        if (!recs) return {}
        const out: Record<string, any> = {}
        Object.values(recs).forEach((r: any) => {
          if (r?.typeName === 'shape' || r?.typeName === 'asset') {
            out[r.id] = r
            if (r.typeName === 'shape') {
              console.log(`📏 Filtering shape: type=${r.type}, text="${r.props?.text || '(none)'}", assetId="${r.props?.assetId || '(none)'}"`)
            }
          }
        })
        return out
      }

      const filteredAdded = filterRecords(added)
      const filteredUpdated = filterRecords(updated)
      const filteredRemoved: Record<string, any> = {}
      if (removed) {
        Object.values(removed).forEach((r: any) => {
          if (r?.typeName === 'shape' || r?.typeName === 'asset') {
            filteredRemoved[r.id] = r
          }
        })
      }

      const hasChanges =
        Object.keys(filteredAdded).length > 0 ||
        Object.keys(filteredUpdated).length > 0 ||
        Object.keys(filteredRemoved).length > 0

      if (!hasChanges) {
        console.log('ℹ️ No shape/asset changes detected')
        return
      }

      Object.entries(filteredAdded).forEach(([id, r]) => allShapeRecordsRef.current.set(id, r))
      Object.entries(filteredUpdated).forEach(([id, r]) => allShapeRecordsRef.current.set(id, r))
      Object.keys(filteredRemoved).forEach((id) => allShapeRecordsRef.current.delete(id))

      const payload = {
        whiteboardId,
        added: filteredAdded,
        updated: filteredUpdated,
        removed: filteredRemoved,
      }

      console.log('📤 Sending whiteboard update:', { whiteboardId, addedCount: Object.keys(filteredAdded).length, updatedCount: Object.keys(filteredUpdated).length, removedCount: Object.keys(filteredRemoved).length })

      try {
        const game = phaserGame.scene.keys.game as Game
        if (game?.network) {
          game.network.sendWhiteboardUpdate(payload)
        }
      } catch (err) {
        console.warn('Could not send whiteboard update:', err)
      }
    })
  }, [mySanitizedId, whiteboardId])

  useEffect(() => {
    if (!editorInstance || !whiteboardId) {
      console.log('⏸️ Listeners useEffect: skipping because editorInstance or whiteboardId missing', { hasEditor: !!editorInstance, whiteboardId })
      return
    }

    console.log('🔌 Attaching whiteboard-update and whiteboard-full-state listeners for whiteboard:', whiteboardId)

    const handleRemoteUpdate = (message: any) => {
      // Filter updates for THIS whiteboard only
      if (!message || message.whiteboardId !== whiteboardId) {
        if (message?.whiteboardId !== whiteboardId) {
          console.log('⏭️ CLIENT: Ignoring update for different whiteboard:', message?.whiteboardId, '(current:', whiteboardId, ')')
        }
        return
      }
      
      const addedCount = Object.keys(message.added || {}).length
      const updatedCount = Object.keys(message.updated || {}).length
      const removedCount = Object.keys(message.removed || {}).length
      console.log(`📥 CLIENT: Received whiteboard update: ${addedCount} added, ${updatedCount} updated, ${removedCount} removed`)
      
      try {
        editorInstance.store.mergeRemoteChanges(() => {
          const isValid = (r: any) =>
            r && typeof r === 'object' && 'typeName' in r && 'id' in r &&
            (r.typeName === 'shape' || r.typeName === 'asset')

          const records: any[] = []
          const currentPage = editorInstance.getCurrentPageId()

          if (message.added) {
            Object.values(message.added).forEach((r: any) => {
              if (isValid(r)) {
                const { cleanRecord, metadata } = sanitizeRecordForTldraw(r)
                if (r.typeName === 'shape') {
                  const textContent = cleanRecord.type === 'text' ? `text="${cleanRecord.props?.text || ''}"` : 'no-text'
                  console.log(`  ✨ Adding: id=${cleanRecord.id}, type=${cleanRecord.type}, ${textContent}, author=${metadata?.authorName}`)
                  // Ensure shape is on the current page
                  if (!cleanRecord.pageId) {
                    cleanRecord.pageId = currentPage
                  }
                  // Store metadata separately for UI
                  if (metadata?.authorName) {
                    allShapeRecordsRef.current.set(`meta_${cleanRecord.id}`, metadata)
                  }
                }
                records.push(cleanRecord)
                allShapeRecordsRef.current.set(cleanRecord.id, cleanRecord)
              }
            })
          }
          if (message.updated) {
            Object.values(message.updated).forEach((r: any) => {
              if (isValid(r)) {
                const { cleanRecord, metadata } = sanitizeRecordForTldraw(r)
                if (r.typeName === 'shape') {
                  const textContent = cleanRecord.type === 'text' ? `text="${cleanRecord.props?.text || ''}"` : 'no-text'
                  console.log(`  🔄 Updating: id=${cleanRecord.id}, type=${cleanRecord.type}, ${textContent}, author=${metadata?.authorName}`)
                  // Ensure shape stays on correct page
                  if (!cleanRecord.pageId) {
                    cleanRecord.pageId = currentPage
                  }
                  // Store metadata separately
                  if (metadata?.authorName) {
                    allShapeRecordsRef.current.set(`meta_${cleanRecord.id}`, metadata)
                  }
                }
                records.push(cleanRecord)
                allShapeRecordsRef.current.set(cleanRecord.id, cleanRecord)
              }
            })
          }

          if (records.length > 0) {
            console.log(`🔄 CLIENT: Merging ${records.length} records...`)
            try {
              // Use mergeRemoteChanges's internal put which handles validation
              editorInstance.store.put(records)
              const allShapes = editorInstance.getAllShapes()
              console.log(`✅ CLIENT: Merged successfully | Total shapes: ${allShapes.length}`)
            } catch (putErr) {
              console.error('❌ CLIENT: store.put() failed:', putErr)
              // If validation fails, try creating fresh records
              try {
                console.log('🔄 CLIENT: Recovery attempt...')
                records.forEach(r => {
                  try {
                    editorInstance.store.put([r])
                  } catch (singleErr) {
                    console.warn(`⚠️ Could not add ${r.id}:`, singleErr)
                  }
                })
              } catch (recoveryErr) {
                console.error('❌ Recovery failed:', recoveryErr)
              }
            }
          }

          if (message.removed) {
            const idsToRemove: string[] = []
            Object.values(message.removed).forEach((r: any) => {
              if (r?.id) {
                console.log(`  🗑️ Removing: ${r.id}`)
                idsToRemove.push(r.id)
                allShapeRecordsRef.current.delete(r.id)
              }
            })
            if (idsToRemove.length > 0) {
              console.log(`🗑️ CLIENT: Removing ${idsToRemove.length} records`)
              editorInstance.store.remove(idsToRemove)
            }
          }
        })
      } catch (err) {
        console.error('❌ CLIENT: Failed to apply whiteboard update:', err)
      }
    }

    const handleFullState = (message: { whiteboardId: string; records: Record<string, any> }) => {
      // Filter full state for THIS whiteboard only
      if (!message?.records || message.whiteboardId !== whiteboardId) {
        if (message?.whiteboardId !== whiteboardId) {
          console.log('⏭️ CLIENT: Ignoring full state for different whiteboard:', message?.whiteboardId, '(current:', whiteboardId, ')')
        }
        return
      }
      
      const recordCount = Object.keys(message.records).length
      console.log(`📥 CLIENT: Received full whiteboard state with ${recordCount} shapes for whiteboard ${whiteboardId}`)
      
      try {
        editorInstance.store.mergeRemoteChanges(() => {
          const records = Object.values(message.records).filter(
            (r: any) => r && typeof r === 'object' && 'typeName' in r && 'id' in r &&
              (r.typeName === 'shape' || r.typeName === 'asset')
          )
          
          if (records.length > 0) {
            console.log(`✅ CLIENT: Loading ${records.length} shapes/assets from full state`)
            
            // Sanitize and log shapes for debugging
            const currentPage = editorInstance.getCurrentPageId()
            console.log(`📄 CLIENT: Current page ID: ${currentPage}`)
            
            const sanitizedRecords: any[] = []
            records.forEach((r: any) => {
              const { cleanRecord, metadata } = sanitizeRecordForTldraw(r)
              if (r.typeName === 'shape') {
                const textContent = cleanRecord.type === 'text' ? `, text="${cleanRecord.props?.text || ''}"` : ''
                console.log(`  📐 Loading shape: id=${cleanRecord.id}, type=${cleanRecord.type}, pageId=${cleanRecord.pageId || 'MISSING'}${textContent}, author=${metadata?.authorName}`)
                // Ensure shapes have the correct pageId for current page
                if (!cleanRecord.pageId) {
                  cleanRecord.pageId = currentPage
                  console.log(`  ⚠️ Shape ${cleanRecord.id} was missing pageId, set to ${currentPage}`)
                }
                // Extract and store meta separately
                if (metadata?.authorName) {
                  allShapeRecordsRef.current.set(`meta_${cleanRecord.id}`, metadata)
                }
              }
              sanitizedRecords.push(cleanRecord)
            })
            
            try {
              editorInstance.store.put(sanitizedRecords)
              console.log(`✅ CLIENT: Successfully applied ${sanitizedRecords.length} records to store`)
              const allPageShapes = editorInstance.getAllShapes()
              console.log(`📊 CLIENT: Store now has ${allPageShapes.length} total shapes`)
            } catch (putErr) {
              console.error('❌ CLIENT: Error in store.put():', putErr)
              // Try one by one as fallback
              console.log('🔄 CLIENT: Attempting to add shapes individually...')
              let successCount = 0
              sanitizedRecords.forEach((r: any) => {
                try {
                  editorInstance.store.put([r])
                  successCount++
                } catch (singleErr) {
                  console.warn(`⚠️ CLIENT: Could not add shape ${r.id} (type=${r.type}):`, singleErr)
                }
              })
              console.log(`📊 CLIENT: Individual add result: ${successCount}/${sanitizedRecords.length} added`)
            }
            sanitizedRecords.forEach((r: any) => allShapeRecordsRef.current.set(r.id, r))
          } else {
            console.log('ℹ️ CLIENT: No shapes/assets in full state')
          }
        })
      } catch (err) {
        console.error('❌ CLIENT: Failed to apply full whiteboard state:', err)
      }
    }

    phaserEvents.on('whiteboard-update', handleRemoteUpdate)
    phaserEvents.on('whiteboard-full-state', handleFullState)
    
    console.log('✅ Listeners attached for whiteboard:', whiteboardId)
    
    return () => {
      console.log('🔌 Detaching listeners for whiteboard:', whiteboardId)
      phaserEvents.off('whiteboard-update', handleRemoteUpdate)
      phaserEvents.off('whiteboard-full-state', handleFullState)
    }
  }, [editorInstance, whiteboardId])

  useEffect(() => {
    return () => setEditorInstance(null)
  }, [])

  const openSpotlight = useCallback((userId: string, userName: string) => {
    if (!editorInstance) return

    const snapshot = editorInstance.getSnapshot()
    const schema = snapshot.schema || editorInstance.store.schema.serialize()
    const storeRecords = Object.values(snapshot.store || {}) as any[]

    const nonShapeRecords = storeRecords.filter(
      (r: any) => r.typeName !== 'shape' && r.typeName !== 'asset'
    )

    const allCurrentShapes = editorInstance.getCurrentPageShapes()
    const userShapes = allCurrentShapes.filter(
      (s: any) => s.meta?.authorId === userId
    )

    allShapeRecordsRef.current.forEach((record, id) => {
      if (
        record.typeName === 'shape' &&
        record.meta?.authorId === userId &&
        !userShapes.find((s: any) => s.id === id)
      ) {
        userShapes.push(record)
      }
    })

    if (userShapes.length === 0) {
      setSpotlightUserName(userName)
      setSpotlightSnapshot({ schema, store: buildStoreFromRecords(nonShapeRecords, []) })
      setSpotlightUserId(userId)
      return
    }

    const assetIds = new Set<string>()
    userShapes.forEach((s: any) => {
      if (s.props?.assetId) assetIds.add(s.props.assetId)
    })
    const userAssets = storeRecords.filter(
      (r: any) => r.typeName === 'asset' && assetIds.has(r.id)
    )

    const filteredStore = buildStoreFromRecords(nonShapeRecords, [...userShapes, ...userAssets])

    setSpotlightUserName(userName)
    setSpotlightSnapshot({ schema, store: filteredStore })
    setSpotlightUserId(userId)
  }, [editorInstance])

  const closeSpotlight = useCallback(() => {
    setSpotlightUserId(null)
    setSpotlightSnapshot(null)
    setSpotlightUserName('')
  }, [])

  return (
    <>
      <Backdrop>
        <Wrapper>
          <IconButton className="close" onClick={handleClose}>
            <CloseIcon />
          </IconButton>

          <Header>
            <HeaderText>
              <h2>Collaborative Whiteboard</h2>
              <p>
                <LiveDot />
                Draw together in real time · Click a user to view their drawings
              </p>
            </HeaderText>
            <HeaderActions>
              <ActionButton
                $danger
                variant="outlined"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handleClearMine}
              >
                Clear Mine
              </ActionButton>
              <ActionButton
                $danger
                variant="outlined"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handleClearAll}
              >
                Clear All
              </ActionButton>
            </HeaderActions>
          </Header>

          <MainArea>
            <WhiteboardWrapper>
              {selectedAuthor && (
                <AuthorBadge $color={selectedAuthor.color}>
                  <PersonIcon style={{ fontSize: 16 }} />
                  ✏️ {selectedAuthor.name}
                </AuthorBadge>
              )}
              <Tldraw
                onMount={handleEditorMount}
                components={customComponents}
                options={customOptions}
              />
            </WhiteboardWrapper>

            <UserPanel>
              <PanelTitle>
                <PeopleIcon />
                Users ({activeUsers.size})
              </PanelTitle>

              <UserList>
                {activeUsers.size === 0 ? (
                  <EmptyState>No users yet.<br />Start drawing!</EmptyState>
                ) : (
                  Array.from(activeUsers.entries()).map(([id, user]) => {
                    const isMe = id === mySanitizedId
                    return (
                      <UserItem
                        key={id}
                        $isMe={isMe}
                        $clickable={!isMe}
                        onClick={() => {
                          if (!isMe) openSpotlight(id, user.name)
                        }}
                        title={isMe ? 'You' : `Click to view ${user.name}'s drawings`}
                      >
                        <UserAvatar $color={user.color}>
                          {user.name.charAt(0).toUpperCase()}
                        </UserAvatar>
                        <UserInfo>
                          <UserName>{user.name}</UserName>
                          <UserBadge $me={isMe}>
                            {isMe ? '(you)' : 'click to view'}
                          </UserBadge>
                        </UserInfo>
                        {!isMe && (
                          <Tooltip title={`View ${user.name}'s drawings`} placement="left">
                            <ViewButton size="small" onClick={(e) => {
                              e.stopPropagation()
                              openSpotlight(id, user.name)
                            }}>
                              <ZoomInIcon />
                            </ViewButton>
                          </Tooltip>
                        )}
                      </UserItem>
                    )
                  })
                )}
              </UserList>
            </UserPanel>
          </MainArea>
        </Wrapper>
      </Backdrop>

      {spotlightUserId && spotlightSnapshot && (
        <SpotlightBackdrop onClick={closeSpotlight}>
          <SpotlightCard onClick={(e) => e.stopPropagation()}>
            <IconButton
              style={{ position: 'absolute', top: 10, right: 10, color: '#888', zIndex: 10 }}
              onClick={closeSpotlight}
            >
              <CloseIcon />
            </IconButton>

            <SpotlightHeader>
              <UserAvatar
                $color={activeUsers.get(spotlightUserId)?.color || getUserColor(spotlightUserId)}
                style={{ width: 36, height: 36, fontSize: 15 }}
              >
                {spotlightUserName.charAt(0).toUpperCase()}
              </UserAvatar>
              <div>
                <h3>{spotlightUserName}'s Drawings</h3>
                <p>Read-only view · Click outside to close</p>
              </div>
            </SpotlightHeader>

            <SpotlightContent>
              {spotlightSnapshot.store && Object.keys(spotlightSnapshot.store).filter(
                k => spotlightSnapshot.store[k].typeName === 'shape'
              ).length === 0 ? (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#999',
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: 14,
                  background: '#f5f5f5',
                  borderRadius: 12,
                }}>
                  {spotlightUserName} hasn't drawn anything yet.
                </div>
              ) : (
                <Tldraw
                  snapshot={spotlightSnapshot}
                  onMount={(editor) => {
                    editor.updateInstanceState({ isReadonly: true })
                    setTimeout(() => {
                      try { editor.zoomToFit({ duration: 300 }) } catch {}
                    }, 200)
                  }}
                  components={customComponents}
                  options={customOptions}
                />
              )}
            </SpotlightContent>
          </SpotlightCard>
        </SpotlightBackdrop>
      )}
    </>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────

function buildStoreFromRecords(
  nonShapeRecords: any[],
  shapeAndAssetRecords: any[]
): Record<string, any> {
  const store: Record<string, any> = {}
  const keptShapeIds = new Set(
    shapeAndAssetRecords.filter(r => r.typeName === 'shape').map(r => r.id)
  )

  nonShapeRecords.forEach((r: any) => {
    if (r.typeName === 'page') {
      store[r.id] = {
        ...r,
        shapeIds: (r.shapeIds || []).filter((id: string) => keptShapeIds.has(id)),
      }
    } else {
      store[r.id] = r
    }
  })

  shapeAndAssetRecords.forEach((r: any) => {
    store[r.id] = r
  })

  return store
}
import React, { useEffect, useState } from 'react'
import styled, { keyframes, css } from 'styled-components'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows'

import { useAppSelector, useAppDispatch } from '../hooks'
import {
  closeComputerDialog,
  clearPendingControlRequest,
  setControlRequestPending,
  setActiveControl,
  endActiveControl,
} from '../stores/ComputerStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

import Video from './Video'
import ScreenShareView from './ScreenShareView'
import ScreenShareWebRTC from '../web/ScreenShareWebRTC'

// ─── Animations ──────────────────────────────────────────────────────────────
const fadeSlideIn = keyframes`
  from { opacity: 0; transform: translateY(-12px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`
const pulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.4); }
  50%        { box-shadow: 0 0 0 8px rgba(250, 204, 21, 0); }
`
const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`

// ─── Styled Components ──────────────────────────────────────────────────────
const Backdrop = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 16px 180px 16px 16px;
  z-index: 100;
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  background: #161b2e;
  border-radius: 16px;
  padding: 16px;
  color: #eee;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 24px 64px rgba(0,0,0,0.6);
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    color: #888;
    &:hover { color: #eee; }
  }
`

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const VideoGrid = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(40%, 1fr));
  .video-container {
    position: relative;
    background: #0a0a12;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.06);
    video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .player-name {
      position: absolute;
      bottom: 12px;
      left: 12px;
      color: #fff;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      background: rgba(0,0,0,0.5);
      padding: 2px 8px;
      border-radius: 4px;
      backdrop-filter: blur(4px);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
`

// ─── Control Request Overlay (shown to OWNER) ───────────────────────────────
const ControlRequestOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10,10,20,0.85);
  backdrop-filter: blur(12px);
  border-radius: 16px;
  animation: ${fadeSlideIn} 0.25s ease-out;
`

const RequestCard = styled.div`
  background: #1e2438;
  border: 1px solid rgba(250,204,21,0.3);
  border-radius: 16px;
  padding: 32px;
  max-width: 380px;
  width: 90%;
  text-align: center;
  box-shadow: 0 0 0 1px rgba(250,204,21,0.1), 0 32px 64px rgba(0,0,0,0.5);
  animation: ${css`${pulse} 2s ease-in-out infinite`};
`

const RequestIcon = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #facc15, #f59e0b);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  font-size: 28px;
  box-shadow: 0 8px 24px rgba(250,204,21,0.3);
`

const RequestTitle = styled.h3`
  font-family: system-ui, sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 6px;
`

const RequestSubtitle = styled.p`
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #888;
  margin: 0 0 24px;
  line-height: 1.5;
`

const RequesterName = styled.span`
  color: #facc15;
  font-weight: 600;
`

const RequestActions = styled.div`
  display: flex;
  gap: 10px;
  justify-content: center;
`

const AcceptButton = styled(Button)`
  && {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: #fff;
    border-radius: 8px;
    padding: 8px 24px;
    font-size: 13px;
    font-weight: 600;
    text-transform: none;
    box-shadow: 0 4px 12px rgba(34,197,94,0.3);
    &:hover {
      background: linear-gradient(135deg, #16a34a, #15803d);
      box-shadow: 0 6px 16px rgba(34,197,94,0.4);
    }
  }
`

const DenyButton = styled(Button)`
  && {
    background: rgba(248,113,113,0.1);
    color: #f87171;
    border: 1px solid rgba(248,113,113,0.3);
    border-radius: 8px;
    padding: 8px 24px;
    font-size: 13px;
    font-weight: 600;
    text-transform: none;
    &:hover {
      background: rgba(248,113,113,0.2);
    }
  }
`

// ─── Waiting Overlay (shown to REQUESTER while pending) ─────────────────────
const WaitingOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(10,10,20,0.9);
  backdrop-filter: blur(12px);
  border-radius: 16px;
  animation: ${fadeSlideIn} 0.25s ease-out;
`

const SpinnerIcon = styled(HourglassEmptyIcon)`
  && {
    font-size: 40px;
    color: #facc15;
    animation: ${spin} 2s linear infinite;
  }
`

const WaitingTitle = styled.h3`
  font-family: system-ui, sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin: 0;
`

const WaitingSubtitle = styled.p`
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #666;
  margin: 0;
`

// ─── Helper: single video container ──────────────────────────────────────────
function VideoContainer({ playerName, stream }: { playerName?: string; stream: MediaStream }) {
  return (
    <div className="video-container">
      <Video srcObject={stream} autoPlay userId="" />
      {playerName && <div className="player-name">{playerName}</div>}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ComputerDialog() {
  const dispatch = useAppDispatch()
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const mySessionId = useAppSelector((state) => state.user.sessionId)
  const shareScreenManager = useAppSelector((state) => state.computer.shareScreenManager)
  const myStream = useAppSelector((state) => state.computer.myStream)
  const peerStreams = useAppSelector((state) => state.computer.peerStreams)
  const computerId = useAppSelector((state) => state.computer.computerId)

  // Remote control state
  const pendingControlRequest = useAppSelector((state) => state.computer.pendingControlRequest)
  const controlRequestPending = useAppSelector((state) => state.computer.controlRequestPending)
  const activeControl = useAppSelector((state) => state.computer.activeControl)

  const [screenShareWebRTC, setScreenShareWebRTC] = useState<ScreenShareWebRTC | null>(null)

  const game = phaserGame.scene.keys.game as Game
  const network = game?.network

  // --- Start screen share when owner's active control is set, and create instance for controller ---
  useEffect(() => {
    console.log('[ComputerDialog] activeControl changed:', activeControl)
    console.log('[ComputerDialog] network present:', !!network)
    if (!network) return

    // If we are the owner and we have an active control session, start screen share
    if (activeControl?.iAmOwner && !screenShareWebRTC) {
      console.log('[ComputerDialog] Starting screen share for owner', activeControl)
      const webrtc = new ScreenShareWebRTC(network)
      setScreenShareWebRTC(webrtc)
      webrtc.startScreenShare(activeControl.controllerId, activeControl.computerId)
    }

    // If we are the controller and we have an active control session, create the instance to handle incoming offer
    if (activeControl && !activeControl.iAmOwner && !screenShareWebRTC) {
      console.log('[ComputerDialog] Creating ScreenShareWebRTC for controller', activeControl)
      const webrtc = new ScreenShareWebRTC(network)
      setScreenShareWebRTC(webrtc)
      // No need to call startScreenShare; the instance will receive the offer via callback.
    }

    // Cleanup when control ends
    return () => {
      if (screenShareWebRTC) {
        console.log('[ComputerDialog] Cleaning up screen share')
        if (activeControl?.iAmOwner) {
          screenShareWebRTC.stopScreenShare()
        } else {
          screenShareWebRTC.stopViewing()
        }
        setScreenShareWebRTC(null)
      }
    }
  }, [activeControl, network])

  // --- Handle network messages for control responses (setup once) ---
  useEffect(() => {
    if (!network) return

    // Requester receives: owner accepted control
    const handleControlGranted = ({ computerId: cid }: { computerId: string }) => {
      console.log('[ComputerDialog] handleControlGranted', cid, computerId)
      if (cid === computerId) {
        dispatch(setActiveControl({
          computerId: cid,
          controllerId: mySessionId,
          iAmOwner: false,
          remoteStream: null,
        }))
        dispatch(setControlRequestPending(false))
      }
    }

    // Requester receives: owner denied control
    const handleControlDenied = ({ computerId: cid }: { computerId: string }) => {
      console.log('[ComputerDialog] handleControlDenied', cid, computerId)
      if (cid === computerId) {
        dispatch(setControlRequestPending(false))
        dispatch(closeComputerDialog())
      }
    }

    // Owner receives: control was granted (acknowledgement from server)
    const handleControlGrantAck = ({ computerId: cid, controllerId }: { computerId: string; controllerId: string }) => {
      console.log('[ComputerDialog] handleControlGrantAck', cid, controllerId, computerId)
      if (cid === computerId) {
        dispatch(setActiveControl({
          computerId: cid,
          controllerId,
          iAmOwner: true,
          remoteStream: null,
        }))
        dispatch(clearPendingControlRequest())
      }
    }

    // Either party receives: control session ended
    const handleControlReleased = ({ computerId: cid }: { computerId: string }) => {
      console.log('[ComputerDialog] handleControlReleased', cid, computerId)
      if (cid === computerId) {
        dispatch(endActiveControl())
      }
    }

    network.on('control_granted', handleControlGranted)
    network.on('control_denied', handleControlDenied)
    network.on('control_grant_ack', handleControlGrantAck)
    network.on('control_released', handleControlReleased)

    return () => {
      network.off('control_granted', handleControlGranted)
      network.off('control_denied', handleControlDenied)
      network.off('control_grant_ack', handleControlGrantAck)
      network.off('control_released', handleControlReleased)
    }
  }, [network, computerId, dispatch, mySessionId])

  // --- Grant control (owner accepts) ---
  const handleGrantControl = () => {
    if (!pendingControlRequest || !computerId || !network) return
    console.log('[ComputerDialog] handleGrantControl', computerId, pendingControlRequest.requesterId)
    network.grantControl(computerId, pendingControlRequest.requesterId)
    dispatch(clearPendingControlRequest())
  }

  // --- Deny control (owner rejects) ---
  const handleDenyControl = () => {
    if (!computerId || !network) return
    console.log('[ComputerDialog] handleDenyControl', computerId)
    network.denyControl(computerId)
    dispatch(clearPendingControlRequest())
  }

  // --- Cancel pending request (requester withdraws) ---
  const handleCancelRequest = () => {
    if (!computerId || !network) return
    console.log('[ComputerDialog] handleCancelRequest', computerId)
    network.cancelControlRequest(computerId)
    dispatch(setControlRequestPending(false))
    dispatch(closeComputerDialog())
  }

  // --- Stop sharing (owner ends control) ---
  const handleStopControl = () => {
    if (!computerId || !network) return
    console.log('[ComputerDialog] handleStopControl', computerId)
    network.releaseControl(computerId)
    dispatch(endActiveControl())
  }

  // --- Determine requester display name ---
  const requesterDisplayName = pendingControlRequest
    ? playerNameMap.get(pendingControlRequest.requesterId) ?? 'A user'
    : ''

  // --- If in active control session ---
  if (activeControl) {
    // If current user is the owner, show normal UI (with a small banner)
    if (activeControl.iAmOwner) {
      return (
        <Backdrop>
          <Wrapper>
            <div style={{ position: 'absolute', top: 50, left: 16, background: '#facc15', color: '#000', padding: '4px 12px', borderRadius: 20, fontSize: 13 }}>
              {playerNameMap.get(activeControl.controllerId) ?? 'Someone'} is controlling your computer
            </div>
            <IconButton
              aria-label="close dialog"
              className="close"
              onClick={() => dispatch(closeComputerDialog())}
            >
              <CloseIcon />
            </IconButton>
            <Toolbar>
              <Button
                variant="contained"
                color="error"
                onClick={handleStopControl}
              >
                Stop Control
              </Button>
            </Toolbar>
            <VideoGrid>
              {myStream && <VideoContainer stream={myStream} playerName="You" />}
              {[...peerStreams.entries()].map(([id, { stream }]) => (
                <VideoContainer key={id} playerName={playerNameMap.get(id)} stream={stream} />
              ))}
            </VideoGrid>
          </Wrapper>
        </Backdrop>
      )
    } else {
      // Controller: show ScreenShareView
      return (
        <Backdrop>
          <Wrapper>
            <IconButton
              aria-label="close dialog"
              className="close"
              onClick={() => {
                network?.releaseControl(computerId!)
                dispatch(closeComputerDialog())
              }}
            >
              <CloseIcon />
            </IconButton>
            <ScreenShareView
              computerId={activeControl.computerId}
              iAmOwner={false}
            />
          </Wrapper>
        </Backdrop>
      )
    }
  }

  // --- Normal rendering (no active control) ---
  return (
    <Backdrop>
      <Wrapper>
        <IconButton
          aria-label="close dialog"
          className="close"
          onClick={() => dispatch(closeComputerDialog())}
        >
          <CloseIcon />
        </IconButton>

        {/* Owner sees pending request popup */}
        {pendingControlRequest && (
          <ControlRequestOverlay>
            <RequestCard>
              <RequestIcon>
                <DesktopWindowsIcon style={{ fontSize: 28, color: '#1a1a1a' }} />
              </RequestIcon>
              <RequestTitle>Remote Control Request</RequestTitle>
              <RequestSubtitle>
                <RequesterName>{requesterDisplayName}</RequesterName> wants to control your
                computer. They will be able to see your screen and send mouse & keyboard events.
              </RequestSubtitle>
              <RequestActions>
                <AcceptButton
                  variant="contained"
                  startIcon={<CheckIcon />}
                  onClick={handleGrantControl}
                >
                  Allow
                </AcceptButton>
                <DenyButton
                  variant="outlined"
                  startIcon={<CloseOutlinedIcon />}
                  onClick={handleDenyControl}
                >
                  Deny
                </DenyButton>
              </RequestActions>
            </RequestCard>
          </ControlRequestOverlay>
        )}

        {/* Requester sees waiting overlay */}
        {controlRequestPending && !pendingControlRequest && (
          <WaitingOverlay>
            <SpinnerIcon />
            <WaitingTitle>Waiting for approval...</WaitingTitle>
            <WaitingSubtitle>The owner is reviewing your request</WaitingSubtitle>
            <Button
              variant="text"
              onClick={handleCancelRequest}
              style={{ color: '#666', marginTop: 8, textTransform: 'none', fontSize: 12 }}
            >
              Cancel request
            </Button>
          </WaitingOverlay>
        )}

        {/* Normal screen share UI (only if not in pending/request states) */}
        {!controlRequestPending && !pendingControlRequest && (
          <>
            <Toolbar>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<DesktopWindowsIcon />}
                onClick={() => {
                  if (shareScreenManager?.myStream) {
                    shareScreenManager?.stopScreenShare()
                  } else {
                    shareScreenManager?.startScreenShare()
                  }
                }}
              >
                {shareScreenManager?.myStream ? 'Stop sharing' : 'Share Screen'}
              </Button>
            </Toolbar>
            <VideoGrid>
              {myStream && <VideoContainer stream={myStream} playerName="You" />}
              {[...peerStreams.entries()].map(([id, { stream }]) => {
                const playerName = playerNameMap.get(id)
                return <VideoContainer key={id} playerName={playerName} stream={stream} />
              })}
            </VideoGrid>
          </>
        )}
      </Wrapper>
    </Backdrop>
  )
}
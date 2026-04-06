import React, { useRef, useEffect, useCallback, useState } from 'react'
import styled, { keyframes, css } from 'styled-components'
import IconButton from '@mui/material/IconButton'
import StopIcon from '@mui/icons-material/Stop'
import MouseIcon from '@mui/icons-material/Mouse'
import KeyboardIcon from '@mui/icons-material/Keyboard'

import { useAppSelector, useAppDispatch } from '../hooks'
import { endActiveControl } from '../stores/ComputerStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

// ─── Animations ──────────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
`

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
`

const scanline = keyframes`
  0%   { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
`

// ─── Styled Components ────────────────────────────────────────────────────────

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background: #0a0a0f;
  border-radius: 12px;
  overflow: hidden;
  animation: ${fadeIn} 0.3s ease-out;
  display: flex;
  flex-direction: column;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  z-index: 10;
`

const StatusIndicator = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: ${({ $active }) => ($active ? '#4ade80' : '#facc15')};

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    animation: ${({ $active }) =>
      $active
        ? css`${pulse} 2s ease-in-out infinite`
        : 'none'};
  }
`

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ControlBadge = styled.div<{ $on: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.05em;
  background: ${({ $on }) => ($on ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255,255,255,0.06)')};
  color: ${({ $on }) => ($on ? '#4ade80' : '#888')};
  border: 1px solid ${({ $on }) => ($on ? 'rgba(74, 222, 128, 0.3)' : 'transparent')};
  transition: all 0.2s;
`

const VideoWrapper = styled.div`
  flex: 1;
  position: relative;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`

const StyledVideo = styled.video`
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
`

const InputOverlay = styled.div`
  position: absolute;
  inset: 0;
  cursor: none;
  z-index: 5;
`

const RemoteCursor = styled.div<{ $x: number; $y: number }>`
  position: absolute;
  pointer-events: none;
  z-index: 10;
  left: ${({ $x }) => $x}px;
  top: ${({ $y }) => $y}px;
  transform: translate(-2px, -2px);

  &::before {
    content: '';
    display: block;
    width: 14px;
    height: 14px;
    border: 2px solid #4ade80;
    border-radius: 50%;
    background: rgba(74, 222, 128, 0.2);
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
  }
`

const WaitingOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 15, 0.92);
  gap: 16px;
  z-index: 20;
`

const WaitingText = styled.p`
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #facc15;
  letter-spacing: 0.08em;
  animation: ${pulse} 2s ease-in-out infinite;
  margin: 0;
`

const WaitingSubText = styled.p`
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: #666;
  margin: 0;
`

const ScanlineEffect = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
  overflow: hidden;
  opacity: 0.03;

  &::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 2px;
    background: rgba(255, 255, 255, 0.8);
    animation: ${scanline} 6s linear infinite;
  }
`

const StopButton = styled(IconButton)`
  && {
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: 6px;
    padding: 4px 8px;
    gap: 4px;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;

    &:hover {
      background: rgba(248, 113, 113, 0.2);
    }

    svg {
      font-size: 14px;
    }
  }
`

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  computerId: string
  iAmOwner: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScreenShareView({ computerId, iAmOwner }: Props) {
  const dispatch = useAppDispatch()
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
  const [keyboardActive, setKeyboardActive] = useState(false)

  const remoteStream = useAppSelector((state) => state.computer.activeControl?.remoteStream)
  const game = phaserGame.scene.keys.game as Game
  const network = game?.network

  // Set video stream when it arrives (controller side)
  useEffect(() => {
    if (!iAmOwner && videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream
    }
  }, [remoteStream, iAmOwner])

  // Disable game keys while in control mode
  useEffect(() => {
    game?.disableKeys()
    return () => {
      game?.enableKeys()
    }
  }, [game])

  // ── Input capture (controller side only) ──────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (iAmOwner || !network) return
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      network.sendInputEvent(computerId, { type: 'mousemove', x, y })
    },
    [iAmOwner, computerId, network]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (iAmOwner || !network) return
      e.preventDefault()
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      network.sendInputEvent(computerId, { type: 'mousedown', button: e.button, x, y })
    },
    [iAmOwner, computerId, network]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (iAmOwner || !network) return
      network.sendInputEvent(computerId, { type: 'mouseup', button: e.button })
    },
    [iAmOwner, computerId, network]
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (iAmOwner || !network) return
      network.sendInputEvent(computerId, { type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY })
    },
    [iAmOwner, computerId, network]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (iAmOwner || !network) return
      e.preventDefault()
      setKeyboardActive(true)
      network.sendInputEvent(computerId, {
        type: 'keydown',
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
      })
    },
    [iAmOwner, computerId, network]
  )

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (iAmOwner || !network) return
      setKeyboardActive(false)
      network.sendInputEvent(computerId, { type: 'keyup', key: e.key, code: e.code })
    },
    [iAmOwner, computerId, network]
  )

  const handleStopControl = () => {
    console.log('📹 Cancel button clicked, releasing control')
    // 1. Immediately update UI
    dispatch(endActiveControl())
    // 2. Notify server (so the other side also ends)
    if (network) {
      network.releaseControl(computerId)
    }
  }

  const isStreaming = iAmOwner ? true : !!remoteStream
  const statusText = iAmOwner
    ? 'SHARING SCREEN'
    : remoteStream
    ? 'RECEIVING STREAM'
    : 'CONNECTING...'

  return (
    <Container>
      <Header>
        <StatusIndicator $active={isStreaming}>{statusText}</StatusIndicator>

        <Controls>
          {!iAmOwner && (
            <>
              <ControlBadge $on={true}>
                <MouseIcon style={{ fontSize: 12 }} />
                MOUSE
              </ControlBadge>
              <ControlBadge $on={keyboardActive}>
                <KeyboardIcon style={{ fontSize: 12 }} />
                KEYBOARD
              </ControlBadge>
            </>
          )}
          {isStreaming && (
            <StopButton onClick={handleStopControl} size="small">
              <StopIcon />
              {iAmOwner ? 'REVOKE' : 'RELEASE'}
            </StopButton>
          )}
        </Controls>
      </Header>

      <VideoWrapper>
        <StyledVideo ref={videoRef} autoPlay muted={iAmOwner} playsInline />

        {!iAmOwner && (
          <InputOverlay
            ref={overlayRef}
            tabIndex={0}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onClick={(e) => overlayRef.current?.focus()}
          >
            <RemoteCursor $x={cursorPos.x} $y={cursorPos.y} />
          </InputOverlay>
        )}

        {!iAmOwner && !remoteStream && (
          <WaitingOverlay>
            <WaitingText>⏳ WAITING FOR STREAM...</WaitingText>
            <WaitingSubText>Owner is setting up screen share</WaitingSubText>
            <StopButton onClick={handleStopControl} size="small" style={{ marginTop: 16 }}>
              <StopIcon />
              CANCEL
            </StopButton>
          </WaitingOverlay>
        )}

        <ScanlineEffect />
      </VideoWrapper>
    </Container>
  )
}
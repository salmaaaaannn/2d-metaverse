import React, { useState, useEffect, useRef } from 'react'
import styled from 'styled-components'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import SendIcon from '@mui/icons-material/Send'

import { useAppSelector } from '../hooks'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { phaserEvents } from '../events/EventCenter'

const ChatContainer = styled.div`
  position: absolute;
  bottom: 20px;
  left: 20px;
  width: 280px;
  background: rgba(34, 38, 57, 0.95);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  display: flex;
  flex-direction: column;
  z-index: 1500;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
`

const MessageList = styled.div`
  height: 200px;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const MessageItem = styled.div<{ $isOwn: boolean }>`
  align-self: ${props => props.$isOwn ? 'flex-end' : 'flex-start'};
  background: ${props => props.$isOwn ? '#3f51b5' : '#2c2f3a'};
  color: white;
  padding: 6px 10px;
  border-radius: 12px;
  max-width: 80%;
  word-wrap: break-word;
  font-size: 13px;
`

const SenderName = styled.div`
  font-size: 11px;
  color: #aaa;
  margin-bottom: 2px;
`

const InputArea = styled.div`
  display: flex;
  padding: 8px;
  border-top: 1px solid rgba(255,255,255,0.1);
`

const StyledTextField = styled(TextField)`
  && {
    .MuiInputBase-root {
      color: white;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      font-size: 13px;
    }
    .MuiOutlinedInput-notchedOutline {
      border: none;
    }
  }
`

const SendButton = styled(IconButton)`
  && {
    color: #3f51b5;
    margin-left: 4px;
  }
`

interface Message {
  id: string
  senderId: string
  senderName: string
  text: string
  timestamp: number
}

export default function WhiteboardChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const mySessionId = useAppSelector((state) => state.user.sessionId)
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const game = phaserGame.scene.keys.game as Game
  const network = game?.network

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Listen for incoming chat messages
  useEffect(() => {
    const handleChatMessage = ({ senderId, text }: { senderId: string; text: string }) => {
      const senderName = playerNameMap.get(senderId) || senderId
      setMessages(prev => [...prev, {
        id: `${senderId}-${Date.now()}`,
        senderId,
        senderName,
        text,
        timestamp: Date.now()
      }])
    }

    phaserEvents.on('whiteboard-chat', handleChatMessage)
    return () => {
      phaserEvents.off('whiteboard-chat', handleChatMessage)
    }
  }, [playerNameMap])

  const sendMessage = () => {
    if (!input.trim() || !network) return
    network.send('whiteboard_chat', { text: input })
    setInput('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <ChatContainer>
      <MessageList>
        {messages.map(msg => (
          <MessageItem key={msg.id} $isOwn={msg.senderId === mySessionId}>
            <SenderName>{msg.senderName}</SenderName>
            {msg.text}
          </MessageItem>
        ))}
        <div ref={messagesEndRef} />
      </MessageList>
      <InputArea>
        <StyledTextField
          fullWidth
          variant="outlined"
          size="small"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <SendButton onClick={sendMessage}>
          <SendIcon />
        </SendButton>
      </InputArea>
    </ChatContainer>
  )
}
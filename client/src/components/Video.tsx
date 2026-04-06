import React, { VideoHTMLAttributes, useEffect, useRef, useState } from 'react'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import VolumeOffIcon from '@mui/icons-material/VolumeOff'

type PropsType = VideoHTMLAttributes<HTMLVideoElement> & {
  srcObject: MediaStream
  userId: string
  userName?: string
  muted?: boolean
  isLocal?: boolean
  onMuteToggle?: (userId: string, muted: boolean) => void
}

export default function Video({
  srcObject,
  userId,
  userName,
  muted = false,
  isLocal = false,
  onMuteToggle,
  ...props
}: PropsType) {
  const refVideo = useRef<HTMLVideoElement>(null)
  const [isMuted, setIsMuted] = useState(muted)
  const [isMicEnabled, setIsMicEnabled] = useState(true)

  useEffect(() => {
    if (!refVideo.current) return
    refVideo.current.srcObject = srcObject
  }, [srcObject])

  useEffect(() => {
    if (!isLocal) {
      setIsMuted(muted)
    }
  }, [muted, isLocal])

  const handleClick = () => {
    if (isLocal) {
      const audioTrack = srcObject.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMicEnabled(audioTrack.enabled)
      }
    } else {
      const newMuted = !isMuted
      setIsMuted(newMuted)
      if (onMuteToggle) {
        onMuteToggle(userId, newMuted)
      }
    }
  }

  const getIcon = () => {
    if (isLocal) {
      return isMicEnabled ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />
    }
    return isMuted ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />
  }

  const getButtonColor = () => {
    if (isLocal) return isMicEnabled ? '#4caf50' : '#f44336'
    return isMuted ? '#f44336' : '#4caf50'
  }

  const displayName = isLocal ? 'You' : (userName || userId)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <video
        ref={refVideo}
        id={userId}
        autoPlay
        playsInline
        muted={isLocal || isMuted}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: '10px',
          transform: 'scaleX(-1)',
        }}
        {...props}
      />

      {/* Name label – smaller, semi-transparent */}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        background: 'rgba(0,0,0,0.6)',
        color: 'white',
        padding: '2px 8px',
        borderRadius: '16px',
        fontSize: '11px',
        fontWeight: '500',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255,255,255,0.2)',
      }}>
        {displayName}
      </div>

      {/* Mute button – smaller */}
      <button
        onClick={handleClick}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          backgroundColor: getButtonColor(),
          color: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '30px',
          height: '30px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
          zIndex: 10,
          transition: 'opacity 0.2s',
          opacity: 0.9,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.9')}
      >
        {getIcon()}
      </button>
    </div>
  )
}
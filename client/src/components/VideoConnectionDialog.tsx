import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { useDispatch, useSelector } from 'react-redux';

import phaserGame from '../PhaserGame';
import Game from '../scenes/Game';
import Video from './Video';
import { setMutedUser } from '../stores/UserStore';
import { RootState } from '../stores';
import { phaserEvents } from '../events/EventCenter';
import { sanitizeId } from '../util';

const Backdrop = styled.div`
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1000;
  max-width: 380px;
  pointer-events: none;
`;

const Wrapper = styled.div`
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 16px;
  padding: 12px;
  color: white;
  box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid rgba(255,255,255,0.1);
`;

const VideoStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 2px;
  scrollbar-width: thin;
  scrollbar-color: #555 #222;
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: #222;
  }
  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 3px;
  }
`;

const VideoContainer = styled.div`
  position: relative;
  width: 200px;
  height: 150px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  transition: transform 0.1s ease;
  &:hover {
    transform: scale(1.02);
  }
`;

const LocalVideoContainer = styled(VideoContainer)`
  border: 2px solid #4caf50;
`;

const Controls = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
`;

const StyledButton = styled(Button)`
  && {
    background: #3f51b5;
    color: white;
    text-transform: none;
    font-weight: 500;
    padding: 4px 12px;
    &:hover {
      background: #303f9f;
    }
  }
`;

export default function VideoConnectionDialog() {
  const [connectionWarning, setConnectionWarning] = useState(true);
  const [remoteStreams, setRemoteStreams] = useState<{ userId: string; stream: MediaStream }[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const playerNameMap = useSelector((state: RootState) => state.user.playerNameMap);
  const mutedUsers = useSelector((state: RootState) => state.user.mutedUsers);
  const dispatch = useDispatch();
  const game = phaserGame.scene.keys.game as Game;

  const getDisplayName = useCallback((userId: string) => {
    if (userId === 'Me') return 'You';
    // FIX: Sanitize userId for lookup since playerNameMap stores sanitized keys
    const sanitized = sanitizeId(userId)
    return playerNameMap.get(sanitized) || playerNameMap.get(userId) || userId
  }, [playerNameMap]);

  const onMuteToggle = useCallback((userId: string, muted: boolean) => {
    const webRTC = game.network?.webRTC;
    if (!webRTC) return;
    dispatch(setMutedUser({ userId, muted }));
    webRTC.setRemoteAudioEnabled(userId, !muted);
  }, [dispatch, game.network]);

  useEffect(() => {
    const webRTC = game.network?.webRTC;
    if (!webRTC) return;

    const handleStreamAdded = (userId: string, stream: MediaStream) => {
      console.log(`📹 VideoDialog: stream-added for ${userId}`);
      setRemoteStreams((prev) => {
        if (prev.find(s => s.userId === userId)) return prev;
        return [...prev, { userId, stream }];
      });
    };

    const handleStreamRemoved = (userId: string) => {
      console.log(`📹 VideoDialog: stream-removed for ${userId}`);
      setRemoteStreams((prev) => prev.filter(s => s.userId !== userId));
    };

    const handleLocalStream = (stream: MediaStream) => {
      console.log(`📹 VideoDialog: local stream ready`);
      setLocalStream(stream);
      setConnectionWarning(false);
    };

    const handlePeerClosed = (userId: string) => {
      console.log(`📹 VideoDialog: peer-closed for ${userId}`);
      setRemoteStreams((prev) => prev.filter(s => s.userId !== userId));
    };

    webRTC.on('stream-added', handleStreamAdded);
    webRTC.on('stream-removed', handleStreamRemoved);
    webRTC.on('local-stream', handleLocalStream);
    phaserEvents.on('peer-closed', handlePeerClosed);

    const existing = webRTC.getAllRemoteStreams();
    const formatted = existing.map(item => ({ userId: item.id, stream: item.stream }));
    setRemoteStreams(formatted);

    if (webRTC.getLocalStream()) {
      setLocalStream(webRTC.getLocalStream()!);
      setConnectionWarning(false);
    }

    return () => {
      webRTC.off('stream-added', handleStreamAdded);
      webRTC.off('stream-removed', handleStreamRemoved);
      webRTC.off('local-stream', handleLocalStream);
      phaserEvents.off('peer-closed', handlePeerClosed);
    };
  }, [game.network]);

  const handleConnectWebcam = () => {
    const webRTC = game.network?.webRTC;
    if (webRTC) webRTC.getUserMedia();
  };

  return (
    <Backdrop>
      {(localStream || remoteStreams.length > 0 || connectionWarning) && (
        <Wrapper>
          {connectionWarning && !localStream && (
            <Alert
              severity="warning"
              onClose={() => setConnectionWarning(false)}
              style={{ marginBottom: '8px', padding: '4px 12px', fontSize: '0.9rem' }}
            >
              <AlertTitle style={{ fontSize: '0.9rem', marginBottom: '2px' }}>Warning</AlertTitle>
              No webcam connected. <br /> Connect one to see others!
            </Alert>
          )}

          <Controls>
            {!localStream && (
              <StyledButton variant="contained" onClick={handleConnectWebcam}>
                Connect Webcam
              </StyledButton>
            )}
          </Controls>

          <VideoStack>
            {localStream && (
              <LocalVideoContainer>
                <Video
                  srcObject={localStream}
                  userId="Me"
                  userName="You"
                  muted={false}
                  isLocal={true}
                />
              </LocalVideoContainer>
            )}

            {remoteStreams.map(({ userId, stream }) => (
              <VideoContainer key={userId}>
                <Video
                  srcObject={stream}
                  userId={userId}
                  userName={getDisplayName(userId)}
                  muted={!!mutedUsers[userId]}
                  isLocal={false}
                  onMuteToggle={onMuteToggle}
                />
              </VideoContainer>
            ))}
          </VideoStack>
        </Wrapper>
      )}
    </Backdrop>
  );
}
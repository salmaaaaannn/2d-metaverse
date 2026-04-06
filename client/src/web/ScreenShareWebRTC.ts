/**
 * ScreenShareWebRTC.ts
 *
 * Manages WebRTC peer connections for the REMOTE CONTROL feature.
 * - Owner (sharer): Captures screen via getDisplayMedia, sends stream to controller.
 * - Controller (viewer): Receives stream, displays in ScreenShareView component.
 *
 * Uses the Colyseus room as the signaling channel (no PeerJS here).
 */

import Network from '../services/Network'
import store from '../stores'
import { setControlRemoteStream } from '../stores/ComputerStore'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export default class ScreenShareWebRTC {
  private network: Network
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private targetId: string = ''
  private computerId: string = ''
  private isOwner: boolean = false

  constructor(network: Network) {
    this.network = network
    // Register callbacks for WebRTC signaling
    network.onWebRTCOffer(this.handleOffer.bind(this))
    network.onWebRTCAnswer(this.handleAnswer.bind(this))
    network.onWebRTCIceCandidate(this.handleCandidate.bind(this))
    console.log('📹 ScreenShareWebRTC: constructor, callbacks registered')
  }

  /**
   * Called by Owner when they grant control.
   * 1. Captures screen.
   * 2. Creates WebRTC Offer.
   * 3. Sends Offer to Controller via Network.
   */
  async startScreenShare(targetId: string, computerId: string): Promise<void> {
    console.log(`📹 ScreenShareWebRTC.startScreenShare: target=${targetId}, computer=${computerId}`)
    this.isOwner = true
    this.targetId = targetId
    this.computerId = computerId

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen sharing not supported in this browser')
      }

      // Capture screen (force high frame rate for better control feel)
      const constraints: any = {
        video: { cursor: 'always', frameRate: 60 },
        audio: false,
      }
      console.log('📹 Requesting display media...')
      this.localStream = await navigator.mediaDevices.getDisplayMedia(constraints)
      console.log('📹 Got local stream, tracks:', this.localStream.getTracks().length)

      this.peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      console.log('📹 PeerConnection created (owner)')

      // Add tracks
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection!.addTrack(track, this.localStream!)
        console.log(`📹 Added track: ${track.kind}`)
      })

      // Handle ICE Candidates (send to peer)
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('📹 ICE candidate (owner) sending')
          this.network.sendWebRTCIceCandidate(this.targetId, event.candidate.toJSON())
        }
      }

      // Handle connection state changes
      this.peerConnection.onconnectionstatechange = () => {
        console.log(`📹 PeerConnection state: ${this.peerConnection?.connectionState}`)
        if (this.peerConnection?.connectionState === 'failed' || this.peerConnection?.connectionState === 'disconnected') {
          console.error('📹 Peer connection failed/disconnected, cleaning up')
          this.stopScreenShare()
        }
      }

      // Handle stream stop via browser UI
      const videoTrack = this.localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('📹 Screen sharing stopped by browser UI')
          this.stopScreenShare()
        }
      }

      // Create Offer
      console.log('📹 Creating offer...')
      const offer = await this.peerConnection.createOffer()
      await this.peerConnection.setLocalDescription(offer)
      console.log('📹 Offer created, sending to controller')
      
      // Send to Controller
      this.network.sendWebRTCOffer(this.targetId, offer, this.computerId)

    } catch (err) {
      console.error('📹 Failed to start screen share:', err)
      this.cleanup()
    }
  }

  /**
   * Called by Controller when they receive an Offer.
   * 1. Sets up PeerConnection.
   * 2. Accepts Offer.
   * 3. Sends Answer back to Owner.
   */
  async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit, computerId: string): Promise<void> {
    console.log(`📹 ScreenShareWebRTC.handleOffer: from=${fromId}, computer=${computerId}`)
    this.isOwner = false
    this.targetId = fromId
    this.computerId = computerId

    this.peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    console.log('📹 PeerConnection created (controller)')

    // Handle ICE Candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('📹 ICE candidate (controller) sending')
        this.network.sendWebRTCIceCandidate(fromId, event.candidate.toJSON())
      }
    }

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      console.log(`📹 PeerConnection state: ${this.peerConnection?.connectionState}`)
      if (this.peerConnection?.connectionState === 'failed' || this.peerConnection?.connectionState === 'disconnected') {
        console.error('📹 Peer connection failed/disconnected, cleaning up')
        this.stopViewing()
      }
    }

    // Handle Incoming Stream (The screen share)
    this.peerConnection.ontrack = (event) => {
      console.log('📹 ontrack: received remote stream')
      this.remoteStream = event.streams[0]
      // Update Redux so React UI can render the video
      store.dispatch(setControlRemoteStream(this.remoteStream))
      console.log('📹 Remote stream dispatched to Redux')
    }

    console.log('📹 Setting remote description (offer)')
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
    
    console.log('📹 Creating answer...')
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    console.log('📹 Answer created, sending to owner')
    
    // Send Answer
    this.network.sendWebRTCAnswer(fromId, answer)
  }

  /**
   * Called by Owner when they receive an Answer.
   */
  async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    console.log(`📹 ScreenShareWebRTC.handleAnswer: from=${fromId}`)
    if (this.peerConnection && this.isOwner) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
      console.log('📹 Remote description (answer) set on owner')
    } else {
      console.warn('📹 handleAnswer: peerConnection not ready or not owner')
    }
  }

  /**
   * Called by both sides when they receive an ICE Candidate.
   */
  async handleCandidate(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    console.log(`📹 ScreenShareWebRTC.handleCandidate: from=${fromId}`)
    if (this.peerConnection) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      console.log('📹 ICE candidate added')
    } else {
      console.warn('📹 handleCandidate: peerConnection not ready')
    }
  }

  /**
   * Cleanup when control session ends.
   */
  stopScreenShare(): void {
    console.log('📹 stopScreenShare')
    this.localStream?.getTracks().forEach((t) => {
      t.stop()
      console.log(`📹 Track ${t.kind} stopped`)
    })
    if (this.isOwner && this.computerId) {
      // Tell server we are done
      this.network.releaseControl(this.computerId)
      console.log(`📹 releaseControl sent for computer ${this.computerId}`)
    }
    this.cleanup()
  }

  stopViewing(): void {
    console.log('📹 stopViewing')
    store.dispatch(setControlRemoteStream(null))
    this.cleanup()
  }

  private cleanup(): void {
    console.log('📹 cleanup')
    this.peerConnection?.close()
    this.peerConnection = null
    this.localStream = null
    this.remoteStream = null
    this.isOwner = false
    this.targetId = ''
    this.computerId = ''
  }
}
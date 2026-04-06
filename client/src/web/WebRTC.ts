import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'

export default class WebRTC {
  isConnected(userId: string) {
    throw new Error('Method not implemented.')
  }
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; stream: MediaStream }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; stream: MediaStream }>()
  private myStream?: MediaStream
  private network: Network

  // Map sanitized ID back to original userId
  private idMap = new Map<string, string>()

  // Event callbacks (Modified to match React component signature)
  private onStreamAddedCallbacks: ((userId: string, stream: MediaStream) => void)[] = []
  private onStreamRemovedCallbacks: ((userId: string) => void)[] = []
  private onLocalStreamCallbacks: ((stream: MediaStream) => void)[] = []

  constructor(userId: string, network: Network) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network
    // Store mapping
    this.idMap.set(sanitizedId, userId)

    console.log('userId:', userId)
    console.log('sanitizedId:', sanitizedId)
    
    this.myPeer.on('error', (err) => {
      console.log(err.type)
      console.error(err)
    })

    this.initialize()
  }

  // --- 1. The Critical Fix: Implement 'on' and 'off' ---
  // This allows the React component to subscribe using strings
  on(event: string, fn: any) {
    if (event === 'stream-added') this.onStreamAddedCallbacks.push(fn)
    if (event === 'stream-removed') this.onStreamRemovedCallbacks.push(fn)
    if (event === 'local-stream') this.onLocalStream(fn)
  }

  off(event: string, fn: any) {
    if (event === 'stream-added') this.onStreamAddedCallbacks = this.onStreamAddedCallbacks.filter(cb => cb !== fn)
    if (event === 'stream-removed') this.onStreamRemovedCallbacks = this.onStreamRemovedCallbacks.filter(cb => cb !== fn)
    if (event === 'local-stream') this.onLocalStreamCallbacks = this.onLocalStreamCallbacks.filter(cb => cb !== fn)
  }

  // PeerJS throws invalid_id error if it contains certain characters.
  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  private initialize() {
    this.myPeer.on('call', (call) => {
      // Answer incoming calls
      if (!this.onCalledPeers.has(call.peer)) {
        call.answer(this.myStream) // Answer with our stream (if we have one)
        
        call.on('stream', (userVideoStream) => {
          if (this.onCalledPeers.has(call.peer)) return // duplicate check

          // Store the stream
          this.onCalledPeers.set(call.peer, { call, stream: userVideoStream })
          
          // Notify listeners - Try to find original ID, fallback to peer ID
          const originalId = this.idMap.get(call.peer) || call.peer
          this.emitStreamAdded(originalId, userVideoStream)
        })
      }
    })
  }

  // --- Internal Event Emitters ---
  
  private emitStreamAdded(userId: string, stream: MediaStream) {
    // FIX: Pass arguments separately to match React component expectation
    this.onStreamAddedCallbacks.forEach(cb => cb(userId, stream))
  }

  private emitStreamRemoved(userId: string) {
    this.onStreamRemovedCallbacks.forEach(cb => cb(userId))
  }

  private emitLocalStream(stream: MediaStream) {
    this.onLocalStreamCallbacks.forEach(cb => cb(stream))
  }

  // helper for type safety if needed explicitly
  private onLocalStream(callback: (stream: MediaStream) => void) {
    this.onLocalStreamCallbacks.push(callback)
    if (this.myStream) callback(this.myStream)
  }

  // ----- Media access -----
  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') this.getUserMedia(false)
    })
  }

  getUserMedia(alertOnError = true) {
    navigator.mediaDevices
      ?.getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        this.myStream = stream
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
        this.emitLocalStream(stream)
        
        // If we are already in calls (received), we might need to replace tracks?
        // For simplicity in this version, we assume camera is set up before calls or 
        // that new calls will pick it up.
      })
      .catch((error) => {
        if (alertOnError) window.alert('No webcam or microphone found, or permission is blocked')
      })
  }

  getLocalStream(): MediaStream | undefined {
    return this.myStream
  }

  stopLocalStream() {
    if (this.myStream) {
      this.myStream.getTracks().forEach(track => track.stop())
      this.myStream = undefined
      store.dispatch(setVideoConnected(false))
    }
  }

  // ----- Call management -----
  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      
      // Store mapping for future reference (Important so we know who called us later)
      if (!this.idMap.has(sanitizedId)) {
        this.idMap.set(sanitizedId, userId)
      }

      if (!this.peers.has(sanitizedId) && !this.onCalledPeers.has(sanitizedId)) {
        console.log('calling', sanitizedId)
        
        const call = this.myPeer.call(sanitizedId, this.myStream)
        
        call.on('stream', (userVideoStream) => {
          if(this.peers.has(sanitizedId)) return 

          this.peers.set(sanitizedId, { call, stream: userVideoStream })
          this.emitStreamAdded(userId, userVideoStream)
        })
      }
    }
  }

  // Close connection with a user
  closePeerConnection(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)

    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)!
      peer.call.close()
      this.peers.delete(sanitizedId)
    } 
    
    if (this.onCalledPeers.has(sanitizedId)) {
      const peer = this.onCalledPeers.get(sanitizedId)!
      peer.call.close()
      this.onCalledPeers.delete(sanitizedId)
    }

    // Always emit removal to update UI
    this.emitStreamRemoved(userId)
  }

  // ----- Local mute (PUBG-style) -----
  setRemoteAudioEnabled(userId: string, enabled: boolean) {
    const sanitizedId = this.replaceInvalidId(userId)
    const peerEntry = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
    
    if (!peerEntry) {
      // It's possible we don't have the stream yet if it's loading
      return
    }
    
    const stream = peerEntry.stream
    const audioTracks = stream.getAudioTracks()
    
    if (audioTracks.length > 0) {
      audioTracks[0].enabled = enabled
      console.log(`Remote audio for ${userId} set to ${enabled}`)
    }
  }

  // ----- Get all current remote streams (for initial render) -----
  getAllRemoteStreams(): { id: string; stream: MediaStream }[] {
    const all: { id: string; stream: MediaStream }[] = []
    
    this.peers.forEach((value, key) => {
      const originalId = this.idMap.get(key) || key
      all.push({ id: originalId, stream: value.stream })
    })
    
    this.onCalledPeers.forEach((value, key) => {
      const originalId = this.idMap.get(key) || key
      all.push({ id: originalId, stream: value.stream })
    })
    
    return all
  }
}
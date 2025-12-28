export interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  audioStream?: MediaStream;
}

// Enhanced ICE configuration with TURN servers for cross-network connectivity
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    // STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free TURN servers for cross-network connectivity
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
};

export class WebRTCManager {
  private peers: Map<string, PeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private myId: string = '';
  private isMicEnabled: boolean = false;
  private onPeerAudio: (peerId: string, stream: MediaStream) => void;
  private onPeerDisconnect: (peerId: string) => void;
  private onUserConnected: (userId: string) => void;
  private onMicStatusChange: (userId: string, status: boolean) => void;

  constructor(
    onPeerAudio: (peerId: string, stream: MediaStream) => void,
    onPeerDisconnect: (peerId: string) => void,
    onUserConnected: (userId: string) => void,
    onMicStatusChange: (userId: string, status: boolean) => void
  ) {
    this.onPeerAudio = onPeerAudio;
    this.onPeerDisconnect = onPeerDisconnect;
    this.onUserConnected = onUserConnected;
    this.onMicStatusChange = onMicStatusChange;
  }

  getMyId(): string {
    return this.myId;
  }

  async initLocalStream(): Promise<MediaStream> {
    try {
      console.log('Requesting microphone access with enhanced audio processing...');
      
      // Request microphone with aggressive noise/echo cancellation
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Advanced constraints for better noise filtering
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        },
        video: false,
      });

      // Apply additional audio processing
      this.processedStream = await this.applyAdvancedAudioProcessing(this.localStream);

      // ALWAYS start with mic DISABLED
      this.processedStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        console.log('Audio track created and disabled:', track.id);
      });
      this.isMicEnabled = false;

      // Add tracks to all existing peer connections
      this.addTracksToAllPeers();

      console.log('Local stream initialized with enhanced noise cancellation, mic OFF');
      return this.processedStream;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      throw error;
    }
  }

  private async applyAdvancedAudioProcessing(stream: MediaStream): Promise<MediaStream> {
    try {
      // Create audio context for advanced processing
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      
      const source = this.audioContext.createMediaStreamSource(stream);
      const destination = this.audioContext.createMediaStreamDestination();

      // Create high-pass filter to remove low frequency noise (rumble, wind)
      const highPassFilter = this.audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 85; // Cut frequencies below 85Hz (removes wind, rumble)
      highPassFilter.Q.value = 0.7;

      // Create low-pass filter to remove high frequency noise (hiss)
      const lowPassFilter = this.audioContext.createBiquadFilter();
      lowPassFilter.type = 'lowpass';
      lowPassFilter.frequency.value = 8000; // Cut frequencies above 8kHz
      lowPassFilter.Q.value = 0.7;

      // Create dynamics compressor to even out volume
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // Create gain node to boost voice after filtering
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1.2;

      // Connect the audio processing chain
      source.connect(highPassFilter);
      highPassFilter.connect(lowPassFilter);
      lowPassFilter.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(destination);

      console.log('Advanced audio processing applied: high-pass (85Hz), low-pass (8kHz), compression');
      
      return destination.stream;
    } catch (error) {
      console.warn('Failed to apply advanced audio processing, using original stream:', error);
      return stream;
    }
  }

  private addTracksToAllPeers() {
    const streamToUse = this.processedStream || this.localStream;
    if (!streamToUse) return;

    console.log('Adding tracks to all existing peers:', this.peers.size);

    this.peers.forEach((peer, peerId) => {
      const senders = peer.connection.getSenders();
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');

      if (!hasAudioSender) {
        console.log('Adding audio track to peer:', peerId);
        streamToUse.getTracks().forEach((track) => {
          peer.connection.addTrack(track, streamToUse);
        });

        // Renegotiate connection
        this.renegotiate(peerId, peer.connection);
      }
    });
  }

  private async renegotiate(peerId: string, peerConnection: RTCPeerConnection) {
    try {
      console.log('Renegotiating with peer:', peerId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendToSignalingServer({
        type: 'offer',
        to: peerId,
        sdp: offer,
      });
    } catch (error) {
      console.error('Renegotiation failed:', error);
    }
  }

  hasLocalStream(): boolean {
    return this.localStream !== null || this.processedStream !== null;
  }

  connectToSignalingServer(serverUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Connecting to signaling server:', serverUrl);
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('Connected to signaling server');
        };

        this.ws.onmessage = async (event) => {
          const data = JSON.parse(event.data);
          console.log('Received signaling message:', data.type);
          await this.handleSignalingMessage(data);

          if (data.type === 'user-connected' && data.id) {
            if (!this.myId) {
              this.myId = data.id;
              console.log('My ID assigned:', this.myId);
              resolve(this.myId);
            } else {
              console.log('New user connected:', data.id);
              this.onUserConnected(data.id);
              // Initiate connection to new user
              await this.createOffer(data.id);
            }
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Disconnected from signaling server');
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private async handleSignalingMessage(data: any) {
    switch (data.type) {
      case 'offer':
        console.log('Received offer from:', data.from);
        await this.handleOffer(data.from, data.sdp);
        break;
      case 'answer':
        console.log('Received answer from:', data.from);
        await this.handleAnswer(data.from, data.sdp);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(data.from, data.candidate);
        break;
      case 'mic-status':
        this.onMicStatusChange(data.id, data.status);
        break;
    }
  }

  private async createOffer(peerId: string) {
    console.log('Creating offer for peer:', peerId);
    const peerConnection = this.createPeerConnection(peerId);

    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
      console.log('Adding local tracks to offer');
      streamToUse.getTracks().forEach((track) => {
        peerConnection.addTrack(track, streamToUse);
      });
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    this.sendToSignalingServer({
      type: 'offer',
      to: peerId,
      sdp: offer,
    });
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    console.log('Handling offer from peer:', peerId);

    // Check if peer already exists
    let peer = this.peers.get(peerId);
    let peerConnection: RTCPeerConnection;

    if (peer) {
      peerConnection = peer.connection;
    } else {
      peerConnection = this.createPeerConnection(peerId);
    }

    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
      const senders = peerConnection.getSenders();
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');

      if (!hasAudioSender) {
        console.log('Adding local tracks to answer');
        streamToUse.getTracks().forEach((track) => {
          peerConnection.addTrack(track, streamToUse);
        });
      }
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    this.sendToSignalingServer({
      type: 'answer',
      to: peerId,
      sdp: answer,
    });
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(peerId);
    if (peer) {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId);
    if (peer && candidate) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    // Check if connection already exists
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      console.log('Reusing existing peer connection for:', peerId);
      return existingPeer.connection;
    }

    console.log('Creating new peer connection for:', peerId);
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendToSignalingServer({
          type: 'ice-candidate',
          to: peerId,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.ontrack = (event) => {
      console.log('Received track from peer:', peerId, 'kind:', event.track.kind);
      const [remoteStream] = event.streams;

      // CRITICAL: Skip our own audio to prevent echo/hearing ourselves
      if (peerId === this.myId) {
        console.log('Skipping own audio stream to prevent echo');
        return;
      }

      console.log('Playing remote audio from peer:', peerId);
      this.onPeerAudio(peerId, remoteStream);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(`Peer ${peerId} connection state:`, peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed') {
        this.removePeer(peerId);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`Peer ${peerId} ICE state:`, peerConnection.iceConnectionState);
    };

    this.peers.set(peerId, { id: peerId, connection: peerConnection });
    return peerConnection;
  }

  private sendToSignalingServer(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('Sending to signaling server:', message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not ready, cannot send:', message.type);
    }
  }

  sendMicStatus(status: boolean) {
    this.sendToSignalingServer({
      type: 'mic-status',
      status,
    });
  }

  toggleMic(enabled: boolean) {
    console.log('toggleMic called with:', enabled);

    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
      streamToUse.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
        console.log('Audio track enabled:', track.enabled, 'id:', track.id);
      });
    } else {
      console.warn('No local stream to toggle mic');
    }
    this.isMicEnabled = enabled;
    this.sendMicStatus(enabled);
  }

  isMicOn(): boolean {
    return this.isMicEnabled;
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connection.close();
      this.peers.delete(peerId);
      this.onPeerDisconnect(peerId);
    }
  }

  disconnect() {
    console.log('Disconnecting WebRTC manager...');
    this.peers.forEach((peer) => {
      peer.connection.close();
    });
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.processedStream) {
      this.processedStream.getTracks().forEach((track) => track.stop());
      this.processedStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

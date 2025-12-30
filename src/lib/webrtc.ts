export interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  audioStream?: MediaStream;
}

// Enhanced ICE configuration with multiple TURN servers for cross-network connectivity
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    // Google STUN servers (free, reliable)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Additional STUN servers for redundancy
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voip.blackberry.com:3478' },

    // Metered TURN servers (free tier - reliable for cross-network)
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'e8dd65c92c5e4db0beee5a40',
      credential: 'FvPvX6eqrHH/fFPT',
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65c92c5e4db0beee5a40',
      credential: 'FvPvX6eqrHH/fFPT',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'e8dd65c92c5e4db0beee5a40',
      credential: 'FvPvX6eqrHH/fFPT',
    },
    {
      urls: 'turn:a.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65c92c5e4db0beee5a40',
      credential: 'FvPvX6eqrHH/fFPT',
    },
    {
      urls: 'turns:a.relay.metered.ca:443',
      username: 'e8dd65c92c5e4db0beee5a40',
      credential: 'FvPvX6eqrHH/fFPT',
    },

    // OpenRelay TURN servers (backup)
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
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export class WebRTCManager {
  private peers: Map<string, PeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private myId: string = '';
  private isMicEnabled: boolean = false;
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
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
      console.log('🎤 Requesting microphone access with enhanced audio processing...');

      // Request microphone with aggressive noise/echo cancellation
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        },
        video: false,
      });

      // Apply additional audio processing
      this.processedStream = await this.applyAdvancedAudioProcessing(this.localStream);

      // Start with mic DISABLED but track exists
      this.processedStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        console.log('🎤 Audio track created and disabled:', track.id);
      });
      this.isMicEnabled = false;

      // CRITICAL: Add tracks to all existing peer connections and renegotiate
      await this.addTracksToAllPeersAndRenegotiate();

      console.log('✅ Local stream initialized with enhanced noise cancellation, mic OFF');
      return this.processedStream;
    } catch (error) {
      console.error('❌ Error accessing microphone:', error);
      throw error;
    }
  }

  private async applyAdvancedAudioProcessing(stream: MediaStream): Promise<MediaStream> {
    try {
      this.audioContext = new AudioContext({ sampleRate: 48000 });

      const source = this.audioContext.createMediaStreamSource(stream);
      const destination = this.audioContext.createMediaStreamDestination();

      // High-pass filter to remove low frequency noise
      const highPassFilter = this.audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 85;
      highPassFilter.Q.value = 0.7;

      // Low-pass filter to remove high frequency noise
      const lowPassFilter = this.audioContext.createBiquadFilter();
      lowPassFilter.type = 'lowpass';
      lowPassFilter.frequency.value = 8000;
      lowPassFilter.Q.value = 0.7;

      // Dynamics compressor to even out volume
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // Gain node to boost voice
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1.2;

      // Connect the audio processing chain
      source.connect(highPassFilter);
      highPassFilter.connect(lowPassFilter);
      lowPassFilter.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(destination);

      console.log('🔊 Advanced audio processing applied');

      return destination.stream;
    } catch (error) {
      console.warn('⚠️ Failed to apply advanced audio processing, using original stream:', error);
      return stream;
    }
  }

  private async addTracksToAllPeersAndRenegotiate() {
    const streamToUse = this.processedStream || this.localStream;
    if (!streamToUse) return;

    console.log('🔄 Adding tracks to all existing peers:', this.peers.size);

    for (const [peerId, peer] of this.peers) {
      const senders = peer.connection.getSenders();
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');

      if (!hasAudioSender) {
        console.log('➕ Adding audio track to peer:', peerId);
        streamToUse.getTracks().forEach((track) => {
          peer.connection.addTrack(track, streamToUse);
        });

        // Renegotiate connection
        await this.renegotiate(peerId, peer.connection);
      }
    }
  }

  private async renegotiate(peerId: string, peerConnection: RTCPeerConnection) {
    try {
      console.log('🔄 Renegotiating with peer:', peerId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendToSignalingServer({
        type: 'offer',
        to: peerId,
        sdp: offer,
      });
    } catch (error) {
      console.error('❌ Renegotiation failed:', error);
    }
  }

  hasLocalStream(): boolean {
    return this.localStream !== null || this.processedStream !== null;
  }

  connectToSignalingServer(
    serverUrl: string,
    onOpen?: () => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔌 Connecting to signaling server:', serverUrl);

        const connectionTimeout = setTimeout(() => {
          console.error('⏱️ WebSocket connection timeout');
          reject(new Error('Connection timeout - server not responding'));
        }, 10000);

        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connected to signaling server');
          clearTimeout(connectionTimeout);
          onOpen?.();
        };

        this.ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('📩 Received signaling message:', data.type, data);
            await this.handleSignalingMessage(data, resolve);
          } catch (parseError) {
            console.error('Failed to parse message:', parseError, event.data);
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          console.error('❌ WebSocket error:', error);
          reject(new Error(`WebSocket error - check if server is running at ${serverUrl}`));
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          console.log('🔌 Disconnected from signaling server', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });

          if (!this.myId) {
            reject(new Error(`Connection closed: ${event.reason || 'Unknown reason'} (code: ${event.code})`));
          }
        };
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  private async handleSignalingMessage(data: any, resolve?: (value: string) => void) {
    switch (data.type) {
      // Handle 'welcome' message from server (initial connection)
      case 'welcome':
        if (data.id) {
          this.myId = data.id;
          console.log('🆔 My ID assigned (welcome):', this.myId);
          resolve?.(this.myId);

          // Handle existing users in the room from welcome message
          if (data.users && Array.isArray(data.users)) {
            console.log('👥 Existing users in room:', data.users);
            for (const userId of data.users) {
              if (userId !== this.myId) {
                this.onUserConnected(userId);
                await this.createOffer(userId);
              }
            }
          }
        }
        break;

      case 'user-connected':
        if (data.id) {
          if (!this.myId) {
            this.myId = data.id;
            console.log('🆔 My ID assigned:', this.myId);
            resolve?.(this.myId);
          } else if (data.id !== this.myId) {
            console.log('👤 New user connected:', data.id);
            this.onUserConnected(data.id);
            // Initiate connection to new user
            await this.createOffer(data.id);
          }
        }
        break;

      case 'user-list':
        // Handle existing users in the room
        if (data.users && Array.isArray(data.users)) {
          console.log('👥 Received user list:', data.users);
          for (const userId of data.users) {
            if (userId !== this.myId) {
              this.onUserConnected(userId);
              await this.createOffer(userId);
            }
          }
        }
        break;

      case 'offer':
        console.log('📥 Received offer from:', data.from);
        await this.handleOffer(data.from, data.sdp);
        break;

      case 'answer':
        console.log('📥 Received answer from:', data.from);
        await this.handleAnswer(data.from, data.sdp);
        break;

      case 'ice-candidate':
        await this.handleIceCandidate(data.from, data.candidate);
        break;

      case 'mic-status':
        this.onMicStatusChange(data.id, data.status);
        break;

      case 'user-disconnected':
        if (data.id) {
          console.log('👋 User disconnected:', data.id);
          this.removePeer(data.id);
        }
        break;

      default:
        console.log('📩 Unknown message type:', data.type, data);
    }
  }

  private async createOffer(peerId: string) {
    console.log('📤 Creating offer for peer:', peerId);
    const peerConnection = this.createPeerConnection(peerId);

    // CRITICAL: Always add a transceiver for audio even without local stream
    const existingTransceivers = peerConnection.getTransceivers();
    const hasAudioTransceiver = existingTransceivers.some(t => t.receiver.track.kind === 'audio');

    if (!hasAudioTransceiver) {
      // Add transceiver to receive audio
      peerConnection.addTransceiver('audio', { direction: 'recvonly' });
      console.log('📻 Added audio transceiver (recvonly)');
    }

    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
      const senders = peerConnection.getSenders();
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');

      if (!hasAudioSender) {
        console.log('➕ Adding local tracks to offer');
        streamToUse.getTracks().forEach((track) => {
          peerConnection.addTrack(track, streamToUse);
        });

        // Update transceiver direction to sendrecv
        const transceivers = peerConnection.getTransceivers();
        transceivers.forEach(t => {
          if (t.receiver.track.kind === 'audio') {
            t.direction = 'sendrecv';
          }
        });
      }
    }

    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendToSignalingServer({
        type: 'offer',
        to: peerId,
        sdp: offer,
      });
      console.log('📤 Offer sent to:', peerId);
    } catch (error) {
      console.error('❌ Failed to create offer:', error);
    }
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    console.log('📥 Handling offer from peer:', peerId);

    let peer = this.peers.get(peerId);
    let peerConnection: RTCPeerConnection;

    if (peer) {
      peerConnection = peer.connection;
    } else {
      peerConnection = this.createPeerConnection(peerId);
    }

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('✅ Remote description set for:', peerId);

      // Process any pending ICE candidates
      const pending = this.pendingCandidates.get(peerId);
      if (pending) {
        console.log(`📦 Processing ${pending.length} pending ICE candidates`);
        for (const candidate of pending) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingCandidates.delete(peerId);
      }

      const streamToUse = this.processedStream || this.localStream;
      if (streamToUse) {
        const senders = peerConnection.getSenders();
        const hasAudioSender = senders.some(s => s.track?.kind === 'audio');

        if (!hasAudioSender) {
          console.log('➕ Adding local tracks to answer');
          streamToUse.getTracks().forEach((track) => {
            peerConnection.addTrack(track, streamToUse);
          });
        }
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendToSignalingServer({
        type: 'answer',
        to: peerId,
        sdp: answer,
      });
      console.log('📤 Answer sent to:', peerId);
    } catch (error) {
      console.error('❌ Failed to handle offer:', error);
    }
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log('✅ Answer applied for:', peerId);

        // Process any pending ICE candidates
        const pending = this.pendingCandidates.get(peerId);
        if (pending) {
          console.log(`📦 Processing ${pending.length} pending ICE candidates`);
          for (const candidate of pending) {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          this.pendingCandidates.delete(peerId);
        }
      } catch (error) {
        console.error('❌ Failed to set remote description:', error);
      }
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId);
    if (!candidate) return;

    if (peer && peer.connection.remoteDescription) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('🧊 ICE candidate added for:', peerId);
      } catch (error) {
        console.error('❌ Error adding ICE candidate:', error);
      }
    } else {
      // Queue the candidate until remote description is set
      console.log('📦 Queueing ICE candidate for:', peerId);
      if (!this.pendingCandidates.has(peerId)) {
        this.pendingCandidates.set(peerId, []);
      }
      this.pendingCandidates.get(peerId)!.push(candidate);
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      console.log('♻️ Reusing existing peer connection for:', peerId);
      return existingPeer.connection;
    }

    console.log('🆕 Creating new peer connection for:', peerId);
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateType = event.candidate.type || 'unknown';
        console.log(`🧊 ICE candidate [${candidateType}] for ${peerId}:`, event.candidate.candidate?.substring(0, 50));
        this.sendToSignalingServer({
          type: 'ice-candidate',
          to: peerId,
          candidate: event.candidate,
        });
      } else {
        console.log(`✅ ICE gathering complete for ${peerId}`);
      }
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log(`🔍 ICE gathering state for ${peerId}:`, peerConnection.iceGatheringState);
    };

    peerConnection.ontrack = (event) => {
      console.log('🎵 Received track from peer:', peerId, 'kind:', event.track.kind);

      if (event.track.kind !== 'audio') return;

      const [remoteStream] = event.streams;

      // Skip our own audio
      if (peerId === this.myId) {
        console.log('🔇 Skipping own audio stream');
        return;
      }

      console.log('🔊 Playing remote audio from peer:', peerId);
      this.onPeerAudio(peerId, remoteStream);
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log(`📶 Peer ${peerId} connection state:`, state);

      if (state === 'connected') {
        console.log(`✅ Successfully connected to peer: ${peerId}`);
        this.logSelectedCandidatePair(peerConnection, peerId);
      }
      if (state === 'disconnected' || state === 'failed') {
        console.log(`❌ Connection ${state} for peer: ${peerId}`);
        this.removePeer(peerId);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      console.log(`🧊 Peer ${peerId} ICE state:`, iceState);

      // Handle ICE connection failures
      if (iceState === 'failed') {
        console.log(`🔄 ICE failed for ${peerId}, attempting ICE restart...`);
        this.restartIce(peerId, peerConnection);
      }
    };

    peerConnection.onnegotiationneeded = async () => {
      console.log(`🔄 Negotiation needed for peer: ${peerId}`);
    };

    this.peers.set(peerId, { id: peerId, connection: peerConnection });
    return peerConnection;
  }

  private sendToSignalingServer(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('📤 Sending to signaling server:', message.type, 'to:', message.to);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('⚠️ WebSocket not ready, cannot send:', message.type);
    }
  }

  sendMicStatus(status: boolean) {
    this.sendToSignalingServer({
      type: 'mic-status',
      status,
    });
  }

  toggleMic(enabled: boolean) {
    console.log('🎤 toggleMic called with:', enabled);

    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
      streamToUse.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
        console.log('🎤 Audio track enabled:', track.enabled);
      });
    } else {
      console.warn('⚠️ No local stream to toggle mic');
    }
    this.isMicEnabled = enabled;
    this.sendMicStatus(enabled);
  }

  isMicOn(): boolean {
    return this.isMicEnabled;
  }

  private async logSelectedCandidatePair(peerConnection: RTCPeerConnection, peerId: string) {
    try {
      const stats = await peerConnection.getStats();
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          console.log(`📊 Selected candidate pair for ${peerId}:`, {
            localType: report.localCandidateId,
            remoteType: report.remoteCandidateId,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
          });
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          console.log(`📊 ${report.type} for ${peerId}:`, {
            candidateType: report.candidateType,
            protocol: report.protocol,
            address: report.address,
            port: report.port,
          });
        }
      });
    } catch (error) {
      console.warn('Could not get candidate pair stats:', error);
    }
  }

  private async restartIce(peerId: string, peerConnection: RTCPeerConnection) {
    try {
      console.log(`🔄 Restarting ICE for peer: ${peerId}`);
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);

      this.sendToSignalingServer({
        type: 'offer',
        to: peerId,
        sdp: offer,
      });
    } catch (error) {
      console.error('ICE restart failed:', error);
    }
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connection.close();
      this.peers.delete(peerId);
      this.pendingCandidates.delete(peerId);
      this.onPeerDisconnect(peerId);
      console.log('👋 Peer removed:', peerId);
    }
  }

  disconnect() {
    console.log('🔌 Disconnecting WebRTC manager...');
    this.peers.forEach((peer) => {
      peer.connection.close();
    });
    this.peers.clear();
    this.pendingCandidates.clear();

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

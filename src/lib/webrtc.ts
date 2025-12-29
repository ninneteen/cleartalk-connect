// webrtc.ts

export interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  audioSender?: RTCRtpSender;
  isPolite: boolean;
  makingOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
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

  // --- Audio Initialization ---
  async initLocalStream(): Promise<MediaStream> {
    try {
      console.log('Requesting microphone access...');
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

      try {
        this.processedStream = await this.applyAdvancedAudioProcessing(this.localStream);
        console.log('✅ Audio processing applied');
      } catch (err) {
        console.warn('⚠️ Audio processing failed, using raw stream', err);
        this.processedStream = this.localStream;
      }

      const streamToUse = this.processedStream || this.localStream;
      streamToUse!.getAudioTracks().forEach((track) => {
        track.enabled = false; // Muted by default
      });
      this.isMicEnabled = false;

      await this.addTracksToAllPeers();
      return streamToUse!;
    } catch (error) {
      console.error('❌ Error accessing microphone:', error);
      throw error;
    }
  }

  private async applyAdvancedAudioProcessing(stream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
    }
    await this.ensureAudioContextResumed();

    const source = this.audioContext.createMediaStreamSource(stream);
    const destination = this.audioContext.createMediaStreamDestination();

    const highPassFilter = this.audioContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 85;
    highPassFilter.Q.value = 0.7;

    const lowPassFilter = this.audioContext.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = 8000;
    lowPassFilter.Q.value = 0.7;

    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.2;

    source.connect(highPassFilter);
    highPassFilter.connect(lowPassFilter);
    lowPassFilter.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(destination);

    return destination.stream;
  }

  private async ensureAudioContextResumed() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('🔊 AudioContext Resumed');
      } catch (e) {
        console.warn('Waiting for user interaction to resume AudioContext');
      }
    }
  }

  // --- Peer & Connection Logic ---
  private async addTracksToAllPeers() {
    const streamToUse = this.processedStream || this.localStream;
    if (!streamToUse) return;

    for (const [peerId, peer] of this.peers) {
      await this.attachLocalAudio(peerId, peer.connection);
      if (peer.connection.signalingState === 'stable') {
        await this.renegotiate(peerId, peer.connection);
      }
    }
  }

  private async renegotiate(peerId: string, peerConnection: RTCPeerConnection) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (!peerConnection.remoteDescription && peerConnection.signalingState !== 'have-local-offer') return;
    if (peer.makingOffer) return;

    try {
      peer.makingOffer = true;
      const offer = await peerConnection.createOffer();
      if (peerConnection.localDescription?.sdp === offer.sdp) return;

      await peerConnection.setLocalDescription(offer);
      this.sendToSignalingServer({
        type: 'offer',
        to: peerId,
        sdp: peerConnection.localDescription,
      });
    } catch (error) {
      console.error('Renegotiation error:', error);
    } finally {
      peer.makingOffer = false;
    }
  }

  connectToSignalingServer(serverUrl: string, onOpen?: () => void): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Connecting to:', serverUrl);
        const connectionTimeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('✅ WS Connected');
          clearTimeout(connectionTimeout);
          onOpen?.();
        };

        this.ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'welcome' && data.id) {
              this.myId = data.id;
              console.log('🆔 My ID:', this.myId);
              if (data.users && Array.isArray(data.users)) {
                for (const userId of data.users) {
                  if (userId === this.myId) continue;
                  this.onUserConnected(userId);
                  await this.createOffer(userId);
                }
              }
              resolve(this.myId);
              return;
            }

            if (data.from && data.from !== this.myId) {
                switch (data.type) {
                case 'offer': await this.handleOffer(data.from, data.sdp); break;
                case 'answer': await this.handleAnswer(data.from, data.sdp); break;
                case 'ice-candidate': await this.handleIceCandidate(data.from, data.candidate); break;
                case 'mic-status': this.onMicStatusChange(data.id, data.status); break;
                case 'user-disconnected': this.removePeer(data.id); break;
                }
            }
            
            if (data.type === 'user-connected' && data.id && data.id !== this.myId) {
              this.onUserConnected(data.id);
              await this.createOffer(data.id);
            }
          } catch (err) {
            console.error('WS Message Error:', err);
          }
        };

        this.ws.onerror = (err) => {
          clearTimeout(connectionTimeout);
          reject(err);
        };
        this.ws.onclose = () => console.log('🔌 WS Disconnected');
      } catch (error) {
        reject(error);
      }
    });
  }

  private createPeerConnection(peerId: string, isPolite: boolean = false): RTCPeerConnection {
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) return existingPeer.connection;

    console.log(`Creating PC for ${peerId}`);
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    const audioTransceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendToSignalingServer({ type: 'ice-candidate', to: peerId, candidate: event.candidate });
      }
    };

    peerConnection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (peerId === this.myId) return;
      this.ensureAudioContextResumed().catch(console.error);
      this.onPeerAudio(peerId, remoteStream);
    };

    peerConnection.onconnectionstatechange = () => {
      if (['disconnected', 'failed'].includes(peerConnection.connectionState)) {
        this.removePeer(peerId);
      }
    };

    this.peers.set(peerId, {
      id: peerId,
      connection: peerConnection,
      audioSender: audioTransceiver.sender,
      isPolite,
      makingOffer: false,
      pendingCandidates: [],
    });

    return peerConnection;
  }

  private async attachLocalAudio(peerId: string, peerConnection: RTCPeerConnection) {
    const peer = this.peers.get(peerId);
    const streamToUse = this.processedStream || this.localStream;
    const track = streamToUse?.getAudioTracks()[0];
    if (!peer || !track) return;

    try {
      if (peer.audioSender) {
        if (peer.audioSender.track?.id === track.id) return;
        await peer.audioSender.replaceTrack(track);
      } else {
        peer.audioSender = peerConnection.addTrack(track, streamToUse!);
      }
    } catch (error) {
      console.error('Track attachment failed:', error);
    }
  }

  private async createOffer(peerId: string) {
    const isPolite = this.myId < peerId;
    const peerConnection = this.createPeerConnection(peerId, isPolite);
    const peer = this.peers.get(peerId)!;

    if (peer.makingOffer || peerConnection.signalingState !== 'stable') return;

    await this.attachLocalAudio(peerId, peerConnection);

    try {
      peer.makingOffer = true;
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendToSignalingServer({
        type: 'offer',
        to: peerId,
        sdp: peerConnection.localDescription,
      });
    } catch (error) {
      console.error('Create offer error:', error);
    } finally {
      peer.makingOffer = false;
    }
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const isPolite = this.myId < peerId;
    let peer = this.peers.get(peerId);
    let peerConnection: RTCPeerConnection;

    if (peer) {
      peerConnection = peer.connection;
    } else {
      peerConnection = this.createPeerConnection(peerId, isPolite);
      peer = this.peers.get(peerId)!;
    }

    const offerCollision = peer.makingOffer || peerConnection.signalingState !== 'stable';
    if (offerCollision && !peer.isPolite) return;

    await this.attachLocalAudio(peerId, peerConnection);

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.processPendingCandidates(peer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      this.sendToSignalingServer({ type: 'answer', to: peerId, sdp: answer });
    } catch (error) {
      console.error('Handle offer error:', error);
    }
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.connection.signalingState !== 'have-local-offer') return;
    try {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.processPendingCandidates(peer);
    } catch (error) {
      console.error('Handle answer error:', error);
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(candidate);
        return;
    }
    await this.addIceCandidateSafely(peer.connection, candidate);
  }

  private async addIceCandidateSafely(pc: RTCPeerConnection, candidate: RTCIceCandidateInit) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('⚠️ Soft ICE Error:', error);
    }
  }

  private async processPendingCandidates(peer: PeerConnection) {
    if (peer.pendingCandidates.length === 0) return;
    const candidates = [...peer.pendingCandidates];
    peer.pendingCandidates = [];
    for (const c of candidates) await this.addIceCandidateSafely(peer.connection, c);
  }

  // --- Mic & Status (FIXED: Added missing method) ---
  
  toggleMic(enabled: boolean) {
    if (enabled) {
      this.ensureAudioContextResumed().catch(console.error);
    }
    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
        streamToUse.getAudioTracks().forEach(t => t.enabled = enabled);
    }
    this.isMicEnabled = enabled;
    this.sendMicStatus(enabled);
  }

  isMicOn(): boolean {
    return this.isMicEnabled;
  }

  // 👇 นี่คือฟังก์ชันที่หายไปในรอบที่แล้วครับ เพิ่มให้แล้วครับ
  sendMicStatus(status: boolean) {
    this.sendToSignalingServer({
      type: 'mic-status',
      status,
    });
  }

  hasLocalStream(): boolean {
    return this.localStream !== null;
  }

  private sendToSignalingServer(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
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
    this.peers.forEach((peer) => peer.connection.close());
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.processedStream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close().catch(console.error);
    this.ws?.close();
    this.myId = '';
    this.isMicEnabled = false;
  }
}
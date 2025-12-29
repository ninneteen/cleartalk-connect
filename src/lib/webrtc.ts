// webrtc.ts

export interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  audioStream?: MediaStream;
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

  async initLocalStream(): Promise<MediaStream> {
    try {
      console.log('Requesting microphone access with enhanced audio processing...');

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

      this.processedStream = await this.applyAdvancedAudioProcessing(this.localStream);

      this.processedStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        console.log('Audio track created and disabled:', track.id);
      });
      this.isMicEnabled = false;

      await this.addTracksToAllPeers();

      console.log('Local stream initialized, mic OFF');
      return this.processedStream;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      throw error;
    }
  }

  private async applyAdvancedAudioProcessing(stream: MediaStream): Promise<MediaStream> {
    try {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
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
    } catch (error) {
      console.warn('Failed to apply advanced audio processing, using original stream:', error);
      return stream;
    }
  }

  private async addTracksToAllPeers() {
    const streamToUse = this.processedStream || this.localStream;
    if (!streamToUse) return;

    for (const [peerId, peer] of this.peers) {
      await this.attachLocalAudio(peerId, peer.connection);
      await this.renegotiate(peerId, peer.connection);
    }
  }

  private async renegotiate(peerId: string, peerConnection: RTCPeerConnection) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (!peerConnection.remoteDescription) return;
    if (peer.makingOffer) return;
    if (peerConnection.signalingState !== 'stable') return;

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
      console.error('Renegotiation failed:', error);
    } finally {
      peer.makingOffer = false;
    }
  }

  // --- Helper ใหม่เพื่อลด Error ---
  private async addIceCandidateSafely(peerConnection: RTCPeerConnection, candidate: RTCIceCandidateInit) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      // Log เป็น warning แทน error เพื่อไม่ให้รก console และไม่ขัดการทำงาน
      console.warn('⚠️ Ignored ICE candidate (likely harmless timing issue):', error);
    }
  }

  // --- Helper สำหรับ flush candidates ---
  private async processPendingCandidates(peer: PeerConnection) {
    if (peer.pendingCandidates.length === 0) return;

    console.log(`Processing ${peer.pendingCandidates.length} pending candidates for ${peer.id}`);
    
    // Clone array เพื่อป้องกันการวนลูป array ที่กำลังถูกแก้ไข
    const candidates = [...peer.pendingCandidates];
    peer.pendingCandidates = []; // Clear queue ทันที

    for (const candidate of candidates) {
        await this.addIceCandidateSafely(peer.connection, candidate);
    }
  }

  hasLocalStream(): boolean {
    return this.localStream !== null || this.processedStream !== null;
  }

  connectToSignalingServer(serverUrl: string, onOpen?: () => void): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Connecting to signaling server:', serverUrl);

        const connectionTimeout = setTimeout(() => {
          reject(new Error('Connection timeout - server not responding'));
        }, 10000);

        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connected');
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
                  this.onUserConnected(userId);
                  await this.createOffer(userId);
                }
              }
              resolve(this.myId);
              return;
            }

            await this.handleSignalingMessage(data);

            if (data.type === 'user-connected' && data.id) {
              this.onUserConnected(data.id);
              await this.createOffer(data.id);
            }
          } catch (parseError) {
            console.error('Failed to parse message:', parseError);
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          console.error('❌ WebSocket error:', error);
          reject(new Error('WebSocket connection error'));
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          console.log('🔌 Disconnected');
          if (!this.myId) {
            reject(new Error(`Connection closed: ${event.reason}`));
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private async handleSignalingMessage(data: any) {
    switch (data.type) {
      case 'offer':
        await this.handleOffer(data.from, data.sdp);
        break;
      case 'answer':
        await this.handleAnswer(data.from, data.sdp);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(data.from, data.candidate);
        break;
      case 'mic-status':
        this.onMicStatusChange(data.id, data.status);
        break;
      case 'user-disconnected':
        this.removePeer(data.id);
        break;
    }
  }

  private async attachLocalAudio(peerId: string, peerConnection: RTCPeerConnection) {
    const peer = this.peers.get(peerId);
    const streamToUse = this.processedStream || this.localStream;
    const track = streamToUse?.getAudioTracks?.()[0];

    if (!peer || !streamToUse || !track) return;

    try {
      if (peer.audioSender) {
        if (peer.audioSender.track?.id === track.id) return;
        await peer.audioSender.replaceTrack(track);
        return;
      }
      peer.audioSender = peerConnection.addTrack(track, streamToUse);
    } catch (error) {
      console.error('Failed to attach local audio track:', error);
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
      console.error('Error creating offer:', error);
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
    const ignoreOffer = !peer.isPolite && offerCollision;

    if (ignoreOffer) {
      console.log('Ignoring offer (collision)');
      return;
    }

    await this.attachLocalAudio(peerId, peerConnection);

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

      // แก้ไข: ใช้ helper ที่ปลอดภัยกว่า และ process หลังจาก setRemoteDescription สำเร็จ
      await this.processPendingCandidates(peer);

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendToSignalingServer({
        type: 'answer',
        to: peerId,
        sdp: answer,
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (peer.connection.signalingState !== 'have-local-offer') return;

    try {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // แก้ไข: ใช้ helper ที่ปลอดภัยกว่า
      await this.processPendingCandidates(peer);
      
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId);
    if (!peer || !candidate) return;

    // แก้ไข: Logic การเช็คที่รัดกุมขึ้น และใช้ try-catch
    try {
      // ถ้าไม่มี Remote Description ให้เข้าคิวไว้ก่อน (เหมือนเดิม)
      if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(candidate);
        return;
      }

      // ถ้ามี Remote Description แล้ว ให้ลอง add เลย แต่ใช้ฟังก์ชันที่ปลอดภัย
      await this.addIceCandidateSafely(peer.connection, candidate);

    } catch (error) {
      // Catch-all สำหรับ error ที่อาจหลุดออกมา
      console.warn('Error in handleIceCandidate:', error);
    }
  }

  private createPeerConnection(peerId: string, isPolite: boolean = false): RTCPeerConnection {
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) return existingPeer.connection;

    console.log(`Creating PeerConnection for ${peerId}`);
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    const audioTransceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

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
      const [remoteStream] = event.streams;
      if (peerId === this.myId) return;
      this.onPeerAudio(peerId, remoteStream);
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed') {
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

  private sendToSignalingServer(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendMicStatus(status: boolean) {
    this.sendToSignalingServer({ type: 'mic-status', status });
  }

  toggleMic(enabled: boolean) {
    const streamToUse = this.processedStream || this.localStream;
    if (streamToUse) {
      streamToUse.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
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
    this.peers.forEach((peer) => peer.connection.close());
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.processedStream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.ws?.close();
  }
}
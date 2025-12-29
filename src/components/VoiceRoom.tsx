import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, PhoneOff, Users, RefreshCw, Volume2 } from 'lucide-react';
import { PlayerCard } from './PlayerCard';
import { WebRTCManager } from '@/lib/webrtc';
import { useProximityData, Player } from '@/hooks/useProximityData';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface VoiceRoomProps {
  apiKey: string;
  wsUrl: string;
  onDisconnect: () => void;
}

interface PeerAudioState {
  peerId: string;
  stream: MediaStream;
  isMuted: boolean;
}

export function VoiceRoom({ apiKey, wsUrl, onDisconnect }: VoiceRoomProps) {
  const [isMicOn, setIsMicOn] = useState(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [myId, setMyId] = useState('');
  const [peerAudios, setPeerAudios] = useState<Map<string, PeerAudioState>>(new Map());
  const [peerMicStatus, setPeerMicStatus] = useState<Map<string, boolean>>(new Map());
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const webrtcRef = useRef<WebRTCManager | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const isInitializedRef = useRef(false);
  const stopPollingRef = useRef<(() => void) | null>(null);

  const { data, loading, error, startPolling } = useProximityData();
  const { toast } = useToast();

  // Use refs for callbacks to prevent re-renders triggering reconnection
  const handlePeerAudioRef = useRef((peerId: string, stream: MediaStream) => {
    console.log('Received audio from peer:', peerId);

    // CRITICAL: Don't play our own audio back to ourselves
    if (peerId === webrtcRef.current?.getMyId()) {
      console.log('Skipping own audio to prevent echo');
      return;
    }

    // Create or update audio element
    let audioEl = audioElementsRef.current.get(peerId);
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.muted = false;
      // Set playsInline for mobile devices
      (audioEl as any).playsInline = true;
      audioElementsRef.current.set(peerId, audioEl);
    }
    audioEl.srcObject = stream;

    // Ensure audio plays
    audioEl.play().catch(err => console.error('Audio play failed:', err));

    setPeerAudios((prev) => {
      const next = new Map(prev);
      next.set(peerId, { peerId, stream, isMuted: false });
      return next;
    });
  });

  const handlePeerDisconnectRef = useRef((peerId: string) => {
    console.log('Peer disconnected:', peerId);

    const audioEl = audioElementsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioElementsRef.current.delete(peerId);
    }

    setPeerAudios((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });

    setConnectedUsers((prev) => prev.filter((id) => id !== peerId));
  });

  const handleUserConnectedRef = useRef((userId: string) => {
    console.log('User connected:', userId);
    setConnectedUsers((prev) => [...prev, userId]);
  });

  const handleMicStatusChangeRef = useRef((userId: string, status: boolean) => {
    setPeerMicStatus((prev) => {
      const next = new Map(prev);
      next.set(userId, status);
      return next;
    });
  });

  // Request mic permission ONLY when user clicks the mic button
  const requestMicPermission = useCallback(async () => {
    if (micPermissionGranted || !webrtcRef.current) return;

    try {
      console.log('Requesting mic permission with enhanced audio processing...');
      await webrtcRef.current.initLocalStream();
      setMicPermissionGranted(true);
      setIsMicOn(false);

      toast({
        title: 'ไมค์พร้อมใช้งาน',
        description: 'ตัดเสียงรบกวนเปิดอยู่ กดปุ่มไมค์อีกครั้งเพื่อเปิดใช้งาน',
      });
    } catch (err) {
      console.error('Failed to get mic permission:', err);
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถเข้าถึงไมค์',
        description: 'กรุณาอนุญาตการใช้ไมค์ในการตั้งค่าเบราว์เซอร์',
      });
    }
  }, [micPermissionGranted, toast]);

  // Initialize only once
  useEffect(() => {
    // Prevent double initialization
    if (isInitializedRef.current) {
      console.log('Already initialized, skipping...');
      return;
    }
    isInitializedRef.current = true;

    const init = async () => {
      setIsInitializing(true);

      try {
        // Start polling proximity data
        stopPollingRef.current = startPolling(apiKey, 5000);

        // Initialize WebRTC manager WITHOUT requesting mic yet
        const manager = new WebRTCManager(
          (peerId, stream) => handlePeerAudioRef.current(peerId, stream),
          (peerId) => handlePeerDisconnectRef.current(peerId),
          (userId) => handleUserConnectedRef.current(userId),
          (userId, status) => handleMicStatusChangeRef.current(userId, status)
        );
        webrtcRef.current = manager;

         // Connect to WebSocket ONLY - no mic request
         try {
           const id = await manager.connectToSignalingServer(wsUrl, () => {
             setWsConnected(true);
             toast({
               title: 'เชื่อมต่อ WebSocket แล้ว',
               description: 'กำลังรอรับ ID จากเซิร์ฟเวอร์...',
             });
           });
           setMyId(id);

           toast({
             title: 'เชื่อมต่อสำเร็จ',
             description: `ID ของคุณ: ${id}`,
           });
         } catch (wsErr) {
           console.error('WebSocket connection failed:', wsErr);
           setWsConnected(false);
           toast({
             variant: 'destructive',
             title: 'เชื่อมต่อ WebSocket ไม่ได้',
             description: wsErr instanceof Error ? wsErr.message : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เสียงได้',
           });
         }

        setMicPermissionGranted(false);
        setIsMicOn(false);

      } catch (err) {
        console.error('Failed to initialize:', err);
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: 'ไม่สามารถเชื่อมต่อได้ กรุณาตรวจสอบการตั้งค่า',
        });
      } finally {
        setIsInitializing(false);
      }
    };

    init();

    return () => {
      console.log('Cleaning up VoiceRoom...');
      if (stopPollingRef.current) {
        stopPollingRef.current();
      }
      webrtcRef.current?.disconnect();
      audioElementsRef.current.forEach((audio) => {
        audio.srcObject = null;
      });
      audioElementsRef.current.clear();
      isInitializedRef.current = false;
    };
  }, [apiKey, wsUrl]); // Only depend on props that don't change

  const toggleMic = async () => {
    if (!micPermissionGranted) {
      await requestMicPermission();
      return;
    }

    const newState = !isMicOn;
    console.log('Toggling mic to:', newState);
    setIsMicOn(newState);
    webrtcRef.current?.toggleMic(newState);
  };

  const handleDisconnect = () => {
    webrtcRef.current?.disconnect();
    onDisconnect();
  };

  const players = data?.players ? Object.values(data.players) : [];
  const onlinePlayers = players.filter((p) => p.status === 'online');
  const offlinePlayers = players.filter((p) => p.status !== 'online');

  return (
    <div className="min-h-screen bg-background grid-bg">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-pixel text-lg text-primary">MikeCraft</h1>
            <p className="text-sm text-muted-foreground">
              {data?.serverName || 'กำลังโหลด...'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-card px-3 py-2 rounded-lg border border-border">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">
                {onlinePlayers.length} ออนไลน์
              </span>
            </div>

            {loading && <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 pb-32">
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-4 mb-6">
            {error}
          </div>
        )}

        {/* Connection Status */}
        <div className={cn(
          "mb-4 p-3 border rounded-lg",
          wsConnected
            ? "bg-success/10 border-success/30"
            : "bg-destructive/10 border-destructive/30"
        )}>
          <p className="text-xs text-center">
            {wsConnected ? (
              <>✅ เชื่อมต่อ WebSocket สำเร็จ (ID: {myId}) • 🔇 ตัดเสียงรบกวน • 🎧 ไม่ได้ยินเสียงตัวเอง</>
            ) : (
              <>❌ ยังไม่ได้เชื่อมต่อ WebSocket • กรุณาตรวจสอบ URL เซิร์ฟเวอร์</>
            )}
          </p>
        </div>

        {/* Connected Users */}
        {peerAudios.size > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-accent" />
              เชื่อมต่อเสียงกับ {peerAudios.size} คน
            </h2>
            <div className="flex flex-wrap gap-2">
              {Array.from(peerAudios.values()).map(({ peerId }) => (
                <div
                  key={peerId}
                  className="bg-accent/10 text-accent px-3 py-1.5 rounded-full text-sm flex items-center gap-2"
                >
                  <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                  {peerId}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Online Players */}
        {onlinePlayers.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              ออนไลน์ ({onlinePlayers.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {onlinePlayers.map((player) => {
                const isMe = player.name === myId;
                return (
                  <PlayerCard
                    key={player.name}
                    player={player}
                    isMe={isMe}
                    isMuted={isMe ? !isMicOn : !peerMicStatus.get(player.name)}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Offline Players */}
        {offlinePlayers.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-muted-foreground mb-4">
              ออฟไลน์ ({offlinePlayers.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {offlinePlayers.map((player) => (
                <PlayerCard key={player.name} player={player} />
              ))}
            </div>
          </section>
        )}

        {players.length === 0 && !loading && (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">ไม่พบข้อมูลผู้เล่น</p>
          </div>
        )}
      </main>

      {/* Fixed Bottom Controls */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-md border-t border-border p-4">
        <div className="container mx-auto flex items-center justify-center gap-4">
          <Button
            onClick={toggleMic}
            disabled={isInitializing}
            size="lg"
            className={cn(
              'w-16 h-16 rounded-full transition-all duration-300',
              !micPermissionGranted
                ? 'bg-muted text-muted-foreground hover:bg-muted/90'
                : isMicOn
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 glow-primary'
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90 glow-destructive'
            )}
          >
            {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </Button>

          <Button
            onClick={handleDisconnect}
            size="lg"
            variant="outline"
            className="w-16 h-16 rounded-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-3">
          {isInitializing
            ? 'กำลังเชื่อมต่อ...'
            : !micPermissionGranted
              ? 'กดปุ่มไมค์เพื่อเริ่มใช้งาน'
              : isMicOn
                ? 'ไมค์เปิดอยู่ - คนอื่นได้ยินคุณ'
                : 'ไมค์ปิด - คนอื่นไม่ได้ยินคุณ'}
        </p>
      </div>
    </div>
  );
}

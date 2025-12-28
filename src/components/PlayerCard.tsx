import React from 'react';
import { Mic, MicOff, MapPin, User } from 'lucide-react';
import { Player } from '@/hooks/useProximityData';
import { cn } from '@/lib/utils';

interface PlayerCardProps {
  player: Player;
  isMe?: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
}

export function PlayerCard({ player, isMe, isMuted, isSpeaking }: PlayerCardProps) {
  const isOnline = player.status === 'online';

  return (
    <div
      className={cn(
        'bg-card border rounded-lg p-4 transition-all duration-300',
        isOnline ? 'border-primary/50' : 'border-border opacity-60',
        isSpeaking && 'border-accent glow-accent',
        isMe && 'ring-2 ring-primary/30'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              isOnline ? 'bg-primary/20' : 'bg-muted'
            )}
          >
            <User className={cn('w-5 h-5', isOnline ? 'text-primary' : 'text-muted-foreground')} />
          </div>
          <div>
            <p className="font-semibold text-foreground flex items-center gap-2">
              {player.name}
              {isMe && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                  คุณ
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">{player.gamemode}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              isOnline ? 'bg-success animate-pulse' : 'bg-muted-foreground'
            )}
          />
          {isOnline && (
            <div
              className={cn(
                'p-1.5 rounded-md',
                isMuted ? 'bg-destructive/20' : 'bg-primary/20'
              )}
            >
              {isMuted ? (
                <MicOff className="w-4 h-4 text-destructive" />
              ) : (
                <Mic className="w-4 h-4 text-primary" />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <MapPin className="w-4 h-4 text-accent" />
        <span className="text-muted-foreground font-mono">
          X: {Math.round(player.x)} Y: {Math.round(player.y)} Z: {Math.round(player.z)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          {player.dim.replace('minecraft:', '')}
        </span>
      </div>
    </div>
  );
}

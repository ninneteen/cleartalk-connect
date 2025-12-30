import React from 'react';
import { Player } from '@/hooks/useProximityData';
import { Mic, MicOff, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlayerCardProps {
  player: Player;
  isMe?: boolean;
  isMuted?: boolean;
}

export function PlayerCard({ player, isMe = false, isMuted = true }: PlayerCardProps) {
  const isOnline = player.status === 'online';

  return (
    <div
      className={cn(
        'relative rounded-xl border p-4 transition-all duration-300',
        isOnline
          ? 'bg-card border-border hover:border-primary/50 hover:shadow-lg'
          : 'bg-muted/30 border-border/50 opacity-60'
      )}
    >
      {isMe && (
        <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
          คุณ
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className={cn(
            'w-12 h-12 rounded-lg flex items-center justify-center',
            isOnline ? 'bg-primary/10' : 'bg-muted'
          )}
        >
          <User className={cn('w-6 h-6', isOnline ? 'text-primary' : 'text-muted-foreground')} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground truncate">{player.name}</h3>
            {isOnline && (
              <div className="flex items-center gap-1">
                {isMuted ? (
                  <MicOff className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Mic className="w-4 h-4 text-success animate-pulse" />
                )}
              </div>
            )}
          </div>

          {isOnline ? (
            <p className="text-xs text-muted-foreground">
              {player.dim} • {Math.round(player.x)}, {Math.round(player.y)}, {Math.round(player.z)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              ออฟไลน์ • {player.lastSeen}
            </p>
          )}
        </div>

        {/* Status indicator */}
        <div
          className={cn(
            'w-3 h-3 rounded-full',
            isOnline ? 'bg-success animate-pulse' : 'bg-muted-foreground/50'
          )}
        />
      </div>
    </div>
  );
}

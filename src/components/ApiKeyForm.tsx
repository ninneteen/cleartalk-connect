import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Server, Loader2 } from 'lucide-react';

interface ApiKeyFormProps {
  onConnect: (apiKey: string, wsUrl: string) => void;
  isConnecting: boolean;
}

export function ApiKeyForm({ onConnect, isConnecting }: ApiKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [wsUrl, setWsUrl] = useState('wss://ws-mike.runaesike.online');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim() && wsUrl.trim()) {
      onConnect(apiKey.trim(), wsUrl.trim());
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 grid-bg">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-pixel text-2xl text-primary mb-4 animate-float">
            MikeCraft
          </h1>
          <p className="text-xl font-semibold text-foreground mb-2">
            Proximity Voice Chat
          </p>
          <p className="text-muted-foreground">
            เชื่อมต่อเพื่อพูดคุยกับผู้เล่นใกล้เคียง
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Key className="w-4 h-4 text-primary" />
                API Key
              </label>
              <Input
                type="text"
                placeholder="กรอก API Key ของคุณ"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-input border-border"
                disabled={isConnecting}
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Server className="w-4 h-4 text-accent" />
                WebSocket URL
              </label>
              <Input
                type="text"
                placeholder="wss://..."
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                className="bg-input border-border"
                disabled={isConnecting}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={isConnecting || !apiKey.trim() || !wsUrl.trim()}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                กำลังเชื่อมต่อ...
              </>
            ) : (
              'เชื่อมต่อ'
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          ใช้งานสำหรับเซิร์ฟเวอร์ MikeCraft เท่านั้น
        </p>
      </div>
    </div>
  );
}

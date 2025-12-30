import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Server, Loader2, Mic } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-primary/5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Mic className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-primary mb-4 tracking-tight">
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
          <div className="bg-card border border-border rounded-xl p-6 space-y-4 shadow-lg">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Key className="w-4 h-4 text-primary" />
                API Key
              </label>
              <Input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ใส่ API Key ของคุณ"
                className="bg-background"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Server className="w-4 h-4 text-primary" />
                WebSocket URL
              </label>
              <Input
                type="text"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                placeholder="wss://your-server.com"
                className="bg-background"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isConnecting || !apiKey.trim() || !wsUrl.trim()}
              className="w-full"
              size="lg"
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
          </div>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          ต้องมี API Key จากเซิร์ฟเวอร์ MikeCraft
        </p>
      </div>
    </div>
  );
}

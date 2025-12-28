import React, { useState } from 'react';
import { ApiKeyForm } from '@/components/ApiKeyForm';
import { VoiceRoom } from '@/components/VoiceRoom';

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [credentials, setCredentials] = useState({ apiKey: '', wsUrl: '' });

  const handleConnect = async (apiKey: string, wsUrl: string) => {
    setIsConnecting(true);
    setCredentials({ apiKey, wsUrl });

    // Small delay for UX
    setTimeout(() => {
      setIsConnected(true);
      setIsConnecting(false);
    }, 500);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setCredentials({ apiKey: '', wsUrl: '' });
  };

  if (isConnected) {
    return (
      <VoiceRoom
        apiKey={credentials.apiKey}
        wsUrl={credentials.wsUrl}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return <ApiKeyForm onConnect={handleConnect} isConnecting={isConnecting} />;
};

export default Index;

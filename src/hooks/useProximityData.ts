import { useState, useCallback } from 'react';

export interface Player {
  name: string;
  x: number;
  y: number;
  z: number;
  dim: string;
  gamemode: string;
  status: string;
  lastSeen: string;
}

export interface ProximityData {
  serverName: string;
  status: string;
  lastUpdate: string;
  players: Record<string, Player>;
}

export function useProximityData() {
  const [data, setData] = useState<ProximityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (apiKey: string) => {
    setLoading(true);
    setError(null);

    try {
      const url = new URL('https://api-mike.runaesike.com/api/proximity-data');
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch proximity data');
      }

      const result = await response.json();
      setData(result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback((apiKey: string, interval: number = 5000) => {
    fetchData(apiKey);
    const pollInterval = setInterval(() => {
      fetchData(apiKey).catch(console.error);
    }, interval);

    return () => clearInterval(pollInterval);
  }, [fetchData]);

  return { data, loading, error, fetchData, startPolling };
}

import { useEffect, useRef, useState } from 'react';

// פונקציית retry/backoff מסויג עם jitter
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  maxDelay = 5000,
  signal?: AbortSignal
): Promise<T> => {
  let retryCount = 0;
  
  while (retryCount <= maxRetries) {
    try {
      // שימוש ב-AbortSignal.timeout לכל ניסיון
      const timeoutPromise = signal 
        ? Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('Operation aborted')));
            })
          ])
        : fn();
        
      return await timeoutPromise;
    } catch (error) {
      retryCount++;
      
      // סיווג שגיאות
      const isRetryable = error instanceof Error && 
        (error.message.includes('timeout') || 
         error.message.includes('5') || 
         error.message.includes('429'));
      
      // אם זו שגיאה שאינה ניתנת לניסיון חוזר, זרוק שוב
      if (!isRetryable || retryCount > maxRetries) {
        console.error(`Non-retryable error after ${retryCount} attempts:`, error);
        throw error;
      }
      
      // חישוב עיכוב מעריכי עם jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, retryCount - 1),
        maxDelay
      );
      const jitteredDelay = delay * (0.5 + Math.random() * 0.5);
      
      console.warn(`Attempt ${retryCount} failed. Retrying in ${jitteredDelay}ms...`, error);
      
      // המתנה עם העיכוב המחושב
      await new Promise(resolve => setTimeout(resolve, jitteredDelay));
    }
  }
  
  throw new Error(`Max retries (${maxRetries}) exceeded`);
};

export const useNotificationChannel = (url: string) => {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  useEffect(() => {
    // יצירת AbortController לביטול פעולות
    abortControllerRef.current = new AbortController();
    
    const connect = async () => {
      try {
        // ניסיוח ראשוני להתחבר לערוץ ההתראות
        await retryWithBackoff(
          () => {
            // סימולציה של חיבור לערוץ התראות
            return new Promise((resolve) => {
              setTimeout(() => {
                setIsConnected(true);
                setError(null);
                resolve(true);
              }, 1000);
            });
          },
          3,
          1000,
          5000,
          abortControllerRef.current.signal
        );
        
        // לאחר החיבור המוצלח, התחל קבלת התראות
        listenForNotifications();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
        setIsConnected(false);
      }
    };
    
    const listenForNotifications = async () => {
      // סימולציה של האזנה להתראות
      const interval = setInterval(() => {
        if (abortControllerRef.current?.signal.aborted) {
          clearInterval(interval);
          return;
        }
        
        // הוספת התראה חדשה (סימולציה)
        const newNotification = {
          id: Date.now(),
          message: `Notification ${notifications.length + 1}`,
          timestamp: new Date().toISOString(),
          correlationId: `corr-${Math.random().toString(36).substr(2, 9)}`
        };
        
        setNotifications(prev => [newNotification, ...prev]);
      }, 5000);
      
      // ניקוי בעת ביטול
      return () => clearInterval(interval);
    };
    
    connect();
    
    // ניקוי בעת ביטול הקומפוננטה
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [url]);
  
  const disconnect = () => {
    abortControllerRef.current?.abort();
    setIsConnected(false);
  };
  
  return {
    notifications,
    isConnected,
    error,
    disconnect
  };
};

// דוגמה לשימוש בקומפוננטה
const NotificationChannel = () => {
  const { notifications, isConnected, error, disconnect } = useNotificationChannel('/api/guard/notifications');
  
  return (
    <div>
      <h2>DB Guard Notifications</h2>
      
      <div>
        <button onClick={disconnect} disabled={!isConnected}>
          Disconnect
        </button>
      </div>
      
      {error && <div style={{ color: 'red' }}>Error: {error}</div>}
      
      <div>
        Status: {isConnected ? 'Connected' : 'Disconnected'}
      </div>
      
      <div>
        <h3>Notifications:</h3>
        <ul>
          {notifications.map(notification => (
            <li key={notification.id}>
              <div>ID: {notification.correlationId}</div>
              <div>{notification.message}</div>
              <div>{new Date(notification.timestamp).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

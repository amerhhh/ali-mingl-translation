import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { availableEmojis, type UserEmoji } from '@shared/schema';

// Cookie management helper functions
const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
};

const setCookie = (name: string, value: string, days: number = 365): void => {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${date.toUTCString()};path=/`;
};

interface Message {
  text: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: string;
  temp_user_uuid: string;
  user_emoji: UserEmoji;
  voiceType?: string;
  isOpenAI?: boolean;
}

interface ChatRoom {
  messages: Message[];
  isConnected: boolean;
  isConnecting: boolean;
  sendMessage: (text: string, sourceLang: string, targetLang: string, existingTranslation?: string) => void;
  reconnect: () => void;
  clearMessages: () => void;
  userEmoji: UserEmoji;
  setUserEmoji: (emoji: UserEmoji) => void;
  userId: string;
  loadStoredMessages: () => Promise<void>;
}

// Helper to get a random emoji from the available list
const getRandomEmoji = (): UserEmoji => {
  const index = Math.floor(Math.random() * availableEmojis.length);
  return availableEmojis[index];
};

export function useChatRoom(roomId: string): ChatRoom {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const { toast } = useToast();

  // Initialize with a cookie UUID, but this might be updated from message history
  const [userId, setUserId] = useState<string>(() => {
    const cookieUUID = getCookie('chat_user_uuid');
    if (!cookieUUID) {
      const newUUID = uuidv4();
      setCookie('chat_user_uuid', newUUID);
      console.log('Generated new UUID:', newUUID);
      // Store in window for OpenAI hook access
      (window as any).__temp_user_uuid = newUUID;
      return newUUID;
    }
    console.log('Using cookie UUID:', cookieUUID);
    // Store in window for OpenAI hook access
    (window as any).__temp_user_uuid = cookieUUID;
    return cookieUUID;
  });

  // Initialize with a random emoji, but this might be updated from message history
  const [userEmoji, setUserEmoji] = useState<UserEmoji>(() => {
    const emoji = getRandomEmoji();
    // Store in window for OpenAI hook access
    (window as any).__user_emoji = emoji;
    return emoji;
  });

  const messageQueue = useRef<{ text: string; sourceLang: string; targetLang: string }[]>([]);
  const reconnectTimeout = useRef<NodeJS.Timeout>();
  const reconnectAttempts = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const [socket, setSocket] = useState<WebSocket | null>(null);

  // Load stored messages and restore user identity
  const loadStoredMessages = useCallback(async () => {
    try {
      const stored = localStorage.getItem(`messages_${roomId}`);
      if (stored) {
        const parsedMessages = JSON.parse(stored);
        console.log('Loading stored messages:', parsedMessages);

        // Find any previous messages from this user's cookie UUID
        const userMessages = parsedMessages.filter((msg: Message) => msg.temp_user_uuid === userId);

        if (userMessages.length > 0) {
          const lastMessage = userMessages[userMessages.length - 1];
          console.log('Found previous user messages with UUID:', lastMessage.temp_user_uuid);

          // Update the UUID and emoji if found in history
          setUserId(lastMessage.temp_user_uuid);
          setCookie('chat_user_uuid', lastMessage.temp_user_uuid);

          if (lastMessage.user_emoji) {
            console.log('Restoring emoji from history:', lastMessage.user_emoji);
            setUserEmoji(lastMessage.user_emoji as UserEmoji);
            sessionStorage.setItem('userEmoji', lastMessage.user_emoji);
          }
        }

        // Only set messages if they're empty, to prevent duplicates when switching modes
        setMessages(prevMessages => {
          if (prevMessages.length === 0) {
            return parsedMessages;
          }
          return prevMessages;
        });
      }
    } catch (error) {
      console.error('Failed to load stored messages:', error);
      throw new Error('Failed to load stored messages');
    }
  }, [roomId, userId]);

  // Effect to initialize chat room
  useEffect(() => {
    const initializeChatRoom = async () => {
      try {
        // First load stored messages to potentially restore identity
        await loadStoredMessages();
        // Then connect with the correct identity
        connect();
      } catch (error) {
        console.error('Failed to initialize chat room:', error);
        setIsConnecting(false);
      }
    };

    initializeChatRoom();

    return () => {
      console.log('Cleaning up chat room hook');
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close();
      }
      
      // Clear global references on unmount
      (window as any).__chatWebSocket = null;
      (window as any).__chatWebSocketReady = false;
      
      // We don't clear messages here because we want to preserve them when switching modes
      // The duplicate prevention happens in the message handlers
    };
  }, []);

  const connect = useCallback(() => {
    try {
      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        setIsConnecting(false);
        toast({
          variant: "destructive",
          title: "Connection Failed",
          description: "Maximum reconnection attempts reached. Please try again later."
        });
        return;
      }

      console.log('Attempting WebSocket connection...');
      setIsConnecting(true);

      const host = window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${host}/ws`;

      console.log('Connecting to WebSocket URL:', wsUrl);
      console.log('Using persistent userId:', userId);

      const ws = new WebSocket(wsUrl);
      
      // Store the socket instance globally immediately (for OpenAI hook to access)
      (window as any).__chatWebSocket = ws;
      console.log('WebSocket reference stored globally for sharing');

      ws.onopen = () => {
        console.log('WebSocket connected successfully');
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttempts.current = 0;
        
        // Update the global with ready state
        (window as any).__chatWebSocketReady = true;
        
        const joinMessage = {
          type: 'join',
          roomId,
          temp_user_uuid: userId,
          user_emoji: userEmoji
        };
        console.log('Sending join message:', joinMessage);
        ws.send(JSON.stringify(joinMessage));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Received message:', message);

          switch (message.type) {
            case 'joined':
              if (message.success) {
                console.log('Successfully joined room:', message.roomId);
                if (message.history && Array.isArray(message.history)) {
                  console.log('Received room history:', message.history);
                  // Only set messages from history if we don't already have them
                  setMessages(prevMessages => {
                    // If we already have messages (from localStorage or previous connection), don't replace them
                    if (prevMessages.length > 0) {
                      console.log('Already have messages, not replacing from server history');
                      return prevMessages;
                    }
                    console.log('Setting messages from server history');
                    localStorage.setItem(`messages_${roomId}`, JSON.stringify(message.history));
                    return message.history;
                  });
                }
              }
              break;

            case 'chat':
              const newMessage = {
                text: message.text,
                translatedText: message.translatedText,
                sourceLang: message.sourceLang,
                targetLang: message.targetLang,
                timestamp: message.timestamp,
                temp_user_uuid: message.temp_user_uuid || userId, // Use sender's UUID if not provided
                user_emoji: message.user_emoji || userEmoji, // Use sender's emoji if not provided
                voiceType: message.voiceType || "female", // Use provided voice type or default to female
                isOpenAI: message.isOpenAI
              };
              console.log('Adding new message to chat:', { 
                ...newMessage, 
                isOpenAI: !!message.isOpenAI,
                text: newMessage.text.substring(0, 30) + '...',
                translatedText: newMessage.translatedText.substring(0, 30) + '...'
              });
              setMessages(prev => {
                // Check if this message is already in the list to prevent duplicates
                // More robust duplicate detection that doesn't rely solely on timestamp string comparison
                const isDuplicate = prev.some(
                  msg => 
                    msg.text === newMessage.text && 
                    msg.temp_user_uuid === newMessage.temp_user_uuid &&
                    (
                      // Same exact timestamp or within 5 seconds (for minute boundary cases)
                      msg.timestamp === newMessage.timestamp ||
                      Math.abs(new Date(msg.timestamp).getTime() - new Date(newMessage.timestamp).getTime()) < 5000
                    )
                );
                
                if (isDuplicate) {
                  console.log('Duplicate message detected, not adding again');
                  return prev;
                }
                
                const updated = [...prev, newMessage];
                localStorage.setItem(`messages_${roomId}`, JSON.stringify(updated));
                return updated;
              });
              break;

            case 'openai-transcription':
              // Handle OpenAI transcriptions coming directly from the WebRTC data channel
              const openAIMessage = {
                text: message.sourceText,
                translatedText: message.translatedText,
                sourceLang: message.sourceLang || 'en',
                targetLang: message.targetLang || 'en',
                timestamp: message.timestamp || new Date().toISOString(),
                temp_user_uuid: message.userId || userId,
                user_emoji: message.userEmoji || userEmoji,
                voiceType: "female",
                isOpenAI: true // Mark as OpenAI message for special display
              };
              console.log('Adding new OpenAI transcription to chat:', openAIMessage);
              setMessages(prev => {
                // Check if this message is already in the list to prevent duplicates
                // More robust duplicate detection that doesn't rely solely on timestamp string comparison
                const isDuplicate = prev.some(
                  msg => 
                    msg.text === openAIMessage.text && 
                    msg.temp_user_uuid === openAIMessage.temp_user_uuid &&
                    (
                      // Same exact timestamp or within 5 seconds (for minute boundary cases)
                      msg.timestamp === openAIMessage.timestamp ||
                      Math.abs(new Date(msg.timestamp).getTime() - new Date(openAIMessage.timestamp).getTime()) < 5000
                    )
                );
                
                if (isDuplicate) {
                  console.log('Duplicate OpenAI transcription detected, not adding again');
                  return prev;
                }
                
                const updated = [...prev, openAIMessage];
                localStorage.setItem(`messages_${roomId}`, JSON.stringify(updated));
                return updated;
              });
              break;

            case 'error':
              console.error('Received error from server:', message.message);
              toast({
                variant: "destructive",
                title: "Error",
                description: message.message
              });
              break;
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        setSocket(null);
        
        // Clear global reference
        (window as any).__chatWebSocketReady = false;
        
        if (reconnectTimeout.current) {
          clearTimeout(reconnectTimeout.current);
        }

        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          console.log(`Attempting reconnect in ${delay}ms`);
          reconnectTimeout.current = setTimeout(connect, delay);
        } else {
          setIsConnecting(false);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      setSocket(ws);
    } catch (error) {
      console.error('Error establishing WebSocket connection:', error);
      setIsConnecting(false);
    }
  }, [roomId, toast, userId, userEmoji]);

  const sendMessage = useCallback(async (
    text: string,
    sourceLang: string,
    targetLang: string,
    existingTranslation?: string
  ) => {
    if (!text.trim() || !roomId) return;

    console.log('Attempting to send message:', { 
      text: text.substring(0, 30) + '...', 
      sourceLang, 
      targetLang, 
      roomId, 
      userId,
      hasTranslation: !!existingTranslation
    });

    try {
      if (socket?.readyState === WebSocket.OPEN) {
        const chatMessage = {
          type: 'chat',
          text,
          sourceLang,
          targetLang,
          roomId,
          temp_user_uuid: userId,
          user_emoji: userEmoji,
          voiceType: "female", // Default to female voice
          isOpenAI: false // Default to false, will be overridden for pre-translated messages
        };

        // If we already have a translation, include it
        if (existingTranslation) {
          Object.assign(chatMessage, {
            translatedText: existingTranslation,
            isOpenAI: true // Mark as OpenAI-style message to get the same UI format
          });
          console.log('Including existing translation in message:', existingTranslation.substring(0, 30) + '...');
          console.log('Setting isOpenAI=true for proper display formatting with source and translation');
        }

        console.log('Sending message through WebSocket:', chatMessage);
        socket.send(JSON.stringify(chatMessage));
      } else {
        console.log('Socket not ready, queueing message');
        messageQueue.current.push({ text, sourceLang, targetLang });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send message. Please try again."
      });
    }
  }, [socket, roomId, toast, userId, userEmoji]);

  const clearMessages = useCallback(() => {
    if (!roomId) return;
    
    console.log('Clearing all messages');
    setMessages([]);
    localStorage.removeItem(`messages_${roomId}`);
    
    // Send clear-room message to server if connected
    if (socket?.readyState === WebSocket.OPEN) {
      const clearMessage = {
        type: 'clear_room',
        roomId
      };
      socket.send(JSON.stringify(clearMessage));
    }
  }, [socket, roomId]);

  const reconnect = useCallback(() => {
    console.log('Manually reconnecting...');
    
    // When manually reconnecting, we should keep the existing messages to prevent duplicates
    // We don't need to clear or reload messages here
    
    // Reset reconnection attempts counter
    reconnectAttempts.current = 0;
    
    // Set connecting state
    setIsConnecting(true);
    
    // Close existing socket if open
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close();
    }
    
    // Attempt to connect
    connect();
  }, [connect, socket]);

  // Store emoji whenever it changes
  useEffect(() => {
    sessionStorage.setItem('userEmoji', userEmoji);
    (window as any).__user_emoji = userEmoji;
  }, [userEmoji]);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`messages_${roomId}`, JSON.stringify(messages));
    }
  }, [messages, roomId]);


  return {
    messages,
    isConnected,
    isConnecting,
    sendMessage,
    reconnect,
    clearMessages,
    userEmoji,
    setUserEmoji,
    userId,
    loadStoredMessages
  };
}
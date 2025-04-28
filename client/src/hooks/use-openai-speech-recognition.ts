import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

// Declare global window properties for TypeScript
declare global {
  interface Window {
    __openAIRawTranscription: {
      sourceText: string;
      translatedText: string;
      isComplete: boolean;
      isSourceComplete?: boolean;
    };
    __lastOpenAIMessage: {
      text: string;
      translatedText: string;
      timestamp: string;
      raw?: any;
    };
    __lastOpenAIProcessedData: any;
    __userId: string;
    __temp_user_uuid: string;
    __userEmoji: string;
    __user_emoji: string;
    __minglWebSocket: WebSocket;
    __chatWebSocket: WebSocket;
  }
}

interface TranscriptResult {
  finalText: string;
  interimText: string;
  isFinal: boolean;
}

interface UseOpenAISpeechRecognitionProps {
  language?: string;
  targetLanguage?: string;
  deviceId?: string;
  onTranslation?: (sourceText: string, translatedText: string) => void;
}

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

// Define interface for session response
interface SessionResponse {
  client_secret: {
    value: string;
  };
}

/**
 * A hook for real-time speech recognition and translation using OpenAI's API
 */
export function useOpenAISpeechRecognition({
  language = 'en-US',
  targetLanguage = 'en-US',
  deviceId,
  onTranslation
}: UseOpenAISpeechRecognitionProps = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult>({
    finalText: "",
    interimText: "",
    isFinal: false
  });
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  // WebRTC connections
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteAudioElement = useRef<HTMLAudioElement | null>(null);

  // Session token
  const sessionToken = useRef<string | null>(null);

  // Create audio element on mount if it doesn't exist
  useEffect(() => {
    if (!remoteAudioElement.current) {
      const audioEl = document.createElement('audio');
      
      // Check if we're in listen mode where we want to completely disable direct audio
      const isListenPage = window.location.pathname.includes('/listen');
      if (isListenPage) {
        // Completely disable audio output in listen mode
        // We'll use our own speech synthesis instead
        audioEl.autoplay = false;
        audioEl.volume = 0; // Mute the element
        console.log('Created remote audio element for OpenAI audio (MUTED for listen mode)');
        // Force target-language-only mode
        (window as any).__playOnlyTargetLanguage = true;
      } else {
        // Normal settings for chat mode
        audioEl.autoplay = true;
        audioEl.volume = 1.0; // Full volume for translations
        console.log('Created remote audio element for OpenAI audio');
      }
      
      remoteAudioElement.current = audioEl;
    }

    return () => {
      if (remoteAudioElement.current) {
        remoteAudioElement.current.srcObject = null;
      }
    };
  }, []);

  // Get available audio devices
  const getAudioDevices = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      stream.getTracks().forEach(track => track.stop()); // Clean up the test stream

      const audioDevices = devices.filter(
        device => device.kind === 'audioinput' || device.kind === 'audiooutput'
      ).map(device => ({
        deviceId: device.deviceId,
        label: device.label || `${device.kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${devices.indexOf(device) + 1}`,
        kind: device.kind as 'audioinput' | 'audiooutput'
      }));

      setDevices(audioDevices);
    } catch (err) {
      console.error('Error getting audio devices:', err);
      setError("Failed to get audio devices. Please ensure microphone permissions are granted.");
    }
  }, []);

  // Audio element is now created in the useEffect above

  // Clean up connections when component unmounts
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  // Get audio devices on mount
  useEffect(() => {
    getAudioDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
    };
  }, [getAudioDevices]);

  // Create a real-time session with OpenAI
  const createRealtimeSession = useCallback(async () => {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: Error | null = null;
    
    while (attempts < maxAttempts) {
      try {
        setIsConnecting(true);
        setError(null);
        attempts++;
        
        console.log(`[OpenAI Session] Attempt ${attempts}/${maxAttempts} to create session`);

        // Extract room ID for logging
        let roomId = 'unknown';
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const urlRoomId = urlParams.get('id');
          const pathParts = window.location.pathname.split('/');
          const isListenMode = pathParts.includes('listen');
          const isChatMode = pathParts.includes('chat');
          
          // Different ID handling for listen mode
          if (isListenMode) {
            // For listen mode, prefer using a prefix to clearly identify it
            if (urlRoomId) {
              // Add prefix to query parameter ID to make it distinct
              roomId = `listen_${urlRoomId}`;
            } else {
              // Extract from path with prefix
              const listenIndex = pathParts.indexOf('listen');
              if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
                roomId = `listen_${pathParts[listenIndex + 1]}`;
              }
            }
          } else if (isChatMode) {
            // Original method for chat mode
            if (urlRoomId) {
              roomId = urlRoomId;
            } else {
              // Extract from path
              const chatIndex = pathParts.indexOf('chat');
              if (chatIndex >= 0 && chatIndex + 1 < pathParts.length) {
                roomId = pathParts[chatIndex + 1];
              }
            }
          } else {
            // Fallback for other pages
            if (urlRoomId) {
              roomId = urlRoomId;
            }
          }
        } catch (e) {
          console.error("[OpenAI Session] Error extracting room ID:", e);
        }

        // Step 1: Get an ephemeral key from our server
        const response = await apiRequest<SessionResponse>({
          url: "/api/realtime-session",
          method: "POST",
          data: {
            sourceLang: language,
            targetLang: targetLanguage,
            roomId: roomId // Include room ID in the request
          },
          on401: "throw"
        });

        if (!response || !response.client_secret || !response.client_secret.value) {
          throw new Error('Invalid session token received');
        }

        sessionToken.current = response.client_secret.value;
        console.log(`[OpenAI Session] Received session token for room ${roomId}`);

        return true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[OpenAI Session] Error creating realtime session (attempt ${attempts}/${maxAttempts}):`, lastError.message);
        
        // Differentiate between error types for retry strategy
        const errorMessage = lastError.message.toLowerCase();
        const isRateLimitError = errorMessage.includes('rate limit') || errorMessage.includes('too many requests');
        const isServerError = errorMessage.includes('server error') || errorMessage.includes('500') || errorMessage.includes('502');
        const isAuthError = errorMessage.includes('unauthorized') || errorMessage.includes('401') || errorMessage.includes('forbidden') || errorMessage.includes('403');
        
        // Don't retry auth errors
        if (isAuthError) {
          console.log("[OpenAI Session] Authentication error - not retrying");
          break;
        }
        
        // Wait longer for rate limit errors
        if (attempts < maxAttempts) {
          const retryDelay = isRateLimitError ? 2000 : (isServerError ? 1000 : 500) * attempts;
          console.log(`[OpenAI Session] Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    // All attempts failed
    const message = lastError?.message || 'Unknown error occurred';
    console.error('[OpenAI Session] All attempts to create session failed:', message);
    setError(`Failed to create session: ${message}`);
    setIsConnecting(false);
    return false;
  }, [language, targetLanguage]);

  // Initialize WebRTC connection
  const initializeWebRTC = useCallback(async () => {
    let attempts = 0;
    const maxAttempts = 2;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`[OpenAI WebRTC] Connection attempt ${attempts}/${maxAttempts}`);
        
        if (!sessionToken.current) {
          throw new Error('No session token available');
        }

        // Create a peer connection
        const rtcConfig = {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ]
        };
        peerConnection.current = new RTCPeerConnection(rtcConfig);
        console.log('[OpenAI WebRTC] Peer connection created');

        // Add connection state change handling
        peerConnection.current.onconnectionstatechange = () => {
          console.log('[OpenAI WebRTC] Connection state:', peerConnection.current?.connectionState);
          
          // Handle different connection states
          if (peerConnection.current) {
            const state = peerConnection.current.connectionState;
            
            if (state === 'failed') {
              console.error('[OpenAI WebRTC] Connection failed, attempting recovery...');
              setError('WebRTC connection failed. Trying to recover...');
              
              // Try to recover connection after a short delay
              setTimeout(() => {
                // IMPORTANT: Only try to reconnect if we were listening
                // This prevents auto-stopping behavior
                if (isListening) {
                  console.log('[OpenAI WebRTC] Attempting to reconnect after failure');
                  // Clean up old connection
                  cleanupConnection();
                  // Try to recreate session
                  createRealtimeSession().then(sessionCreated => {
                    if (sessionCreated) {
                      initializeWebRTC();
                    } else {
                      // Only set isListening false if recreation fails
                      setIsListening(false);
                      setError('Failed to recover WebRTC connection. Please try again.');
                    }
                  });
                }
              }, 1000);
            } 
            else if (state === 'disconnected') {
              console.warn('[OpenAI WebRTC] Connection disconnected temporarily');
              // Don't immediately set error or stop listening for temporary disconnects
              // as the connection might recover
              
              // Set a timeout - if we're still disconnected after 5 seconds, then stop
              setTimeout(() => {
                // IMPORTANT: Only stop if we're still in the disconnected state
                // AND we're supposed to be listening
                if (peerConnection.current?.connectionState === 'disconnected' && isListening) {
                  console.error('[OpenAI WebRTC] Connection remained disconnected, stopping');
                  setError('WebRTC connection disconnected');
                  
                  // NOW we can stop listening since we've been disconnected for a while
                  setIsListening(false);
                }
              }, 5000);
            }
            else if (state === 'connected') {
              // Clear any previous connection errors
              setError(null);
              
              // Log that we're successfully connected
              console.log('[OpenAI WebRTC] Connection state changed to connected - recognition active');
              
              // Force a delay before allowing any stop calls
              (window as any).__openAIStartTime = Date.now();
            }
          }
        };

        // Add ICE connection state change handling
        peerConnection.current.oniceconnectionstatechange = () => {
          console.log('[OpenAI WebRTC] ICE connection state:', peerConnection.current?.iceConnectionState);
        };

        // Add audio track handler
        peerConnection.current.ontrack = (e) => {
          if (remoteAudioElement.current) {
            const isListenPage = window.location.pathname.includes('/listen');
            const isChatPage = window.location.pathname.includes('/chat');
            
            // Store the stream for later use
            (window as any).__openAIOriginalStream = e.streams[0];
            
            // In Listen mode, we always want to use our custom speech synthesis approach
            // This ensures we have full control over what gets spoken, regardless of the setting
            // For other modes, we'll respect the user's preference
            const isListenMode = isListenPage;
            
            // Force target language only mode for Listen mode
            if (isListenMode) {
              // For Listen page - ALWAYS use the target language only approach
              // This gives us full control over which voice plays and avoids source language playback
              remoteAudioElement.current.srcObject = null;
              remoteAudioElement.current.autoplay = false;
              remoteAudioElement.current.volume = 0; // Ensure volume is muted
              // Force global flag to true in Listen mode
              (window as any).__playOnlyTargetLanguage = true;
              console.log('[OpenAI WebRTC] LISTEN MODE - forcing target language only mode');
            } else if (!isChatPage) {
              // Normal behavior for non-chat, non-listen pages
              remoteAudioElement.current.srcObject = e.streams[0];
              remoteAudioElement.current.autoplay = true;
              remoteAudioElement.current.volume = 1.0;
              console.log('[OpenAI WebRTC] Set audio source for regular audio playback');
            } else {
              console.log('[OpenAI WebRTC] In Chat page - not setting audio source to prevent voice playback');
              // Don't set the audio source to prevent any playback
            }
          }
        };

        // Setup ICE candidate handling
        peerConnection.current.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('[OpenAI WebRTC] New ICE candidate:', event.candidate.candidate.substr(0, 30) + '...');
          }
        };

        // Add local audio track for microphone input
        try {
          const constraints: MediaStreamConstraints = {
            audio: deviceId ? { deviceId: { exact: deviceId } } : true,
            video: false
          };

          localStream.current = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('[OpenAI WebRTC] Got local media stream');

          // Add track to peer connection
          localStream.current.getTracks().forEach(track => {
            if (peerConnection.current) {
              peerConnection.current.addTrack(track, localStream.current!);
              console.log(`[OpenAI WebRTC] Added ${track.kind} track to peer connection`);
            }
          });
        } catch (mediaError) {
          console.error('[OpenAI WebRTC] Media device error:', mediaError);
          throw new Error(`Microphone access failed: ${mediaError instanceof Error ? mediaError.message : String(mediaError)}`);
        }

        // Set up data channel for sending and receiving events
        dataChannel.current = peerConnection.current.createDataChannel('oai-events');
        console.log('[OpenAI WebRTC] Data channel created');

        // Setup data channel event handlers
        dataChannel.current.onmessage = (event) => {
          console.log("[OpenAI WebRTC] Received data channel message", event.data);
          
          // Store raw data for debugging
          (window as any).__lastOpenAIMessage = {
            raw: event.data,
            timestamp: new Date().toISOString()
          };

          try {
            let data;
            // Handle different data formats
            if (typeof event.data === 'string') {
              try {
                data = JSON.parse(event.data);
              } catch (e) {
                console.warn("[OpenAI WebRTC] Received non-JSON string data:", event.data);
                data = { text: event.data };
              }
            } else if (event.data instanceof Blob) {
              console.log("[OpenAI WebRTC] Received blob data, not processing");
              return;
            } else {
              console.warn("[OpenAI WebRTC] Received unknown data type:", typeof event.data);
              return;
            }

            // Extract room ID for logging
            let roomId = 'unknown';
            try {
              const urlParams = new URLSearchParams(window.location.search);
              const urlRoomId = urlParams.get('id');
              const pathParts = window.location.pathname.split('/');
              const isListenMode = pathParts.includes('listen');
              const isChatMode = pathParts.includes('chat');
              
              // Different ID handling for listen mode
              if (isListenMode) {
                // For listen mode, prefer using a prefix to clearly identify it
                if (urlRoomId) {
                  // Add prefix to query parameter ID to make it distinct
                  roomId = `listen_${urlRoomId}`;
                } else {
                  // Extract from path with prefix
                  const listenIndex = pathParts.indexOf('listen');
                  if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
                    roomId = `listen_${pathParts[listenIndex + 1]}`;
                  }
                }
              } else if (isChatMode) {
                // Original method for chat mode
                if (urlRoomId) {
                  roomId = urlRoomId;
                } else {
                  // Extract from path
                  const chatIndex = pathParts.indexOf('chat');
                  if (chatIndex >= 0 && chatIndex + 1 < pathParts.length) {
                    roomId = pathParts[chatIndex + 1];
                  }
                }
              } else {
                // Fallback for other pages
                if (urlRoomId) {
                  roomId = urlRoomId;
                }
              }
            } catch (e) {
              console.error("[OpenAI WebRTC] Error extracting room ID:", e);
            }
            
            console.log(`[OpenAI WebRTC] Parsed data for room ${roomId}:`, data);

            // Track full transcript across messages
            if (!window.__openAIRawTranscription) {
              window.__openAIRawTranscription = { 
                sourceText: '', 
                translatedText: '', 
                isComplete: false 
              };
            }

            // Handle different message types
            switch (data.type) {
              case 'response.audio_transcript.delta':
                // Append delta to transcript
                if (data.delta) {
                  // If we have a newline character, it signals the boundary between source and translation
                  if (data.delta === '\n') {
                    window.__openAIRawTranscription.isSourceComplete = true;
                  } else if (window.__openAIRawTranscription.isSourceComplete) {
                    // Check for trigger phrases that shouldn't be spoken
                    let delta = data.delta;
                    
                    // These are partial deltas, so we need to be careful not to break words
                    // We'll only filter complete phrases when we see them
                    if (window.__openAIRawTranscription.translatedText.endsWith("translate ") && delta === "them") {
                      // Don't add "them" when it follows "translate "
                      console.log("[OpenAI WebRTC] Filtering out 'them' from 'translate them'");
                      // Remove the "translate " part from the existing text
                      window.__openAIRawTranscription.translatedText = 
                        window.__openAIRawTranscription.translatedText.substring(0, window.__openAIRawTranscription.translatedText.length - 10);
                    } else if (window.__openAIRawTranscription.translatedText.endsWith("translation") && delta === ":") {
                      // Don't add ":" when it follows "translation"
                      console.log("[OpenAI WebRTC] Filtering out ':' from 'translation:'");
                      // Remove the "translation" part from the existing text
                      window.__openAIRawTranscription.translatedText = 
                        window.__openAIRawTranscription.translatedText.substring(0, window.__openAIRawTranscription.translatedText.length - 11);
                    } else if (window.__openAIRawTranscription.translatedText.endsWith("translating") && 
                               (delta === " " || delta === "." || delta === "…")) {
                      // Don't add the space or periods when it follows "translating"
                      console.log("[OpenAI WebRTC] Filtering out 'translating' word");
                      // Remove the "translating" part from the existing text
                      window.__openAIRawTranscription.translatedText = 
                        window.__openAIRawTranscription.translatedText.substring(0, window.__openAIRawTranscription.translatedText.length - 11);
                    } else {
                      // Add to translation
                      window.__openAIRawTranscription.translatedText += delta;
                    }
                  } else {
                    // Add to source text
                    window.__openAIRawTranscription.sourceText += data.delta;
                  }
                }
                break;

              case 'response.audio_transcript.done':
                // Complete transcript received
                if (data.transcript) {
                  const parts = data.transcript.split('\n');
                  if (parts.length >= 2) {
                    // Remove any trigger phrases that shouldn't be spoken
                    const filteredTranslation = parts[1]
                      .replace(/translate them/gi, "")
                      .replace(/translation:/gi, "")
                      .replace(/translating\.{0,3}/gi, "") // Remove "translating" with or without ellipsis
                      .trim();

                    window.__openAIRawTranscription = {
                      sourceText: parts[0],
                      translatedText: filteredTranslation,
                      isComplete: true
                    };

                    // Also update the lastOpenAIMessage for compatibility
                    window.__lastOpenAIMessage = {
                      text: parts[0],
                      translatedText: filteredTranslation,
                      timestamp: new Date().toISOString()
                    };

                    console.log("[OpenAI WebRTC] Complete transcript received:", {
                      source: parts[0],
                      translation: filteredTranslation
                    });
                  }
                }
                break;

              case 'input_audio_buffer.speech_started':
                // Speech started
                console.log("[OpenAI WebRTC] Speech started");
                break;

              case 'input_audio_buffer.speech_stopped':
                // Speech stopped
                console.log("[OpenAI WebRTC] Speech stopped");
                // Wait a short time for any final processing to complete
                setTimeout(() => {
                  // If we have a complete transcript, process it now
                  if (window.__openAIRawTranscription && 
                      window.__openAIRawTranscription.sourceText && 
                      window.__openAIRawTranscription.translatedText) {
                    
                    // Process the final transcript
                    const { sourceText, translatedText } = window.__openAIRawTranscription;
                    console.log("[OpenAI WebRTC] Processing final transcript after speech stopped:", {
                      source: sourceText.substring(0, 30) + "...",
                      translation: translatedText.substring(0, 30) + "..."
                    });
                    
                    // Check if we're in listen mode
                    const isListenPage = window.location.pathname.includes('/listen');
                    
                    // For listen mode, use persistent tracking to completely prevent duplication
                    if (isListenPage) {
                      // Remove any trigger phrases that shouldn't be spoken
                      const filteredTranslation = translatedText
                        .replace(/translate them/gi, "")
                        .replace(/translation:/gi, "")
                        .replace(/translating\.{0,3}/gi, "") // Remove "translating" with or without ellipsis
                        .trim();
                      
                      // Skip if text is empty after filtering
                      if (!filteredTranslation || filteredTranslation === "..." || filteredTranslation === "") {
                        console.log("[OpenAI WebRTC] Skipping empty translation after filtering");
                        
                        // Reset transcript for next utterance
                        window.__openAIRawTranscription = {
                          sourceText: '',
                          translatedText: '',
                          isComplete: false,
                          isSourceComplete: false
                        };
                        
                        return;
                      }
                      
                      // Create a message fingerprint
                      const messageKey = `${sourceText}-${filteredTranslation}`;
                      
                      // Use a shared global cache for listen mode messages
                      const processedMessages = (window as any).__listenModeProcessedMessages = (window as any).__listenModeProcessedMessages || {};
                      
                      // Check if we've seen this message before in listen mode
                      if (processedMessages[messageKey]) {
                        console.log(`[OpenAI WebRTC] BLOCKING duplicate transcript after speech stopped in listen mode:`, sourceText.substring(0, 30) + "...");
                        
                        // Reset transcript for next utterance to prevent further processing attempts
                        window.__openAIRawTranscription = {
                          sourceText: '',
                          translatedText: '',
                          isComplete: false,
                          isSourceComplete: false
                        };
                        
                        return;
                      }
                      
                      // Mark it as processed to prevent duplicate processing elsewhere
                      processedMessages[messageKey] = true;
                      console.log(`[OpenAI WebRTC] First time processing transcript after speech stopped in listen mode:`, sourceText.substring(0, 30) + "...");
                      
                      // Update global state with the filtered translation
                      window.__openAIRawTranscription.translatedText = filteredTranslation;
                      
                      // Call the callback with the final transcript
                      if (onTranslation) {
                        onTranslation(sourceText, filteredTranslation);
                      }
                      
                      // Send to server
                      sendToServer(sourceText, filteredTranslation, roomId);
                    } else {
                      // Call the callback with the final transcript
                      if (onTranslation) {
                        onTranslation(sourceText, translatedText);
                      }
                      
                      // Send to server
                      sendToServer(sourceText, translatedText, roomId);
                    }
                    
                    // Reset transcript for next utterance
                    window.__openAIRawTranscription = {
                      sourceText: '',
                      translatedText: '',
                      isComplete: false,
                      isSourceComplete: false
                    };
                  }
                }, 300);
                break;
                
              case 'response.output_item.done':
                // This message indicates the audio output has been generated and will play
                console.log("[OpenAI WebRTC] Output item done", data.output_index);
                
                // For Listen page ONLY, cancel speech synthesis audio to block OpenAI's voice
                const isListenPage = window.location.pathname.includes('/listen');
                if (isListenPage) {
                  // Cancel any playing speech to block the direct audio
                  if (window.speechSynthesis) {
                    console.log('[OpenAI WebRTC] Canceling OpenAI speech in Listen mode to force our TTS');
                    window.speechSynthesis.cancel();
                  }
                }
                
                // Process the completed assistant item
                if (data.item && data.item.content && data.item.content.length > 0) {
                  const content = data.item.content[0];
                  if (content.type === "audio" && content.transcript) {
                    // Extract source and translation from transcript
                    const transcript = content.transcript;
                    const parts = transcript.split('\n').filter((part: string) => part.trim() !== '');
                    
                    if (parts.length >= 2) {
                      const sourceText = parts[0];
                      const translatedText = parts[parts.length - 1]; // Get the last part as translation
                      
                      // Remove any trigger phrases that shouldn't be spoken
                      const filteredTranslation = translatedText
                        .replace(/translate them/gi, "")
                        .replace(/translation:/gi, "")
                        .replace(/translating\.{0,3}/gi, "") // Remove "translating" with or without ellipsis
                        .trim();
                      
                      // Check if we're in listen mode
                      const isListenPage = window.location.pathname.includes('/listen');
                      
                      // For listen mode, we want to track messages but not block them completely
                      // This allows the proper handling by our custom speech synthesis approach
                      if (isListenPage) {
                        // Create a message fingerprint
                        const messageKey = `${sourceText}-${filteredTranslation}`;
                        
                        // Use a shared global cache for listen mode messages
                        const processedMessages = (window as any).__listenModeProcessedMessages = (window as any).__listenModeProcessedMessages || {};
                        
                        // Log if we've seen this message before, but DON'T block it
                        // This ensures we still process it for our custom speech synthesis
                        if (processedMessages[messageKey]) {
                          console.log(`[OpenAI WebRTC] Processing duplicate item output in listen mode:`, sourceText.substring(0, 30) + "...");
                        } else {
                          console.log(`[OpenAI WebRTC] First time processing this output item in listen mode:`, sourceText.substring(0, 30) + "...");
                        }
                        
                        // Always mark it as processed to track frequency
                        processedMessages[messageKey] = true;
                      } else {
                        // In chat mode, use the regular time-based deduplication
                        const lastProcessedTime = (window as any).__lastProcessedTimestamp || 0;
                        const lastProcessedText = (window as any).__lastProcessedText || '';
                        const now = Date.now();
                        
                        // Don't process duplicate messages within 3 seconds in chat mode
                        if (lastProcessedText === sourceText && (now - lastProcessedTime) < 3000) {
                          console.log("[OpenAI WebRTC] Skipping duplicate message in chat mode:", sourceText.substring(0, 30) + "...");
                          return;
                        }
                        
                        // Update last processed info for chat mode
                        (window as any).__lastProcessedTimestamp = now;
                        (window as any).__lastProcessedText = sourceText;
                      }
                      
                      window.__openAIRawTranscription = {
                        sourceText,
                        translatedText: filteredTranslation,
                        isComplete: true
                      };

                      // Update lastOpenAIMessage for compatibility
                      window.__lastOpenAIMessage = {
                        text: sourceText,
                        translatedText: filteredTranslation,
                        timestamp: new Date().toISOString()
                      };

                      console.log("[OpenAI WebRTC] Complete message transcript:", {
                        source: sourceText,
                        translation: filteredTranslation,
                        fullTranscript: transcript
                      });
                      
                      // Check if we're in target-language-only mode
                      const playOnlyTargetLanguage = (window as any).__playOnlyTargetLanguage;
                      
                      // If we're in target-language-only mode and in listen page, 
                      // we need to manually trigger the text-to-speech for the translation
                      if (playOnlyTargetLanguage && isListenPage) {
                        // Try to find a reasonable language code based on the pathname
                        const pathParts = window.location.pathname.split('/');
                        const listenIndex = pathParts.indexOf('listen');
                        let targetLang = 'en'; // Default to English
                        
                        // Try to extract target language from path
                        if (listenIndex >= 0 && listenIndex + 2 < pathParts.length) {
                          // The URL format should be /listen/ROOMID/TARGETLANG
                          const possibleLang = pathParts[listenIndex + 2];
                          if (possibleLang && possibleLang.length === 2) {
                            targetLang = possibleLang;
                          }
                        }
                        
                        // Add voice mapping for common languages
                        const langMap: Record<string, string> = {
                          'en': 'en-US',
                          'es': 'es-ES',
                          'fr': 'fr-FR',
                          'de': 'de-DE',
                          'it': 'it-IT',
                          'pt': 'pt-PT',
                          'ar': 'ar-SA',
                          'ru': 'ru-RU',
                          'zh': 'zh-CN',
                          'ja': 'ja-JP',
                          'ko': 'ko-KR'
                        };
                        
                        const langCode = langMap[targetLang] || targetLang;
                        
                        console.log(`[OpenAI WebRTC] Manually playing translated text with speech synthesis: "${filteredTranslation.substring(0, 30)}..." (lang: ${langCode})`);
                        
                        // Create and configure the utterance
                        const utterance = new SpeechSynthesisUtterance(filteredTranslation);
                        utterance.lang = langCode;
                        utterance.volume = 1.0;
                        
                        // Set special flag to ensure our utterance isn't blocked
                        (window as any).__forcePlayNextUtterance = true;
                        
                        // Play the translation using speech synthesis
                        window.speechSynthesis.speak(utterance);
                        
                        // Reset flag
                        setTimeout(() => {
                          (window as any).__forcePlayNextUtterance = false;
                        }, 100);
                      }
                    }
                  }
                }
                break;
            }

            // Add debug display element if not exists
            let debugEl = document.getElementById('openai-debug-display');
            if (!debugEl && process.env.NODE_ENV === 'development') {
              debugEl = document.createElement('div');
              debugEl.id = 'openai-debug-display';
              debugEl.style.position = 'fixed';
              debugEl.style.bottom = '10px';
              debugEl.style.right = '10px';
              debugEl.style.width = '300px';
              debugEl.style.maxHeight = '200px';
              debugEl.style.overflow = 'auto';
              debugEl.style.background = 'rgba(0,0,0,0.7)';
              debugEl.style.color = 'white';
              debugEl.style.padding = '10px';
              debugEl.style.zIndex = '9999';
              debugEl.style.fontSize = '12px';
              debugEl.style.borderRadius = '5px';
              document.body.appendChild(debugEl);
            }

            if (debugEl && process.env.NODE_ENV === 'development') {
              const rawTranscription = window.__openAIRawTranscription || { sourceText: 'N/A', translatedText: 'N/A' };
              debugEl.innerHTML = `
                <strong>OpenAI WebRTC Debug</strong><br/>
                Room: ${roomId}<br/>
                Source: ${rawTranscription.sourceText || 'N/A'}<br/>
                Translation: ${rawTranscription.translatedText || 'N/A'}<br/>
                Time: ${new Date().toISOString().split('T')[1].split('.')[0]}
              `;
            }

            // Process the text data if complete transcript is available
            if (window.__openAIRawTranscription && window.__openAIRawTranscription.isComplete) {
              const { sourceText, translatedText } = window.__openAIRawTranscription;
              
              if (sourceText && translatedText) {
                console.log(`[OpenAI WebRTC] Text: ${sourceText.substring(0, 30)}...`);
                console.log(`[OpenAI WebRTC] Translation: ${translatedText.substring(0, 30)}...`);
                
                // Check if we're in listen mode
                const isListenPage = window.location.pathname.includes('/listen');
                
                // For listen mode, use our global registry of processed messages
                if (isListenPage) {
                  // Create a message fingerprint
                  const messageKey = `${sourceText}-${translatedText}`;
                  
                  // Use a shared global cache for listen mode messages
                  const processedMessages = (window as any).__listenModeProcessedMessages = (window as any).__listenModeProcessedMessages || {};
                  
                  // In Listen mode, we need to process the message even if it's a duplicate
                  // but we'll log it for debugging
                  if (processedMessages[messageKey]) {
                    console.log(`[OpenAI WebRTC] Processing duplicate transcript in listen mode:`, sourceText.substring(0, 30) + "...");
                  } else {
                    // Mark it as processed for tracking purposes
                    processedMessages[messageKey] = true;
                    console.log(`[OpenAI WebRTC] First time processing this output item in listen mode:`, sourceText.substring(0, 30) + "...");
                  }
                }
                // If not in listen mode, use our previous deduplication approach
                else {
                  // Skip if we've already processed this exact message in the last 5 seconds
                  const lastProcessedKey = `${sourceText}-${translatedText}`;
                  const lastProcessedMap = (window as any).__lastProcessedMap || {};
                  const now = Date.now();
                  const lastProcessed = lastProcessedMap[lastProcessedKey] || 0;
                  
                  if (now - lastProcessed < 5000) {
                    console.log(`[OpenAI WebRTC] Skipping duplicate processing in chat mode:`, sourceText.substring(0, 30) + "...");
                    
                    // Reset the transcript to prevent further processing attempts
                    window.__openAIRawTranscription = {
                      sourceText: '',
                      translatedText: '',
                      isComplete: false,
                      isSourceComplete: false
                    };
                    
                    return;
                  }
                  
                  // Update the last processed time
                  lastProcessedMap[lastProcessedKey] = now;
                  (window as any).__lastProcessedMap = lastProcessedMap;
                }
                
                // Store data for global access by other components
                (window as any).__lastOpenAIProcessedData = {
                  sourceText,
                  translatedText,
                  roomId,
                  timestamp: new Date().toISOString()
                };
                
                // Directly call the onTranslation callback to update the UI
                if (onTranslation) {
                  console.log("[OpenAI WebRTC] Calling onTranslation callback with:", { 
                    sourceText: sourceText.substring(0, 30) + "...", 
                    translatedText: translatedText.substring(0, 30) + "..."
                  });
                  onTranslation(sourceText, translatedText);
                  
                  // Check if we're in target-language-only mode and in listen page, 
                  // we need to manually trigger the text-to-speech for the translation
                  const playOnlyTargetLanguage = (window as any).__playOnlyTargetLanguage;
                  if (isListenPage) {
                    // Try to find a reasonable language code based on the pathname
                    const pathParts = window.location.pathname.split('/');
                    const listenIndex = pathParts.indexOf('listen');
                    let targetLang = 'en'; // Default to English
                    
                    // Try to extract target language from path
                    if (listenIndex >= 0 && listenIndex + 2 < pathParts.length) {
                      // The URL format should be /listen/ROOMID/TARGETLANG
                      const possibleLang = pathParts[listenIndex + 2];
                      if (possibleLang && possibleLang.length === 2) {
                        targetLang = possibleLang;
                      }
                    }
                    
                    // Add voice mapping for common languages
                    const langMap: Record<string, string> = {
                      'en': 'en-US',
                      'es': 'es-ES',
                      'fr': 'fr-FR',
                      'de': 'de-DE',
                      'it': 'it-IT',
                      'pt': 'pt-PT',
                      'ar': 'ar-SA',
                      'ru': 'ru-RU',
                      'zh': 'zh-CN',
                      'ja': 'ja-JP',
                      'ko': 'ko-KR'
                    };
                    
                    // We only want to play the translated text in Listen mode
                    // Extract the translated text part only
                    let textToSpeak = "";
                    
                    // Look for Arabic text in the translation
                    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
                    
                    // Check if the transcript has both source and target texts (usually with a newline between them)
                    if (translatedText.includes('\n')) {
                      // Split by newline to separate source and target texts
                      const parts = translatedText.split('\n').filter(p => p.trim());
                      
                      if (parts.length >= 2) {
                        // First part is source text, second part is translated text
                        // For listen mode, we always want the translated text (second part)
                        textToSpeak = parts[parts.length - 1]; // Use the last part
                        console.log(`[OpenAI WebRTC] Using split text parts. Selected: "${textToSpeak.substring(0, 30)}..."`);
                      } else {
                        textToSpeak = translatedText;
                      }
                    }
                    // If target language is Arabic, find and use Arabic text
                    else if (targetLang === 'ar' && arabicRegex.test(translatedText)) {
                      // Extract Arabic part from translatedText (remove quotes if present)
                      const arabicMatch = translatedText.match(/["']?([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s\.\,\;\:\-\!\?]+)["']?/);
                      if (arabicMatch && arabicMatch[1]) {
                        textToSpeak = arabicMatch[1];
                        console.log(`[OpenAI WebRTC] Extracted Arabic text: "${textToSpeak.substring(0, 30)}..."`);
                      } else {
                        textToSpeak = translatedText;
                      }
                    } 
                    // If target is English or another language with Latin script
                    else if (['en', 'es', 'fr', 'de', 'it', 'pt'].includes(targetLang)) {
                      // Remove parts that look like non-Latin scripts
                      const nonLatinPattern = /["']?[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\s\.\,\;\:\-\!\?]+["']?/;
                      
                      // Check if we have quotes around the target text
                      const quotesMatch = translatedText.match(/["'](.*?)["']/);
                      if (quotesMatch && quotesMatch[1]) {
                        // Use content inside quotes
                        textToSpeak = quotesMatch[1];
                        console.log(`[OpenAI WebRTC] Extracted quoted text: "${textToSpeak.substring(0, 30)}..."`);
                      } else {
                        // Split by non-Latin pattern
                        const parts = translatedText.split(nonLatinPattern).filter(p => p.trim());
                        textToSpeak = parts[0] || translatedText;
                        console.log(`[OpenAI WebRTC] Extracted ${targetLang} text: "${textToSpeak.substring(0, 30)}..."`);
                      }
                    }
                    // Otherwise, use the whole translation
                    else {
                      textToSpeak = translatedText;
                    }
                    
                    const langCode = langMap[targetLang] || targetLang;
                    
                    console.log(`[OpenAI WebRTC] Manually playing translated text with speech synthesis: "${textToSpeak.substring(0, 30)}..." (lang: ${langCode})`);
                    
                    // Create and configure the utterance
                    const utterance = new SpeechSynthesisUtterance(textToSpeak);
                    utterance.lang = langCode;
                    utterance.volume = 1.0;
                    
                    // Set special flag to ensure our utterance isn't blocked
                    (window as any).__forcePlayNextUtterance = true;
                    
                    // Play the translation using speech synthesis
                    window.speechSynthesis.speak(utterance);
                    
                    // Reset flag
                    setTimeout(() => {
                      (window as any).__forcePlayNextUtterance = false;
                    }, 500);
                  }
                  
                  // Also send to the server, but don't reset isComplete flag yet
                  // to allow the message to be displayed in the UI first
                  sendToServer(sourceText, translatedText, roomId);
                  
                  // Reset the transcript after a short delay to allow UI to update
                  setTimeout(() => {
                    window.__openAIRawTranscription = {
                      sourceText: '',
                      translatedText: '',
                      isComplete: false,
                      isSourceComplete: false
                    };
                  }, 500);
                } else {
                  console.warn("[OpenAI WebRTC] No onTranslation callback available");
                  // Still try to send to server
                  sendToServer(sourceText, translatedText, roomId);
                  
                  // Reset the complete flag since we can't show in UI
                  window.__openAIRawTranscription.isComplete = false;
                }
              }
            }
          } catch (err) {
            console.error("[OpenAI WebRTC] Error processing message:", err, "Raw data:", event.data);
          }
        };

        dataChannel.current.onopen = () => {
          console.log('[OpenAI WebRTC] Data channel opened');
          
          // Make sure we're still set to listening even after the data channel opens
          // This prevents any state changes from closing the connection
          setIsListening(true);
          
          // Mark that the connection is fully ready
          (window as any).__openAIConnectionReady = true;
          
          // Set a timestamp to prevent rapid closing
          (window as any).__openAIDataChannelOpenTime = Date.now();
        };

        dataChannel.current.onerror = (error) => {
          console.error('[OpenAI WebRTC] Data channel error:', error);
          // Don't set error unless it's been open for a while
          const openTime = (window as any).__openAIDataChannelOpenTime || 0;
          const now = Date.now();
          if (now - openTime > 2000) {
            setError('Connection error occurred');
          }
        };

        dataChannel.current.onclose = () => {
          console.log('[OpenAI WebRTC] Data channel closed');
          
          // Only set isListening to false if it's been open for a while
          // This prevents React state batching from triggering unintentional closures
          const openTime = (window as any).__openAIDataChannelOpenTime || 0;
          const now = Date.now();
          if (now - openTime > 2000) {
            setIsListening(false);
          } else {
            console.log('[OpenAI WebRTC] Data channel closed too soon after opening - ignoring');
          }
        };

        // Start the session using SDP
        console.log('[OpenAI WebRTC] Creating offer');
        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);
        console.log('[OpenAI WebRTC] Local description set');

        // Send SDP offer to OpenAI
        try {
          const baseUrl = 'https://api.openai.com/v1/realtime';
          const model = 'gpt-4o-realtime-preview-2024-12-17';
          console.log(`[OpenAI WebRTC] Sending SDP offer to ${baseUrl}`);
          
          const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
            method: 'POST',
            body: offer.sdp,
            headers: {
              'Authorization': `Bearer ${sessionToken.current}`,
              'Content-Type': 'application/sdp'
            },
          });

          if (!sdpResponse.ok) {
            const errorText = await sdpResponse.text().catch(() => 'No error text available');
            throw new Error(`SDP response error: ${sdpResponse.status} ${sdpResponse.statusText} - ${errorText}`);
          }

          const answerSdp = await sdpResponse.text();
          console.log('[OpenAI WebRTC] Received SDP answer');
          
          const answer = {
            type: 'answer' as RTCSdpType,
            sdp: answerSdp,
          };

          await peerConnection.current.setRemoteDescription(answer);
          console.log('[OpenAI WebRTC] Remote description set');

          // Set isListening explicitly here to prevent premature cleanup
          setIsListening(true);
          
          // Delay completing setup to prevent race conditions in React state updates
          await new Promise(resolve => setTimeout(resolve, 300));
          
          setIsConnecting(false);
          console.log('[OpenAI WebRTC] Connection established successfully');

          return true;
        } catch (sdpError) {
          console.error('[OpenAI WebRTC] SDP exchange error:', sdpError);
          throw sdpError;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`[OpenAI WebRTC] Initialization error (attempt ${attempts}/${maxAttempts}):`, message);
        
        if (attempts < maxAttempts) {
          console.log(`[OpenAI WebRTC] Retrying connection in ${1000 * attempts}ms...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          // Clean up failed connection before retry
          cleanupConnection();
        } else {
          setError(`Connection error: ${message}`);
          setIsConnecting(false);
          cleanupConnection();
          return false;
        }
      }
    }
    
    // If we reach here, all attempts failed
    setError('Failed to establish WebRTC connection after multiple attempts');
    setIsConnecting(false);
    return false;
  }, [deviceId, language, targetLanguage, onTranslation]);

  // Clean up WebRTC connection
  const cleanupConnection = useCallback(() => {
    // First make sure to clear any state that might get us stuck
    setIsListening(false);
    
    // Clear any keepalive interval
    if ((window as any).__openAIKeepaliveInterval) {
      clearInterval((window as any).__openAIKeepaliveInterval);
      (window as any).__openAIKeepaliveInterval = null;
    }
    
    // Close data channel
    if (dataChannel.current) {
      try {
        dataChannel.current.close();
      } catch (e) {
        console.error('[OpenAI WebRTC] Error closing data channel:', e);
      }
      dataChannel.current = null;
    }

    // Close peer connection
    if (peerConnection.current) {
      try {
        peerConnection.current.close();
      } catch (e) {
        console.error('[OpenAI WebRTC] Error closing peer connection:', e);
      }
      peerConnection.current = null;
    }

    // Stop local media tracks
    if (localStream.current) {
      try {
        localStream.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.error('[OpenAI WebRTC] Error stopping track:', e);
          }
        });
      } catch (e) {
        console.error('[OpenAI WebRTC] Error stopping local stream:', e);
      }
      localStream.current = null;
    }

    // Clear remote audio element
    if (remoteAudioElement.current) {
      try {
        remoteAudioElement.current.srcObject = null;
        remoteAudioElement.current.pause();
      } catch (e) {
        console.error('[OpenAI WebRTC] Error clearing remote audio element:', e);
      }
    }

    sessionToken.current = null;
    
    // Reset any OpenAI raw transcription data to prevent stale data
    if (window.__openAIRawTranscription) {
      window.__openAIRawTranscription = {
        sourceText: '',
        translatedText: '',
        isComplete: false,
        isSourceComplete: false
      };
    }
    
    console.log('[OpenAI WebRTC] Connection cleaned up successfully');
  }, []);

  // Start listening
  const startListening = useCallback(async () => {
    try {
      // Store start time to prevent auto-stop for a few seconds
      (window as any).__openAIStartTime = Date.now();
      
      // First clean up any existing connections to ensure a fresh start
      cleanupConnection();
      
      // Wake up audio context if it exists (helps with audio processing)
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const tempContext = new AudioContext();
          // Create and play a short silent buffer to wake up the audio system
          const buffer = tempContext.createBuffer(1, 1, 22050);
          const source = tempContext.createBufferSource();
          source.buffer = buffer;
          source.connect(tempContext.destination);
          source.start(0);
          // Cleanup after a short delay
          setTimeout(() => {
            try {
              tempContext.close();
            } catch (e) {
              // Ignore cleanup errors
            }
          }, 1000);
          console.log('[OpenAI WebRTC] Audio context activated');
        }
      } catch (e) {
        console.warn('[OpenAI WebRTC] Failed to wake audio context:', e);
        // Non-critical, continue anyway
      }
      
      setError(null);
      setIsConnecting(true);

      // Reset transcript state
      setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
      
      // Reset OpenAI raw transcription data
      window.__openAIRawTranscription = {
        sourceText: '',
        translatedText: '',
        isComplete: false,
        isSourceComplete: false
      };

      // Create a new session
      console.log("[OpenAI WebRTC] Creating new session...");
      const sessionCreated = await createRealtimeSession();
      if (!sessionCreated) {
        console.error("[OpenAI WebRTC] Failed to create session");
        setIsConnecting(false);
        return false;
      }

      // Initialize WebRTC connection with a timeout
      console.log("[OpenAI WebRTC] Initializing WebRTC connection...");
      
      // Create a timeout promise that will reject after 10 seconds
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error("WebRTC connection timed out")), 10000);
      });
      
      // Try to initialize WebRTC with timeout
      const connectionInitialized = await Promise.race([
        initializeWebRTC(),
        timeoutPromise
      ]).catch(error => {
        console.error("[OpenAI WebRTC] Connection timeout or error:", error);
        return false;
      });
      
      if (!connectionInitialized) {
        console.error("[OpenAI WebRTC] Failed to initialize connection");
        setIsConnecting(false);
        cleanupConnection();
        return false;
      }

      // Reset transcript
      setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
      
      // Set up a keepalive ping on the data channel to prevent premature closure
      const keepaliveInterval = setInterval(() => {
        if (dataChannel.current && dataChannel.current.readyState === 'open' && isListening) {
          try {
            // Send a tiny keepalive message
            dataChannel.current.send(JSON.stringify({ type: 'keepalive_ping' }));
            console.log('[OpenAI WebRTC] Sent keepalive ping');
          } catch (e) {
            console.error('[OpenAI WebRTC] Error sending keepalive:', e);
          }
        } else if (!isListening) {
          // If we're no longer listening, clear the interval
          clearInterval(keepaliveInterval);
        }
      }, 5000); // Every 5 seconds
      
      // Store the interval ID in window so we can clear it if needed
      (window as any).__openAIKeepaliveInterval = keepaliveInterval;
      
      setIsConnecting(false);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('[OpenAI WebRTC] Failed to start listening:', message);
      setError(`Failed to start listening: ${message}`);
      setIsListening(false);
      setIsConnecting(false);
      
      // Make sure to clean up any partial connections
      cleanupConnection();
      
      // Special handling for common errors
      if (message.includes('getUserMedia') || message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError("Microphone access was denied. Please check your browser permissions and try again.");
      }
      
      return false;
    }
  }, [createRealtimeSession, initializeWebRTC, cleanupConnection]);

  // Stop listening
  const stopListening = useCallback(() => {
    // Print stack trace to debug what's calling this
    console.log('[OpenAI WebRTC] stopListening called from:', new Error().stack);

    // Only allow manual stopping, not auto-stopping
    if (isConnecting) {
      console.log('[OpenAI WebRTC] Not stopping during connection setup');
      return;
    }
    
    // Add a timestamp check to prevent multiple rapid stop calls
    const now = Date.now();
    const lastStopTime = (window as any).__lastOpenAIStopTime || 0;
    if (now - lastStopTime < 1000) {
      console.log('[OpenAI WebRTC] Ignoring rapid stop request');
      return;
    }
    (window as any).__lastOpenAIStopTime = now;

    // Check if we just started - prevent auto-stop within 5 seconds of starting
    const startTime = (window as any).__openAIStartTime || 0;
    if (now - startTime < 5000) {
      console.log('[OpenAI WebRTC] Ignoring stop request within 5 seconds of starting');
      return;
    }
    
    console.log('[OpenAI WebRTC] Stopping listening and cleaning up');
    
    // First set the listening state to false so no auto-restart attempts happen
    setIsListening(false);
    
    // Reset any pending transcriptions
    if (window.__openAIRawTranscription) {
      // If we have valid transcript data, process it before cleaning up
      const { sourceText, translatedText } = window.__openAIRawTranscription;
      if (sourceText && translatedText && sourceText.trim() && translatedText.trim()) {
        console.log('[OpenAI WebRTC] Processing final transcript before cleanup');
        
        // Try to extract the room ID
        let roomId = 'unknown';
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const urlRoomId = urlParams.get('id');
          const pathParts = window.location.pathname.split('/');
          const isListenMode = pathParts.includes('listen');
          const isChatMode = pathParts.includes('chat');
          
          // Different ID handling for listen mode
          if (isListenMode) {
            // For listen mode, prefer using a prefix to clearly identify it
            if (urlRoomId) {
              // Add prefix to query parameter ID to make it distinct
              roomId = `listen_${urlRoomId}`;
            } else {
              // Extract from path with prefix
              const listenIndex = pathParts.indexOf('listen');
              if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
                roomId = `listen_${pathParts[listenIndex + 1]}`;
              }
            }
          } else if (isChatMode) {
            // Original method for chat mode
            if (urlRoomId) {
              roomId = urlRoomId;
            } else {
              // Extract from path
              const chatIndex = pathParts.indexOf('chat');
              if (chatIndex >= 0 && chatIndex + 1 < pathParts.length) {
                roomId = pathParts[chatIndex + 1];
              }
            }
          } else {
            // Fallback for other pages
            if (urlRoomId) {
              roomId = urlRoomId;
            }
          }
        } catch (e) {
          console.error("[OpenAI WebRTC] Error extracting room ID:", e);
        }
        
        // Send final transcript to server if we have one
        if (onTranslation) {
          try {
            onTranslation(sourceText, translatedText);
          } catch (e) {
            console.error('[OpenAI WebRTC] Error calling onTranslation:', e);
          }
        }
        
        try {
          sendToServer(sourceText, translatedText, roomId);
        } catch (e) {
          console.error('[OpenAI WebRTC] Error sending to server:', e);
        }
      }
    }
    
    // Add a small delay before cleaning up to allow any pending operations to complete
    setTimeout(() => {
      try {
        // Clean up connections
        cleanupConnection();
      } catch (e) {
        console.error('[OpenAI WebRTC] Error during cleanup:', e);
      }
    }, 100);
  }, [cleanupConnection, onTranslation]);

  // Reset transcript
  const resetTranscript = useCallback(() => {
    setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
    
    // Also reset the OpenAI transcription data
    if (window.__openAIRawTranscription) {
      window.__openAIRawTranscription = {
        sourceText: '',
        translatedText: '',
        isComplete: false,
        isSourceComplete: false
      };
    }
  }, []);

  // Helper function to send messages to the server
  const sendToServer = (sourceText: string, translatedText: string, roomId: string) => {
    try {
      // Check if we're in listen mode for specialized deduplication
      const isListenPage = window.location.pathname.includes('/listen');
      
      // If roomId doesn't already have a prefix but we're in listen mode, add it
      // This ensures listen mode and chat mode use different room IDs to prevent
      // messages crossing between modes, even when viewing the same logical room
      if (isListenPage && roomId !== 'unknown' && !roomId.startsWith('listen_')) {
        roomId = `listen_${roomId}`;
        console.log("[OpenAI WebRTC] Updated listen mode roomId with prefix:", roomId);
      }
      
      // For listen mode, use a shared counter across all handlers to completely prevent duplication
      if (isListenPage) {
        // Create a message fingerprint
        const messageKey = `${sourceText}-${translatedText}`;
        
        // Use a global cache for all listen mode messages
        const processedMessages = (window as any).__listenModeProcessedMessages = (window as any).__listenModeProcessedMessages || {};
        
        // Check if we've seen this message before in listen mode
        if (processedMessages[messageKey]) {
          console.log(`[OpenAI WebRTC] BLOCKING message already processed in listen mode:`, sourceText.substring(0, 30) + "...");
          return;
        }
        
        // Mark as processed (forever in this session)
        processedMessages[messageKey] = true;
        console.log(`[OpenAI WebRTC] First time processing this message in listen mode:`, sourceText.substring(0, 30) + "...");
      } else {
        // Regular chat mode uses a time-based deduplication window (2 seconds)
        const deduplicationWindow = 2000;
        
        // Skip if we recently sent this exact message in chat mode
        const lastSentTime = (window as any).__lastSentMessageTimestamp || 0;
        const lastSentText = (window as any).__lastSentMessageText || '';
        const now = Date.now();
        
        // Don't send duplicate messages within the deduplication window in chat mode
        if (lastSentText === sourceText && (now - lastSentTime) < deduplicationWindow) {
          console.log(`[OpenAI WebRTC] Skipping duplicate message send in chat mode:`, sourceText.substring(0, 30) + "...");
          return;
        }
        
        // Update last sent info for chat mode
        (window as any).__lastSentMessageTimestamp = now;
        (window as any).__lastSentMessageText = sourceText;
      }
      
      // Check if we're on chat or listen page
      const isChatPage = window.location.pathname.includes('/chat');
      
      // Get user info if available
      const userId = (window as any).__userId || (window as any).__temp_user_uuid || 'unknown';
      const userEmoji = (window as any).__userEmoji || (window as any).__user_emoji || '👤';
      
      // Send to WebSocket if needed
      if ((isChatPage || isListenPage) && roomId !== 'unknown') {
        const messageData = {
          type: 'openai-transcription',
          roomId,
          sourceText,
          translatedText,
          sourceLang: language.split('-')[0], // Convert 'en-US' to 'en'
          targetLang: targetLanguage.split('-')[0], // Convert 'ar-SA' to 'ar'
          userId,
          userEmoji,
          timestamp: new Date().toISOString(),
          isOpenAI: true  // Mark as OpenAI message for special rendering
        };
        
        // Try to send via WebSocket first
        const ws = (window as any).__minglWebSocket || (window as any).__chatWebSocket;
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log("[OpenAI WebRTC] Sending transcription via WebSocket");
          ws.send(JSON.stringify(messageData));
        } else {
          // Fallback to HTTP endpoint
          console.log("[OpenAI WebRTC] Sending transcription via HTTP");
          fetch('/api/store-transcription', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(messageData)
          }).catch(e => console.error("[OpenAI WebRTC] Error storing transcription:", e));
        }
      }
    } catch (e) {
      console.error("[OpenAI WebRTC] Error sending transcription:", e);
    }
  };

  return {
    isListening,
    isConnecting,
    transcriptResult,
    error,
    startListening,
    stopListening,
    resetTranscript,
    devices
  };
}
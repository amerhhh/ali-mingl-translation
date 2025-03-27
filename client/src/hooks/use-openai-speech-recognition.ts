import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

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
      audioEl.autoplay = true;
      audioEl.volume = 1.0; // Ensure full volume for translations
      remoteAudioElement.current = audioEl;
      console.log('Created remote audio element for OpenAI audio');
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
    try {
      setIsConnecting(true);
      setError(null);

      // Step 1: Get an ephemeral key from our server
      const response = await apiRequest<SessionResponse>({
        url: "/api/realtime-session",
        method: "POST",
        data: {
          sourceLang: language,
          targetLang: targetLanguage
        },
        on401: "throw"
      });

      if (!response || !response.client_secret || !response.client_secret.value) {
        throw new Error('Invalid session token received');
      }

      sessionToken.current = response.client_secret.value;
      console.log('Received session token');
      
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Error creating realtime session:', message);
      setError(`Failed to create session: ${message}`);
      setIsConnecting(false);
      return false;
    }
  }, [language, targetLanguage]);

  // Initialize WebRTC connection
  const initializeWebRTC = useCallback(async () => {
    try {
      if (!sessionToken.current) {
        throw new Error('No session token available');
      }

      // Create a peer connection
      peerConnection.current = new RTCPeerConnection();
      
      // Add audio track handler
      peerConnection.current.ontrack = (e) => {
        if (remoteAudioElement.current) {
          // Check if we're on the Listen page and if we're in a language situation that requires filtering
          const isListenPage = window.location.pathname.includes('/listen');
          
          // Check if we're translating from Arabic to English, being more permissive with how we detect Arabic
          // This will match 'ar', 'ar-SA', 'ar-EG', etc.
          const isArabicSource = language?.toLowerCase().startsWith('ar');
          const isEnglishTarget = targetLanguage?.toLowerCase().startsWith('en');
          const isArabicToEnglish = isArabicSource && isEnglishTarget;
          
          console.log(`Language detection - Source: ${language} (isArabic: ${isArabicSource}), Target: ${targetLanguage} (isEnglish: ${isEnglishTarget})`);
          
          // For the Listen page with Arabic as source, special handling to block Arabic audio
          if (isListenPage && isArabicToEnglish) {
            console.log('Listen page with Arabic source detected - not playing source audio from OpenAI');
            
            // Instead of immediately setting the srcObject, we'll create a filtered MediaStream
            // that only includes audio if we know it's a translated output
            const originalStream = e.streams[0];
            
            // Create a flag in window to track if we're expecting a translation response
            if (!(window as any).__openAIAudioState) {
              (window as any).__openAIAudioState = {
                expectingTranslation: false,
                lastTranslationTime: 0
              };
            }
            
            // We'll modify the stream object but not assign it immediately
            // It will only be assigned when we know we have a translation
            (window as any).__openAIOriginalStream = originalStream;
            
            // Don't immediately set the srcObject - wait for translation confirmation
            console.log('Audio playback pending translation confirmation');
          } else {
            // Normal behavior for other pages or language combinations
            remoteAudioElement.current.srcObject = e.streams[0];
          }
        }
      };

      // Add local audio track for microphone input
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };

      localStream.current = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Add track to peer connection
      localStream.current.getTracks().forEach(track => {
        if (peerConnection.current) {
          peerConnection.current.addTrack(track, localStream.current!);
        }
      });

      // Set up data channel for sending and receiving events
      dataChannel.current = peerConnection.current.createDataChannel('oai-events');
      
      // Setup data channel event handlers
      dataChannel.current.onmessage = (event) => {
        try {
          // Try to parse as JSON
          const data = JSON.parse(event.data);
          
          // Handle specific session events
          if (data.type === 'caption') {
            // Handle transcription/translation
            let sourceText = '';
            let translatedText = '';
            
            if (data.transcription && data.transcription.text) {
              sourceText = data.transcription.text;
            }
            
            if (data.translation && data.translation.text) {
              translatedText = data.translation.text;
            }
            
            // Use the translation data
            console.log(`Original (${language}):`, sourceText);
            console.log(`Translation (${targetLanguage}):`, translatedText);

            // Update transcript result
            // For consistency with our app's behavior, we always update with the source text
            // The Listen page will specifically handle the translation differently
            setTranscriptResult({
              finalText: sourceText,
              interimText: "",
              isFinal: true
            });

            // Call the onTranslation callback if provided
            // This allows the Listen page to handle the translation separately from the Chat page
            // We also store the translation in a custom property for the Listen page
            if (onTranslation && sourceText) {
              // Set a flag for Listen page to know we have a translation ready
              (window as any).__latestOpenAITranslation = {
                sourceText,
                translatedText: translatedText || '',
                sourceLang: language,
                targetLang: targetLanguage
              };
              
              // If we're on the Listen page with Arabic->English, now we can allow audio playback
              // for the translated response (English only)
              const isListenPage = window.location.pathname.includes('/listen');
              
              // Using the same approach as above for consistent detection
              const isArabicSource = language?.toLowerCase().startsWith('ar');
              const isEnglishTarget = targetLanguage?.toLowerCase().startsWith('en');
              const isArabicToEnglish = isArabicSource && isEnglishTarget;
              
              console.log(`Translation detected - Allow playback? ${isListenPage && isArabicToEnglish && !!translatedText}`);
              
              if (isListenPage && isArabicToEnglish && translatedText && remoteAudioElement.current) {
                console.log('✓ Now allowing English translation audio on Listen page');
                
                // Get the original stream that was stored but not assigned
                const originalStream = (window as any).__openAIOriginalStream;
                if (originalStream) {
                  // Now it's safe to assign the stream because we know it contains translated audio
                  remoteAudioElement.current.srcObject = originalStream;
                  console.log('Audio stream assigned for translation playback');
                }
              }
              
              onTranslation(sourceText, translatedText || '');
            }
          } else if (data.type === 'interim_caption') {
            // Handle interim results
            let sourceText = '';
            
            if (data.transcription && data.transcription.text) {
              sourceText = data.transcription.text;
            }
            
            // Update transcript result with interim text
            setTranscriptResult(prev => ({
              ...prev,
              interimText: sourceText,
              isFinal: false
            }));
          }
        } catch (e) {
          // If not JSON, handle as plain text
          console.log("Received text:", event.data);
        }
      };

      dataChannel.current.onopen = () => {
        console.log('Data channel opened');
      };

      dataChannel.current.onerror = (error) => {
        console.error('Data channel error:', error);
        setError('Connection error occurred');
      };

      dataChannel.current.onclose = () => {
        console.log('Data channel closed');
        setIsListening(false);
      };

      // Start the session using SDP
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);

      // Send SDP offer to OpenAI
      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2024-12-17';
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${sessionToken.current}`,
          'Content-Type': 'application/sdp'
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`SDP response error: ${sdpResponse.status} ${sdpResponse.statusText}`);
      }

      const answerSdp = await sdpResponse.text();
      const answer = {
        type: 'answer' as RTCSdpType,
        sdp: answerSdp,
      };

      await peerConnection.current.setRemoteDescription(answer);
      
      setIsConnecting(false);
      setIsListening(true);
      console.log('WebRTC connection established');
      
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('WebRTC initialization error:', message);
      setError(`Connection error: ${message}`);
      setIsConnecting(false);
      cleanupConnection();
      return false;
    }
  }, [deviceId, language, targetLanguage, onTranslation]);

  // Clean up WebRTC connection
  const cleanupConnection = useCallback(() => {
    // Close data channel
    if (dataChannel.current) {
      dataChannel.current.close();
      dataChannel.current = null;
    }

    // Close peer connection
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    // Stop local media tracks
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    // Clear remote audio element
    if (remoteAudioElement.current) {
      remoteAudioElement.current.srcObject = null;
    }

    sessionToken.current = null;
  }, []);

  // Start listening
  const startListening = useCallback(async () => {
    try {
      setError(null);
      
      // Create a new session
      const sessionCreated = await createRealtimeSession();
      if (!sessionCreated) return;
      
      // Initialize WebRTC connection
      const connectionInitialized = await initializeWebRTC();
      if (!connectionInitialized) return;
      
      // Reset transcript
      setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Failed to start listening:', message);
      setError(`Failed to start listening: ${message}`);
      setIsListening(false);
      cleanupConnection();
    }
  }, [createRealtimeSession, initializeWebRTC, cleanupConnection]);

  // Stop listening
  const stopListening = useCallback(() => {
    setIsListening(false);
    cleanupConnection();
  }, [cleanupConnection]);

  // Reset transcript
  const resetTranscript = useCallback(() => {
    setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
  }, []);

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
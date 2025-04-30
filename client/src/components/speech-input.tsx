import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import { useOpenAISpeechRecognition } from "@/hooks/use-openai-speech-recognition";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useEffect, useRef, useState, useCallback } from "react";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// Extend Window interface to include our tracking
declare global {
  interface Window {
    __speechInputTracking?: {
      isListening: boolean;
      currentLanguage: string;
      usingOpenAI: boolean;
      lastToggleTime: number;
      preventLanguageEffectTrigger: boolean;
    };
    __lastProcessedUtteranceTime?: number;
    __lastUtteranceText?: string;
    __lastProcessedTranslationTime?: number;
    __lastTranslationText?: { source: string, target: string };
  }
}

interface SpeechInputProps {
  onTranscriptChange: (text: string, isFinal: boolean) => void;
  language: LanguageCode;
  targetLanguage?: LanguageCode;
  uiText: {
    speakNow: string;
    inputDevice: string;
    outputDevice: string;
    typeMessage: string;
  };
}

export function SpeechInput({ 
  onTranscriptChange, 
  language, 
  targetLanguage = language,
  uiText 
}: SpeechInputProps) {
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [useOpenAI, setUseOpenAI] = useState<boolean>(false); // Default to WebSpeech as basic option
  const [debugInfo, setDebugInfo] = useState<string>("");
  const lastSentText = useRef("");
  const { toast } = useToast();
  
  // Add a state to store WebSpeech translations
  const [webSpeechTranslation, setWebSpeechTranslation] = useState<{ sourceText: string, translatedText: string } | null>(null);
  
  // Reference to store the last transcript sent for matching with incoming translations
  const lastTranscriptSent = useRef<string>("");
  
  // Add a debounced language handler to prevent rapid effects
  const [debouncedLanguage, setDebouncedLanguage] = useState(language);
  
  // Reference to track previous language - MUST be created at component level
  const prevLanguageRef = useRef(debouncedLanguage);
  
  // WebSpeech API hook
  const { 
    isListening: isListeningWebSpeech, 
    transcriptResult: webSpeechTranscript, 
    error: webSpeechError, 
    startListening: startListeningWebSpeech, 
    stopListening: stopListeningWebSpeech, 
    resetTranscript: resetWebSpeechTranscript,
    devices 
  } = useSpeechRecognition({ 
    language: getLanguageCode(language),
    deviceId: selectedMicId
  });

  // OpenAI speech recognition hook
  const {
    isListening: isListeningOpenAI,
    isConnecting,
    transcriptResult: openAITranscript,
    error: openAIError,
    startListening: startListeningOpenAI,
    stopListening: stopListeningOpenAI,
    resetTranscript: resetOpenAITranscript,
    devices: openAIDevices
  } = useOpenAISpeechRecognition({
    language: getLanguageCode(language),
    targetLanguage: getLanguageCode(targetLanguage),
    deviceId: selectedMicId,
    onTranslation: (sourceText, translatedText) => {
      console.log("OPENAI TRANSLATION RECEIVED:", { 
        sourceText, 
        translatedText,
        sourceLength: sourceText?.length,
        transLength: translatedText?.length,
        url: window.location.href
      });
      
      // Check if we're in the Listen page by looking at the URL
      const isListenPage = window.location.pathname.includes('/listen');
      const isChatPage = window.location.pathname.includes('/chat');
      const hasQueryParam = window.location.search.includes('id=');
      
      // Get the room ID for the current page using our consistent approach
      let roomId = 'unknown';
      try {
        const pathParts = window.location.pathname.split('/');
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromQuery = urlParams.get('id');
        
        if (roomIdFromQuery) {
          roomId = roomIdFromQuery;
        } else if (isListenPage) {
          const listenIndex = pathParts.indexOf('listen');
          if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
            roomId = pathParts[listenIndex + 1];
          }
        } else if (isChatPage) {
          const chatIndex = pathParts.indexOf('chat');
          if (chatIndex >= 0 && chatIndex + 1 < pathParts.length) {
            roomId = pathParts[chatIndex + 1];
          }
        }
        
        // Apply prefix for listen mode to differentiate
        if (isListenPage && roomId !== 'unknown') {
          roomId = `listen_${roomId}`;
        }
      } catch (e) {
        console.error('Error extracting room ID in onTranslation:', e);
      }
      
      // Add debug information to help trace the flow
      console.log(`Speech Input: Handling OpenAI translation - isListenPage: ${isListenPage}, isChatPage: ${isChatPage}, hasQueryParam: ${hasQueryParam}, roomId: ${roomId}, sourceText: "${sourceText?.substring(0,20)}...", translatedText: "${translatedText?.substring(0,20)}..."`);
      
      // Force audio to play - ensure audio context is running
      if (window.speechSynthesis) {
        // Make sure speech synthesis is ready
        window.speechSynthesis.cancel();
        
        // Add debug log
        console.log("Preparing speech synthesis for playback");
      }
      
      // Always send the transcript to the parent component
      if (sourceText) {
        // Extract current room ID for debugging
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('id');
        
        console.log(`Calling onTranscriptChange with sourceText (${sourceText.length} chars), roomId=${roomId}`);
        
        try {
          onTranscriptChange(sourceText, true);
          console.log("Successfully called onTranscriptChange");
        } catch (err) {
          console.error("Error in onTranscriptChange callback:", err);
        }
      } else {
        console.warn("No source text received from OpenAI translation");
      }
    }
  });

  // Combine the device lists
  const combinedDevices = devices.length ? devices : openAIDevices;
  
  // Determine the active state based on which API is being used
  const isListening = useOpenAI ? isListeningOpenAI : isListeningWebSpeech;
  const transcriptResult = useOpenAI ? openAITranscript : webSpeechTranscript;
  const error = useOpenAI ? openAIError : webSpeechError;
  
  // Global tracking for click prevention - moved after hook definitions to prevent linter errors
  useEffect(() => {
    // Create a global click tracking system to avoid race conditions in React state
    if (!window.__speechInputTracking) {
      // Initialize the tracking object if it doesn't exist
      window.__speechInputTracking = {
        isListening: false,
        currentLanguage: language,
        usingOpenAI: useOpenAI,
        lastToggleTime: 0,
        preventLanguageEffectTrigger: false
      };
    }
    
    // Update tracking when state changes
    window.__speechInputTracking.isListening = isListening;
    window.__speechInputTracking.currentLanguage = language;
    window.__speechInputTracking.usingOpenAI = useOpenAI;
    
    // Debug
    console.log('Global speech tracking updated:', window.__speechInputTracking);
    
  }, [isListening, language, useOpenAI]);
  
  // Debounce the language changes to prevent rapid triggers
  useEffect(() => {
    // Track when language actually changes
    console.log(`Language prop changed: ${debouncedLanguage} -> ${language}`);
    
    // Don't update if we just recently detected a change to prevent cascading effects
    if (window.__speechInputTracking?.preventLanguageEffectTrigger) {
      console.log('Skipping language update due to prevention flag');
      window.__speechInputTracking.preventLanguageEffectTrigger = false;
      return;
    }
    
    // Set a debounce timer to update the language
    const timer = setTimeout(() => {
      setDebouncedLanguage(language);
    }, 500);
    
    return () => clearTimeout(timer);
  }, [language, debouncedLanguage]);

  // Add debug panel to show the latest OpenAI transcriptions 
  useEffect(() => {
    // Function to update debug info
    const updateDebugInfo = () => {
      const openAIData = (window as any).__openAIRawTranscription;
      if (openAIData) {
        // Show additional debug information for both path and query parameter formats
        const pathParts = window.location.pathname.split('/');
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromQuery = urlParams.get('id');
        
        // Determine if we're in listen mode or chat mode
        const isListenMode = pathParts.includes('listen');
        const isChatMode = pathParts.includes('chat');
        
        // First try query parameter format
        let roomId = roomIdFromQuery || 'unknown';
        
        // If no query parameter, try path format
        if (!roomIdFromQuery) {
          if (isListenMode) {
            const listenIndex = pathParts.indexOf('listen');
            if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
              roomId = pathParts[listenIndex + 1];
            }
          } else if (isChatMode) {
            const chatIndex = pathParts.indexOf('chat');
            if (chatIndex >= 0 && chatIndex + 1 < pathParts.length) {
              roomId = pathParts[chatIndex + 1];
            }
          }
        }
        
        // Apply prefix for listen mode to differentiate from chat mode
        if (isListenMode && roomId !== 'unknown') {
          roomId = `listen_${roomId}`;
        }

        setDebugInfo(JSON.stringify({
          source: openAIData.sourceText || "",
          translation: openAIData.translatedText || "",
          roomId: roomId,
          mode: isListenMode ? 'listen' : (isChatMode ? 'chat' : 'unknown'),
          queryParam: roomIdFromQuery ? 'yes' : 'no',
          fullURL: window.location.href,
          path: window.location.pathname,
          search: window.location.search,
          time: new Date().toLocaleTimeString()
        }, null, 2));
      }
    };
    
    // Update every second
    const interval = setInterval(updateDebugInfo, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load stored device preferences
  useEffect(() => {
    const storedMicId = localStorage.getItem('selectedMicId');
    const storedSpeakerId = localStorage.getItem('selectedSpeakerId');
    const storedUseOpenAI = localStorage.getItem('useOpenAI');
    if (storedMicId) setSelectedMicId(storedMicId);
    if (storedSpeakerId) setSelectedSpeakerId(storedSpeakerId);
    if (storedUseOpenAI !== null) setUseOpenAI(storedUseOpenAI === 'true');
    
    // Initialize streaming configuration for WebSpeech API
    const isListenPage = window.location.pathname.includes('/listen');
    if (isListenPage) {
      // In Listen mode, enable and configure the streaming system
      console.log("Setting up WebSpeech streaming for Listen mode");
      
      // Global variables for the streaming system
      (window as any).__webSpeechStreamingEnabled = true;
      (window as any).__webSpeechLastStreamingChunkTime = Date.now();
      (window as any).__webSpeechStreamingChunkInterval = 2500; // 2.5 seconds provides a good balance between responsiveness and smoothness
      (window as any).__webSpeechStreamingLastProcessedText = '';
      (window as any).__webSpeechStreamingProcessingChunk = false;
      (window as any).__webSpeechStreamingLastChunkTime = 0;
      
      // Initialize message queue system
      if (!(window as any).__listenModePlayedTranslations) {
        (window as any).__listenModePlayedTranslations = {};
      }
    } else {
      // Disable streaming in Chat mode - we want complete messages
      (window as any).__webSpeechStreamingEnabled = false;
    }
  }, []);

  // Save device preferences
  useEffect(() => {
    if (selectedMicId) localStorage.setItem('selectedMicId', selectedMicId);
    if (selectedSpeakerId) localStorage.setItem('selectedSpeakerId', selectedSpeakerId);
    localStorage.setItem('useOpenAI', String(useOpenAI));
  }, [selectedMicId, selectedSpeakerId, useOpenAI]);

  // Handle language changes - only when language actually changes
  useEffect(() => {
    // Skip effect if the prevention flag is set
    if (window.__speechInputTracking?.preventLanguageEffectTrigger) {
      console.log('Skipping language reset effect due to prevention flag');
      return;
    }
    
    // Only reset if language actually changed from previous value
    if (prevLanguageRef.current !== debouncedLanguage && isListening) {
      console.log(`Language actually changed from ${prevLanguageRef.current} to ${debouncedLanguage}, resetting speech recognition`);
      
      // Set prevention flag to avoid cascading effects
      if (window.__speechInputTracking) {
        window.__speechInputTracking.preventLanguageEffectTrigger = true;
      }
      
      setIsResetting(true);
      
      // Store the current mode before stopping to prevent race conditions
      const wasUsingOpenAI = useOpenAI;
      
      // Stop the appropriate listening mechanism
      if (wasUsingOpenAI) {
        stopListeningOpenAI();
      } else {
        stopListeningWebSpeech();
      }
      
      // Use a longer timeout for cleanup to be safe
      setTimeout(() => {
        if (wasUsingOpenAI) {
          resetOpenAITranscript();
        } else {
          resetWebSpeechTranscript();
        }
        lastSentText.current = "";
        setIsResetting(false);
        
        // Update the ref with current language
        prevLanguageRef.current = debouncedLanguage;
        
        // Clear prevention flag
        if (window.__speechInputTracking) {
          window.__speechInputTracking.preventLanguageEffectTrigger = false;
        }
      }, 1000);
    } else if (prevLanguageRef.current !== debouncedLanguage) {
      // If language changed but we're not listening, just update the ref
      prevLanguageRef.current = debouncedLanguage;
    }
  }, [debouncedLanguage, stopListeningWebSpeech, resetWebSpeechTranscript, stopListeningOpenAI, resetOpenAITranscript, useOpenAI, isListening]);

  // Listen for WebSocket messages to update WebSpeech translations
  useEffect(() => {
    if (useOpenAI) return; // Only relevant for WebSpeech mode
    
    // Function to handle incoming websocket messages
    const handleWebSocketMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        
        // Only process chat messages
        if (message.type === 'chat') {
          // Check if this is a response to our last transcript
          if (message.text === lastTranscriptSent.current && message.translatedText) {
            console.log('Received translation for WebSpeech message:', message.translatedText);
            
            // Check if we're in listen mode
            const isListenMode = window.location.pathname.includes('/listen');
            
            // Get the room ID for the current page
            let roomId = 'unknown';
            try {
              const pathParts = window.location.pathname.split('/');
              const urlParams = new URLSearchParams(window.location.search);
              const roomIdFromQuery = urlParams.get('id');
              
              if (roomIdFromQuery) {
                roomId = roomIdFromQuery;
              } else if (isListenMode) {
                const listenIndex = pathParts.indexOf('listen');
                if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
                  roomId = pathParts[listenIndex + 1];
                }
              } else {
                const chatIndex = pathParts.indexOf('chat');
                if (chatIndex >= 0 && chatIndex + 1 < pathParts.length) {
                  roomId = pathParts[chatIndex + 1];
                }
              }
              
              // Apply prefix for listen mode to match the OpenAI approach
              if (isListenMode && roomId !== 'unknown') {
                roomId = `listen_${roomId}`;
              }
            } catch (e) {
              console.error('Error extracting room ID for WebSpeech:', e);
            }
            
            // For listen mode, implement stricter deduplication
            if (isListenMode) {
              // Create a unique fingerprint for this message
              const messageFingerprint = `${message.text}-${message.translatedText}`;
              
              // Initialize or get the global deduplication registry
              const webSpeechProcessed = (window as any).__webSpeechProcessedMessages = 
                (window as any).__webSpeechProcessedMessages || {};
              
              // Add a time window-based key so we can reprocess identical messages after some time
              const timeWindow = Math.floor(Date.now() / 30000); // 30-second window
              const dedupKey = `${messageFingerprint}-${timeWindow}`;
              
              // Check if we've already processed this message in the current time window
              if (webSpeechProcessed[dedupKey]) {
                console.log(`[WebSpeech] BLOCKING duplicate message in listen mode:`, 
                  message.text.substring(0, 30) + "...");
                return;
              }
              
              // Mark this message as processed for this time window
              webSpeechProcessed[dedupKey] = true;
              
              console.log(`[WebSpeech] Processing message in listen mode with dedupKey`);
            }
            
            // Update the global OpenAI transcription object for UI display
            if (window.__openAIRawTranscription) {
              window.__openAIRawTranscription.sourceText = message.text;
              window.__openAIRawTranscription.translatedText = message.translatedText;
              window.__openAIRawTranscription.isComplete = true;
              window.__openAIRawTranscription.isSourceComplete = true;
              // Add room ID to match OpenAI debug format
              (window.__openAIRawTranscription as any).roomId = roomId;
            }
            
            // Simulate an onTranslation callback like OpenAI uses
            console.log("WEBSPEECH TRANSLATION RECEIVED:", { 
              sourceText: message.text, 
              translatedText: message.translatedText
            });
            
            // Add a clear debug message for troubleshooting
            console.log("%c WebSpeech Translation Status %c", 
              "background: #4CAF50; color: white; padding: 2px 4px; border-radius: 3px;", 
              "", 
              "Source text:", message.text,
              "Translation:", message.translatedText,
              "Both will be displayed in chat with the Translation label"
            );
            
            // Add a toast notification to make debugging more visible during testing
            if (toast) {
              toast({
                title: "WebSpeech Translation",
                description: `Source: "${message.text.substring(0, 20)}..."
                 Translation: "${message.translatedText.substring(0, 20)}..."`,
                duration: 3000
              });
            }
            
            // Check if we're in listen mode
            const isListenPage = window.location.pathname.includes('/listen');
            
            // For listen mode, use persistent tracking to completely prevent duplication
            if (isListenPage) {
              // COMPLETE REDESIGN: Instead of using complex fingerprinting,
              // use a simple timestamp-based approach for translations too
              const now = Date.now();
              const trimmedText = message.text.trim();
              const trimmedTranslation = message.translatedText ? message.translatedText.trim() : '';
              
              // Initialize a tracker for the last processed translation time
              if (!(window as any).__lastProcessedTranslationTime) {
                (window as any).__lastProcessedTranslationTime = 0;
              }
              
              // Initialize a tracker for the last translation text
              if (!(window as any).__lastTranslationText) {
                (window as any).__lastTranslationText = { source: '', target: '' };
              }
              
              // Get the time since we last processed a translation
              const timeSinceLastTranslation = now - (window as any).__lastProcessedTranslationTime;
              
              // Simple logic - if both the source text and translation match exactly what we just processed,
              // and it was very recent (within 2 seconds), then it's likely a duplicate
              const isDuplicate = 
                trimmedText === (window as any).__lastTranslationText.source && 
                trimmedTranslation === (window as any).__lastTranslationText.target &&
                timeSinceLastTranslation < 2000; // 2 seconds
                
              // For debugging - log what's happening
              console.log(`[WebSpeech] Processing translation: "${trimmedText.substring(0, 30)}..." → "${trimmedTranslation.substring(0, 30)}..."`);
              console.log(`[WebSpeech] Time since last translation: ${timeSinceLastTranslation}ms`);
              
              // If it's an exact duplicate within a short timeframe, skip it
              if (isDuplicate) {
                console.log(`[WebSpeech] Skipping exact duplicate translation within 2 seconds`);
                return;
              }
              
              // Otherwise, update our tracking and proceed
              (window as any).__lastProcessedTranslationTime = now;
              (window as any).__lastTranslationText = { 
                source: trimmedText, 
                target: trimmedTranslation 
              };
              console.log(`[WebSpeech] Processing translation in listen mode: "${trimmedText.substring(0, 30)}..." -> "${trimmedTranslation.substring(0, 30)}..."`);
              
              // Reset WebSpeech recognition state to prevent picking up the translated audio
              // This helps stop the microphone from capturing its own output
              if (isListenPage) {
                setTimeout(() => {
                  if (isListening && !useOpenAI) {
                    console.log("[WebSpeech] Clearing recognition buffer after translation processed...");
                    resetWebSpeechTranscript();
                    
                    // Extra cleanup to wipe any pending processing
                    if (window.__openAIRawTranscription) {
                      window.__openAIRawTranscription.sourceText = '';
                      window.__openAIRawTranscription.translatedText = '';
                    }
                    
                    // No need to directly manipulate the recognition object here
                    // The existing resetWebSpeechTranscript already handles the reset
                  }
                }, 500); // Do this after translation is spoken to clear recognition state
              }
            }
            
            // IMPORTANT: For WebSpeech, make sure we're sending the original transcript text
            // rather than just calling onTranscriptChange with the final text.
            // This ensures the chat component gets both the original text and translation
            onTranscriptChange(message.text, true);
            
            // Reset the transcription data after a short delay
            setTimeout(() => {
              if (window.__openAIRawTranscription) {
                window.__openAIRawTranscription = {
                  sourceText: '',
                  translatedText: '',
                  isComplete: false,
                  isSourceComplete: false
                };
              }
            }, 500);
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };
    
    // Get the WebSocket instance
    const ws = (window as any).__chatWebSocket || (window as any).__minglWebSocket;
    
    if (ws) {
      // Add the message listener
      ws.addEventListener('message', handleWebSocketMessage);
      
      // Return cleanup function
      return () => {
        ws.removeEventListener('message', handleWebSocketMessage);
      };
    }
  }, [useOpenAI, onTranscriptChange]);

  // Handle transcript updates with enhanced buffering for smoother experience
  useEffect(() => {
    // IMPORTANT: Only process transcript changes if we're actively listening
    // This prevents state changes from triggering unintentional stops
    if (!isListening) return;
    
    // Get the current combined text (final + interim)
    const currentText = transcriptResult.finalText + (transcriptResult.interimText ? ' ' + transcriptResult.interimText : '');
    
    // Don't process empty or unchanged text
    if (!currentText.trim() || currentText === lastSentText.current) {
      return;
    }
    
    // Check if we're in listen mode, where we need special handling
    const isListenPage = window.location.pathname.includes('/listen');
    
    // For listen mode: check if this is a very minor update to avoid processing tiny changes
    if (isListenPage && lastSentText.current && !transcriptResult.isFinal) {
      // Only for incremental changes in interim text (not final)
      const prevTextLength = lastSentText.current.length;
      const currentTextLength = currentText.length;
      
      // If the change is very small (< 5 characters) and we processed text recently (< 0.8 sec ago),
      // hold off on processing this update to avoid too many small chunks
      const isVerySmallChange = Math.abs(currentTextLength - prevTextLength) < 5;
      const lastProcessTime = (window as any).__lastWebSpeechProcessTime || 0;
      const isVeryRecentUpdate = (Date.now() - lastProcessTime) < 800;
      
      if (isVerySmallChange && isVeryRecentUpdate) {
        // Skip this minor update - will catch it in a slightly larger chunk soon
        return;
      }
    }
    
    // Update tracking variables
    lastSentText.current = currentText;
    (window as any).__lastWebSpeechProcessTime = Date.now();
    
    // For WebSpeech, store the source text in window for matching with translations
    if (!useOpenAI && transcriptResult.isFinal && transcriptResult.finalText) {
      // Check if we're in listen mode
      const isListenPage = window.location.pathname.includes('/listen');
      
      // For listen mode, use persistent tracking to completely prevent duplication
      if (isListenPage) {
        // COMPLETE REDESIGN: Instead of trying to prevent duplicates through fingerprinting,
        // we'll use a timestamp-based approach that's much simpler and more reliable
        const now = Date.now();
        const trimmedText = transcriptResult.finalText.trim();
        
        // Initialize a tracker for the last processed utterance time
        if (!(window as any).__lastProcessedUtteranceTime) {
          (window as any).__lastProcessedUtteranceTime = 0;
        }
        
        // Initialize a tracker for the last utterance text for logging
        if (!(window as any).__lastUtteranceText) {
          (window as any).__lastUtteranceText = '';
        }
        
        // Get the time since we last processed an utterance
        const timeSinceLastUtterance = now - (window as any).__lastProcessedUtteranceTime;
        
        // Simple logic - if the exact same text was processed very recently (within 1.5 seconds), 
        // and the speech recognition is sending the exact same final text, it's likely a duplicate
        const isDuplicate = 
          trimmedText === (window as any).__lastUtteranceText && 
          timeSinceLastUtterance < 1500; // 1.5 seconds
          
        // For debugging - always log what we're doing but be very clear
        console.log(`[WebSpeech] Processing utterance: "${trimmedText.substring(0, 30)}..." (${trimmedText.length} chars)`);
        console.log(`[WebSpeech] Time since last utterance: ${timeSinceLastUtterance}ms, Last text: "${((window as any).__lastUtteranceText || '').substring(0, 30)}..."`);
        
        // If it's an exact duplicate within a very short timeframe, skip it
        if (isDuplicate) {
          console.log(`[WebSpeech] Skipping exact duplicate utterance within 1.5 seconds`);
          return;
        }
        
        // Otherwise, update our tracking and proceed
        (window as any).__lastProcessedUtteranceTime = now;
        (window as any).__lastUtteranceText = trimmedText;
        console.log(`[WebSpeech] Processing new transcript in listen mode: ${trimmedText.substring(0, 30)}...`);
        
        // In listen mode, it's important to clear the recognition after sending
        // to prevent picking up the translation audio and creating feedback loops
        if (isListenPage) {
          // Schedule a restart of recognition to clear buffer after sending
          // This helps prevent feedback loops where the system hears its own output
          setTimeout(() => {
            if (isListening) {
              console.log("[WebSpeech] Clearing recognition buffer to prevent audio feedback...");
              resetWebSpeechTranscript();
              
              // No need for direct recognition manipulation
              // The resetWebSpeechTranscript function already handles this
            }
          }, 300);
        }
      }
      
      // Store the source text in the window to mimic OpenAI format
      if (!window.__openAIRawTranscription) {
        window.__openAIRawTranscription = {
          sourceText: transcriptResult.finalText,
          translatedText: '',
          isComplete: false,
          isSourceComplete: true // Mark source as complete for WebSpeech
        };
      } else {
        window.__openAIRawTranscription.sourceText = transcriptResult.finalText;
        window.__openAIRawTranscription.translatedText = '';
        window.__openAIRawTranscription.isComplete = false;
        window.__openAIRawTranscription.isSourceComplete = true; // Mark source as complete for WebSpeech
      }
      
      // Store the transcript for matching with translations
      lastTranscriptSent.current = transcriptResult.finalText;
      
      // Log that we're storing the source text for WebSpeech translation
      console.log("WebSpeech: Stored source text for translation matching:", transcriptResult.finalText);
    }
    
    // Send to chat component - this works for both OpenAI and WebSpeech
    onTranscriptChange(currentText, transcriptResult.isFinal);

    // Reset transcript state after sending final text
    if (transcriptResult.isFinal) {
      if (useOpenAI) {
        resetOpenAITranscript();
      } else {
        resetWebSpeechTranscript();
      }
      lastSentText.current = "";
    }
  }, [transcriptResult, onTranscriptChange, resetWebSpeechTranscript, resetOpenAITranscript, useOpenAI, isListening]);

  // Debug the listening state when it changes
  useEffect(() => {
    console.log(`Speech recognition state updated: 
      useOpenAI: ${useOpenAI}
      isListeningOpenAI: ${isListeningOpenAI}
      isListeningWebSpeech: ${isListeningWebSpeech}
      combined isListening: ${isListening}
      isResetting: ${isResetting}
      isConnecting: ${isConnecting}
    `);
  }, [isListening, isListeningOpenAI, isListeningWebSpeech, useOpenAI, isResetting, isConnecting]);

  const handleToggle = async () => {
    // Clear any stuck processing flags that could prevent proper handling
    if (window.__webSpeechStreamingProcessingChunk) {
      window.__webSpeechStreamingProcessingChunk = false;
    }
    
    // Set debug flag for more detailed logging on next operation
    (window as any).__debugSpeech = true;
    
    // Log detailed diagnostic information to help track microphone control flow
    const debugInfo = {
      isListening,
      isResetting,
      isConnecting,
      usingOpenAI: window.__speechInputTracking?.usingOpenAI || false,
      webSpeechActive: (window as any).__webSpeechActive || false,
      openAIActive: (window as any).__openAIActive || false,
      listenPageMode: window.location.pathname.includes('/listen'),
      streamingEnabled: window.__webSpeechStreamingEnabled || window.__streamingEnabled || false,
      hasPendingMessages: (window as any).__listenModeProcessedMessages ? 
        Object.keys((window as any).__listenModeProcessedMessages || {}).length > 0 : false,
      lastToggleTime: window.__speechInputTracking?.lastToggleTime || 0,
      timeSinceLastToggle: window.__speechInputTracking?.lastToggleTime ? 
        (Date.now() - window.__speechInputTracking.lastToggleTime) : -1
    };
    
    console.log(`handleToggle called - current state:`, debugInfo);
    
    // More responsive toggle for button clicks while still preventing accidental double-triggers
    const now = Date.now();
    const lastToggleTime = (window as any).__lastToggleTime || 0;
    
    // Track when the microphone button was last toggled (for global tracking)
    if (window.__speechInputTracking) {
      window.__speechInputTracking.lastToggleTime = now;
    } else {
      window.__speechInputTracking = {
        isListening: false,
        currentLanguage: language || 'en',
        usingOpenAI: useOpenAI,
        lastToggleTime: now,
        preventLanguageEffectTrigger: false
      };
    }
    
    // For manual clicks (not programmatic), use a shorter debounce period to improve responsiveness
    const isManualClick = new Error().stack?.includes('HTMLUnknownElement.callCallback');
    const debounceTime = isManualClick ? 300 : 1000; // Faster response times
    
    if (now - lastToggleTime < debounceTime) {
      console.log(`Ignoring rapid toggle request (${now - lastToggleTime}ms since last toggle)`);
      return;
    }
    
    // Enhanced error handling and logs
    console.log(`Starting microphone ${isListening ? 'OFF' : 'ON'} - using ${useOpenAI ? 'OpenAI' : 'WebSpeech'} API`);
    
    // Update the last toggle time immediately to prevent race conditions
    (window as any).__lastToggleTime = now;
    
    // Force-clear any active state flags for more responsive toggling
    if (isListening) {
      // When turning off, immediately set the global state even before the async operation completes
      (window as any).__webSpeechActive = false;
      (window as any).__openAIActive = false;
    }

    try {
      if (isListening) {
        // Stop the appropriate listening mechanism with proper cleanup
        if (useOpenAI) {
          console.log("Stopping OpenAI speech recognition");
          await stopListeningOpenAI();
          // Use a longer delay to ensure cleanup completes
          await new Promise(resolve => setTimeout(resolve, 500));
          resetOpenAITranscript();
        } else {
          console.log("Stopping WebSpeech recognition");
          await stopListeningWebSpeech();
          // Use a longer delay to ensure cleanup completes
          await new Promise(resolve => setTimeout(resolve, 500));
          resetWebSpeechTranscript();
          
          // Reset WebSpeech translation data
          lastTranscriptSent.current = "";
          if (window.__openAIRawTranscription) {
            window.__openAIRawTranscription = {
              sourceText: '',
              translatedText: '',
              isComplete: false,
              isSourceComplete: false
            };
          }
        }
        lastSentText.current = "";
      } else if (!isResetting && !isConnecting) {
        // Start with a clean state
        if (useOpenAI) {
          resetOpenAITranscript();
        } else {
          resetWebSpeechTranscript();
        }
        lastSentText.current = "";
        
        // First make sure microphone permissions are granted
        try {
          console.log("Checking microphone access before starting recognition");
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop()); // Clean up the test stream
        } catch (err) {
          console.error("Failed to access microphone:", err);
          toast({
            title: "Microphone Access Error",
            description: "Please grant microphone permissions in your browser settings and try again.",
            variant: "destructive",
            duration: 5000
          });
          return;
        }
        
        // Store what API we're using to prevent race conditions
        const usingOpenAI = useOpenAI;
        
        // Start with retry logic
        let retryCount = 0;
        const maxRetries = 2;
        let success = false;
        
        while (!success && retryCount < maxRetries) {
          try {
            if (usingOpenAI) {
              console.log(`Starting OpenAI speech recognition (attempt ${retryCount + 1}/${maxRetries})`);
              
              // Initialize streaming functionality for OpenAI
              if (window) {
                console.log('Initializing OpenAI streaming functionality');
                
                // Enable streaming by default
                window.__streamingEnabled = true;
                
                // Initialize timestamps and intervals
                window.__lastStreamingChunkTime = Date.now();
                window.__streamingChunkInterval = 2500; // Default 2.5 seconds between chunks for OpenAI
                window.__streamingLastProcessedText = "";
              }
              
              // For OpenAI, use the await since it returns a Promise<boolean>
              success = await startListeningOpenAI();
              
              // If OpenAI fails after retries, fall back to WebSpeech
              if (!success && retryCount === maxRetries - 1) {
                console.warn("OpenAI speech recognition failed to start. Falling back to WebSpeech");
                toast({
                  title: "Switching to Basic Mode",
                  description: "Advanced mode (OpenAI) failed to start. Using browser speech recognition instead.",
                  variant: "default",
                  duration: 5000
                });
                
                // Set state first, then try WebSpeech after a delay
                setUseOpenAI(false);
                
                // Try WebSpeech after a delay to allow state update
                setTimeout(() => {
                  console.log("Trying WebSpeech as fallback");
                  startListeningWebSpeech();
                }, 1000);
              }
            } else {
              console.log(`Starting WebSpeech recognition (attempt ${retryCount + 1}/${maxRetries})`);
              
              // Initialize streaming functionality for WebSpeech
              // This enables processing transcript in small chunks
              if (window) {
                console.log('Initializing WebSpeech streaming functionality');
                
                // Enable streaming by default for better user experience
                window.__webSpeechStreamingEnabled = true;
                
                // Initialize timestamps and intervals
                window.__webSpeechLastStreamingChunkTime = Date.now();
                window.__webSpeechStreamingChunkInterval = 3500; // Default 3.5 seconds between chunks to prevent voice lag
                window.__webSpeechStreamingLastProcessedText = "";
                window.__webSpeechStreamingProcessingChunk = false;
                window.__webSpeechStreamingLastChunkTime = Date.now();
              }
              
              // Start WebSpeech recognition with streaming enabled
              success = startListeningWebSpeech();
              
              if (!success && retryCount === maxRetries - 1) {
                console.error("WebSpeech failed to start after retries");
                toast({
                  title: "Speech Recognition Error",
                  description: "Failed to start speech recognition. Please try again or refresh the page.",
                  variant: "destructive",
                  duration: 5000
                });
              }
            }
            
            // If successful, break out of retry loop
            if (success) {
              console.log(`Successfully started ${usingOpenAI ? 'OpenAI' : 'WebSpeech'} recognition`);
              
              // Don't make any additional state changes here
              // This prevents React from batching updates that could cause unintentional shutdowns
              break;
            }
            
            // If not successful, increment retry count and wait before retrying
            retryCount++;
            if (retryCount < maxRetries) {
              console.log(`Attempt ${retryCount}/${maxRetries} failed, retrying in 1 second...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } catch (err) {
            console.error(`Error on retry ${retryCount}:`, err);
            retryCount++;
            
            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
              throw err; // Re-throw if we've exhausted retries
            }
          }
        }
      }
    } catch (err) {
      console.error('Error toggling microphone:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      
      toast({
        title: "Speech Recognition Error",
        description: `Failed to start speech recognition: ${errorMessage}`,
        variant: "destructive",
        duration: 5000
      });
      
      // If this is a permission error, show specific message
      if (errorMessage.toLowerCase().includes('permission') || 
          errorMessage.toLowerCase().includes('denied') || 
          errorMessage.toLowerCase().includes('not allowed')) {
        toast({
          title: "Microphone Permission Denied",
          description: "Please enable microphone access in your browser settings and reload the page.",
          variant: "destructive",
          duration: 6000
        });
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      onTranscriptChange(textInput.trim(), true);
      setTextInput("");
    }
  };

  const toggleSpeechAPI = () => {
    // Prevent rapid toggling by using a timestamp check
    const now = Date.now();
    const lastApiToggleTime = (window as any).__lastApiToggleTime || 0;
    if (now - lastApiToggleTime < 1500) {
      console.log("Ignoring rapid API toggle request");
      return;
    }
    (window as any).__lastApiToggleTime = now;

    if (isListening) {
      // Stop current listening before switching
      if (useOpenAI) {
        stopListeningOpenAI();
      } else {
        stopListeningWebSpeech();
      }
      
      // Reset transcripts with a longer delay to ensure they've been properly stopped
      setTimeout(() => {
        resetOpenAITranscript();
        resetWebSpeechTranscript();
        lastSentText.current = "";
        lastTranscriptSent.current = "";
        
        // Reset WebSpeech translation data when switching to OpenAI
        if (!useOpenAI) {
          // Clear OpenAI raw transcription for WebSpeech mode
          if (window.__openAIRawTranscription) {
            window.__openAIRawTranscription = {
              sourceText: '',
              translatedText: '',
              isComplete: false,
              isSourceComplete: false
            };
          }
        }
        
        // Now we can safely update the API mode
        const newMode = !useOpenAI;
        setUseOpenAI(newMode);
        
        // Log what's happening
        console.log(`Speech API switched: ${useOpenAI ? 'OpenAI → WebSpeech' : 'WebSpeech → OpenAI'}`);
        
        // Show a toast message to inform the user
        toast({
          title: newMode ? "Advanced Mode Activated" : "Basic Mode Activated",
          description: newMode ? 
            "Using OpenAI for better accuracy and translation." : 
            "Using browser speech recognition.",
          duration: 3000
        });
      }, 500);
    } else {
      // Not listening, so we can just update the state directly
      const newMode = !useOpenAI;
      setUseOpenAI(newMode);
      
      // Reset WebSpeech translation data when switching to OpenAI
      if (!newMode) {
        // Clear OpenAI raw transcription for WebSpeech mode
        if (window.__openAIRawTranscription) {
          window.__openAIRawTranscription = {
            sourceText: '',
            translatedText: '',
            isComplete: false,
            isSourceComplete: false
          };
        }
      }
      
      // Log what's happening
      console.log(`Speech API switched: ${useOpenAI ? 'OpenAI → WebSpeech' : 'WebSpeech → OpenAI'}`);
      
      // Show a toast message to inform the user
      toast({
        title: newMode ? "Advanced Mode Activated" : "Basic Mode Activated",
        description: newMode ? 
          "Using OpenAI for better accuracy and translation." : 
          "Using browser speech recognition.",
        duration: 3000
      });
    }
  };

  const currentText = transcriptResult.finalText + (transcriptResult.interimText ? ' ' + transcriptResult.interimText : '');

  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <Button
          variant={isListening ? "default" : "destructive"}
          size="lg"
          onClick={handleToggle}
          disabled={isResetting || isConnecting}
          className={`w-16 h-16 rounded-full transition-all duration-200 touch-manipulation ${
            isListeningWebSpeech || isListeningOpenAI
              ? "bg-green-500 hover:bg-green-600" 
              : "bg-destructive hover:bg-destructive/90"
          }`}
        >
          {isConnecting ? (
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          ) : isListeningWebSpeech || isListeningOpenAI ? (
            <Mic className="h-6 w-6 text-white" />
          ) : (
            <MicOff className="h-6 w-6 text-white" />
          )}
        </Button>
        <div className="flex-1">
          <div className="flex items-center justify-between h-16">
            <div>
              <p className="text-sm text-muted-foreground">
                {isListening 
                  ? uiText.speakNow
                  : `${uiText.speakNow} (${supportedLanguages[language].native})`}
              </p>
              <div className="mt-1">
                <Badge variant={!useOpenAI ? "default" : "outline"} className="mr-2 cursor-pointer" onClick={toggleSpeechAPI}>
                  WebSpeech (Basic)
                </Badge>
                <Badge variant={useOpenAI ? "default" : "outline"} className="cursor-pointer" onClick={toggleSpeechAPI}>
                  OpenAI (Advanced)
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="touch-manipulation"
                onClick={() => setShowSettings(!showSettings)}
              >
                {showSettings ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {showSettings && (
            <div className="space-y-4 pt-2">
              <form onSubmit={handleTextSubmit} className="flex gap-2">
                <Input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={uiText.typeMessage}
                  className="flex-1"
                />
                <Button type="submit" disabled={!textInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>

              <div className="space-y-2">
                <label className="text-sm font-medium">{uiText.inputDevice}</label>
                <Select value={selectedMicId} onValueChange={setSelectedMicId}>
                  <SelectTrigger>
                    <SelectValue placeholder={uiText.inputDevice} />
                  </SelectTrigger>
                  <SelectContent>
                    {combinedDevices
                      .filter(d => d.kind === 'audioinput')
                      .map(device => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{uiText.outputDevice}</label>
                <Select value={selectedSpeakerId} onValueChange={setSelectedSpeakerId}>
                  <SelectTrigger>
                    <SelectValue placeholder={uiText.outputDevice} />
                  </SelectTrigger>
                  <SelectContent>
                    {combinedDevices
                      .filter(d => d.kind === 'audiooutput')
                      .map(device => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          {currentText && (
            <p className="mt-2 text-foreground">
              {currentText}
              {!transcriptResult.isFinal && <span className="ml-1 animate-pulse">▋</span>}
            </p>
          )}
          
          {/* Debug Panel - show for both OpenAI and WebSpeech */}
          {(useOpenAI || !useOpenAI) && window.__openAIRawTranscription && (
            <Card className="mt-4 p-3 bg-slate-800 text-white">
              <h4 className="text-xs font-medium mb-1">{useOpenAI ? "OpenAI" : "WebSpeech"} Debug Info</h4>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                {debugInfo}
              </pre>
              <div className="mt-2 text-xs">
                <button 
                  className="bg-blue-500 px-2 py-1 rounded text-white"
                  onClick={() => {
                    console.log(`${useOpenAI ? 'OpenAI' : 'WebSpeech'} raw data:`, 
                      window.__openAIRawTranscription);
                      
                    // Add room ID extraction debug info
                    const pathParts = window.location.pathname.split('/');
                    const urlParams = new URLSearchParams(window.location.search);
                    const roomIdFromQuery = urlParams.get('id');
                    const isListenMode = pathParts.includes('listen');
                    
                    // Extract raw roomId
                    let rawRoomId = roomIdFromQuery || 'unknown';
                    if (!roomIdFromQuery) {
                      if (isListenMode) {
                        const listenIndex = pathParts.indexOf('listen');
                        if (listenIndex >= 0 && listenIndex + 1 < pathParts.length) {
                          rawRoomId = pathParts[listenIndex + 1];
                        }
                      }
                    }
                    
                    // Prefixed room ID for listen mode
                    const prefixedRoomId = isListenMode ? `listen_${rawRoomId}` : rawRoomId;
                    
                    console.log("Room ID Details:", {
                      rawRoomId,
                      prefixedRoomId,
                      isListenMode,
                      path: window.location.pathname,
                      queryParams: window.location.search
                    });
                  }}
                >
                  Log Details to Console
                </button>
                <div className="mt-2 bg-gray-900 p-1 rounded">
                  <p className="text-xs">
                    Mode: <span className="text-green-400">{window.location.pathname.includes('/listen') ? 'Listen' : 'Chat'}</span> | 
                    URL Room ID: <span className="text-yellow-400">{
                      (() => {
                        const pathParts = window.location.pathname.split('/');
                        const type = pathParts.includes('listen') ? 'listen' : (pathParts.includes('chat') ? 'chat' : '');
                        const index = pathParts.indexOf(type);
                        return index >= 0 && index + 1 < pathParts.length ? pathParts[index + 1] : 'none';
                      })()
                    }</span> | 
                    Internal Room ID: <span className="text-orange-400">{
                      window.location.pathname.includes('/listen') ? 
                      `listen_${(() => {
                        const pathParts = window.location.pathname.split('/');
                        const index = pathParts.indexOf('listen');
                        return index >= 0 && index + 1 < pathParts.length ? pathParts[index + 1] : 'unknown';
                      })()}` : 
                      (() => {
                        const pathParts = window.location.pathname.split('/');
                        const index = pathParts.indexOf('chat');
                        return index >= 0 && index + 1 < pathParts.length ? pathParts[index + 1] : 'unknown';
                      })()
                    }</span>
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Card>
  );
}

const getLanguageCode = (lang: LanguageCode) => {
  const languageCodes: Record<LanguageCode, string> = {
    en: 'en-US',
    es: 'es-ES',
    ar: 'ar-SA',
    it: 'it-IT'
  };
  return languageCodes[lang] || 'en-US';
};
import { useState, useEffect, useCallback, useRef } from "react";

interface TranscriptResult {
  finalText: string;
  interimText: string;
  isFinal: boolean;
}

interface UseSpeechRecognitionProps {
  language?: string;
  deviceId?: string;
}

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

// Declare global window properties for streaming
declare global {
  interface Window {
    __webSpeechStreamingEnabled: boolean;
    __webSpeechLastStreamingChunkTime: number;
    __webSpeechStreamingChunkInterval: number;
    __webSpeechStreamingLastProcessedText: string;
  }
}

export function useSpeechRecognition({ language = 'en-US', deviceId }: UseSpeechRecognitionProps = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult>({
    finalText: "",
    interimText: "",
    isFinal: false
  });
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const recognition = useRef<any>(null);
  const restartAttempts = useRef(0);
  const maxRestartAttempts = 3;

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

  // Clear any existing recognition instance and create a new one
  const createRecognitionInstance = useCallback(() => {
    // Stop any existing instance
    if (recognition.current) {
      try {
        recognition.current.stop();
      } catch (e) {
        console.log('Error stopping previous recognition instance:', e);
      }
    }

    // Create a new instance
    if ('webkitSpeechRecognition' in window) {
      recognition.current = new (window as any).webkitSpeechRecognition();
      recognition.current.continuous = true;
      recognition.current.interimResults = true;
      recognition.current.lang = language;
      
      console.log('Created new speech recognition instance with language:', language);
      return true;
    } else {
      setError("Speech recognition is not supported in this browser");
      return false;
    }
  }, [language]);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    getAudioDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
      // Ensure we stop any active recognition when component unmounts
      if (recognition.current) {
        try {
          recognition.current.stop();
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
    };
  }, [getAudioDevices]);

  // Update recognition language when language prop changes
  useEffect(() => {
    if (recognition.current) {
      recognition.current.lang = language;
      console.log('Updated speech recognition language to:', language);
    }
  }, [language]);

  // Setup recognition event handlers
  const setupRecognitionHandlers = useCallback(() => {
    if (!recognition.current) return;
    
    // Save for closure access
    const currentFinalText = transcriptResult.finalText;
    
    recognition.current.onstart = () => {
      console.log('Speech recognition started in language:', language);
      
      // Set the start time to prevent early shutdown
      (window as any).__webSpeechStartTime = Date.now();
      
      // Set the global marker 
      (window as any).__webSpeechActive = true;
      
      setIsListening(true);
      setError(null);
      // Don't reset the transcript here to avoid losing previous text
    };

    recognition.current.onresult = (event: any) => {
      let finalText = currentFinalText;
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText = (finalText + ' ' + transcript).trim();
        } else {
          interimText = transcript;
        }
      }
      
      // Even more aggressive streaming chunk processing for smooth real-time translation
      if (window.__webSpeechStreamingEnabled) {
        const now = Date.now();
        const timeSinceLastChunk = now - (window.__webSpeechLastStreamingChunkTime || 0);
        
        // Further lowered text requirements for extremely responsive streaming
        const totalContentLength = (finalText + ' ' + interimText).trim().length;
        const hasSomeText = totalContentLength > 8; // Much lower threshold to ensure nothing is missed
        const hasIntermediateText = totalContentLength > 20; 
        const hasSubstantialText = totalContentLength > 40;
        
        // Multi-tiered processing approach:
        // 1. For small amounts of text, wait at least 1.5 seconds between chunks
        // 2. For moderate text, process every 1 second
        // 3. For substantial text, process immediately with minimum 0.7 second gap
        // 4. When we've accumulated enough interim text, process regardless of timing
        if ((timeSinceLastChunk >= 1500 && hasSomeText) || 
            (timeSinceLastChunk >= 1000 && hasIntermediateText) ||
            (timeSinceLastChunk >= 700 && hasSubstantialText) || 
            (interimText.length > 25)) {
          
          // Log diagnostic info to help track chunking behavior
          console.log(`[WebSpeech Streaming] Processing chunk with ${finalText.length} final chars, ${interimText.length} interim chars after ${Math.round(timeSinceLastChunk/100)/10}s`);
          
          // Create temporary final text that includes both final and interim text
          const combinedText = (finalText + ' ' + interimText).trim();
          
          console.log(`[WebSpeech Streaming] Processing chunk after ${timeSinceLastChunk}ms:`, {
            finalTextLength: finalText.length,
            interimTextLength: interimText.length,
            combinedLength: combinedText.length,
          });
          
          // Force a "chunk final" event by creating a shallow copy with isFinal:true
          const streamingResult = {
            finalText: combinedText,
            interimText: '',
            isFinal: true
          };
          
          // Set the transcript result with our forced "chunk final" data
          setTranscriptResult(streamingResult);
          
          // Update tracking variables
          window.__webSpeechLastStreamingChunkTime = now;
          
          // Don't set lastProcessedText to the full final text - this prevents future chunks
          // from being blocked if they contain similar content
          if (finalText.length > 0) {
            // Only store the last portion of the text to allow overlapping content
            const endIndex = Math.max(0, finalText.length - 20);
            window.__webSpeechStreamingLastProcessedText = finalText.substring(endIndex);
          }
          
          // Return early to avoid overwriting our streaming result
          return;
        }
      }

      // Standard non-streaming processing
      setTranscriptResult({
        finalText,
        interimText,
        isFinal: !interimText
      });
    };

    recognition.current.onerror = (event: any) => {
      console.error('Speech recognition error:', event);
      
      // Handle no-speech errors - don't stop listening
      if (event.error === 'no-speech') {
        console.log('No speech detected, but continuing to listen...');
        
        // Don't restart immediately for no-speech errors, just continue
        return;
      }
      
      // Handle abort errors
      if (event.error === 'aborted') {
        console.log('Speech recognition was aborted, attempting to restart...');
        
        // Increment restart counter
        restartAttempts.current += 1;
        
        // Don't try to restart too many times
        if (restartAttempts.current > maxRestartAttempts) {
          console.error('Exceeded maximum restart attempts, giving up');
          setError('Speech recognition failed after multiple restart attempts');
          setIsListening(false);
          return;
        }
        
        // Wait a moment before restarting
        setTimeout(() => {
          if (isListening) {
            try {
              // Create a new instance and restart
              if (createRecognitionInstance()) {
                setupRecognitionHandlers();
                recognition.current.start();
                console.log('Successfully restarted speech recognition after abort');
              }
            } catch (e) {
              console.error('Failed to restart recognition after abort:', e);
              setError('Failed to restart speech recognition');
              setIsListening(false);
            }
          }
        }, 300);
        
        return;
      }
      
      // For other errors, show error and stop listening
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.current.onend = () => {
      console.log('Speech recognition ended, checking if we should restart');
      
      // Get the current time to compare with start time
      const now = Date.now();
      const startTime = (window as any).__webSpeechStartTime || 0;
      
      // If recognition ended within 2 seconds of starting, it's likely an error
      // or automatic shutdown - try to restart it
      const justStarted = (now - startTime < 2000);
      
      // Check if we should still be active
      const isStillActive = (window as any).__webSpeechActive === true;
      
      console.log(`WebSpeech onend - justStarted: ${justStarted}, isStillActive: ${isStillActive}, isListening: ${isListening}`);
      
      // Don't actually end recognition if:
      // 1. The global marker indicates we should be active
      // 2. We're still supposed to be listening according to local state
      // 3. We just started (within last 2 seconds)
      // 4. We haven't exceeded max restart attempts
      const shouldRestart = (isStillActive || isListening || justStarted) && 
                            restartAttempts.current < maxRestartAttempts;
      
      // If we're still supposed to be listening, try to restart
      if (shouldRestart) {
        console.log('Recognition ended but should be listening. Attempting to restart...');
        
        if (!justStarted) {
          restartAttempts.current += 1;
        }
        
        setTimeout(() => {
          try {
            if ((window as any).__webSpeechActive) {
              recognition.current.start();
              console.log('Successfully restarted recognition after end event');
            } else {
              console.log('Not restarting since recognition is no longer active');
            }
          } catch (e) {
            console.error('Failed to restart recognition after end:', e);
            // Only set listening to false if we've exceeded retry attempts
            if (restartAttempts.current >= maxRestartAttempts) {
              setIsListening(false);
              (window as any).__webSpeechActive = false;
            }
          }
        }, 300);
      } else {
        // Only set isListening to false if we're not trying to restart
        // AND we're not within the protected startup period
        if (!justStarted) {
          console.log('Recognition ended and not restarting');
          setIsListening(false);
          (window as any).__webSpeechActive = false;
        }
      }
    };
  }, [language, isListening, transcriptResult.finalText, createRecognitionInstance]);

  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window)) {
      setError("Speech recognition is not supported in this browser");
      return false;
    }

    try {
      // Store start time to prevent auto-stop for a few seconds
      const now = Date.now();
      (window as any).__webSpeechStartTime = now;
      (window as any).__webSpeechActive = true;
      
      // Initialize streaming properties with more aggressive settings
      const isListenPage = window.location.pathname.includes('/listen');
      window.__webSpeechStreamingEnabled = isListenPage; // Only enable streaming in listen mode
      window.__webSpeechLastStreamingChunkTime = 0;
      window.__webSpeechStreamingChunkInterval = 1000; // Process every 1 second in listen mode for baseline
      window.__webSpeechStreamingLastProcessedText = '';
      
      // Create a global tracking object for streaming performance monitoring
      if (!(window as any).__speechStreamingStats) {
        (window as any).__speechStreamingStats = {
          totalChunks: 0,
          duplicatesDetected: 0,
          avgChunkSize: 0,
          lastChunkTime: 0
        };
      }
      
      console.log(`WebSpeech starting at ${now}, marked as active globally`);
      console.log(`WebSpeech streaming ${window.__webSpeechStreamingEnabled ? 'enabled' : 'disabled'}, chunk interval: ${window.__webSpeechStreamingChunkInterval}ms`);

      // Reset restart counter
      restartAttempts.current = 0;
      
      // Set to listening state immediately to update UI
      setIsListening(true);
      
      // Create a fresh recognition instance
      if (!createRecognitionInstance()) {
        setIsListening(false); // Reset if instance creation fails
        return false;
      }
      
      // Set audio source if deviceId is provided
      if (deviceId) {
        const constraints = {
          audio: {
            deviceId: { exact: deviceId }
          }
        };
        recognition.current.mediaDevices = constraints;
      }
      
      // Set up event handlers
      setupRecognitionHandlers();
      
      // Prevent accidental cleanup
      (window as any).__webSpeechJustStarted = true;
      
      // Set a timer to clear the flag
      setTimeout(() => {
        (window as any).__webSpeechJustStarted = false;
      }, 2000);
      
      // Start recognition
      recognition.current.start();
      console.log('Started speech recognition');
      return true;
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      setError('Failed to start speech recognition. Please try again.');
      setIsListening(false);
      return false;
    }
  }, [language, deviceId, createRecognitionInstance, setupRecognitionHandlers]);

  const stopListening = useCallback(() => {
    // Print stack trace to debug what's calling this
    console.log('WebSpeech stopListening called from:', new Error().stack);

    // Check if this stop request is coming from a language change effect
    // React internal effects have a specific stack signature
    const isFromEffectCleanup = new Error().stack?.includes('commitHookEffectListMount');
    
    // If from effect cleanup and other conditions are met, we may want to ignore
    if (isFromEffectCleanup) {
      console.log('Stop request coming from React effect cleanup - checking if we should ignore');
      
      // Check if we've recently started - if so, ignore the stop request
      const now = Date.now();
      const startTime = (window as any).__webSpeechStartTime || 0;
      if (now - startTime < 5000) {
        console.log('Ignoring WebSpeech stop request from effect within 5 seconds of starting');
        return;
      }
      
      // Check if the global marker indicates we should be active
      if ((window as any).__webSpeechActive === true) {
        console.log('Ignoring effect cleanup stop request because __webSpeechActive is true');
        return;
      }
    }

    // Add a timestamp check to prevent multiple rapid stop calls
    const now = Date.now();
    const lastStopTime = (window as any).__lastWebSpeechStopTime || 0;
    if (now - lastStopTime < 1000) {
      console.log('Ignoring rapid WebSpeech stop request');
      return;
    }
    (window as any).__lastWebSpeechStopTime = now;

    // Check if this is a user-initiated stop from a UI click (like the microphone button)
    // Stack trace for button clicks includes 'callCallback' from React's synthetic event handler
    const isUserInitiatedStop = new Error().stack?.includes('HTMLUnknownElement.callCallback');
    
    // Only apply the timing protection for automatic/programmatic stops, not for explicit user actions
    if (!isUserInitiatedStop) {
      // Check if we just started - prevent auto-stop within 3 seconds of starting (for automatic events only)
      const startTime = (window as any).__webSpeechStartTime || 0;
      if (now - startTime < 3000) {
        console.log('Ignoring WebSpeech stop request within 3 seconds of starting (auto/programmatic)');
        return;
      }
    } else {
      console.log('User clicked stop button - immediately stopping WebSpeech regardless of timing');
      // Force reset the global state for user-initiated stops
      (window as any).__webSpeechActive = false;
    }

    // Only stop if we're actually listening according to our tracking
    if (!(window as any).__webSpeechActive && !isListening) {
      console.log('Not stopping WebSpeech since it is not active');
      return;
    }

    console.log('Actually stopping WebSpeech recognition');
    restartAttempts.current = maxRestartAttempts; // Prevent auto-restart
    (window as any).__webSpeechActive = false; // Mark as inactive globally
    
    if (recognition.current) {
      try {
        recognition.current.stop();
        console.log('Stopped speech recognition');
      } catch (e) {
        console.error('Error stopping recognition:', e);
      }
    }
    setIsListening(false);
  }, [isListening]);

  const resetTranscript = useCallback(() => {
    setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
  }, []);

  return {
    isListening,
    transcriptResult,
    error,
    startListening,
    stopListening,
    resetTranscript,
    devices
  };
}
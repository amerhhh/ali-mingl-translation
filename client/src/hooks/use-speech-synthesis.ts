import { useCallback, useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const { toast } = useToast();
  const audioContext = useRef<AudioContext | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const speechErrorCount = useRef(0);

  // Function to reset speech synthesis in case of repeated errors
  const resetSpeechSynthesis = useCallback(() => {
    if ('speechSynthesis' in window) {
      console.log('Resetting speech synthesis...');
      window.speechSynthesis.cancel();
      // Force the browser to re-initialize the speech synthesis engine
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      window.speechSynthesis.cancel();
      // Reset error counter
      speechErrorCount.current = 0;
    }
  }, []);

  // Initialize speech synthesis on mount
  useEffect(() => {
    if ('speechSynthesis' in window) {
      // Force initialize the speech synthesis
      window.speechSynthesis.cancel();
      setIsInitialized(true);
      
      // Initialize with a reset
      resetSpeechSynthesis();
    }
    
    // Cleanup function to cancel any ongoing speech when component unmounts
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (currentUtterance.current) {
        currentUtterance.current = null;
      }
    };
  }, [resetSpeechSynthesis]);

  const speak = useCallback((text: string, lang: string = 'en-US', isManualPlayback: boolean = false) => {
    if (!('speechSynthesis' in window)) {
      console.error('Speech synthesis not supported');
      toast({
        variant: "destructive",
        title: "Speech Synthesis Error",
        description: "Text-to-speech is not supported in your browser"
      });
      return;
    }

    try {
      // Check if we're in Listen mode - remove the block on audio playback
      const isListenPage = window.location.pathname.includes('/listen');
      if (isListenPage) {
        console.log('Allowing audio playback in Listen mode for real-time translation');
        // Don't return early here - continue with speech synthesis
      }

      // Check if we're in Chat mode
      const isChatPage = window.location.pathname.includes('/chat');
      
      // Check if this is an OpenAI message by looking for our global variable
      const isOpenAIMessage = (window as any).__lastOpenAIMessage && 
                             ((window as any).__lastOpenAIMessage.text === text || 
                              (window as any).__lastOpenAIMessage.translatedText === text);
      
      // Check if playTargetLanguage is enabled (available as a global variable)
      const playTargetLanguage = (window as any).__playTargetLanguage === true;
      
      // Log the values for debugging
      console.log(`Speech check for auto-play: isChat=${isChatPage}, isOpenAI=${isOpenAIMessage}, isManual=${isManualPlayback}, playTargetEnabled=${playTargetLanguage}`);
      
      // Skip audio playback for OpenAI translations in Chat mode
      // ONLY if this is automatic playback (not manual)
      // AND if playTargetLanguage is not enabled
      if (isChatPage && isOpenAIMessage && !isManualPlayback && !playTargetLanguage) {
        console.log('Blocking automatic audio playback for OpenAI message in Chat mode (playTargetLanguage is off)');
        // Still trigger onend to reset UI state
        setTimeout(() => {
          setIsSpeaking(false);
        }, 100);
        return;
      }

      // Always allow manual playback regardless of other settings
      if (isManualPlayback) {
        console.log('Manual playback requested - allowing audio regardless of other settings');
      }
      
      // Cancel any ongoing speech
      if (currentUtterance.current) {
        window.speechSynthesis.cancel();
        currentUtterance.current = null;
      }
      
      // Check if this is Arabic text 
      const hasArabicScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      
      // Special handling for Arabic text to improve reliability
      if (hasArabicScript && text.length > 20 && isListenPage) {
        console.log('Arabic text detected in Listen mode, using enhanced reliability mode');
        
        try {
          // For longer Arabic text in Listen mode, we'll use a chunking strategy 
          // to minimize errors by breaking the text into smaller segments
          setIsSpeaking(true);
          
          // First cancel any ongoing speech
          window.speechSynthesis.cancel();
          
          // Split the text on punctuation to create natural breaks
          // Arabic punctuation includes: '.' (period), '،' (Arabic comma), and other marks
          // Use more aggressive chunking for better reliability
          const segments = text.split(/([\.،؛\!\?؟])/);
          
          // Recombine segments with their punctuation 
          const textChunks: string[] = [];
          for (let i = 0; i < segments.length; i += 2) {
            let chunk = segments[i];
            if (i + 1 < segments.length) {
              chunk += segments[i + 1]; // Add back the punctuation
            }
            
            // Further split long chunks for even better reliability
            if (chunk.trim().length > 25) {
              // Split longer segments into smaller chunks without breaking words
              const words = chunk.trim().split(' ');
              let currentChunk = '';
              
              for (const word of words) {
                if (currentChunk.length + word.length > 20) { // Even smaller chunks
                  if (currentChunk.length > 0) {
                    textChunks.push(currentChunk.trim());
                    currentChunk = '';
                  }
                }
                currentChunk += ' ' + word;
              }
              
              if (currentChunk.trim().length > 0) {
                textChunks.push(currentChunk.trim());
              }
            } else if (chunk.trim().length > 0) {
              textChunks.push(chunk.trim());
            }
          }
          
          // If we still didn't get proper chunks, use a fallback approach
          if (textChunks.length <= 1) {
            // Fallback: split by approximate length (15-20 chars)
            // This tries to avoid cutting words in the middle
            const words = text.split(' ');
            textChunks.length = 0; // Clear the chunks array
            let currentChunk = '';
            
            for (const word of words) {
              if (currentChunk.length + word.length > 15) { // Even smaller chunks
                if (currentChunk.length > 0) {
                  textChunks.push(currentChunk.trim());
                  currentChunk = '';
                }
              }
              currentChunk += ' ' + word;
            }
            
            if (currentChunk.trim().length > 0) {
              textChunks.push(currentChunk.trim());
            }
          }
          
          console.log(`Split Arabic text into ${textChunks.length} chunks for reliable playback`);
          
          // Function to speak chunks sequentially
          const speakNextChunk = (index: number) => {
            if (index >= textChunks.length) {
              // All chunks have been spoken
              setIsSpeaking(false);
              return;
            }
            
            const chunk = textChunks[index];
            const chunkUtterance = new SpeechSynthesisUtterance(chunk);
            
            // Get available voices
            let voices = window.speechSynthesis.getVoices();
            
            // Try to find a matching voice for Arabic
            let voice = voices.find(v => v.lang === 'ar-SA');
            if (!voice) {
              voice = voices.find(v => v.lang.toLowerCase().includes('ar'));
            }
            
            if (voice) {
              chunkUtterance.voice = voice;
            }
            
            chunkUtterance.lang = 'ar-SA';
            chunkUtterance.rate = 0.92; // Even slower for better reliability
            chunkUtterance.pitch = 1.0; // Default pitch
            
            // Enhanced robustness for chunked speech
            let chunkStarted = false;
            let chunkCancelled = false;
            
            // Add a flag to track start of speech
            chunkUtterance.onstart = () => {
              chunkStarted = true;
              console.log(`Arabic chunk ${index} started speaking`);
            };
            
            // When this chunk ends successfully, play the next one
            chunkUtterance.onend = () => {
              if (chunkStarted && !chunkCancelled) {
                console.log(`Arabic chunk ${index} completed normally`);
                setTimeout(() => {
                  speakNextChunk(index + 1);
                }, 150); // Small gap between chunks for better clarity
              }
            };
            
            // Handle errors more robustly
            chunkUtterance.onerror = (event) => {
              const errorType = event.error || 'unknown';
              
              // Mark chunk as cancelled to prevent multiple attempts
              chunkCancelled = true;
              
              console.error(`Error with Arabic chunk ${index} (${errorType}):`, event);
              
              // For any error type, try to recover and continue with the next chunk
              // The error.error check now uses string.includes() to be more forgiving with error types
              console.log(`Arabic speech interrupted, advancing to next chunk`);
              
              // Clear any pending speech
              window.speechSynthesis.cancel();
              
              // Calculate dynamic timeout based on error type - longer for more severe errors
              let timeout = 300; // Default
              if (errorType.includes('audio-busy') || errorType.includes('network')) {
                timeout = 700; // Longer wait for resource issues
              }
              
              // Wait, then continue with next chunk
              setTimeout(() => {
                speakNextChunk(index + 1);
              }, timeout);
            };
            
            // Play this chunk with safeguards
            try {
              // First make sure synthesis service is not busy
              window.speechSynthesis.cancel();
              
              // Small delay before starting new speech
              setTimeout(() => {
                window.speechSynthesis.speak(chunkUtterance);
              }, 100);
            } catch (err) {
              console.error(`Exception when trying to speak Arabic chunk ${index}:`, err);
              // Try to recover by moving to next chunk
              setTimeout(() => {
                speakNextChunk(index + 1);
              }, 400);
            }
          };
          
          // Start speaking the first chunk
          speakNextChunk(0);
          
          // Return early as we're handling this with our chunking system
          return;
        } catch (error) {
          console.error('Error in Arabic chunked speech, falling back to normal synthesis:', error);
          // We'll continue with the normal approach below
        }
      }

      const utterance = new SpeechSynthesisUtterance(text);
      currentUtterance.current = utterance;

      // Get available voices
      let voices = window.speechSynthesis.getVoices();

      // If voices aren't loaded yet, wait for them
      if (voices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          voices = window.speechSynthesis.getVoices();
        };
      }

      // Note: containsArabic is already defined earlier in this function
      
      // Convert language code to match voice format
      // Force ar-SA for any text with Arabic characters, regardless of the specified language
      let langCode = lang;
      if (hasArabicScript || lang.toLowerCase().startsWith('ar')) {
        langCode = 'ar-SA';
        console.log('Arabic text detected, using ar-SA language code');
      }

      // Log available voices for debugging
      console.log('Available voices:', voices.map(v => `${v.name} (${v.lang})`));
      
      // Try specialized voice selection for Arabic text
      let voice = null;
      
      if (hasArabicScript || langCode === 'ar-SA') {
        // First, try to find an exact ar-SA voice
        voice = voices.find(v => v.lang === 'ar-SA');
        
        // If not found, try any Arabic voice
        if (!voice) {
          voice = voices.find(v => v.lang.toLowerCase().includes('ar'));
        }
        
        // If still not found, try Microsoft voices which often handle Arabic well
        if (!voice) {
          voice = voices.find(v => v.name.includes('Microsoft') && (v.lang === 'ar-SA' || v.lang.includes('ar')));
        }
        
        // Last resort - use any available voice but maintain Arabic language setting
        if (!voice && voices.length > 0) {
          voice = voices[0]; // Use first available voice but keep language as Arabic
          console.log('No Arabic voice found, using default voice but keeping Arabic language settings');
        }
      } else {
        // For non-Arabic text, find voice matching the language
        voice = voices.find(v => v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
      }

      console.log('Selected voice:', voice?.name, 'for language:', langCode);

      if (voice) {
        utterance.voice = voice;
      } else {
        console.warn(`No voice found for language ${langCode}, using default`);
        // For Arabic, give a more specific message
        if (langCode === 'ar-SA') {
          console.warn('No Arabic voice found on this device');
          // Don't show toast to avoid disrupting user experience
          // Instead, we'll proceed with default voice
        }
      }

      utterance.lang = langCode;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      // iOS Safari specific setup
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isiOS) {
        // Set a longer timeout for iOS devices before attempting to speak
        // This helps prevent some "canceled" errors on iOS
        const iOSTimeout = 300;
        
        // Resume audio context if needed
        const resumeAudio = () => {
          // Create AudioContext if it doesn't exist
          if (!audioContext.current) {
            audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }
          // Resume AudioContext
          if (audioContext.current.state === 'suspended') {
            audioContext.current.resume();
          }
          
          // First pause then resume synthesis to ensure it's in a clean state
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        };

        // Add multiple event listeners for iOS
        ['touchstart', 'touchend', 'click'].forEach(eventType => {
          document.addEventListener(eventType, resumeAudio, { once: true });
        });
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        console.log('Speech started');
        // For iOS, ensure synthesis stays active
        if (isiOS) {
          const keepAlive = setInterval(() => {
            if (window.speechSynthesis.speaking) {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            } else {
              clearInterval(keepAlive);
            }
          }, 14000);

          // Clear interval after 2 minutes max
          setTimeout(() => clearInterval(keepAlive), 120000);
        }
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        console.log('Speech ended');
        // Clear the reference to the utterance when speech ends normally
        if (currentUtterance.current === utterance) {
          currentUtterance.current = null;
        }
      };

      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        setIsSpeaking(false);
        
        // Clear the reference to the utterance when speech errors
        if (currentUtterance.current === utterance) {
          currentUtterance.current = null;
        }
        
        // Check if this is Arabic text 
        const textHasArabicScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(utterance.text);
        
        // For interrupted speech errors (with any language), use enhanced recovery
        // Using string.includes() for safer type checking
        if (String(event.error).includes("interrupted") || String(event.error).includes("canceled")) {
          // Increment recovery count globally to track retries across attempts
          const recoveryCount = ((window as any).__speechRecoveryCount || 0) + 1;
          (window as any).__speechRecoveryCount = recoveryCount;
          
          console.log(`Speech interrupted/canceled (attempt #${recoveryCount}), attempting recovery...`);
          
          // Progressive backoff for retries
          const recoveryDelay = Math.min(300 + (recoveryCount * 100), 800);
          
          // Cancel any pending speech to ensure a clean state
          window.speechSynthesis.cancel();
          
          // Wait a brief moment then try again with modified parameters for better reliability
          setTimeout(() => {
            if (!window.speechSynthesis.speaking) {
              try {
                // If we've tried too many times, use a more aggressive approach
                const isLongText = utterance.text.length > 100;
                const shouldSplitText = recoveryCount > 1 && isLongText;
                
                // For multiple retries with long text, only speak the beginning
                const textToSpeak = shouldSplitText 
                  ? utterance.text.substring(0, 50) + "..." 
                  : utterance.text;
                
                // Create a new utterance with the same text but modified parameters
                const newUtterance = new SpeechSynthesisUtterance(textToSpeak);
                
                // Try using the same voice if available
                if (utterance.voice) {
                  newUtterance.voice = utterance.voice;
                }
                
                // Use the same language
                newUtterance.lang = utterance.lang;
                
                // Progressively slow down speech for better reliability in subsequent attempts
                newUtterance.rate = Math.max(0.8, 1.0 - (recoveryCount * 0.1));
                
                // Don't show errors for the retry attempt
                newUtterance.onerror = () => {
                  setIsSpeaking(false);
                  // After multiple recovery failures, reset the counter
                  if (recoveryCount >= 3) {
                    (window as any).__speechRecoveryCount = 0;
                  }
                };
                
                newUtterance.onend = () => {
                  setIsSpeaking(false);
                  // Reset recovery count on success
                  (window as any).__speechRecoveryCount = 0;
                };
                
                // Try speaking again with modified parameters
                window.speechSynthesis.speak(newUtterance);
                console.log(`Recovery attempt #${recoveryCount} with rate ${newUtterance.rate}, text length: ${textToSpeak.length}`);
              } catch (e) {
                console.error(`Speech recovery attempt #${recoveryCount} failed:`, e);
                // Reset recovery count on exception
                (window as any).__speechRecoveryCount = 0;
                setIsSpeaking(false);
              }
            } else {
              console.log('Speech already in progress, skipping recovery attempt');
            }
          }, recoveryDelay);
          
          return; // Don't show error toasts when attempting recovery
        }
        
        // For non-Arabic text or non-interrupted errors, proceed with normal error handling
        // Increment error counter
        speechErrorCount.current += 1;
        
        // Reset the speech synthesis if we get too many errors
        if (speechErrorCount.current >= 3) {
          resetSpeechSynthesis();
        }
        
        // Only show error toast for errors other than "canceled" or "interrupted"
        // These errors are common and expected when navigating or starting new speech
        // Using type-safe comparisons with string.includes() instead of strict equality
        if (!String(event.error).includes("canceled") && !String(event.error).includes("interrupted")) {
          toast({
            variant: "destructive",
            title: "Speech Playback Error",
            description: "Failed to play audio. Try tapping the play button again."
          });
        } else {
          // Just log these expected errors without showing a toast
          console.log(`Speech synthesis ${event.error}`);
        }
      };

      // Add a small delay for iOS devices
      if (isiOS) {
        setTimeout(() => {
          // Double-check that we haven't navigated away or canceled in the meantime
          if (currentUtterance.current === utterance) {
            window.speechSynthesis.speak(utterance);
          }
        }, 300); // Increased timeout for better reliability
      } else {
        window.speechSynthesis.speak(utterance);
      }

    } catch (error) {
      console.error('Speech synthesis error:', error);
      setIsSpeaking(false);
      toast({
        variant: "destructive",
        title: "Speech Playback Error",
        description: "Unable to play audio. Please try again."
      });
    }
  }, [toast, resetSpeechSynthesis]);

  return { speak, isSpeaking, isInitialized };
}
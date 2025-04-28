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
      if (hasArabicScript && text.length > 30 && isListenPage) {
        console.log('Arabic text detected in Listen mode, using enhanced reliability mode');
        
        try {
          // For longer Arabic text in Listen mode, we'll use a chunking strategy 
          // to minimize errors by breaking the text into smaller segments
          setIsSpeaking(true);
          
          // First cancel any ongoing speech
          window.speechSynthesis.cancel();
          
          // Split the text on punctuation to create natural breaks
          // Arabic punctuation includes: '.' (period), '،' (Arabic comma), and other marks
          const segments = text.split(/([\.،؛\!\?؟])/);
          
          // Recombine segments with their punctuation 
          const textChunks: string[] = [];
          for (let i = 0; i < segments.length; i += 2) {
            let chunk = segments[i];
            if (i + 1 < segments.length) {
              chunk += segments[i + 1]; // Add back the punctuation
            }
            if (chunk.trim().length > 0) {
              textChunks.push(chunk.trim());
            }
          }
          
          // If we didn't get proper chunks (no punctuation), use a fallback approach
          if (textChunks.length <= 1) {
            // Fallback: split by approximate length (20-30 chars)
            // This tries to avoid cutting words in the middle
            const words = text.split(' ');
            textChunks.length = 0; // Clear the chunks array
            let currentChunk = '';
            
            for (const word of words) {
              if (currentChunk.length + word.length > 25) {
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
            chunkUtterance.rate = 0.95; // Slightly slower for better reliability
            
            // When this chunk ends, play the next one
            chunkUtterance.onend = () => {
              speakNextChunk(index + 1);
            };
            
            // If there's an error with this chunk, try to continue with the next one
            chunkUtterance.onerror = (event) => {
              console.error(`Error with Arabic chunk ${index}:`, event);
              // Try to continue with the next chunk after a brief pause
              setTimeout(() => {
                speakNextChunk(index + 1);
              }, 300);
            };
            
            // Play this chunk
            window.speechSynthesis.speak(chunkUtterance);
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
        
        // Special handling for Arabic text or other RTL languages
        if (textHasArabicScript) {
          // For Arabic text, if we get "interrupted" errors, try again with a different approach
          if (event.error === "interrupted" || event.error === "canceled") {
            console.log('Arabic speech interrupted or canceled, attempting recovery...');
            
            // Wait a brief moment then try again with a shorter segment or different rate
            setTimeout(() => {
              if (!window.speechSynthesis.speaking) {
                try {
                  // Create a new utterance with the same text but modified parameters
                  const newUtterance = new SpeechSynthesisUtterance(utterance.text);
                  
                  // Try using the same voice if available
                  if (utterance.voice) {
                    newUtterance.voice = utterance.voice;
                  }
                  
                  // Use the same language
                  newUtterance.lang = utterance.lang;
                  
                  // Adjust rate slightly to make it more reliable
                  newUtterance.rate = 0.9; // Slightly slower rate often helps with errors
                  
                  // Don't show errors for the retry attempt
                  newUtterance.onerror = () => {
                    setIsSpeaking(false);
                    // Just silently fail on retry without showing error to user
                  };
                  
                  newUtterance.onend = () => {
                    setIsSpeaking(false);
                  };
                  
                  // Try speaking again
                  window.speechSynthesis.speak(newUtterance);
                  console.log("Recovery attempt for Arabic speech");
                } catch (e) {
                  console.error("Arabic speech recovery attempt failed:", e);
                  // Don't show error for recovery attempt
                }
              }
            }, 300); // Small delay before retry
            
            return; // Don't show error toasts for Arabic text when retrying
          }
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
        if (event.error !== "canceled" && event.error !== "interrupted") {
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
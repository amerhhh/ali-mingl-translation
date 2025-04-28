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
      if (hasArabicScript && isListenPage) {
        console.log('Arabic text detected in Listen mode, using simplified reliable mode');
        
        try {
          // For Arabic text in Listen mode, we'll use a more direct approach
          // that's less likely to trigger browser errors
          setIsSpeaking(true);
          
          // First cancel any ongoing speech
          window.speechSynthesis.cancel();
          
          // Create a single utterance with carefully tuned parameters
          const arabicUtterance = new SpeechSynthesisUtterance(text);
          
          // Get available voices
          let voices = window.speechSynthesis.getVoices();
          
          // Log available voices for debugging
          console.log('Available voices for Arabic:', voices.map(v => `${v.name} (${v.lang})`));
          
          // Try to find the best voice for Arabic
          let voice = null;
          
          // First try exact match
          voice = voices.find(v => v.lang === 'ar-SA' || v.lang === 'ar-EG');
          
          // Then try any Arabic voice
          if (!voice) {
            voice = voices.find(v => v.lang.toLowerCase().includes('ar'));
          }
          
          // Then try Microsoft voices which often handle Arabic well
          if (!voice) {
            voice = voices.find(v => 
              v.name.includes('Microsoft') && 
              (v.lang === 'ar-SA' || v.lang === 'ar-EG' || v.lang.includes('ar'))
            );
          }
          
          // Finally try any Google voice with Arabic
          if (!voice) {
            voice = voices.find(v => 
              v.name.includes('Google') && 
              (v.lang === 'ar-SA' || v.lang === 'ar-EG' || v.lang.includes('ar'))
            );
          }
          
          // As absolute fallback, use any voice but keep Arabic language setting
          if (!voice && voices.length > 0) {
            // Look for any default voice in Chrome/Safari that might work
            for (const defaultName of ['Samantha', 'Daniel', 'Google US English', 'Microsoft David']) {
              voice = voices.find(v => v.name.includes(defaultName));
              if (voice) break;
            }
            
            // If still not found, use the first voice
            if (!voice) {
              voice = voices[0];
            }
            console.log('Using fallback voice for Arabic:', voice?.name);
          }
          
          if (voice) {
            arabicUtterance.voice = voice;
            console.log('Selected voice for Arabic:', voice.name, voice.lang);
          } else {
            console.warn('No voice found for Arabic');
          }
          
          // Apply special settings for reliability
          arabicUtterance.lang = 'ar-SA';  // Saudi Arabic
          arabicUtterance.rate = 0.9;      // Slightly slower
          arabicUtterance.pitch = 1.0;     // Normal pitch
          arabicUtterance.volume = 1.0;    // Full volume
          
          // This is important - manage completion events
          arabicUtterance.onend = () => {
            console.log('Arabic speech completed successfully');
            setIsSpeaking(false);
          };
          
          // Handle errors - show specific error messages for debugging
          arabicUtterance.onerror = (event) => {
            console.error('Arabic speech error:', event.error || 'Unknown error');
            
            // All browser error handlers need to reset speaking state
            setIsSpeaking(false);

            // Special handling for text-to-speech in web browsers
            // Don't show error to user for any of these - they're system errors
            // and often can't be fixed by the user
            
            // For browsers on mobile that don't fully support Arabic TTS
            // We'll use a fallback mechanism to handle Arabic text
            
            // We can try a super basic approach - for very short text only
            if (text.length < 50) {
              console.log('Attempting super simple fallback for Arabic...');
              
              try {
                // Cancel any existing speech synthesis 
                window.speechSynthesis.cancel();
                
                // Wait a moment to ensure the speech engine is reset
                setTimeout(() => {
                  try {
                    // Create a completely new utterance
                    const fallbackUtterance = new SpeechSynthesisUtterance(text);
                    
                    // We'll manually set everything from scratch
                    fallbackUtterance.lang = 'ar'; // Basic Arabic code
                    fallbackUtterance.rate = 0.8;  // Even slower
                    fallbackUtterance.pitch = 1.0;
                    fallbackUtterance.volume = 1.0;
                    
                    // Don't use a specific voice
                    // Some browsers work better with the default voice
                    
                    // Simple event handlers that won't trigger additional errors
                    fallbackUtterance.onend = () => {
                      console.log('Arabic fallback speech completed successfully');
                    };
                    
                    fallbackUtterance.onerror = () => {
                      // Just log the error but don't try additional fallbacks
                      console.log('Ultimate Arabic fallback failed - this browser may not support Arabic TTS');
                    };
                    
                    // Try one last time
                    window.speechSynthesis.speak(fallbackUtterance);
                  } catch (e) {
                    // Just log, don't try to handle further
                    console.log('Browser rejected Arabic TTS attempt');
                  }
                }, 300);
              } catch (e) {
                console.error('Final Arabic fallback failed');
              }
            }
          };
          
          // On iOS, we need a small delay
          const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
          if (isiOS) {
            setTimeout(() => {
              window.speechSynthesis.speak(arabicUtterance);
            }, 100);
          } else {
            // Speak immediately on other platforms
            window.speechSynthesis.speak(arabicUtterance);
          }
          
          // Return early as we're handling Arabic specially
          return;
        } catch (error) {
          console.error('Error in Arabic speech, falling back to normal synthesis:', error);
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
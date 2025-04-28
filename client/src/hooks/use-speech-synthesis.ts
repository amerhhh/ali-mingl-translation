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

      // Check if the text contains Arabic characters
      const containsArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      
      // Convert language code to match voice format
      // Force ar-SA for any text with Arabic characters, regardless of the specified language
      let langCode = lang;
      if (containsArabic || lang.toLowerCase().startsWith('ar')) {
        langCode = 'ar-SA';
        console.log('Arabic text detected, using ar-SA language code');
      }

      // Log available voices for debugging
      console.log('Available voices:', voices.map(v => `${v.name} (${v.lang})`));
      
      // Try specialized voice selection for Arabic text
      let voice = null;
      
      if (containsArabic || langCode === 'ar-SA') {
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
        
        // Increment error counter
        speechErrorCount.current += 1;
        
        // Reset the speech synthesis if we get too many errors
        if (speechErrorCount.current >= 3) {
          resetSpeechSynthesis();
        }
        
        // Only show error toast for errors other than "canceled"
        // "canceled" errors are common and expected when navigating or starting new speech
        if (event.error !== "canceled") {
          toast({
            variant: "destructive",
            title: "Speech Playback Error",
            description: "Failed to play audio. Try tapping the play button again."
          });
        } else {
          // Just log canceled errors without showing a toast
          console.log('Speech synthesis canceled');
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
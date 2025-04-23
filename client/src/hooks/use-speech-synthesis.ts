import { useCallback, useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const { toast } = useToast();
  const audioContext = useRef<AudioContext | null>(null);

  // Initialize speech synthesis on mount
  useEffect(() => {
    if ('speechSynthesis' in window) {
      // Force initialize the speech synthesis
      window.speechSynthesis.cancel();
      setIsInitialized(true);
    }
  }, []);

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
      // Check if we're in Listen mode - if so, block all audio playback
      const isListenPage = window.location.pathname.includes('/listen');
      if (isListenPage) {
        console.log('Blocking all audio playback in Listen mode');
        // Still trigger onend to reset UI state
        setTimeout(() => {
          setIsSpeaking(false);
        }, 100);
        return;
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
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      // Get available voices
      let voices = window.speechSynthesis.getVoices();

      // If voices aren't loaded yet, wait for them
      if (voices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          voices = window.speechSynthesis.getVoices();
        };
      }

      // Convert language code to match voice format
      const langCode = lang.toLowerCase().startsWith('ar') ? 'ar-SA' : lang;

      // Try to find a matching voice
      let voice = voices.find(v => v.lang.toLowerCase().startsWith(langCode.toLowerCase()));

      // Log available voices for debugging
      console.log('Available voices:', voices.map(v => `${v.name} (${v.lang})`));
      console.log('Selected voice:', voice?.name);

      if (voice) {
        utterance.voice = voice;
      } else {
        console.warn(`No voice found for language ${langCode}, using default`);
        // For Arabic, try to find any Arabic voice as fallback
        if (langCode === 'ar-SA') {
          voice = voices.find(v => v.lang.toLowerCase().includes('ar'));
          if (voice) {
            utterance.voice = voice;
            console.log('Using fallback Arabic voice:', voice.name);
          } else {
            toast({
              title: "Voice Not Available",
              description: "Arabic voice not found on your device. Using default voice instead.",
            });
          }
        }
      }

      utterance.lang = langCode;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      // iOS Safari specific setup
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isiOS) {
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
      };

      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        setIsSpeaking(false);
        toast({
          variant: "destructive",
          title: "Speech Playback Error",
          description: "Failed to play audio. Try tapping the play button again."
        });
      };

      // Add a small delay for iOS devices
      if (isiOS) {
        setTimeout(() => {
          window.speechSynthesis.speak(utterance);
        }, 100);
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
  }, [toast]);

  return { speak, isSpeaking, isInitialized };
}
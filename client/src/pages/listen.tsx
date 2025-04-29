import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QRCode } from "@/components/qr-code";
import { useChatRoom } from "@/hooks/use-chat-room";
import { SpeechInput } from "@/components/speech-input";
import { LanguageSelector } from "@/components/language-selector";
import { EmojiSelector } from "@/components/emoji-selector";
import { ChatMessages } from "@/components/chat-messages";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import {
  RefreshCcw,
  Copy,
  Share2,
  X as XIcon,
  WifiOff,
  ArrowLeftRight,
  Trash2,
  Volume2,
  VolumeX,
  Loader2,
  MessageSquare,
  Headphones,
  HelpCircle
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useToast } from "@/hooks/use-toast";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { translateUIText, translateWithLanguage } from "@/lib/translations";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Declare global window properties for TypeScript
declare global {
  interface Window {
    __openAIRawTranscription: {
      sourceText: string;
      translatedText: string;
      isComplete: boolean;
      isSourceComplete?: boolean;
    };
    __speechInputTracking?: {
      isListening: boolean;
      currentLanguage: string;
      usingOpenAI: boolean;
      lastToggleTime: number;
      preventLanguageEffectTrigger: boolean;
    };
  }
}

// Helper function to get the full language code for speech synthesis
const getLanguageCode = (lang: LanguageCode) => {
  const languageCodes: Record<LanguageCode, string> = {
    en: 'en-US',
    es: 'es-ES',
    ar: 'ar-SA',
    it: 'it-IT',
    // Add other languages as needed
  };
  return languageCodes[lang] || 'en-US';
};
import { Documentation } from "@/components/documentation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

const defaultUiText = {
  roomTitle: "Room ID:",
  newRoom: "Create New Room",
  clearRoom: "Clear Room",
  clearConfirm: "Clear All Messages?",
  clearWarning: "This will permanently delete all messages in this room. This action cannot be undone.",
  cancel: "Cancel",
  confirm: "Yes, Delete All",
  joinRoom: "Join Room",
  speakNow: "Start listening to {sourceLang} to see translation",
  translating: "Translating...",
  startConversation: "Start speaking in {sourceLang} to see translation",
  playAudio: "Play Audio",
  playing: "Playing...",
  iosNotice: "📱 On iOS devices: First tap anywhere on the screen, then click the 'Play Audio' button next to the translated text",
  arabicNotice: "ℹ️ Text-to-speech may not be available on all devices. If you don't hear audio, try using a different device or browser.",
  translationSettings: "Translation Settings",
  autoPlayMatching: "Auto-play matching languages:",
  from: "From:",
  to: "To:",
  on: "On",
  off: "Off",
  enterRoomId: "Enter room ID",
  replayTranslated: "Only play target language (recommended)",
  scanToChat: "Scan to Chat With Me in",
  inputDevice: "Input Device",
  outputDevice: "Output Device",
  typeMessage: "Type your message...",
  chat: "Chat",
  listen: "Listen",
  help: "Help"
};

const turnOffMicrophone = () => {
  // Check if microphone is active
  const isMicrophoneActive = window.__speechInputTracking?.isListening;
  
  // Clear the played translation registry when turning off the mic
  // This prevents stale entries when the user starts a new session
  console.log('Resetting speech translation tracking on language/mode change');
  (window as any).__listenModePlayedTranslations = {};
  
  // Get microphone element to trigger a click if it's active
  const microphoneButton = document.querySelector('.rounded-full');
  
  // If mic is active, click it to turn it off
  if (isMicrophoneActive && microphoneButton instanceof HTMLButtonElement) {
    console.log("Turning off microphone due to language change");
    microphoneButton.click();
    return true;
  }
  return false;
};

export default function Listen() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Get room ID from URL parameters or query string
  const params = useParams();
  const urlSearchParams = new URLSearchParams(window.location.search);
  const roomIdFromQuery = urlSearchParams.get('id') || '';
  const currentRoomId = params?.id || roomIdFromQuery || '';
  const [, setLocation] = useLocation();

  // Add a session start timestamp to track when the Listen page was loaded
  const sessionStartTime = useRef(Date.now());
  
  // Reset the session timestamp when the room ID changes
  useEffect(() => {
    sessionStartTime.current = Date.now();
    console.log(`Listen page: Session start time reset to ${new Date(sessionStartTime.current).toLocaleTimeString()} for room ${currentRoomId}`);
  }, [currentRoomId]);

  const getInitialLanguages = () => {
    const deviceLang = navigator.language.split('-')[0].toLowerCase();
    if (deviceLang in supportedLanguages) {
      if (deviceLang !== 'en') {
        return {
          source: deviceLang as LanguageCode,
          target: 'en' as LanguageCode
        };
      }
      return {
        source: 'en' as LanguageCode,
        target: 'ar' as LanguageCode
      };
    }
    return {
      source: 'en' as LanguageCode,
      target: 'ar' as LanguageCode
    };
  };

  const initialLangs = getInitialLanguages();
  const [sourceLang, setSourceLang] = useState<LanguageCode>(initialLangs.source);
  const [targetLang, setTargetLang] = useState<LanguageCode>(initialLangs.target);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [currentTranslation, setCurrentTranslation] = useState<{
    sourceText: string;
    targetText: string;
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    isPartial: boolean;
  } | null>(null);
  const [uiText, setUiText] = useState(defaultUiText);
  const [showRoomOptions, setShowRoomOptions] = useState(false);
  // Default to true - only play target language (what the user requested)
  const [playTargetLanguage, setPlayTargetLanguage] = useState(true);
  const [translatedQRText, setTranslatedQRText] = useState("");
  
  // Sync playTargetLanguage state with global variable for OpenAI processing
  useEffect(() => {
    // Set the global variable that will be read by the OpenAI WebRTC component
    (window as any).__playOnlyTargetLanguage = playTargetLanguage;
    console.log(`Updated global playTargetLanguage to: ${playTargetLanguage}`);
  }, [playTargetLanguage]);
  
  // Force playTargetLanguage to be true when component mounts
  useEffect(() => {
    // Force it to be true on initial load (this is the recommended setting)
    setPlayTargetLanguage(true);
    (window as any).__playOnlyTargetLanguage = true;
    console.log('Forcing playTargetLanguage to true on initial mount');
  }, []);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showIosNotice, setShowIosNotice] = useState(false);
  const [showArabicNotice, setShowArabicNotice] = useState(false);

  const { toast } = useToast();
  const { speak, isSpeaking, isInitialized } = useSpeechSynthesis();

  const {
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
  } = useChatRoom(currentRoomId);

  // Add a state to store both room IDs
  const [roomIds, setRoomIds] = useState<{chatRoomId: string, listenRoomId: string} | null>(null);

  useEffect(() => {
    const initializeChat = async () => {
      setIsLoading(true);
      try {
        // Instead of calling clearMessages directly, which can show the toast message,
        // we'll handle local cleanup manually without the WebSocket notification
        if (currentRoomId) {
          console.log('Initializing listen room - resetting local state');
          // Clear messages in local state
          localStorage.removeItem(`messages_${currentRoomId}`);
          // No need to update server here as we'll get the latest state during connection
        }
        
        // Then load stored messages
        await loadStoredMessages();
        
        // Force reconnect to ensure we get latest messages
        if (isConnected) {
          reconnect();
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
        setError('Failed to load chat history');
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load chat history"
        });
      } finally {
        setIsLoading(false);
      }
    };

    initializeChat();

    // Load room IDs from localStorage if they exist
    const storedRoomIds = localStorage.getItem('streamflow_room_ids');
    let parsedRoomIds = null;
    
    if (storedRoomIds) {
      try {
        parsedRoomIds = JSON.parse(storedRoomIds);
        setRoomIds(parsedRoomIds);
      } catch (error) {
        console.error("Failed to parse stored room IDs:", error);
      }
    }
    
    // Update the listen room ID with the current room ID
    if (currentRoomId) {
      const updatedRoomIds = parsedRoomIds ? { 
        ...parsedRoomIds,
        listenRoomId: currentRoomId 
      } : { 
        chatRoomId: parsedRoomIds?.chatRoomId || currentRoomId,
        listenRoomId: currentRoomId
      };
      
      localStorage.setItem('streamflow_room_ids', JSON.stringify(updatedRoomIds));
      setRoomIds(updatedRoomIds);
    }
  }, [currentRoomId]);

  // Listen-specific transcript handler that focuses on target language translation
  const handleListenTranscript = async (text: string, isFinal: boolean) => {
    if (text.trim()) {
      // Check for duplicate messages in listen mode
      if (isFinal) {
        // Create a message fingerprint
        const messageKey = `${text}`;
        
        // Use a shared global cache for listen mode handler calls
        const processedHandlerCalls = (window as any).__listenModeHandlerCalls = (window as any).__listenModeHandlerCalls || {};
        
        // Create a timestamp-based key to allow messages to be processed again after 10 seconds
        // This prevents accidental blocking of legitimate repeated phrases
        const timeKey = Math.floor(Date.now() / 10000); // Changes every 10 seconds
        const dedupKey = `${messageKey}-${timeKey}`;
        
        // Check if we've seen this exact text recently in listen mode
        if (processedHandlerCalls[dedupKey]) {
          console.log(`[Listen] BLOCKING duplicate transcript handler call:`, text.substring(0, 30) + "...");
          return;
        }
        
        // Mark it as processed to prevent duplicate processing in this time window
        processedHandlerCalls[dedupKey] = true;
        console.log(`[Listen] First time handling this transcript in current time window:`, text.substring(0, 30) + "...");
      }
      
      setCurrentTranslation({
        sourceText: text,
        targetText: isFinal ? "" : "...",
        sourceLang,
        targetLang,
        isPartial: !isFinal
      });

      if (isFinal && currentRoomId) {
        try {
          await sendMessage(text, sourceLang, targetLang);
          setCurrentTranslation(null);
          
          // Access the global OpenAI raw transcription which should have the most recent translation
          const openAITranscription = window.__openAIRawTranscription;
          if (openAITranscription && openAITranscription.translatedText) {
            // Remove any "translate them" or similar phrases from the text
            const filteredText = openAITranscription.translatedText
              .replace(/translate them/gi, "")
              .replace(/translation:/gi, "")
              .replace(/translating\.{0,3}/gi, "") // Remove "translating" with or without ellipsis
              .trim();
            
            // Skip playback if the filtered text is empty or just contains ellipsis or spaces
            if (!filteredText || filteredText.trim() === "..." || filteredText.trim() === "") {
              console.log("Skipping playback for empty or placeholder text after filtering");
              return;
            }
            
            console.log("Found OpenAI translation, playing audio immediately:", filteredText.substring(0, 30) + "...");
            
            // Store this timestamp to prevent duplicate playback
            (window as any).__lastPlayedTranscriptTimestamp = Date.now();
            
            handlePlayTranslation(filteredText, targetLang, false);
          } else {
            console.log("No OpenAI translation found for immediate playback");
            // The message will still be played by the messages useEffect when the server sends it back
          }
        } catch (error) {
          console.error('Failed to send message:', error);
          toast({
            variant: "destructive",
            title: "Translation Failed",
            description: "Failed to translate and send message"
          });
        }
      }
    }
  };

  // For the Listen page, we only want to play target language translations
  const handlePlayTranslation = (text: string, lang: LanguageCode, ignoreMainSpeaker: boolean = false) => {
    if (!isInitialized) return;
    
    // Remove any "translate them" or similar phrases from the text
    const filteredText = text
      .replace(/translate them/gi, "")
      .replace(/translation:/gi, "")
      .replace(/translating\.{0,3}/gi, "") // Remove "translating" with or without ellipsis
      .trim();
    
    // Skip playback if the filtered text is empty or just contains ellipsis or spaces
    if (!filteredText || filteredText.trim() === "..." || filteredText.trim() === "") {
      console.log(`Listen page: Skipping playback for empty or placeholder text`);
      return;
    }
    
    console.log(`Listen page: PlayTranslation called: text="${filteredText.substring(0, 20)}...", lang=${lang}, ignoreMainSpeaker=${ignoreMainSpeaker}`);

    // Enable playback in Listen mode
    if (filteredText && speakerEnabled) {
      console.log(`Listen page: Playing audio in target language: ${targetLang}`);
      
      // Set the force play flag before speaking
      (window as any).__forcePlayNextUtterance = true;
      
      // Speak with proper language code
      speak(filteredText, getLanguageCode(lang), true);
      
      // Reset the flag after a small delay to ensure it's still set when the utterance is created
      setTimeout(() => {
        (window as any).__forcePlayNextUtterance = false;
      }, 100);
    } else {
      console.log(`Listen page: Playback skipped, speaker enabled: ${speakerEnabled}`);
    }
  };

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Debug logs for tracking audio issues
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  
  // Debug logging utility
  const addDebugLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(`[DEBUG] ${message}`);
  }, []);
  
  // ULTRA AGGRESSIVE FIX: COMPLETELY REPLACE THE SPEECH SYNTHESIS API
  // This is our most aggressive solution to ensure only target language is heard
  useEffect(() => {
    addDebugLog(`Setting up audio interceptor for target lang: ${targetLang}`);
    
    if ('speechSynthesis' in window) {
      // Cancel any current speech - this ensures we start with a clean slate
      window.speechSynthesis.cancel();
      
      // Store the original speak function (only if we haven't already)
      if (!(window.speechSynthesis as any)._originalSpeak) {
        (window.speechSynthesis as any)._originalSpeak = window.speechSynthesis.speak;
        addDebugLog("Original speech function stored");
      }
      const originalSpeak = (window.speechSynthesis as any)._originalSpeak;
      
      // Create a mapping for multiple language scripts
      const languageScriptPatterns = {
        'ar': { regex: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/, name: 'Arabic' },
        'zh': { regex: /[\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF\u2A700-\u2B73F\u2B740-\u2B81F\u2B820-\u2CEAF]/, name: 'Chinese' },
        'ja': { regex: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/, name: 'Japanese' },
        'ko': { regex: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/, name: 'Korean' },
        'ru': { regex: /[\u0400-\u04FF\u0500-\u052F]/, name: 'Cyrillic' },
        'he': { regex: /[\u0590-\u05FF]/, name: 'Hebrew' },
        'th': { regex: /[\u0E00-\u0E7F]/, name: 'Thai' },
        'hi': { regex: /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF]/, name: 'Indic' },
        // Default script for Latin-based languages
        'latin': { regex: /[A-Za-z\u00C0-\u00FF\u0100-\u017F\u0180-\u024F]/, name: 'Latin' }
      };
      
      // Get the appropriate language code for a detected script
      const getLanguageForScript = (text: string): { detectedLang: string, confidence: number } => {
        // Check for each script
        for (const [lang, pattern] of Object.entries(languageScriptPatterns)) {
          const matches = (text.match(pattern.regex) || []).length;
          if (matches > 0) {
            // Calculate confidence based on percentage of matching characters
            const confidence = matches / Math.max(1, text.length);
            if (confidence > 0.2) { // At least 20% of characters match the script
              return { detectedLang: lang, confidence };
            }
          }
        }
        
        // Default to Latin script
        return { detectedLang: 'en', confidence: 0.1 };
      };
      
      // COMPLETELY override the speak function 
      window.speechSynthesis.speak = function(utterance: SpeechSynthesisUtterance) {
        // First, always cancel any ongoing speech to prevent overlapping
        window.speechSynthesis.cancel();
        
        // Get the language from the utterance
        const uttLang = utterance.lang?.toLowerCase() || '';
        const targetLangCode = targetLang.toLowerCase();
        
        // Check if this is in the Listen page (where we control translation)
        const isListenPage = window.location.pathname.includes('/listen');
        
        // Force target language only mode in Listen page
        if (isListenPage) {
          (window as any).__playOnlyTargetLanguage = true;
        }
        
        // Add to debug logs
        addDebugLog(`Speech request - text: "${utterance.text.substring(0, 20)}..." lang: ${uttLang}`);
        
        // Detect script in the text
        const { detectedLang, confidence } = getLanguageForScript(utterance.text);
        
        if (detectedLang && confidence > 0.2) {
          const scriptInfo = detectedLang in languageScriptPatterns 
            ? languageScriptPatterns[detectedLang as keyof typeof languageScriptPatterns]
            : { name: detectedLang };
          addDebugLog(`Script detection: likely ${scriptInfo.name} script (confidence: ${(confidence * 100).toFixed(1)}%)`);
        }
        
        // Enable target-language-only mode by default
        if ((window as any).__playOnlyTargetLanguage === undefined) {
          (window as any).__playOnlyTargetLanguage = true;
          addDebugLog(`Setting default __playOnlyTargetLanguage = true`);
        }
        
        // Get the play target language preference
        const playOnlyTargetLanguage = (window as any).__playOnlyTargetLanguage === true;
        
        // For debugging - check if this might be a duplicate utterance
        const utteranceKey = `${uttLang}-${utterance.text.substring(0, 30)}`;
        const now = Date.now();
        const lastPlayedMap = (window as any).__lastPlayedUtterances = (window as any).__lastPlayedUtterances || {};
        const lastPlayed = lastPlayedMap[utteranceKey] || 0;
        
        if (now - lastPlayed < 1000) {
          // This is a duplicate utterance within 1 second, likely the source language repetition
          addDebugLog(`⚠️ Detected duplicate utterance within 1 second, possibly source language repetition`);
        }
        
        // Always update the last played time
        lastPlayedMap[utteranceKey] = now;
        
        // In Listen page, we want to be extra careful to prevent duplicates
        if (isListenPage && playOnlyTargetLanguage) {
          // If this is a forced play utterance, we should never block it
          if ((window as any).__forcePlayNextUtterance === true) {
            addDebugLog(`🔊 Force playing this utterance (unblocked by force flag)`);
          } 
          // Otherwise, we need to be careful about blocking only source language
          else {
            // Check if this utterance's text matches the target language script
            const textMatchesTargetScript = detectedLang === targetLangCode;
            
            // Check if we're in OpenAI mode (more aggressive filtering needed)
            const isOpenAIMode = (window as any).__openAIConnectionReady === true;
            
            // Don't block if the text matches target language script (even if it's the first utterance)
            if (!textMatchesTargetScript && isOpenAIMode) {
              // Check if this is the first utterance we've received in a short window
              const lastUtteranceTime = (window as any).__lastUtteranceTime || 0;
              const isFirstInSequence = now - lastUtteranceTime > 1500; // More than 1.5 seconds
              
              // If it's the first utterance and doesn't match target script, it's likely source language
              if (isFirstInSequence) {
                addDebugLog(`🔇 Blocking first utterance in sequence (likely source language)`);
                // Update the timestamp but block the speech
                (window as any).__lastUtteranceTime = now;
                return; // Block this utterance
              }
            }
          }
          
          // Always update the timestamp for any utterance that makes it past filtering
          (window as any).__lastUtteranceTime = now;
        }
        
        // Decide if we should play this utterance
        const shouldPlay = 
          // Check for our force play flag first
          (window as any).__forcePlayNextUtterance === true ||
          // Allow text that actually has the right language code
          uttLang.includes(targetLangCode) || 
          // Allow when script detection matches target language
          (detectedLang === targetLangCode) ||
          // If we're not in Listen page, or target-only mode is off, allow anything
          (!isListenPage || !playOnlyTargetLanguage);
        
        if (shouldPlay) {
          // Force the correct language for the utterance based on script detection
          const originalLang = utterance.lang;
          
          // Try to set the most appropriate language code
          if (detectedLang && detectedLang !== 'latin' && confidence > 0.3) {
            // If we detected a specific script with high confidence, use it
            const newLangCode = getLanguageCode(detectedLang as LanguageCode) || utterance.lang;
            if (newLangCode !== originalLang) {
              utterance.lang = newLangCode;
              addDebugLog(`Fixed language code based on script detection: ${originalLang} → ${newLangCode}`);
            }
          } else if (targetLangCode && !uttLang.includes(targetLangCode)) {
            // Otherwise use the target language
            const newLangCode = getLanguageCode(targetLang);
            utterance.lang = newLangCode;
            addDebugLog(`Fixed language code: ${originalLang} → ${newLangCode}`);
          }
          
          addDebugLog(`✓ ALLOWING speech with text "${utterance.text.substring(0, 20)}..." (lang: ${utterance.lang})`);
          originalSpeak.call(window.speechSynthesis, utterance);
        } else {
          addDebugLog(`✗ BLOCKING non-target language speech (${uttLang})`);
          // DO NOTHING - completely block the speech
        }
      };
      
      addDebugLog("Speech synthesis interceptor installed");
    }
    
    // Clean up when component unmounts or when target language changes
    return () => {
      if ('speechSynthesis' in window && (window.speechSynthesis as any)._originalSpeak) {
        addDebugLog("Restoring original speech function");
        window.speechSynthesis.speak = (window.speechSynthesis as any)._originalSpeak;
      }
    };
  }, [targetLang, addDebugLog]);
  
  // Message queue system for sequential, uninterrupted playback
  const messageQueue = useRef<{
    messages: {
      text: string;
      lang: LanguageCode;
      timestamp: number;
      played: boolean;
      id: string; // Unique ID for tracking
    }[];
    isPlaying: boolean;
    lastPlayedTimestamp: number;
  }>({
    messages: [],
    isPlaying: false,
    lastPlayedTimestamp: 0,
  });
  
  // Process the message queue in sequence
  const processMessageQueue = useCallback(() => {
    const queue = messageQueue.current;
    
    // If already playing or queue is empty, do nothing
    if (queue.isPlaying || queue.messages.length === 0) {
      return;
    }
    
    // Find the first unplayed message
    const nextMessageIndex = queue.messages.findIndex(m => !m.played);
    if (nextMessageIndex === -1) {
      // All messages have been played, clear the queue
      queue.messages = [];
      return;
    }
    
    // Mark as playing
    queue.isPlaying = true;
    
    // Get the next message
    const nextMessage = queue.messages[nextMessageIndex];
    
    // Play the message
    console.log(`Message Queue: Playing message ${nextMessageIndex + 1}/${queue.messages.length}:`, nextMessage.text.substring(0, 30) + "...");
    
    // Set a flag to force the next utterance to play, regardless of language detection
    (window as any).__forcePlayNextUtterance = true;
    
    // We need to force cancel any existing speech synthesis to ensure this plays
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    
    // Function to mark message as played and process next
    const onMessagePlayed = () => {
      // Mark this message as played
      if (queue.messages[nextMessageIndex]) {
        queue.messages[nextMessageIndex].played = true;
      }
      
      // Reset playing flag
      queue.isPlaying = false;
      
      // Update last played timestamp
      queue.lastPlayedTimestamp = Date.now();
      
      // Reset force play flag
      (window as any).__forcePlayNextUtterance = false;
      
      // Process next message after a short delay for better voice naturalness
      setTimeout(() => {
        processMessageQueue();
      }, 300);
    };
    
    // Save the original speak behavior
    const originalSpeak = speak;
    
    // Function to detect when speech has completed 
    const detectSpeechCompletion = () => {
      // Create a timeout based on text length (roughly 10-15 chars per second)
      // Add a base time and limit maximum duration
      const estimatedDuration = Math.min(
        10000, // Max 10 seconds
        700 + nextMessage.text.length * 70 // Base time + character estimate
      );
      
      console.log(`Message Queue: Setting completion timeout for ${estimatedDuration}ms`);
      
      // Set timeout to detect speech completion
      setTimeout(() => {
        if (queue.isPlaying && queue.messages[nextMessageIndex] && !queue.messages[nextMessageIndex].played) {
          console.log(`Message Queue: Speech completion detected by timeout`);
          onMessagePlayed();
        }
      }, estimatedDuration);
    };
    
    // Actually speak the text
    speak(nextMessage.text, getLanguageCode(nextMessage.lang));
    
    // Start the detection timeout
    detectSpeechCompletion();
    
  }, [speak]);
  
  // Override the speech synthesis speak method to track utterance completion
  useEffect(() => {
    if (window.speechSynthesis) {
      // Store original speak method if not already stored
      if (!(window.speechSynthesis as any).__originalSpeak) {
        (window.speechSynthesis as any).__originalSpeak = window.speechSynthesis.speak;
      }
      
      // Override the speak method
      window.speechSynthesis.speak = function(utterance: SpeechSynthesisUtterance) {
        // Add utterance end event listener
        const originalOnEnd = utterance.onend;
        utterance.onend = function(event) {
          // Call original handler if it exists
          if (originalOnEnd) {
            originalOnEnd.call(this, event);
          }
          
          // Mark the current message in queue as played
          const queue = messageQueue.current;
          if (queue.isPlaying) {
            console.log(`Speech synthesis utterance completed event fired`);
            // Find the first unplayed message
            const nextMessageIndex = queue.messages.findIndex(m => !m.played);
            if (nextMessageIndex !== -1) {
              // Mark as played
              queue.messages[nextMessageIndex].played = true;
              // Update last played timestamp
              queue.lastPlayedTimestamp = Date.now();
              // Reset playing flag
              queue.isPlaying = false;
              
              // Process next message after a short delay
              setTimeout(() => {
                processMessageQueue();
              }, 300);
            }
          }
        };
        
        // Add error handling
        const originalOnError = utterance.onerror;
        utterance.onerror = function(event) {
          // Call original handler if it exists
          if (originalOnError) {
            originalOnError.call(this, event);
          }
          
          console.log(`Speech synthesis error:`, event);
          
          // Continue the queue even on error
          const queue = messageQueue.current;
          if (queue.isPlaying) {
            // Find the first unplayed message
            const nextMessageIndex = queue.messages.findIndex(m => !m.played);
            if (nextMessageIndex !== -1) {
              // Mark as played
              queue.messages[nextMessageIndex].played = true;
              // Reset playing flag
              queue.isPlaying = false;
              
              // Process next message after a short delay
              setTimeout(() => {
                processMessageQueue();
              }, 300);
            }
          }
        };
        
        // Call the original speak method
        (window.speechSynthesis as any).__originalSpeak.call(window.speechSynthesis, utterance);
      };
    }
    
    // Cleanup
    return () => {
      if (window.speechSynthesis && (window.speechSynthesis as any).__originalSpeak) {
        window.speechSynthesis.speak = (window.speechSynthesis as any).__originalSpeak;
      }
    };
  }, []);
  
  // Set up effect to add latest messages to the queue
  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (isInitialized && latestMessage && speakerEnabled) {
      console.log("Listen page: New message detected, checking for queue:", latestMessage);
      
      // Check if the message was created after the session started
      const messageTime = new Date(latestMessage.timestamp).getTime();
      const messageTimeFormatted = new Date(messageTime).toISOString();
      const sessionStartFormatted = new Date(sessionStartTime.current).toISOString();
      
      if (messageTime < sessionStartTime.current) {
        console.log(`Listen page: Skipping message from previous session:
        - Message timestamp: ${messageTimeFormatted}
        - Session started: ${sessionStartFormatted}
        - Message text: "${latestMessage.translatedText.substring(0, 30)}..."`);
        return;
      }
      
      // In Listen mode, only play the target language translation
      if (latestMessage.targetLang === targetLang) {
        // Clean the text
        const filteredText = latestMessage.translatedText
          .replace(/translate them/gi, "")
          .replace(/translation:/gi, "")
          .replace(/translating\.{0,3}/gi, "") // Remove "translating" with or without ellipsis
          .trim();
        
        // Skip empty messages
        if (!filteredText || filteredText === "..." || filteredText === "") {
          console.log("Listen page: Skipping empty or placeholder message");
          return;
        }
        
        // Generate a unique ID for this message
        const messageId = `${latestMessage.temp_user_uuid}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        
        // Get the translation prefix for comparison
        const translationPrefix = filteredText.substring(0, Math.min(20, filteredText.length));
        
        // Check for duplicates in the queue
        const queue = messageQueue.current;
        const isDuplicateInQueue = queue.messages.some(m => 
          // Exact match
          m.text === filteredText ||
          // Contains prefix (for partial matches)
          (m.text.length >= 20 && filteredText.includes(m.text.substring(0, 20))) ||
          // Message prefix matches
          (translationPrefix.length >= 15 && m.text.includes(translationPrefix))
        );
        
        if (isDuplicateInQueue) {
          console.log("Listen page: Skipping message already in queue:", filteredText.substring(0, 30) + "...");
          return;
        }
        
        // Check against global played registry 
        const globalRegistry = (window as any).__listenModePlayedTranslations || {};
        
        // Check if we've played this exact message recently
        if (globalRegistry[filteredText] === true) {
          console.log("Listen page: Skipping recently played exact message:", filteredText.substring(0, 30) + "...");
          return;
        }
        
        // Add to global registry
        (window as any).__listenModePlayedTranslations = {
          ...globalRegistry,
          [filteredText]: true
        };
        
        // Check if this is an RTL language for special handling
        const isRTLSource = 
          /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(filteredText) || 
          /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(latestMessage.text || '');
        
        // Add to queue
        queue.messages.push({
          text: filteredText,
          lang: latestMessage.targetLang as LanguageCode,
          timestamp: Date.now(),
          played: false,
          id: messageId
        });
        
        console.log(`Message Queue: Added message to queue (${queue.messages.length} total):`, filteredText.substring(0, 30) + "...");
        
        // Process the queue
        processMessageQueue();
      }
    }
  }, [messages, speakerEnabled, isInitialized, targetLang, processMessageQueue]);

  const copyRoomId = () => {
    if (currentRoomId) {
      navigator.clipboard.writeText(currentRoomId);
      toast({
        title: "Copied!",
        description: "Room ID copied to clipboard"
      });
    }
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinRoomId.trim()) {
      setLocation(`/listen/${joinRoomId.trim()}`);
    }
  };

  const handleSwapLanguages = () => {
    // First, check if microphone is active and turn it off
    const wasMicActive = turnOffMicrophone();
    
    // Add a delay to ensure microphone is properly turned off if it was active
    // Use a slightly longer delay for more reliable cleanup
    setTimeout(() => {
      // Then swap languages
      const temp = sourceLang;
      setSourceLang(targetLang);
      setTargetLang(temp);
      setCurrentTranslation(null);
      
      // Reset speech system to ensure proper cleanup
      if (window.speechSynthesis) {
        console.log('Stopping any ongoing speech synthesis');
        window.speechSynthesis.cancel();
      }
      
      // Reset global speech tracking if it exists
      if (window.__speechInputTracking) {
        window.__speechInputTracking.preventLanguageEffectTrigger = false;
      }
      
      // Reset speech state with a small delay
      setSpeakerEnabled(false);
      setTimeout(() => setSpeakerEnabled(true), 200);
      
      // Display a toast to inform the user if the mic was active
      if (wasMicActive) {
        toast({
          title: "Languages Swapped",
          description: "Please turn on the microphone again to start speaking in the new language.",
          duration: 3000
        });
      }
    }, wasMicActive ? 800 : 0); // Increase delay for more reliable cleanup
  };

  // Function to handle source language change with microphone control
  const handleSourceLangChange = (newLang: LanguageCode) => {
    // Turn off microphone if it's active
    const wasMicActive = turnOffMicrophone();
    
    // Set the new language
    setSourceLang(newLang);
    
    // Reset speech system to ensure proper cleanup
    if (window.speechSynthesis) {
      console.log('Stopping any ongoing speech synthesis');
      window.speechSynthesis.cancel();
    }
    
    // Reset global speech tracking if it exists
    if (window.__speechInputTracking) {
      window.__speechInputTracking.preventLanguageEffectTrigger = false;
    }
    
    // Show toast if microphone was active
    if (wasMicActive) {
      // Small delay to let the language change take effect first
      setTimeout(() => {
        toast({
          title: "Language Changed",
          description: "Please turn on the microphone again to start speaking in the new language.",
          duration: 3000
        });
      }, 500);
    }
  };
  
  // Function to handle target language change with microphone control
  const handleTargetLangChange = (newLang: LanguageCode) => {
    // Turn off microphone if it's active
    const wasMicActive = turnOffMicrophone();
    
    // Set the new language
    setTargetLang(newLang);
    
    // Reset speech system to ensure proper cleanup
    if (window.speechSynthesis) {
      console.log('Stopping any ongoing speech synthesis');
      window.speechSynthesis.cancel();
    }
    
    // Reset global speech tracking if it exists
    if (window.__speechInputTracking) {
      window.__speechInputTracking.preventLanguageEffectTrigger = false;
    }
    
    // Show toast if microphone was active
    if (wasMicActive) {
      // Small delay to let the language change take effect first
      setTimeout(() => {
        toast({
          title: "Language Changed",
          description: "Please turn on the microphone again to continue.",
          duration: 3000
        });
      }, 500);
    }
  };

  const translateUI = async (lang: LanguageCode) => {
    // Get the source language display name
    const sourceLanguageName = supportedLanguages[sourceLang].english;
    
    // Create a copy of the default UI text with placeholders replaced
    const baseUiText = {
      ...defaultUiText,
      speakNow: defaultUiText.speakNow.replace("{sourceLang}", sourceLanguageName),
      startConversation: defaultUiText.startConversation.replace("{sourceLang}", sourceLanguageName)
    };
    
    if (lang === 'en') {
      setUiText(baseUiText);
      return;
    }
    
    try {
      const translations = await Promise.all(
        Object.entries(baseUiText).map(async ([key, text]) => {
          const translated = await translateUIText(text, lang);
          return [key, translated];
        })
      );
      const updatedUiText = Object.fromEntries(translations);
      setUiText(updatedUiText);
    } catch (error) {
      console.error('Failed to translate UI:', error);
      setUiText(baseUiText);
    }
  };

  // For Listen page - use target language for UI instead of source language
  useEffect(() => {
    // Use target language for UI in Listen mode
    translateUI(targetLang);
  }, [targetLang, sourceLang]);

  useEffect(() => {
    const translateQRText = async () => {
      try {
        const baseText = "Scan to Chat With Me in [LANGUAGE]";
        let translated;

        if (targetLang === 'en') {
          translated = baseText.replace('[LANGUAGE]', supportedLanguages[sourceLang].english);
        } else {
          translated = await translateWithLanguage(
            baseText.replace('[LANGUAGE]', supportedLanguages[sourceLang].english),
            targetLang,
            targetLang
          );
        }

        setTranslatedQRText(translated);
      } catch (error) {
        console.error('Failed to translate QR text:', error);
        setTranslatedQRText(`Scan to Chat With Me in ${supportedLanguages[sourceLang].english}`);
      }
    };

    translateQRText();
  }, [targetLang, sourceLang]);

  const handleSlideChange = useCallback((api: any) => { //Type any is used because CarouselApi type is not provided
    if (!api) return;

    api.on("select", () => {
      setCurrentSlide(api.selectedScrollSnap());
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-6">
          <p className="text-destructive">{error}</p>
          <Button onClick={() => window.location.reload()} className="mt-4">
            <RefreshCcw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E6F7FF] to-[#D6EBFA] p-4 md:p-6">
      <div className="container mx-auto max-w-4xl">
        {/* Main Navigation Tabs */}
        <div className="mb-6">
          <Tabs defaultValue="listen" className="w-full" onValueChange={value => {
            if (value === "chat") {
              // Use pre-created chat room ID if available
              if (roomIds?.chatRoomId) {
                setLocation(`/chat/${roomIds.chatRoomId}`);
              } else {
                // Fall back to creating a new room if needed
                const createChatRoom = async () => {
                  try {
                    const response = await apiRequest({
                      method: "POST", 
                      url: "/api/rooms", 
                      data: {},
                      on401: "throw"
                    });
                    
                    // Navigate to the new chat room with its own unique ID
                    setLocation(`/chat/${response.roomId}`);
                  } catch (error) {
                    console.error("Failed to create chat room:", error);
                    toast({
                      variant: "destructive",
                      title: "Failed to create chat room",
                      description: "Using listen room ID as fallback"
                    });
                    // Fallback to old behavior if room creation fails
                    setLocation(currentRoomId ? `/chat/${currentRoomId}` : '/chat');
                  }
                };
                
                createChatRoom();
              }
            } else if (value === "help") {
              setLocation('/help');
            }
          }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="chat">
                <MessageSquare className="h-4 w-4 mr-2" />
                {uiText.chat}
              </TabsTrigger>
              <TabsTrigger value="listen">
                <Headphones className="h-4 w-4 mr-2" />
                {uiText.listen}
              </TabsTrigger>
              <TabsTrigger value="help">
                <HelpCircle className="h-4 w-4 mr-2" />
                {uiText.help}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        
        <div className="space-y-4 md:space-y-6">
          {showIosNotice && (
            <div className="relative bg-blue-100 p-3 md:p-4 rounded-lg text-sm md:text-base">
              <button
                onClick={() => setShowIosNotice(false)}
                className="absolute top-2 right-2 p-2 text-blue-600 hover:text-blue-800 touch-manipulation"
              >
                <XIcon className="h-4 w-4" />
              </button>
              <p className="pr-8">{uiText.iosNotice}</p>
            </div>
          )}

          {showArabicNotice && targetLang === 'ar' && (
            <div className="relative bg-amber-100 p-3 md:p-4 rounded-lg text-sm md:text-base">
              <button
                onClick={() => setShowArabicNotice(false)}
                className="absolute top-2 right-2 p-2 text-amber-600 hover:text-amber-800 touch-manipulation"
              >
                <XIcon className="h-4 w-4" />
              </button>
              <p className="pr-8">{uiText.arabicNotice}</p>
            </div>
          )}

          <Card className="p-3 md:p-4 bg-blue-50 border-blue-200 shadow-sm">
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 md:gap-4">
                  <h1 className="text-xl md:text-2xl font-semibold">{uiText.roomTitle} {currentRoomId}</h1>
                  <EmojiSelector value={userEmoji} onChange={setUserEmoji} />
                </div>
                <div className="flex items-center gap-1 md:gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-2 md:p-3 touch-manipulation"
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/rooms', {
                          method: 'POST'
                        });
                        const data = await response.json();
                        setLocation(`/listen/${data.roomId}`);
                      } catch (error) {
                        console.error('Failed to create room:', error);
                        toast({
                          variant: "destructive",
                          title: "Error",
                          description: "Failed to create a new room"
                        });
                      }
                    }}
                  >
                    <RefreshCcw className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{uiText.clearConfirm}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {uiText.clearWarning}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{uiText.cancel}</AlertDialogCancel>
                        <AlertDialogAction onClick={clearMessages}>
                          {uiText.confirm}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowRoomOptions(!showRoomOptions)}
                  >
                    {showRoomOptions ? <XIcon className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {showRoomOptions && (
                <div className="space-y-3 md:space-y-4 pt-2">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <form onSubmit={joinRoom} className="flex gap-2">
                        <Input
                          value={joinRoomId}
                          onChange={(e) => setJoinRoomId(e.target.value)}
                          placeholder={uiText.enterRoomId}
                          className="flex-1"
                        />
                        <Button type="submit" disabled={!joinRoomId.trim()}>
                          {uiText.joinRoom}
                        </Button>
                      </form>
                    </div>
                    <Button variant="outline" size="icon" onClick={copyRoomId}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <QRCode
                      value={`${window.location.origin}/listen/${currentRoomId}`}
                      title={translatedQRText}
                      className="w-[120px] h-[120px]"
                    />
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">
                        {translatedQRText}
                      </p>
                    </div>
                  </div>

                  {!isConnected && !isConnecting && (
                    <div className="flex items-center justify-between p-4 bg-destructive/10 rounded-lg">
                      <div className="flex items-center gap-2 text-destructive">
                        <WifiOff className="h-5 w-5" />
                        <span>Disconnected from chat room</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={reconnect}
                        className="gap-2"
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Retry Connection
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="p-4 shadow-sm bg-blue-50 border-blue-200">
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <h2 className="text-lg font-semibold">{uiText.translationSettings}</h2>
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={playTargetLanguage}
                        onCheckedChange={setPlayTargetLanguage}
                        id="play-target-lang"
                      />
                      <label
                        htmlFor="play-target-lang"
                        className="text-sm text-muted-foreground whitespace-nowrap"
                      >
                        {uiText.replayTranslated}
                      </label>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSpeakerEnabled(!speakerEnabled)}
                            className={cn(
                              "transition-colors",
                              speakerEnabled ? "text-primary" : "text-muted-foreground"
                            )}
                          >
                            {speakerEnabled ? (
                              <Volume2 className="h-4 w-4" />
                            ) : (
                              <VolumeX className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>{uiText.autoPlayMatching} {speakerEnabled ? uiText.on : uiText.off}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <LanguageSelector
                      value={sourceLang}
                      onChange={handleSourceLangChange}
                      label={uiText.from}
                      placeholder="Source language"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <LanguageSelector
                        value={targetLang}
                        onChange={handleTargetLangChange}
                        label={uiText.to}
                        placeholder="Target language"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleSwapLanguages}
                      className="mt-6"
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <div className="space-y-8">
              <SpeechInput
                onTranscriptChange={handleListenTranscript}
                language={sourceLang}
                targetLanguage={targetLang}
                uiText={{
                  speakNow: uiText.speakNow,
                  inputDevice: uiText.inputDevice,
                  outputDevice: uiText.outputDevice,
                  typeMessage: uiText.typeMessage
                }}
              />

              {/* Listen page version of ChatMessages - showing only target language translations */}
              <div className="space-y-4 rounded-lg bg-blue-100/50 p-4 backdrop-blur-sm shadow-inner border border-blue-200">
                <h2 className="text-xl font-semibold text-center">
                  {messages.length > 0 ? 'Translations' : uiText.startConversation}
                </h2>
                
                {messages.length > 0 ? (
                  <div className="space-y-4 max-h-[400px] overflow-y-auto">
                    {messages.map((msg, index) => (
                      <div key={index} className="flex flex-col p-3 rounded-lg bg-blue-200 shadow-sm relative">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-lg">{msg.user_emoji || '🔊'}</span>
                          <span className="text-sm text-muted-foreground">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-foreground font-medium">{msg.translatedText}</p>
                        <div className="absolute top-2 right-2">
                          {/* MODIFIED: Removed play button in Listen mode */}
                          {/* No audio playback allowed in Listen mode */}
                          {/* 
                            {speakerEnabled && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                className="h-6 w-6 rounded-full"
                                onClick={() => handlePlayTranslation(
                                  msg.translatedText, 
                                  msg.targetLang as LanguageCode,
                                  true
                                )}
                              >
                                <Volume2 className="h-3 w-3" />
                              </Button>
                            )}
                          */}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center p-8 text-muted-foreground">
                    {uiText.startConversation}
                  </div>
                )}
                
                {/* Current translation in progress */}
                {currentTranslation && (
                  <div className="flex flex-col p-3 rounded-lg bg-blue-100 border border-blue-300 shadow-sm">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-lg">{userEmoji}</span>
                      <span className="text-sm text-muted-foreground">
                        {new Date().toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      {currentTranslation.targetText}
                      {currentTranslation.isPartial && (
                        <span className="inline-block animate-pulse ml-1">...</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Debug logs section (only visible in development) */}
          <Collapsible className="mt-4 border rounded-lg">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full flex justify-between p-2">
                <span>Debug Logs (Audio Filter)</span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-3 bg-gray-50 max-h-60 overflow-auto text-xs font-mono">
                {debugLogs.length === 0 ? (
                  <p className="text-muted-foreground">No debug logs available.</p>
                ) : (
                  <ul className="space-y-1">
                    {debugLogs.map((log, i) => (
                      <li key={i} className={
                        log.includes("ALLOWING") ? "text-green-600" : 
                        log.includes("BLOCKING") ? "text-red-600" : "text-gray-700"
                      }>
                        {log}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
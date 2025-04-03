import { useState, useEffect, useCallback } from "react";
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
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  startConversation: "Start listening to {sourceLang} to see translation",
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
  replayTranslated: "Play my translated words",
  scanToChat: "Scan to Chat With Me in",
  inputDevice: "Input Device",
  outputDevice: "Output Device",
  typeMessage: "Type your message...",
  chat: "Chat",
  listen: "Listen",
  help: "Help"
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
  const [playTargetLanguage, setPlayTargetLanguage] = useState(false);
  const [translatedQRText, setTranslatedQRText] = useState("");
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

  useEffect(() => {
    const initializeChat = async () => {
      setIsLoading(true);
      try {
        await loadStoredMessages();
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
  }, [currentRoomId]);

  // Listen-specific transcript handler that focuses on target language translation
  const handleListenTranscript = async (text: string, isFinal: boolean) => {
    if (text.trim()) {
      setCurrentTranslation({
        sourceText: text,
        targetText: isFinal ? "" : "Translating...",
        sourceLang,
        targetLang,
        isPartial: !isFinal
      });

      if (isFinal && currentRoomId) {
        try {
          await sendMessage(text, sourceLang, targetLang);
          setCurrentTranslation(null);
          
          // Automatically play the target language translation
          // We'll let the useEffect for new messages handle the speech
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

    // If ignoreMainSpeaker is true, this is a manual play request from the message button
    // or it's specifically being called to play ONLY the target language
    if (ignoreMainSpeaker) {
      // For Listen page, we'll only play the target language
      if (lang === targetLang) {
        speak(text, lang);
      }
      return;
    }

    // Only auto-play if speaker is enabled
    // In Listen mode, we ONLY want to play target language translations
    if (speakerEnabled) {
      // Always prioritize target language in Listen mode
      if (lang === targetLang) {
        speak(text, lang);
      }
      // We never play source language in Listen mode
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
      // Cancel any current speech
      window.speechSynthesis.cancel();
      
      // Store the original speak function
      const originalSpeak = window.speechSynthesis.speak;
      (window.speechSynthesis as any)._originalSpeak = originalSpeak;
      
      // COMPLETELY override the speak function
      window.speechSynthesis.speak = function(utterance: SpeechSynthesisUtterance) {
        // Get the language from the utterance
        const uttLang = utterance.lang?.toLowerCase() || '';
        const targetLangCode = targetLang.toLowerCase();
        
        // Add to debug logs
        addDebugLog(`Speech request - text: "${utterance.text.substring(0, 20)}..." lang: ${uttLang}`);
        
        // ONLY allow if it explicitly matches target language
        if (uttLang.includes(targetLangCode)) {
          addDebugLog(`✓ ALLOWING target language speech (${uttLang})`);
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
  
  // Play only the most recent translation in target language
  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (isInitialized && latestMessage && speakerEnabled) {
      addDebugLog(`Message received - Text: "${latestMessage.translatedText.substring(0, 20)}..." Lang: ${latestMessage.targetLang}`);
      
      // Cancel any ongoing speech
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        addDebugLog('Cancelled any ongoing speech');
      }
      
      // Delay to ensure cancellation completes
      setTimeout(() => {
        // Verify this is a target language message
        if (latestMessage.targetLang === targetLang) {
          addDebugLog(`✓ Attempting to play target language message`);
          
          // Create utterance manually with explicit target language
          const utterance = new SpeechSynthesisUtterance(latestMessage.translatedText);
          utterance.lang = getLanguageCode(targetLang as LanguageCode);
          utterance.rate = 1;
          utterance.pitch = 1;
          
          // Add event handlers for debugging
          utterance.onstart = () => addDebugLog('Speech started');
          utterance.onend = () => addDebugLog('Speech completed');
          utterance.onerror = (e) => addDebugLog(`Speech error: ${e.error}`);
          
          addDebugLog(`Configured utterance with language: ${utterance.lang}`);
          
          // Play using direct SpeechSynthesis API
          try {
            window.speechSynthesis.speak(utterance);
            addDebugLog('Speech synthesis started');
          } catch (error) {
            addDebugLog(`Failed to start speech: ${error}`);
          }
        } else {
          addDebugLog(`✗ Skipped non-target language message`);
        }
      }, 300);
    } else {
      if (!isInitialized) addDebugLog('Speech synthesis not initialized');
      if (!speakerEnabled) addDebugLog('Speaker is disabled');
    }
  }, [messages, speakerEnabled, isInitialized, targetLang, addDebugLog]);

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
    const temp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(temp);
    setCurrentTranslation(null);
    setSpeakerEnabled(false);
    setTimeout(() => setSpeakerEnabled(true), 100);
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
              setLocation(currentRoomId ? `/chat/${currentRoomId}` : '/chat');
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
                      onChange={setSourceLang}
                      label={uiText.from}
                      placeholder="Source language"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <LanguageSelector
                        value={targetLang}
                        onChange={setTargetLang}
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
                      {currentTranslation.targetText || uiText.translating}
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
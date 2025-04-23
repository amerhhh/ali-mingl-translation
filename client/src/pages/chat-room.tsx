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
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
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
  speakNow: "Start speaking to translate",
  translating: "Translating...",
  startConversation: "Start speaking to translate",
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

export default function ChatRoom() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Get room ID from URL parameters or query string
  const params = useParams();
  const urlSearchParams = new URLSearchParams(window.location.search);
  const roomIdFromQuery = urlSearchParams.get('id') || '';
  const currentRoomId = params?.id || roomIdFromQuery || '';
  const [, setLocation] = useLocation();

  // Initialize global variables for cross-component communication
  useEffect(() => {
    (window as any).__playTargetLanguage = playTargetLanguage; // Initialize with current state value
  }, []);

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
  // Add a ref to track which messages have been played
  const playedMessageIds = useRef<Set<string>>(new Set());
  // Track when a new message is added to accurately detect NEW messages
  const messagesLengthRef = useRef(0);

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

  const handleTranscript = async (text: string, isFinal: boolean) => {
    console.log(`handleTranscript called with text: "${text?.substring(0, 30)}...", isFinal: ${isFinal}, roomId: ${currentRoomId}`);
    
    if (text.trim()) {
      // Update the UI immediately with the current transcription
      setCurrentTranslation({
        sourceText: text,
        targetText: isFinal ? "" : "Translating...",
        sourceLang,
        targetLang,
        isPartial: !isFinal
      });

      // Process final transcriptions
      if (isFinal && currentRoomId) {
        console.log(`Processing final transcript: "${text?.substring(0, 30)}..." for room ${currentRoomId}`);
        
        try {
          // For OpenAI or WebSpeech transcriptions, check if we have a complete translation
          let existingTranslation = undefined;
          let isUsingWebSpeech = false; // Track if this is a WebSpeech translation
          
          // Check our global window object for translation data (works for both OpenAI and WebSpeech)
          if (window.__openAIRawTranscription && 
              window.__openAIRawTranscription.sourceText === text &&
              window.__openAIRawTranscription.translatedText &&
              window.__openAIRawTranscription.translatedText !== 'Translating...') {
            console.log("Using existing translation from window.__openAIRawTranscription");
            existingTranslation = window.__openAIRawTranscription.translatedText;
            
            // Check if we're in WebSpeech mode to set appropriate formatting
            isUsingWebSpeech = !(window as any).__speechInputTracking?.usingOpenAI;
            
            // Additional debug logging to verify the data
            console.log("Translation data from window object:", {
              sourceText: window.__openAIRawTranscription.sourceText,
              translatedText: window.__openAIRawTranscription.translatedText,
              isComplete: window.__openAIRawTranscription.isComplete,
              isSourceComplete: window.__openAIRawTranscription.isSourceComplete,
              isWebSpeech: isUsingWebSpeech
            });
          } 
          // For backward compatibility, also check the older format
          else if ((window as any).__lastOpenAIMessage && 
              (window as any).__lastOpenAIMessage.text === text) {
            console.log("Using existing OpenAI translation from __lastOpenAIMessage");
            existingTranslation = (window as any).__lastOpenAIMessage.translatedText;
          }
          
          if (existingTranslation) {
            // Try to send the message with the existing translation
            // Always set isOpenAI=true for both WebSpeech and OpenAI modes with translations
            // This ensures the UI consistently shows both source and translation
            await sendMessage(
              text, 
              sourceLang, 
              targetLang,
              existingTranslation
            );
          } else {
            console.log("Sending message for translation");
            // Regular send which will trigger translation
            await sendMessage(text, sourceLang, targetLang);
          }
          
          // Reset currentTranslation after sending
          setCurrentTranslation(null);
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

  const handlePlayTranslation = useCallback((text: string, lang: LanguageCode) => {
    if (!isInitialized) return;

    console.log(`PlayTranslation called: text="${text.substring(0, 20)}...", lang=${lang}`);

    // Always stop any currently playing audio first
    if (window.speechSynthesis) {
      console.log('Cancelling any ongoing speech synthesis');
      window.speechSynthesis.cancel();
    }
    
    // Set the speaking state to prevent multiple simultaneous playbacks
    setSpeakerEnabled(false);
    
    // Slight delay to ensure cancel is processed
    setTimeout(() => {
      console.log(`Playing text in ${lang}: "${text.substring(0, 20)}..."`);
      speak(text, lang, true);
      
      // Re-enable the speaker after a short delay to prevent rapid clicks
      setTimeout(() => {
        setSpeakerEnabled(true);
      }, 500);
    }, 100);
  }, [isInitialized, speak]);

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    
    // Check if this is actually a new message by comparing with our previous length
    const isNewMessage = messages.length > messagesLengthRef.current;
    messagesLengthRef.current = messages.length; // Update the ref
    
    // Only play NEW message audio when we're not already speaking and speaker is enabled
    if (isInitialized && latestMessage && speakerEnabled && !isSpeaking && isNewMessage) {
      // Check if this is an OpenAI translation
      const isOpenAIMessage = latestMessage.isOpenAI === true;
      
      // Create a unique message ID to track if this message has been played
      const messageId = `${latestMessage.temp_user_uuid}-${latestMessage.timestamp}`;
      const hasBeenPlayed = playedMessageIds.current.has(messageId);
      
      // Log for debugging
      console.log("Latest message for auto-play consideration:", {
        text: latestMessage.text.substring(0, 20),
        isOpenAI: latestMessage.isOpenAI, 
        sourceLang: latestMessage.sourceLang,
        targetLang: latestMessage.targetLang,
        isSpeaking: isSpeaking,
        speakerEnabled: speakerEnabled,
        playTargetLanguage: playTargetLanguage,
        hasBeenPlayed: hasBeenPlayed,
        messageId: messageId,
        isNewMessage: isNewMessage
      });
      
      // Skip audio playback for messages that have already been played
      if (hasBeenPlayed) {
        console.log('Skipping auto audio playback for already played message');
        return;
      }
      
      // Skip audio playback for OpenAI translations in Chat mode if we don't want auto-play
      if (isOpenAIMessage && window.location.pathname.includes('/chat') && !playTargetLanguage) {
        console.log('Skipping auto audio playback for OpenAI translation in Chat mode');
        return;
      }
      
      // For automatic playback, decide which message to play based on playTargetLanguage
      setTimeout(() => {
        // Only play if we're still not speaking (in case user clicked a different message)
        if (!isSpeaking) {
          if (playTargetLanguage && latestMessage.targetLang === targetLang) {
            console.log(`Auto-playing target language message: ${latestMessage.targetLang}`);
            // Mark this message as played
            playedMessageIds.current.add(messageId);
            handlePlayTranslation(latestMessage.translatedText, latestMessage.targetLang as LanguageCode);
          } else if (!playTargetLanguage && latestMessage.targetLang === sourceLang) {
            console.log(`Auto-playing source language message: ${latestMessage.sourceLang}`);
            // Mark this message as played
            playedMessageIds.current.add(messageId);
            handlePlayTranslation(latestMessage.translatedText, latestMessage.targetLang as LanguageCode);
          }
        }
      }, 100);
    }
  }, [messages, isInitialized, speakerEnabled, isSpeaking, playTargetLanguage, targetLang, sourceLang, handlePlayTranslation]);

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
      setLocation(`/chat/${joinRoomId.trim()}`);
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
    if (lang === 'en') {
      setUiText(defaultUiText);
      return;
    }
    try {
      const translations = await Promise.all(
        Object.entries(defaultUiText).map(async ([key, text]) => {
          const translated = await translateUIText(text, lang);
          return [key, translated];
        })
      );
      const updatedUiText = Object.fromEntries(translations);
      setUiText(updatedUiText);
    } catch (error) {
      console.error('Failed to translate UI:', error);
      setUiText(defaultUiText);
    }
  };

  useEffect(() => {
    translateUI(sourceLang);
  }, [sourceLang]);

  // Set playTargetLanguage as global variable when it changes
  useEffect(() => {
    (window as any).__playTargetLanguage = playTargetLanguage;
    console.log(`Updated global playTargetLanguage to: ${playTargetLanguage}`);
  }, [playTargetLanguage]);

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
    <div className="min-h-screen bg-gradient-to-b from-[#F2F0FF] to-[#EDEDED] p-4 md:p-6">
      <div className="container mx-auto max-w-4xl">
        {/* Main Navigation Tabs */}
        <div className="mb-6">
          <Tabs defaultValue="chat" className="w-full" onValueChange={value => {
            if (value === "listen") {
              setLocation(currentRoomId ? `/listen/${currentRoomId}` : '/listen');
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

          <Card className="p-3 md:p-4">
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
                        setLocation(`/chat/${data.roomId}`);
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
                      value={`${window.location.origin}/chat/${currentRoomId}`}
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
            <Card className="p-4 shadow-lg bg-white">
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <h2 className="text-lg font-semibold">{uiText.translationSettings}</h2>
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={playTargetLanguage}
                        onCheckedChange={(checked) => {
                          // When toggling this feature, reset the played messages tracking
                          // So new messages will play with the new setting
                          setPlayTargetLanguage(checked);
                          
                          // When turning ON the feature, mark all existing messages as "played"
                          // This prevents replaying old messages when toggle is turned on
                          if (checked) {
                            console.log("Play my translated words enabled - only new messages will be played");
                            // Mark all existing messages as played to avoid replaying them
                            messages.forEach(msg => {
                              const msgId = `${msg.temp_user_uuid}-${msg.timestamp}`;
                              playedMessageIds.current.add(msgId);
                            });
                          }
                        }}
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
                onTranscriptChange={handleTranscript}
                language={sourceLang}
                targetLanguage={targetLang}
                uiText={{
                  speakNow: uiText.speakNow,
                  inputDevice: uiText.inputDevice,
                  outputDevice: uiText.outputDevice,
                  typeMessage: uiText.typeMessage
                }}
              />

              <ChatMessages
                messages={messages.map((msg) => ({
                  sourceText: msg.text,
                  targetText: msg.translatedText,
                  sourceLang: msg.sourceLang as LanguageCode,
                  targetLang: msg.targetLang as LanguageCode,
                  timestamp: new Date(msg.timestamp),
                  userEmoji: msg.user_emoji,
                  isCurrentUser: msg.temp_user_uuid === userId,
                  temp_user_uuid: msg.temp_user_uuid,
                  isOpenAI: msg.isOpenAI || (msg.text !== msg.translatedText)
                }))}
                currentTranslation={currentTranslation && !isSpeaking ? {
                  ...currentTranslation,
                  userEmoji,
                  temp_user_uuid: userId
                } : undefined}
                onPlayTranslation={(text, lang) =>
                  handlePlayTranslation(
                    text,
                    lang
                  )
                }
                isSpeaking={isSpeaking}
                uiText={uiText}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
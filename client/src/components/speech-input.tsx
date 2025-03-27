import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import { useOpenAISpeechRecognition } from "@/hooks/use-openai-speech-recognition";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useEffect, useRef, useState } from "react";
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
  const lastSentText = useRef("");
  const { toast } = useToast();

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
      console.log("Translation received:", { sourceText, translatedText });
      
      // Check if we're in the Listen page by looking at the URL
      const isListenPage = window.location.pathname.includes('/listen');
      
      // For Listen page, we handle it differently to ensure only target language audio
      if (isListenPage && sourceText && translatedText) {
        // The OpenAI hook has already stored the translation in window.__latestOpenAITranslation
        // Now we send the source text through the normal channel for consistent messaging
        onTranscriptChange(sourceText, true);
        
        // Additional logging for debugging
        console.log("Listen mode: Will only play target language:", translatedText);
      } 
      // For Chat page, we handle as before
      else if (sourceText) {
        onTranscriptChange(sourceText, true);
      }
    }
  });

  // Combine the device lists
  const combinedDevices = devices.length ? devices : openAIDevices;
  
  // Determine the active state based on which API is being used
  const isListening = useOpenAI ? isListeningOpenAI : isListeningWebSpeech;
  const transcriptResult = useOpenAI ? openAITranscript : webSpeechTranscript;
  const error = useOpenAI ? openAIError : webSpeechError;
  
  // Load stored device preferences
  useEffect(() => {
    const storedMicId = localStorage.getItem('selectedMicId');
    const storedSpeakerId = localStorage.getItem('selectedSpeakerId');
    const storedUseOpenAI = localStorage.getItem('useOpenAI');
    if (storedMicId) setSelectedMicId(storedMicId);
    if (storedSpeakerId) setSelectedSpeakerId(storedSpeakerId);
    if (storedUseOpenAI !== null) setUseOpenAI(storedUseOpenAI === 'true');
  }, []);

  // Save device preferences
  useEffect(() => {
    if (selectedMicId) localStorage.setItem('selectedMicId', selectedMicId);
    if (selectedSpeakerId) localStorage.setItem('selectedSpeakerId', selectedSpeakerId);
    localStorage.setItem('useOpenAI', String(useOpenAI));
  }, [selectedMicId, selectedSpeakerId, useOpenAI]);

  // Handle language changes
  useEffect(() => {
    if (isListening) {
      setIsResetting(true);
      
      // Stop the appropriate listening mechanism
      if (useOpenAI) {
        stopListeningOpenAI();
      } else {
        stopListeningWebSpeech();
      }
      
      setTimeout(() => {
        if (useOpenAI) {
          resetOpenAITranscript();
        } else {
          resetWebSpeechTranscript();
        }
        lastSentText.current = "";
        setIsResetting(false);
      }, 100);
    }
  }, [language, stopListeningWebSpeech, resetWebSpeechTranscript, stopListeningOpenAI, resetOpenAITranscript, useOpenAI]);

  // Handle transcript updates
  useEffect(() => {
    const currentText = transcriptResult.finalText + (transcriptResult.interimText ? ' ' + transcriptResult.interimText : '');

    if (currentText.trim() && currentText !== lastSentText.current) {
      lastSentText.current = currentText;
      onTranscriptChange(currentText, transcriptResult.isFinal);

      if (transcriptResult.isFinal) {
        if (useOpenAI) {
          resetOpenAITranscript();
        } else {
          resetWebSpeechTranscript();
        }
        lastSentText.current = "";
      }
    }
  }, [transcriptResult, onTranscriptChange, resetWebSpeechTranscript, resetOpenAITranscript, useOpenAI]);

  const handleToggle = async () => {
    try {
      if (isListening) {
        // Stop the appropriate listening mechanism
        if (useOpenAI) {
          await stopListeningOpenAI();
          resetOpenAITranscript();
        } else {
          await stopListeningWebSpeech();
          resetWebSpeechTranscript();
        }
        lastSentText.current = "";
      } else if (!isResetting && !isConnecting) {
        // Start the appropriate listening mechanism
        if (useOpenAI) {
          await startListeningOpenAI();
        } else {
          await startListeningWebSpeech();
        }
      }
    } catch (err) {
      console.error('Error toggling microphone:', err);
      toast({
        title: "Error",
        description: `Failed to start speech recognition: ${err instanceof Error ? err.message : 'Unknown error'}`,
        variant: "destructive"
      });
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
    if (isListening) {
      // Stop current listening before switching
      if (useOpenAI) {
        stopListeningOpenAI();
      } else {
        stopListeningWebSpeech();
      }
    }
    setUseOpenAI(!useOpenAI);
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
            isListening 
              ? "bg-green-500 hover:bg-green-600" 
              : "bg-destructive hover:bg-destructive/90"
          }`}
        >
          {isConnecting ? (
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          ) : isListening ? (
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
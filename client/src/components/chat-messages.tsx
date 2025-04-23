import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, formatRelative } from "date-fns";
import { Volume2, Loader2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LanguageCode } from "@shared/schema";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { memo } from 'react';

interface ChatMessage {
  sourceText: string;
  targetText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  timestamp: Date;
  userEmoji: string;
  isCurrentUser: boolean;
  temp_user_uuid: string;
  isOpenAI?: boolean;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  currentTranslation?: {
    sourceText: string;
    targetText: string;
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    userEmoji: string;
    temp_user_uuid: string;
    isPartial: boolean;
  };
  onPlayTranslation: (text: string, lang: LanguageCode) => void;
  isSpeaking: boolean;
  uiText: {
    iosNotice: string;
    arabicNotice: string;
    playAudio: string;
    playing: string;
    translating: string;
    startConversation: string;
  };
}

const Message = memo(({ message, onPlayTranslation, isSpeaking }: {
  message: ChatMessage,
  onPlayTranslation: (text: string, lang: LanguageCode) => void,
  isSpeaking: boolean
}) => {
  const isCurrentUser = message.isCurrentUser === true;
  const isArabic = message.sourceLang === 'ar' || message.targetLang === 'ar';
  
  // Add a click handler that forces audio playback
  const handlePlayAudio = () => {
    // Even if this is an OpenAI message, we'll allow it to be played manually
    // This way users can still hear the translation if they choose to
    console.log(`Playing message audio: "${message.targetText.substring(0, 20)}..." in language ${message.targetLang}`);
    
    // Force any running speech to stop first
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    
    // Call with the third parameter as true to indicate this is a manual playback
    onPlayTranslation(message.targetText, message.targetLang);
  };

  return (
    <div className={cn(
      "flex w-full gap-2 mb-4",
      isCurrentUser ? "flex-row-reverse" : "flex-row"
    )}>
      <div className="flex-shrink-0 text-2xl w-8 h-8 flex items-center justify-center">
        {message.userEmoji}
      </div>
      <div className={cn(
        "max-w-[80%] rounded-2xl p-3 border shadow-sm",
        isCurrentUser
          ? "bg-[#67a9d1] border-[#5590b3] text-white rounded-tr-none"
          : "bg-[#98c98b] border-[#7ba36f] text-white rounded-tl-none",
        isArabic && "text-lg leading-relaxed text-arabic"
      )}>
        <div className="space-y-2">
          <p className={cn(
            "break-words",
            message.sourceLang === 'ar' && "text-right direction-rtl text-arabic"
          )}>{message.sourceText}</p>
          <Separator className="my-2 bg-white/20" />
          <div className="space-y-2">
            <p className={cn(
              "text-sm break-words",
              message.targetLang === 'ar' && "text-right direction-rtl text-lg leading-relaxed text-arabic"
            )}>{message.targetText}</p>
            <div className="flex items-center justify-between">
              <time className="text-xs text-white/80">
                {formatRelative(message.timestamp, new Date())}
              </time>
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePlayAudio}
                className="transition-colors hover:bg-white/10 touch-manipulation p-2 text-white"
              >
                {isSpeaking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

Message.displayName = 'Message';

export function ChatMessages({
  messages,
  currentTranslation,
  onPlayTranslation,
  isSpeaking,
  uiText
}: ChatMessagesProps) {
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const hasArabicMessages = messages.some(msg => msg.targetLang === 'ar') || currentTranslation?.targetLang === 'ar';

  // Group messages by user and date
  const groupedMessages: ChatMessage[][] = [];
  let currentGroup: ChatMessage[] = [];
  let previousUser = '';
  let previousDate = '';

  messages.forEach((message, index) => {
    const messageDate = formatRelative(
      message.timestamp,
      new Date()
    ).split(' at ')[0];
    
    // Start a new group if user or date changes
    if (
      message.temp_user_uuid !== previousUser ||
      messageDate !== previousDate
    ) {
      if (currentGroup.length > 0) {
        groupedMessages.push([...currentGroup]);
      }
      currentGroup = [message];
    } else {
      currentGroup.push(message);
    }

    previousUser = message.temp_user_uuid;
    previousDate = messageDate;

    // For the last message
    if (index === messages.length - 1) {
      groupedMessages.push([...currentGroup]);
    }
  });

  return (
    <ScrollArea className="h-[500px] w-full rounded-lg border bg-white">
      <div className="p-4 space-y-4">
        {/* iOS Audio Notice */}
        {isiOS && (
          <Card className="p-4 bg-blue-500/10 border-blue-500/20">
            <p className="text-sm text-muted-foreground">{uiText.iosNotice}</p>
          </Card>
        )}

        {/* Arabic Support Notice */}
        {isiOS && hasArabicMessages && (
          <Card className="p-4 bg-yellow-500/10 border-yellow-500/20">
            <p className="text-sm text-muted-foreground">{uiText.arabicNotice}</p>
          </Card>
        )}

        {/* Current Translation */}
        {currentTranslation && !isSpeaking && (
          <Message
            message={{
              sourceText: currentTranslation.sourceText,
              targetText: currentTranslation.targetText + (currentTranslation.isPartial ? "▋" : ""),
              sourceLang: currentTranslation.sourceLang,
              targetLang: currentTranslation.targetLang,
              timestamp: new Date(),
              userEmoji: currentTranslation.userEmoji,
              isCurrentUser: true,
              temp_user_uuid: currentTranslation.temp_user_uuid
            }}
            onPlayTranslation={onPlayTranslation}
            isSpeaking={false} 
          />
        )}

        {/* Message History */}
        {messages.length > 0 ? (
          groupedMessages.map((group, groupIndex) => (
            <div key={groupIndex} className="space-y-2">
              {group.map((message, messageIndex) => {
                const isSource = message.sourceLang === message.targetLang;
                const showEmoji = messageIndex === 0;
                
                // Special rendering for OpenAI messages
                if (message.isOpenAI) {
                  return (
                    <div className={cn(
                      "flex w-full gap-2 mb-4",
                      message.isCurrentUser ? "flex-row-reverse" : "flex-row"
                    )}>
                      <div className="flex-shrink-0 text-2xl w-8 h-8 flex items-center justify-center">
                        {message.userEmoji}
                      </div>
                      <div className={cn(
                        "max-w-[80%] rounded-2xl p-3 border shadow-sm",
                        message.isCurrentUser
                          ? "bg-[#67a9d1] border-[#5590b3] text-white rounded-tr-none"
                          : "bg-[#98c98b] border-[#7ba36f] text-white rounded-tl-none",
                        message.sourceLang === 'ar' && "text-lg leading-relaxed text-arabic"
                      )}>
                        <div className="space-y-2">
                          <p className={cn(
                            "break-words",
                            message.sourceLang === 'ar' && "text-right direction-rtl text-arabic"
                          )}>{message.sourceText}</p>
                          <Separator className="my-2 bg-white/20" />
                          <div className="space-y-2">
                            <p className={cn(
                              "text-sm break-words",
                              message.targetLang === 'ar' && "text-right direction-rtl text-lg leading-relaxed text-arabic"
                            )}>{message.targetText}</p>
                            <div className="flex items-center justify-between">
                              <time className="text-xs text-white/80">
                                {formatRelative(message.timestamp, new Date())}
                              </time>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-white/80">Translation</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => onPlayTranslation(message.targetText, message.targetLang)}
                                  disabled={isSpeaking}
                                  className="transition-colors hover:bg-white/10 touch-manipulation p-2 text-white"
                                >
                                  {isSpeaking ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Volume2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                return (
                  <div
                    key={`${message.temp_user_uuid}-${messageIndex}`}
                    className={`flex ${
                      message.isCurrentUser ? 'justify-end' : 'justify-start'
                    } items-start gap-2`}
                  >
                    {showEmoji && !message.isCurrentUser && (
                      <div className="mt-4 text-2xl select-none">{message.userEmoji}</div>
                    )}
                    <div className={`max-w-[80%] space-y-1`}>
                      <Card
                        className={`p-3 ${
                          isSource
                            ? 'bg-gray-100'
                            : message.isCurrentUser
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-gray-100'
                        } rounded-lg`}
                      >
                        <div className="text-sm">
                          <p className="whitespace-pre-wrap break-words">{
                            isSource ? message.sourceText : message.targetText
                          }</p>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <div className="text-xs text-muted-foreground">
                            {formatRelative(message.timestamp, new Date())}
                          </div>
                          {!isSource && (
                            <button
                              onClick={() => onPlayTranslation(message.targetText, message.targetLang)}
                              disabled={isSpeaking}
                              className={`${
                                message.isCurrentUser
                                  ? 'text-primary-foreground hover:text-primary-foreground/90'
                                  : 'text-muted-foreground hover:text-foreground'
                              } p-1 rounded`}
                              title={uiText.playAudio}
                            >
                              {isSpeaking ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Volume2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </Card>
                    </div>
                    {showEmoji && message.isCurrentUser && (
                      <div className="mt-4 text-2xl select-none">{message.userEmoji}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <Card className="p-8 text-center text-muted-foreground">
            {currentTranslation ? uiText.translating : uiText.startConversation}
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { Volume2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LanguageCode } from "@shared/schema";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { memo } from 'react';

interface Message {
  sourceText: string;
  targetText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  timestamp: Date;
  userEmoji: string;
  isCurrentUser: boolean;
  temp_user_uuid?: string;
}

interface ChatMessagesProps {
  messages: Message[];
  currentTranslation?: {
    sourceText: string;
    targetText: string;
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    isPartial: boolean;
    userEmoji: string;
    temp_user_uuid?: string;
  };
  onPlayTranslation: (text: string, lang: LanguageCode) => void;
  isSpeaking?: boolean;
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
  message: Message,
  onPlayTranslation: (text: string, lang: LanguageCode) => void,
  isSpeaking?: boolean
}) => {
  const isCurrentUser = message.isCurrentUser === true;
  const isArabic = message.sourceLang === 'ar' || message.targetLang === 'ar';

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
                {format(message.timestamp, 'h:mm a')}
              </time>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onPlayTranslation(message.targetText, message.targetLang)}
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

export function ChatMessages({ messages, currentTranslation, onPlayTranslation, isSpeaking, uiText }: ChatMessagesProps) {
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const hasArabicMessages = messages.some(msg => msg.targetLang === 'ar') || currentTranslation?.targetLang === 'ar';

  // Sort messages by timestamp, newest first
  const sortedMessages = [...messages].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

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
        {sortedMessages.length > 0 ? (
          sortedMessages.map((message) => (
            <Message
              key={`${message.temp_user_uuid}-${message.timestamp.getTime()}`}
              message={message}
              onPlayTranslation={onPlayTranslation}
              isSpeaking={isSpeaking}
            />
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
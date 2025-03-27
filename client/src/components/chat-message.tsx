import React from 'react';
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { type UserEmoji } from "@shared/schema";
import { Separator } from "@/components/ui/separator";

interface ChatMessageProps {
  text: string;
  translatedText: string;
  isCurrentUser: boolean;
  userEmoji: UserEmoji;
  timestamp: string;
}

export function ChatMessage({ text, translatedText, isCurrentUser, userEmoji, timestamp }: ChatMessageProps) {
  return (
    <div className={cn(
      "flex w-full gap-2 mb-4",
      "flex-row"
    )}>
      <div className="flex-shrink-0 text-2xl w-8 h-8 flex items-center justify-center">
        {userEmoji}
      </div>
      <Card className={cn(
        "max-w-[80%] p-3 shadow-sm",
        isCurrentUser ? "bg-primary text-primary-foreground" : "bg-muted"
      )}>
        {/* Always display both source and translated text on separate lines */}
        <p className={cn(
          "mb-1",
          isCurrentUser ? "text-primary-foreground" : "text-foreground",
          text.length > 40 ? "text-sm" : "text-base" // Adjust size for long messages
        )}>
          {text}
        </p>
        {translatedText !== text && (
          <>
            <Separator className={cn(
              "my-1", 
              isCurrentUser ? "bg-primary-foreground/20" : "bg-foreground/20"
            )} />
            <p className={cn(
              "opacity-90",
              isCurrentUser ? "text-primary-foreground" : "text-foreground",
              translatedText.length > 40 ? "text-xs" : "text-sm" // Adjust size for long translations
            )}>
              {translatedText}
            </p>
          </>
        )}
        <time className="text-xs opacity-50 block mt-2">
          {new Date(timestamp).toLocaleTimeString()}
        </time>
      </Card>
    </div>
  );
}
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { availableEmojis, type UserEmoji } from "@shared/schema";

interface EmojiSelectorProps {
  value: UserEmoji;
  onChange: (emoji: UserEmoji) => void;
}

export function EmojiSelector({ value, onChange }: EmojiSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-10 p-0">
          {value}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="grid grid-cols-4 gap-2 p-2">
        {availableEmojis.map((emoji) => (
          <Button
            key={emoji}
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => onChange(emoji)}
          >
            {emoji}
          </Button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

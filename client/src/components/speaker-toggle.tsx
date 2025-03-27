import { Button } from "@/components/ui/button";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpeakerToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function SpeakerToggle({ enabled, onChange }: SpeakerToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => onChange(!enabled)}
      className={cn(
        "transition-colors",
        enabled ? "text-primary" : "text-muted-foreground"
      )}
    >
      {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </Button>
  );
}
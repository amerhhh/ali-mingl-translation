import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

interface AudioPlayerProps {
  isPlaying: boolean;
  onVolumeChange?: (volume: number) => void;
  onStop?: () => void;
}

export function AudioPlayer({ isPlaying, onVolumeChange, onStop }: AudioPlayerProps) {
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Update speech synthesis volume when volume changes
  useEffect(() => {
    if (onVolumeChange) {
      onVolumeChange(isMuted ? 0 : volume);
    }
  }, [volume, isMuted, onVolumeChange]);

  // Stop speech synthesis when component unmounts
  useEffect(() => {
    return () => {
      if (onStop) {
        onStop();
      }
    };
  }, [onStop]);

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0]);
    if (value[0] > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (onVolumeChange) {
      onVolumeChange(!isMuted ? 0 : volume);
    }
  };

  return (
    <div className="flex items-center gap-4 p-2 rounded-lg bg-muted/30">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleMute}
        className="h-8 w-8"
      >
        {isMuted ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </Button>

      <div className="flex-1">
        <Slider
          value={[isMuted ? 0 : volume]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={handleVolumeChange}
          className="w-full"
          aria-label="Volume"
        />
      </div>

      {isPlaying && (
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-4 bg-primary animate-pulse rounded-full" />
          <span className="w-1.5 h-4 bg-primary animate-pulse rounded-full [animation-delay:0.2s]" />
          <span className="w-1.5 h-4 bg-primary animate-pulse rounded-full [animation-delay:0.4s]" />
        </div>
      )}
    </div>
  );
}

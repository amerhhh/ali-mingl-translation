import { QRCodeSVG } from "qrcode.react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface QRCodeProps {
  value: string;
  onClose?: () => void;
  title?: string;
  className?: string;
}

export function QRCode({ value, onClose, title, className }: QRCodeProps) {
  return (
    <Card className="p-4 relative">
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {title && (
        <h3 className="text-lg font-semibold mb-4 text-center">{title}</h3>
      )}

      <div className="flex justify-center p-4 bg-white rounded-lg">
        <QRCodeSVG
          value={value}
          size={className ? undefined : 200}
          level="H"
          includeMargin
          className={cn("mx-auto", className)}
        />
      </div>

      <p className="mt-4 text-sm text-muted-foreground text-center break-all">
        {value}
      </p>
    </Card>
  );
}
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Users, Copy, ChevronDown, ChevronUp, MessageSquare, Headphones, HelpCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QRCode } from "@/components/qr-code";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  const [, setLocation] = useLocation();
  const [joinRoomId, setJoinRoomId] = useState("");
  const [myRoomId, setMyRoomId] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const { toast } = useToast();

  // Create a room when the page loads
  useEffect(() => {
    const createInitialRoom = async () => {
      try {
        const response = await apiRequest({
          method: "POST", 
          url: "/api/rooms", 
          data: {},
          on401: "throw"
        });
        
        setMyRoomId(response.roomId);
        // Automatically join the room
        setLocation(`/chat?id=${response.roomId}`);
      } catch (error) {
        console.error("Failed to create initial room:", error);
        toast({
          variant: "destructive",
          title: "Failed to create room",
          description: "Please refresh the page to try again"
        });
      }
    };

    createInitialRoom();
  }, [toast, setLocation]);

  const joinRoom = (e: React.FormEvent, mode: 'chat' | 'listen' = 'chat') => {
    e.preventDefault();
    if (joinRoomId.trim()) {
      setLocation(`/${mode}?id=${joinRoomId.trim()}`);
    }
  };

  const copyRoomId = () => {
    if (myRoomId) {
      navigator.clipboard.writeText(myRoomId);
      toast({
        title: "Copied!",
        description: "Room ID copied to clipboard"
      });
    }
  };

  const shareUrl = myRoomId ? `${window.location.origin}/chat?id=${myRoomId}` : '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto py-12 px-4">
        <div className="max-w-2xl mx-auto space-y-8">
          <h1 className="text-4xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
            Real-time Translation Chat
          </h1>
          
          {/* Main Navigation Tabs */}
          <div>
            <Tabs defaultValue="chat" className="w-full" onValueChange={value => {
              if (value === "listen") {
                if (myRoomId) {
                  setLocation(`/listen?id=${myRoomId}`);
                } else {
                  setLocation("/listen");
                }
              } else if (value === "help") {
                if (myRoomId) {
                  setLocation(`/help?id=${myRoomId}`);
                } else {
                  setLocation("/help");
                }
              }
            }}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="chat">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="listen">
                  <Headphones className="h-4 w-4 mr-2" />
                  Listen
                </TabsTrigger>
                <TabsTrigger value="help">
                  <HelpCircle className="h-4 w-4 mr-2" />
                  Help
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="space-y-8">
            {myRoomId ? (
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">Room ID:</p>
                      <p className="text-2xl font-mono">{myRoomId}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={copyRoomId}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between"
                    onClick={() => setShowQR(!showQR)}
                  >
                    <span>QR Code</span>
                    {showQR ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>

                  {showQR && (
                    <div className="pt-2">
                      <QRCode
                        value={shareUrl}
                        title="Scan to Join Chat"
                      />
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <Card className="p-6">
                <div className="flex items-center justify-center">
                  <p className="text-muted-foreground">Creating your chat room...</p>
                </div>
              </Card>
            )}

            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Users className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-semibold">Join Another Room</h2>
              </div>
              <form className="space-y-4">
                <Input
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  placeholder="Enter room ID"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    onClick={(e) => joinRoom(e, 'chat')} 
                    className="w-full" 
                    disabled={!joinRoomId.trim()}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Join Chat
                  </Button>
                  <Button 
                    onClick={(e) => joinRoom(e, 'listen')} 
                    className="w-full" 
                    disabled={!joinRoomId.trim()}
                    variant="outline"
                  >
                    <Headphones className="h-4 w-4 mr-2" />
                    Join Listen
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
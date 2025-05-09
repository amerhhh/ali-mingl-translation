import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Users, Copy, ChevronDown, ChevronUp, MessageSquare, Headphones, HelpCircle, Loader2, Mic } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QRCode } from "@/components/qr-code";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  const [, setLocation] = useLocation();
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const { toast } = useToast();
  
  // Interface for storing both chat and listen room IDs
  interface RoomIds {
    chatRoomId: string;
    listenRoomId: string;
  }
  
  // Store room IDs as a state for use in navigation
  const [roomIds, setRoomIds] = useState<RoomIds | null>(null);

  useEffect(() => {
    // Always create new rooms when landing on the home page
    createNewRooms();
  }, []);
  
  // We'll no longer automatically navigate to chat room
  // This allows us to see the home page with test options
  useEffect(() => {
    // Only run this if we want to automatically navigate to chat (disabled for testing)
    // if (roomIds?.chatRoomId) {
    //   setLocation(`/chat/${roomIds.chatRoomId}`);
    // }
  }, [roomIds, setLocation]);

  // Create both chat and listen room IDs at once
  const createNewRooms = async () => {
    try {
      setIsCreatingRoom(true);
      
      // Create chat room ID
      const chatResponse = await apiRequest({
        method: "POST",
        url: "/api/rooms",
        data: {},
        on401: "throw",
      });
      
      // Create listen room ID
      const listenResponse = await apiRequest({
        method: "POST",
        url: "/api/rooms",
        data: {},
        on401: "throw",
      });
      
      // Ensure chat and listen IDs are different
      if (chatResponse.roomId === listenResponse.roomId) {
        // If by chance they are the same, create another listen room
        const newListenResponse = await apiRequest({
          method: "POST",
          url: "/api/rooms",
          data: {},
          on401: "throw",
        });
        
        // Store both room IDs
        const newRoomIds: RoomIds = {
          chatRoomId: chatResponse.roomId,
          listenRoomId: newListenResponse.roomId
        };
        
        localStorage.setItem('streamflow_room_ids', JSON.stringify(newRoomIds));
        setRoomIds(newRoomIds);
      } else {
        // Store both room IDs
        const newRoomIds: RoomIds = {
          chatRoomId: chatResponse.roomId,
          listenRoomId: listenResponse.roomId
        };
        
        localStorage.setItem('streamflow_room_ids', JSON.stringify(newRoomIds));
        setRoomIds(newRoomIds);
      }
    } catch (error) {
      console.error("Room creation failed:", error);
      toast({
        variant: "destructive",
        title: "Room Creation Failed",
        description: "Unable to create new room. Please try again."
      });
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinRoomId.trim()) {
      setLocation(`/chat/${joinRoomId}`);
    }
  };

  const copyRoomId = () => {
    if (roomIds?.chatRoomId) {
      navigator.clipboard.writeText(roomIds.chatRoomId);
      toast({
        title: "Room ID Copied",
        description: "Room ID has been copied to clipboard."
      });
    }
  };

  const shareUrl = roomIds?.chatRoomId ? `${window.location.origin}/chat/${roomIds.chatRoomId}` : '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto py-12 px-4">
        <div className="max-w-2xl mx-auto space-y-8">
          <h1 className="text-4xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
            Real-time Translation Chat
          </h1>
          
          {/* Loading indicator while creating rooms */}
          {isCreatingRoom && (
            <Card className="p-6">
              <div className="flex items-center justify-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-muted-foreground">Creating your chat rooms...</p>
              </div>
            </Card>
          )}
          
          {/* Main Navigation Tabs */}
          <div>
            <Tabs defaultValue="chat" className="w-full" onValueChange={value => {
              if (value === "chat") {
                // Navigate to chat with pre-created chat room ID
                if (roomIds?.chatRoomId) {
                  setLocation(`/chat/${roomIds.chatRoomId}`);
                } else {
                  setLocation("/chat");
                }
              } else if (value === "listen") {
                // Navigate to listen with pre-created listen room ID
                if (roomIds?.listenRoomId) {
                  setLocation(`/listen/${roomIds.listenRoomId}`);
                } else {
                  setLocation("/listen");
                }
              } else if (value === "whisper") {
                setLocation('/whisper-test');
              } else if (value === "help") {
                setLocation('/help');
              }
            }}>
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="chat">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="listen">
                  <Headphones className="h-4 w-4 mr-2" />
                  Listen
                </TabsTrigger>
                <TabsTrigger value="whisper">
                  <Mic className="h-4 w-4 mr-2" />
                  Whisper Test
                </TabsTrigger>
                <TabsTrigger value="help">
                  <HelpCircle className="h-4 w-4 mr-2" />
                  Help
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="space-y-8">
            {roomIds?.chatRoomId ? (
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">Room ID:</p>
                      <p className="text-2xl font-mono">{roomIds.chatRoomId}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={copyRoomId}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between"
                  >
                    <span>QR Code</span>
                  </Button>

                  <div className="pt-2">
                    <QRCode
                      value={shareUrl}
                      title="Scan to Join Chat"
                    />
                  </div>
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
                <Button 
                  onClick={joinRoom} 
                  className="w-full" 
                  disabled={!joinRoomId.trim()}
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Join Chat
                </Button>
              </form>
            </Card>
            
            {/* Whisper Test Feature */}
            <Card className="p-6 space-y-4 border-2 border-primary/20">
              <div className="flex items-center gap-3">
                <Mic className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-semibold">Test New Features</h2>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Try our new speech-to-text feature powered by OpenAI's Whisper model.
                </p>
                <Button 
                  onClick={() => setLocation('/whisper-test')}
                  className="w-full bg-primary/90 hover:bg-primary"
                >
                  <Mic className="h-4 w-4 mr-2" />
                  Test Whisper Speech-to-Text
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
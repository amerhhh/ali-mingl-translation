import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Volume2, VolumeX, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LanguageSelector } from "@/components/language-selector";
import { LanguageCode } from "@shared/schema";
import { useIsMobile } from "@/hooks/use-mobile";
import axios from "axios";

export default function RealtimeTranscribe() {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [translation, setTranslation] = useState("");
  const [sourceLang, setSourceLang] = useState<LanguageCode>("en");
  const [targetLang, setTargetLang] = useState<LanguageCode>("es");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const { toast } = useToast();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isMobile = useIsMobile();
  
  // Used for cleanup
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    try {
      setIsConnecting(true);
      
      // 1. Create a session that will connect to our server (not directly to OpenAI)
      const sessionResponse = await axios.post('/api/openai/realtime-session', {
        sourceLang,
        targetLang
      });
      
      if (!sessionResponse.data || !sessionResponse.data.success === false) {
        throw new Error(sessionResponse.data.message || "Failed to get session details");
      }
      
      // Get session ID - we'll use this to identify this streaming session
      const serverSessionId = sessionResponse.data.sessionId;
      console.log("Got server session ID:", serverSessionId);
      
      // 2. Get user media for audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // 3. Create a WebSocket connection to our server with the correct URL
      // Construct proper WebSocket URL based on current location
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host; // Includes hostname and port if any
      const wsUrl = `${protocol}//${host}/ws`;
      console.log("Connecting to WebSocket at:", wsUrl);
      
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;
      
      // Create a unique client session ID for this recording session
      const clientSessionId = `realtime-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      
      // 4. Handle WebSocket events
      socket.onopen = () => {
        console.log("WebSocket connection established with server");
        
        // Send initial join message with session info
        socket.send(JSON.stringify({
          type: 'realtime_join',
          sessionId: serverSessionId,
          clientSessionId: clientSessionId,
          sourceLang: sourceLang,
          targetLang: targetLang
        }));
        
        // Start recording once socket is open
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        
        // Buffer to store audio chunks
        let audioChunks: BlobPart[] = [];
        
        // Collect audio data when available
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
            
            // When we have enough data, send it as a chunk
            if (audioChunks.length >= 1) { // Send each chunk immediately for low latency
              const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
              audioChunks = []; // Clear the chunks
              
              // Convert blob to base64
              const reader = new FileReader();
              reader.readAsDataURL(audioBlob);
              
              reader.onloadend = () => {
                const base64data = reader.result as string;
                const base64Audio = base64data.split(',')[1]; // Remove the data URL prefix
                
                // Send audio data to server with metadata
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({
                    type: 'whisper_stream',
                    audio: base64Audio,
                    language: sourceLang,
                    requestId: `whisper-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    targetLang: targetLang
                  }));
                }
              };
            }
          }
        };
        
        // Set timeslice to 250ms for frequent data transmission
        mediaRecorder.start(250);
        
        setIsListening(true);
        setIsConnecting(false);
        
        toast({
          title: "Connected to Server",
          description: "Speech recognition is now active. Start speaking.",
        });
      };
      
      // Handle messages from the server
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received message:", data);
          
          // Handle different message types
          if (data.type === "whisper_result") {
            // Update transcript with the transcription result
            if (data.transcription && data.transcription.trim()) {
              setTranscript(data.transcription);
              
              // If we have a target language different from source, request translation
              if (targetLang !== sourceLang) {
                // Server will handle translation and send it back
                socket.send(JSON.stringify({
                  type: 'translate_request',
                  text: data.transcription,
                  sourceLang: sourceLang,
                  targetLang: targetLang,
                  requestId: data.requestId
                }));
              }
            }
          } else if (data.type === "translation_result") {
            // Update translation with the result
            if (data.translation && data.translation.trim()) {
              setTranslation(data.translation);
            }
          } else if (data.type === "error" || data.type === "whisper_error") {
            console.error("Transcription error:", data.error);
            toast({
              variant: "destructive",
              title: "Transcription Error",
              description: data.error || "Error processing audio",
            });
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };
      
      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Failed to connect to transcription service",
        });
        stopRecording();
      };
      
      socket.onclose = () => {
        console.log("WebSocket connection closed");
        stopRecording();
      };
      
    } catch (error) {
      console.error("Error starting real-time transcription:", error);
      setIsConnecting(false);
      setIsListening(false);
      
      toast({
        variant: "destructive",
        title: "Transcription Failed",
        description: error instanceof Error ? error.message : "Could not start speech recognition",
      });
      
      // Clean up if there was an error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  };
  
  const stopRecording = () => {
    // Stop MediaRecorder if it exists
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    // Close WebSocket if it exists
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    // Stop all tracks in the stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsListening(false);
    setIsConnecting(false);
  };
  
  const toggleRecording = () => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  
  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);
  
  const toggleAudio = () => {
    setAudioEnabled(!audioEnabled);
  };
  
  const clearTranscript = () => {
    setTranscript("");
    setTranslation("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 py-8">
      <div className="container max-w-3xl mx-auto px-4 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Real-time OpenAI Transcription</h1>
          <p className="text-muted-foreground">
            Speak continuously and see real-time transcription and translation
          </p>
        </div>
        
        <Card className="p-6 shadow-lg">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Source Language</label>
              <LanguageSelector
                value={sourceLang}
                onChange={setSourceLang}
                disabled={isListening || isConnecting}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Target Language</label>
              <LanguageSelector
                value={targetLang}
                onChange={setTargetLang}
                disabled={isListening || isConnecting}
              />
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="relative">
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Your speech will appear here..."
                className="min-h-[120px] font-medium text-lg resize-none"
                readOnly
              />
              <div className="absolute top-2 right-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={clearTranscript}
                  disabled={isConnecting || (!transcript && !translation)}
                >
                  Clear
                </Button>
              </div>
            </div>
            
            {translation && (
              <div>
                <h3 className="text-sm font-medium mb-2">Translation:</h3>
                <div className="p-4 bg-muted rounded-md text-lg">
                  {translation || "Translation will appear here..."}
                </div>
              </div>
            )}
            
            <div className="flex justify-center gap-4 pt-4">
              <Button
                size="lg"
                variant={isListening ? "destructive" : "default"}
                className={`w-40 h-16 ${
                  isListening ? "bg-red-500 hover:bg-red-600" : ""
                }`}
                onClick={toggleRecording}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : isListening ? (
                  <>
                    <MicOff className="h-5 w-5 mr-2" />
                    Stop
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5 mr-2" />
                    Start Recording
                  </>
                )}
              </Button>
              
              <Button
                size="lg"
                variant="outline"
                className="w-14 h-16"
                onClick={toggleAudio}
              >
                {audioEnabled ? (
                  <Volume2 className="h-5 w-5" />
                ) : (
                  <VolumeX className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </Card>
        
        <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
          <h2 className="font-semibold mb-2">About this feature</h2>
          <p className="text-sm text-muted-foreground">
            This experimental feature uses OpenAI's real-time transcription API for continuous speech recognition. 
            Unlike the previous Whisper implementation, this allows for true real-time streaming transcription 
            with immediate feedback as you speak without requiring you to stop recording.
          </p>
        </div>
      </div>
    </div>
  );
}
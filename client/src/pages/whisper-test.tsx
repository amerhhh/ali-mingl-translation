import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LanguageSelector } from "@/components/language-selector";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import { Mic, StopCircle, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

export default function WhisperTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [liveIndicator, setLiveIndicator] = useState<string>("");
  
  // WebSocket connection for real-time streaming
  const wsRef = useRef<WebSocket | null>(null);
  
  // Media recorder for capturing audio
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestIdCounterRef = useRef<number>(0);
  
  const { toast } = useToast();

  // Function to connect to WebSocket for streaming
  const connectWebSocket = useCallback(() => {
    try {
      setIsConnecting(true);
      
      // Close existing connection if any
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      
      // Determine WebSocket protocol based on page protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      console.log(`Connecting to WebSocket at ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      // WebSocket event handlers
      ws.onopen = () => {
        console.log('WebSocket connection established');
        setIsConnecting(false);
        toast({
          title: "Connected to streaming server",
          description: "Ready for real-time transcription"
        });
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle Whisper transcription results
          if (data.type === 'whisper_result') {
            const { transcription, requestId } = data;
            
            if (transcription && transcription.trim()) {
              // Update the transcription
              setTranscription((prev) => {
                // Add space between text if needed
                const needsSpace = prev.length > 0 && 
                  !prev.endsWith(' ') && 
                  !prev.endsWith('.') && 
                  !prev.endsWith('?') && 
                  !prev.endsWith('!') && 
                  !prev.endsWith('\n');
                
                return prev + (needsSpace ? ' ' : '') + transcription.trim();
              });
              
              // Show typing-like animation for live indicator
              setLiveIndicator("");
            }
          }
          
          // Handle errors
          if (data.type === 'whisper_error') {
            console.error('Whisper error:', data.error);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnecting(false);
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Failed to connect to transcription server"
        });
      };
      
      ws.onclose = () => {
        console.log('WebSocket connection closed');
        setIsConnecting(false);
      };
      
      return ws;
    } catch (error) {
      console.error('Error setting up WebSocket:', error);
      setIsConnecting(false);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Failed to connect to transcription server"
      });
      return null;
    }
  }, [toast]);

  // Clean up function to stop recording and close connections
  const cleanupRecording = useCallback(() => {
    // Clear any ongoing timers
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Stop and clean up media recorder
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (err) {
          console.error("Error stopping media recorder:", err);
        }
      }
      
      // Release the microphone by stopping all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
    
    // Close WebSocket connection
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    
    // Reset state
    setIsRecording(false);
    setLiveIndicator("");
  }, []);

  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, [cleanupRecording]);

  // Setup typing indicator animation
  useEffect(() => {
    let dotCount = 0;
    let typingTimer: number | null = null;
    
    if (isRecording) {
      typingTimer = window.setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        const dots = '.'.repeat(dotCount);
        setLiveIndicator(dots);
      }, 300);
    }
    
    return () => {
      if (typingTimer) {
        clearInterval(typingTimer);
      }
    };
  }, [isRecording]);

  // Function to process audio chunks via WebSocket
  const processAudioViaWebSocket = useCallback((audioBlob: Blob) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not open, reconnecting...');
      connectWebSocket();
      return;
    }
    
    // Get the next request ID
    const requestId = `whisper-${Date.now()}-${requestIdCounterRef.current++}`;
    
    // Skip if the blob is too small (likely silence)
    if (audioBlob.size < 100) {
      return;
    }
    
    // Convert Blob to base64 and send via WebSocket
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1]; // Remove the "data:audio/webm;base64," part
      
      // Send to WebSocket server
      wsRef.current?.send(JSON.stringify({
        type: 'whisper_stream',
        audio: base64Data,
        language,
        requestId
      }));
    };
    reader.readAsDataURL(audioBlob);
  }, [language, connectWebSocket]);

  // Function to start streaming audio for real-time transcription
  const startStreamingAudio = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    
    // Use a very short interval (50ms) for truly real-time streaming
    timerRef.current = window.setInterval(() => {
      if (!isRecording || audioChunksRef.current.length === 0) return;
      
      // Create a blob from the current audio chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      
      // Clear the audio chunks immediately so new ones can be collected
      audioChunksRef.current = [];
      
      // Process via WebSocket without blocking the UI
      setTimeout(() => {
        processAudioViaWebSocket(audioBlob);
      }, 0);
      
    }, 50); // Ultra-short interval for true streaming
  }, [isRecording, processAudioViaWebSocket]);

  // Function to request microphone access and start recording
  const startRecording = useCallback(async () => {
    try {
      // Reset state
      setTranscription("");
      audioChunksRef.current = [];
      
      // Connect to WebSocket first
      const ws = connectWebSocket();
      if (!ws) {
        throw new Error("Failed to connect to transcription server");
      }
      
      // Request microphone access with optimized settings
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        } 
      });
      
      streamRef.current = stream;
      
      // Create a new MediaRecorder with the stream using optimized settings
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = mediaRecorder;
      
      // Add event listeners for data availability
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Configure the media recorder to deliver data extremely frequently
      mediaRecorder.start(50); // Get data every 50ms for true streaming experience
      
      // Start the streaming audio process immediately
      startStreamingAudio();
      
      setIsRecording(true);
      
      toast({
        title: "Streaming Started",
        description: "Speak now - transcription will appear as you speak",
      });
    } catch (error) {
      console.error("Error starting streaming:", error);
      toast({
        variant: "destructive",
        title: "Streaming Error",
        description: "Could not access your microphone or connect to server",
      });
    }
  }, [toast, connectWebSocket, startStreamingAudio]);

  // Function to stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Clean up timer
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      // Process any remaining chunks
      if (audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        processAudioViaWebSocket(audioBlob);
        audioChunksRef.current = [];
      }
      
      // Stop all audio tracks to release the microphone
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      toast({
        title: "Streaming Stopped",
        description: "Final transcription displayed",
      });
    }
  }, [isRecording, toast, processAudioViaWebSocket]);

  // Reset the transcription
  const resetTranscription = useCallback(() => {
    setTranscription("");
    toast({
      title: "Transcription Reset",
      description: "The transcription has been cleared.",
    });
  }, [toast]);

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6 text-center">Real-Time Streaming Transcription</h1>
      
      <Card className="p-6 mb-6">
        <div className="flex flex-col space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Language:</label>
            <LanguageSelector
              value={language}
              onChange={setLanguage}
              placeholder="Select language"
              disabled={isRecording}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Select the language you'll be speaking in (helps improve accuracy)
            </p>
          </div>
          
          <div className="flex justify-center gap-3 mt-4">
            {!isRecording ? (
              <Button 
                onClick={startRecording}
                disabled={isConnecting}
                className="flex items-center space-x-2 bg-primary hover:bg-primary/90 text-white"
                size="lg"
              >
                {isConnecting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Mic size={20} />
                )}
                <span>{isConnecting ? "Connecting..." : "Start Streaming Transcription"}</span>
              </Button>
            ) : (
              <Button 
                onClick={stopRecording}
                variant="destructive"
                className="flex items-center space-x-2"
                size="lg"
              >
                <StopCircle size={20} />
                <span>Stop Recording</span>
              </Button>
            )}
            
            <Button 
              onClick={resetTranscription}
              variant="outline"
              className="flex items-center space-x-2"
              disabled={!transcription || isConnecting}
            >
              <RotateCcw size={16} />
              <span>Reset</span>
            </Button>
          </div>
        </div>
      </Card>
      
      <Card className="p-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold">Live Transcription:</h2>
          {isRecording && (
            <div className="flex items-center space-x-2 text-sm text-primary animate-pulse">
              <Wand2 className="h-4 w-4 animate-pulse" />
              <span>Listening{liveIndicator}</span>
            </div>
          )}
        </div>
        
        {isConnecting ? (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">Connecting to transcription service...</span>
          </div>
        ) : (
          <div className="min-h-[200px] p-4 border border-border rounded-md">
            {transcription ? (
              <p className="whitespace-pre-wrap">{transcription}</p>
            ) : (
              <p className="text-muted-foreground text-center italic">
                {isRecording 
                  ? "Start speaking to see transcription..." 
                  : "Click 'Start Streaming Transcription' and begin speaking"}
              </p>
            )}
          </div>
        )}
      </Card>
      
      <div className="mt-6 text-sm text-muted-foreground">
        <p>This feature uses WebSockets and OpenAI's Whisper model for true streaming transcription.</p>
        <p>The transcription appears in real-time as you speak - no need to pause or stop recording.</p>
        <p className="font-medium mt-2">Tips for better transcription:</p>
        <ul className="list-disc list-inside ml-2">
          <li>Speak clearly at a normal pace</li>
          <li>Use a good quality microphone</li>
          <li>Reduce background noise when possible</li>
          <li>Start with short phrases to see immediate results</li>
        </ul>
      </div>
    </div>
  );
}
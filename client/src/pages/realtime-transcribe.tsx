import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LanguageSelector } from "@/components/language-selector";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import { Mic, StopCircle, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";

export default function RealtimeTranscribe() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  
  // WebSocket connection for real-time streaming
  const wsRef = useRef<WebSocket | null>(null);
  
  // Media recorder for capturing audio
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  
  const { toast } = useToast();

  // Function to create a real-time transcription session with OpenAI
  const createTranscriptionSession = useCallback(async () => {
    try {
      setIsConnecting(true);
      
      // Request a new session from our API
      const response = await axios.post('/api/realtime-transcription');
      
      if (!response.data.success || !response.data.session) {
        throw new Error("Failed to create transcription session");
      }
      
      const { sessionId, socket_url, client_secret } = response.data.session;
      
      console.log(`Created real-time transcription session: ${sessionId}`);
      sessionIdRef.current = sessionId;
      
      // Connect to the WebSocket
      const ws = new WebSocket(socket_url);
      wsRef.current = ws;
      
      // Set up WebSocket event handlers
      ws.onopen = () => {
        console.log('OpenAI Transcription WebSocket connected');
        
        // Authenticate the session
        ws.send(JSON.stringify({
          type: "auth",
          client_secret
        }));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle different message types from OpenAI
          if (data.type === "auth_success") {
            console.log('Successfully authenticated with OpenAI streaming session');
            setIsConnecting(false);
            
            // Show a success toast
            toast({
              title: "Connected to OpenAI",
              description: "Real-time transcription is ready",
              duration: 3000
            });
          } 
          else if (data.type === "transcript") {
            // Handle transcription results
            const text = data.text || "";
            const isFinal = data.is_final || false;
            
            if (text && text.trim()) {
              console.log(`Transcription${isFinal ? ' (final)' : ''}: "${text}"`);
              
              // Update the transcription
              setTranscription((prev) => {
                if (isFinal) {
                  // For final results, add to the accumulated text
                  const needsSpace = prev.length > 0 && 
                    !prev.endsWith(' ') && 
                    !prev.endsWith('.') && 
                    !prev.endsWith('?') && 
                    !prev.endsWith('!') && 
                    !prev.endsWith('\n');
                  
                  return prev + (needsSpace ? ' ' : '') + text;
                } else {
                  // For interim results, just show the latest text
                  return text;
                }
              });
            }
          }
          else if (data.type === "error") {
            console.error('OpenAI WebSocket error:', data.error);
            toast({
              variant: "destructive",
              title: "Transcription Error",
              description: data.error || "Error processing audio"
            });
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('OpenAI WebSocket error:', error);
        setIsConnecting(false);
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Failed to connect to transcription service"
        });
      };
      
      ws.onclose = (event) => {
        console.log(`OpenAI WebSocket closed: ${event.code} ${event.reason}`);
        setIsConnecting(false);
        
        // Auto-reconnect if we were still recording
        if (isRecording) {
          console.log('Reconnecting to OpenAI WebSocket...');
          setTimeout(() => {
            createTranscriptionSession();
          }, 1000);
        }
      };
      
      return true;
    } catch (error) {
      console.error('Error creating transcription session:', error);
      setIsConnecting(false);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Failed to create transcription session"
      });
      return false;
    }
  }, [toast, isRecording]);

  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Close audio processing
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      
      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // Stop media recorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      // Release microphone
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Function to start recording and streaming audio
  const startRecording = useCallback(async () => {
    try {
      // Reset state
      setTranscription("");
      
      // Create transcription session first
      const sessionCreated = await createTranscriptionSession();
      if (!sessionCreated) {
        throw new Error("Failed to create transcription session");
      }
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        } 
      });
      
      streamRef.current = stream;
      
      // Create audio context and processor
      const audioContext = new AudioContext({
        sampleRate: 16000, // OpenAI's expected sample rate
      });
      audioContextRef.current = audioContext;
      
      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create processor node
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      // Connect the audio pipeline
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Process audio data in real-time
      processor.onaudioprocess = (e) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // Get audio data
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Create an Int16Array for efficient data transmission
          const pcmBuffer = new Int16Array(inputData.length);
          
          // Convert Float32Array to Int16Array
          for (let i = 0; i < inputData.length; i++) {
            // Scale float values (-1.0 to 1.0) to int16 range
            pcmBuffer[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
          }
          
          // Send audio data to WebSocket
          wsRef.current.send(pcmBuffer.buffer);
        }
      };
      
      setIsRecording(true);
      
      toast({
        title: "Recording Started",
        description: "Speak now - transcription will appear in real-time",
      });
    } catch (error) {
      console.error("Error starting recording:", error);
      toast({
        variant: "destructive",
        title: "Recording Error",
        description: "Could not access your microphone or connect to server",
      });
    }
  }, [createTranscriptionSession, toast]);

  // Function to stop recording
  const stopRecording = useCallback(() => {
    setIsRecording(false);
    
    // Stop processing audio
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Release microphone
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    toast({
      title: "Recording Stopped",
      description: "Final transcription displayed",
    });
  }, [toast]);

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
      <h1 className="text-3xl font-bold mb-6 text-center">OpenAI Streaming Transcription</h1>
      
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
              Select the language you'll be speaking in
            </p>
          </div>
          
          <div className="flex justify-center gap-3 mt-4">
            <Button 
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isConnecting}
              className={`flex items-center space-x-2 ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/90'} text-white`}
              size="lg"
            >
              {isConnecting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isRecording ? (
                <StopCircle size={20} />
              ) : (
                <Mic size={20} />
              )}
              <span>
                {isConnecting ? "Connecting to OpenAI..." : isRecording ? "Stop Transcription" : "Start OpenAI Transcription"}
              </span>
            </Button>
            
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
            <div className="flex items-center gap-2 text-sm text-primary">
              <div className="relative flex h-3 w-16">
                <div className="flex-1 flex justify-evenly items-center">
                  <div className="w-1 h-1 bg-primary rounded-full animate-pulse"></div>
                  <div className="w-1 h-2 bg-primary rounded-full animate-pulse [animation-delay:0.2s]"></div>
                  <div className="w-1 h-3 bg-primary rounded-full animate-pulse [animation-delay:0.4s]"></div>
                  <div className="w-1 h-2 bg-primary rounded-full animate-pulse [animation-delay:0.5s]"></div>
                  <div className="w-1 h-1 bg-primary rounded-full animate-pulse [animation-delay:0.6s]"></div>
                </div>
              </div>
              <span>OpenAI Listening</span>
            </div>
          )}
        </div>
        
        {isConnecting ? (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">Connecting to OpenAI transcription service...</span>
          </div>
        ) : (
          <div className="min-h-[200px] p-4 border border-border rounded-md">
            {transcription ? (
              <p className="whitespace-pre-wrap">{transcription}</p>
            ) : (
              <p className="text-muted-foreground text-center italic">
                {isRecording 
                  ? "Speech will be transcribed in real-time as you speak..." 
                  : "Click 'Start OpenAI Transcription' and just start speaking"}
              </p>
            )}
          </div>
        )}
      </Card>
      
      <div className="mt-6 text-sm text-muted-foreground">
        <p>This feature uses OpenAI's streaming transcription API for true real-time transcription.</p>
        <p>Just click start and speak - transcription appears instantly with no extra clicks needed.</p>
        <p className="font-medium mt-2">Tips for best results:</p>
        <ul className="list-disc list-inside ml-2">
          <li>Speak clearly at a normal pace</li>
          <li>Use a good quality microphone</li>
          <li>Reduce background noise when possible</li>
          <li>No need to pause or click any buttons - just speak naturally</li>
        </ul>
      </div>
    </div>
  );
}
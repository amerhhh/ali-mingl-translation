import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LanguageSelector } from "@/components/language-selector";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import { Mic, StopCircle, Loader2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function WhisperTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [useRealTimeMode, setUseRealTimeMode] = useState(true);
  const [chunkDuration, setChunkDuration] = useState(2000); // 2 seconds chunks by default for fast results
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const lastProcessedTimeRef = useRef<number>(0);
  const processingChunkRef = useRef<boolean>(false);
  const timerRef = useRef<number | null>(null);
  
  const { toast } = useToast();

  // Clean up function to stop recording and clear timers
  const cleanupRecording = useCallback(() => {
    // Clear any ongoing timers
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Stop and clean up media recorder
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      // Release the microphone by stopping all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
    
    // Reset state
    setIsRecording(false);
    processingChunkRef.current = false;
  }, []);

  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, [cleanupRecording]);

  // Function to process an audio chunk
  const processAudioChunk = async (audioBlob: Blob) => {
    if (processingChunkRef.current) {
      console.log("Already processing a chunk, skipping this one");
      return;
    }

    try {
      processingChunkRef.current = true;
      
      // Convert Blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      // Wait for the FileReader to finish reading the file
      const base64Audio = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          // Get the base64 string by removing the data URL prefix
          const base64 = reader.result as string;
          const base64Data = base64.split(',')[1]; // Remove the "data:audio/webm;base64," part
          resolve(base64Data);
        };
      });
      
      // Send the audio to the server for transcription
      const response = await axios.post('/api/whisper-transcribe', {
        audio: base64Audio,
        language: language
      });
      
      // Update the transcription state with the result
      if (response.data.success) {
        const newTranscription = response.data.transcription.trim();
        
        // Only append if there's actual text (not just whitespace or empty)
        if (newTranscription) {
          setTranscription((prev) => {
            // If previous text doesn't end with punctuation or space, add a space
            const needsSpace = prev.length > 0 && 
              !prev.endsWith(' ') && 
              !prev.endsWith('.') && 
              !prev.endsWith('?') && 
              !prev.endsWith('!') && 
              !prev.endsWith('\n');
              
            return prev + (needsSpace ? ' ' : '') + newTranscription;
          });
        }
      } else {
        console.warn("Server returned error:", response.data.error);
      }
    } catch (error) {
      console.error("Error processing audio chunk:", error);
    } finally {
      processingChunkRef.current = false;
      lastProcessedTimeRef.current = Date.now();
    }
  };

  // Function to start a timer to process audio chunks instantly
  const startChunkProcessingTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    
    // Process chunks based on configured chunk duration (default: 500ms)
    // For very responsive real-time experience, we use a shorter interval than the chunk duration
    const processingInterval = Math.min(500, chunkDuration / 2);
    
    timerRef.current = window.setInterval(() => {
      if (!isRecording || audioChunksRef.current.length === 0) return;
      
      // Create a blob from the current audio chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      
      // Process the audio without waiting
      processAudioChunk(audioBlob);
      
      // Clear the chunks after processing
      audioChunksRef.current = [];
    }, processingInterval); // Use optimized processing interval for faster transcription
  }, [isRecording, chunkDuration]);

  // Function to request microphone access and start recording
  const startRecording = useCallback(async () => {
    try {
      // Reset state
      setTranscription("");
      audioChunksRef.current = [];
      lastProcessedTimeRef.current = 0;
      processingChunkRef.current = false;

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      streamRef.current = stream;
      
      // Create a new MediaRecorder with the stream
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });
      mediaRecorderRef.current = mediaRecorder;
      
      // Add event listeners
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Set up processing based on mode
      if (useRealTimeMode) {
        // For real-time mode, start a timer to process chunks periodically
        startChunkProcessingTimer();
        
        // Configure the media recorder to deliver data very frequently (250ms)
        mediaRecorder.start(250); // Get data every 250ms for near instant transcription
      } else {
        // For traditional mode, process everything when recording stops
        mediaRecorder.onstop = async () => {
          setIsProcessing(true);
          // Create a blob from the recorded audio chunks
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Process the entire recording
          await processAudioChunk(audioBlob);
          setIsProcessing(false);
        };
        
        // Start recording without frequent data delivery
        mediaRecorder.start();
      }
      
      setIsRecording(true);
      
      toast({
        title: "Recording Started",
        description: useRealTimeMode 
          ? "Speaking now... Transcription will appear in real-time"
          : "Speak now... Transcription will appear when you stop",
      });
    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast({
        variant: "destructive",
        title: "Recording Error",
        description: "Could not access your microphone. Please check permissions.",
      });
    }
  }, [toast, useRealTimeMode, startChunkProcessingTimer]);

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
      
      // Process any remaining chunks for real-time mode
      if (useRealTimeMode && audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        processAudioChunk(audioBlob);
        audioChunksRef.current = [];
      }
      
      // Stop all audio tracks to release the microphone
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      toast({
        title: "Recording Stopped",
        description: useRealTimeMode 
          ? "Final transcription displayed"
          : "Processing your audio...",
      });
    }
  }, [isRecording, toast, useRealTimeMode]);

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
      <h1 className="text-3xl font-bold mb-6 text-center">Whisper Speech-to-Text Test</h1>
      
      <Card className="p-6 mb-6">
        <div className="flex flex-col space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Language:</label>
            <LanguageSelector
              value={language}
              onChange={setLanguage}
              placeholder="Select language"
            />
            <p className="text-sm text-muted-foreground mt-1">
              Select the language you'll be speaking in (helps improve accuracy)
            </p>
          </div>
          
          <Separator className="my-2" />
          
          <div className="flex items-center space-x-2">
            <Switch
              id="real-time-mode"
              checked={useRealTimeMode}
              onCheckedChange={setUseRealTimeMode}
              disabled={isRecording}
            />
            <Label htmlFor="real-time-mode" className="cursor-pointer">
              Real-time transcription mode
            </Label>
          </div>
          
          {useRealTimeMode && (
            <div className="flex flex-col space-y-2 pl-7">
              <p className="text-sm text-muted-foreground">
                Chunks are processed every {chunkDuration/1000} seconds for real-time results.
              </p>
              <div className="flex items-center gap-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setChunkDuration(2000)}
                  disabled={isRecording || chunkDuration === 2000}
                  className={chunkDuration === 2000 ? "bg-primary/10" : ""}
                >
                  2s
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setChunkDuration(5000)}
                  disabled={isRecording || chunkDuration === 5000}
                  className={chunkDuration === 5000 ? "bg-primary/10" : ""}
                >
                  5s
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setChunkDuration(10000)}
                  disabled={isRecording || chunkDuration === 10000}
                  className={chunkDuration === 10000 ? "bg-primary/10" : ""}
                >
                  10s
                </Button>
              </div>
            </div>
          )}
          
          <div className="flex justify-center gap-3 mt-4">
            {!isRecording ? (
              <Button 
                onClick={startRecording}
                disabled={isProcessing}
                className="flex items-center space-x-2 bg-primary hover:bg-primary/90 text-white"
                size="lg"
              >
                <Mic size={20} />
                <span>Start Recording</span>
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
              disabled={!transcription || isProcessing}
            >
              <RotateCcw size={16} />
              <span>Reset</span>
            </Button>
          </div>
        </div>
      </Card>
      
      <Card className="p-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold">Transcription Result:</h2>
          {isRecording && useRealTimeMode && (
            <div className="flex items-center space-x-2 text-sm text-primary animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Live transcribing...</span>
            </div>
          )}
        </div>
        
        {isProcessing ? (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">Processing audio...</span>
          </div>
        ) : (
          <div className="min-h-[200px] p-4 border border-border rounded-md">
            {transcription ? (
              <p className="whitespace-pre-wrap">{transcription}</p>
            ) : (
              <p className="text-muted-foreground text-center italic">
                {isRecording && useRealTimeMode 
                  ? "Start speaking to see transcription..." 
                  : "Record audio to see transcription here"}
              </p>
            )}
          </div>
        )}
      </Card>
      
      <div className="mt-6 text-sm text-muted-foreground">
        <p>This test uses OpenAI's Whisper model for speech-to-text conversion.</p>
        <p>The audio processing happens on the server - your audio is not stored permanently.</p>
        <p className="font-medium mt-2">Tips for better transcription:</p>
        <ul className="list-disc list-inside ml-2">
          <li>Speak clearly and at a normal pace</li>
          <li>Use a good quality microphone</li>
          <li>Reduce background noise when possible</li>
          <li>In real-time mode, pause briefly between sentences for best results</li>
        </ul>
      </div>
    </div>
  );
}
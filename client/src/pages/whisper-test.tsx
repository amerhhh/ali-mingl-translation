import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LanguageSelector } from "@/components/language-selector";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import { Mic, StopCircle, Loader2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";

export default function WhisperTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
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

  // Function to process an audio chunk with continuous processing
  const processAudioChunk = async (audioBlob: Blob) => {
    // Use a unique ID for this processing request to handle concurrency
    const requestId = Date.now();
    
    // Skip if the blob is too small (likely silence)
    if (audioBlob.size < 100) {
      return;
    }
    
    // Don't block other chunks from processing
    // Instead of preventing concurrent requests, we'll handle them all
    // and merge results intelligently
    const isFirstInQueue = !processingChunkRef.current;
    processingChunkRef.current = true;
    
    try {
      console.log(`Processing chunk ${requestId}, size: ${audioBlob.size} bytes`);
      
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
      // Only wait for 2.5 seconds max to maintain real-time feel
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      
      try {
        const response = await axios.post('/api/whisper-transcribe', {
          audio: base64Audio,
          language: language
        }, { 
          signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        
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
            
            console.log(`Added transcription from chunk ${requestId}: "${newTranscription}"`);
          }
        }
      } catch (requestError) {
        if (requestError.name === 'AbortError') {
          console.log(`Request ${requestId} aborted after timeout to maintain real-time flow`);
        } else {
          throw requestError; // Re-throw for the outer catch
        }
      }
    } catch (error) {
      console.error(`Error processing audio chunk ${requestId}:`, error);
    } finally {
      // Only reset the processing flag if we're the last request in the queue
      if (isFirstInQueue) {
        processingChunkRef.current = false;
      }
    }
  };

  // Function to start a continuous streaming transcription with progressive processing
  const startContinuousTranscription = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    
    // Use an extremely short interval (100ms) for truly real-time processing
    // This creates a continuous stream effect without needing to stop recording
    timerRef.current = window.setInterval(() => {
      if (!isRecording || audioChunksRef.current.length === 0) return;
      
      // Create a blob from the current audio chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      
      // Make a copy of the chunks and then clear the original array immediately
      // This allows the MediaRecorder to continue collecting new chunks while we process
      const chunksToProcess = [...audioChunksRef.current];
      audioChunksRef.current = [];
      
      // Process the audio in a non-blocking way
      setTimeout(() => {
        processAudioChunk(audioBlob);
      }, 0);
      
    }, 100); // Ultra-short interval for truly continuous results
  }, [isRecording]);

  // Function to request microphone access and start recording
  const startRecording = useCallback(async () => {
    try {
      // Reset state
      setTranscription("");
      audioChunksRef.current = [];
      processingChunkRef.current = false;

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
      
      // Configure the media recorder to deliver data very frequently (100ms)
      mediaRecorder.start(100); // Get data every 100ms for near continuous results
      
      // Start the continuous transcription process immediately
      startContinuousTranscription();
      
      setIsRecording(true);
      
      toast({
        title: "Recording Started",
        description: "Speaking now... Transcription will appear in real-time",
      });
    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast({
        variant: "destructive",
        title: "Recording Error",
        description: "Could not access your microphone. Please check permissions.",
      });
    }
  }, [toast, startContinuousTranscription]);

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
        description: "Final transcription displayed",
      });
    }
  }, [isRecording, toast]);

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
      <h1 className="text-3xl font-bold mb-6 text-center">Continuous Live Transcription</h1>
      
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
                disabled={isProcessing}
                className="flex items-center space-x-2 bg-primary hover:bg-primary/90 text-white"
                size="lg"
              >
                <Mic size={20} />
                <span>Start Continuous Transcription</span>
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
          <h2 className="text-xl font-semibold">Live Transcription:</h2>
          {isRecording && (
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
                {isRecording 
                  ? "Start speaking to see transcription..." 
                  : "Click 'Start Continuous Transcription' and begin speaking"}
              </p>
            )}
          </div>
        )}
      </Card>
      
      <div className="mt-6 text-sm text-muted-foreground">
        <p>This test uses OpenAI's Whisper model for continuous speech-to-text conversion.</p>
        <p>The audio processing happens on the server in near real-time.</p>
        <p className="font-medium mt-2">Tips for better transcription:</p>
        <ul className="list-disc list-inside ml-2">
          <li>Speak clearly and at a normal pace</li>
          <li>Use a good quality microphone</li>
          <li>Reduce background noise when possible</li>
          <li>Pause briefly between sentences for more accurate results</li>
        </ul>
      </div>
    </div>
  );
}
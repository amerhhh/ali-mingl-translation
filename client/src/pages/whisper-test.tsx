import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LanguageSelector } from "@/components/language-selector";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import { Mic, StopCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";

export default function WhisperTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();

  // Function to request microphone access and start recording
  const startRecording = useCallback(async () => {
    try {
      // Reset state
      setTranscription("");
      audioChunksRef.current = [];

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create a new MediaRecorder with the stream
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      // Add event listeners
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Create a blob from the recorded audio chunks
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Process the audio blob (send to Whisper API)
        await processAudio(audioBlob);
      };
      
      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      
      toast({
        title: "Recording Started",
        description: "Speak now...",
      });
    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast({
        variant: "destructive",
        title: "Recording Error",
        description: "Could not access your microphone. Please check permissions.",
      });
    }
  }, [toast]);

  // Function to stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Stop all audio tracks to release the microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      
      toast({
        title: "Recording Stopped",
        description: "Processing your audio...",
      });
    }
  }, [isRecording, toast]);

  // Function to process the audio and send to Whisper API
  const processAudio = async (audioBlob: Blob) => {
    try {
      setIsProcessing(true);
      
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
        setTranscription(response.data.transcription);
        toast({
          title: "Transcription Complete",
          description: "Audio processed successfully!",
        });
      } else {
        throw new Error(response.data.error || "Failed to transcribe audio");
      }
    } catch (error) {
      console.error("Error processing audio:", error);
      toast({
        variant: "destructive",
        title: "Transcription Error",
        description: error instanceof Error ? error.message : "Failed to transcribe audio",
      });
    } finally {
      setIsProcessing(false);
    }
  };

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
          
          <div className="flex justify-center mt-4">
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
          </div>
        </div>
      </Card>
      
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-3">Transcription Result:</h2>
        
        {isProcessing ? (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">Processing audio...</span>
          </div>
        ) : (
          <div className="min-h-[150px] p-4 border border-border rounded-md">
            {transcription ? (
              <p className="whitespace-pre-wrap">{transcription}</p>
            ) : (
              <p className="text-muted-foreground text-center italic">
                Record audio to see transcription here
              </p>
            )}
          </div>
        )}
      </Card>
      
      <div className="mt-6 text-sm text-muted-foreground">
        <p>This test uses OpenAI's Whisper model for speech-to-text conversion.</p>
        <p>The audio processing happens on the server - your audio is not stored permanently.</p>
      </div>
    </div>
  );
}
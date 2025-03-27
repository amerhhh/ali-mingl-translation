import { useState, useEffect, useCallback, useRef } from "react";

interface TranscriptResult {
  finalText: string;
  interimText: string;
  isFinal: boolean;
}

interface UseSpeechRecognitionProps {
  language?: string;
  deviceId?: string;
}

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export function useSpeechRecognition({ language = 'en-US', deviceId }: UseSpeechRecognitionProps = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult>({
    finalText: "",
    interimText: "",
    isFinal: false
  });
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const recognition = useRef<any>(null);

  // Get available audio devices
  const getAudioDevices = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      stream.getTracks().forEach(track => track.stop()); // Clean up the test stream

      const audioDevices = devices.filter(
        device => device.kind === 'audioinput' || device.kind === 'audiooutput'
      ).map(device => ({
        deviceId: device.deviceId,
        label: device.label || `${device.kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${devices.indexOf(device) + 1}`,
        kind: device.kind as 'audioinput' | 'audiooutput'
      }));

      setDevices(audioDevices);
    } catch (err) {
      console.error('Error getting audio devices:', err);
      setError("Failed to get audio devices. Please ensure microphone permissions are granted.");
    }
  }, []);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    getAudioDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
    };
  }, [getAudioDevices]);

  // Update recognition language when language prop changes
  useEffect(() => {
    if (recognition.current) {
      recognition.current.lang = language;
      console.log('Updated speech recognition language to:', language);
    }
  }, [language]);

  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window)) {
      return;
    }

    // Create a new recognition instance
    recognition.current = new (window as any).webkitSpeechRecognition();

    // Configure recognition settings
    recognition.current.continuous = true;
    recognition.current.interimResults = true;
    recognition.current.lang = language;

    // Set audio source if deviceId is provided
    if (deviceId) {
      const constraints = {
        audio: {
          deviceId: { exact: deviceId }
        }
      };
      recognition.current.mediaDevices = constraints;
    }

    recognition.current.onstart = () => {
      setIsListening(true);
      setError(null);
      setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
      console.log('Speech recognition started in language:', language);
    };

    recognition.current.onresult = (event: any) => {
      let finalText = transcriptResult.finalText;
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText = (finalText + ' ' + transcript).trim();
        } else {
          interimText = transcript;
        }
      }

      setTranscriptResult({
        finalText,
        interimText,
        isFinal: !interimText
      });
    };

    recognition.current.onerror = (event: any) => {
      console.error('Speech recognition error:', event);
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.current.onend = () => {
      console.log('Speech recognition ended');
      setIsListening(false);
    };

    // Start recognition
    try {
      recognition.current.start();
      console.log('Started speech recognition');
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      setError('Failed to start speech recognition. Please try again.');
      setIsListening(false);
    }
  }, [language, deviceId, transcriptResult.finalText]);

  const stopListening = useCallback(() => {
    if (recognition.current) {
      recognition.current.stop();
      console.log('Stopped speech recognition');
    }
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscriptResult({ finalText: "", interimText: "", isFinal: false });
  }, []);

  return {
    isListening,
    transcriptResult,
    error,
    startListening,
    stopListening,
    resetTranscript,
    devices
  };
}
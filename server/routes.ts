import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { storage } from "./storage";
import { translations, type Translation, insertTranslationSchema } from "@shared/schema";
import { translateText, translateUIText, createRealtimeSpeechSession, createRealtimeTranscriptionSession, transcribeAudio } from "./openai";
import { ZodError } from "zod";
import { customAlphabet } from 'nanoid';

// Create a custom nanoid generator with only uppercase letters and numbers
const generateRoomId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 3);

// Store active connections and their rooms
const rooms = new Map<string, Set<WebSocket>>();
const clientRooms = new Map<WebSocket, string>();

function broadcast(roomId: string, message: any, exclude?: WebSocket) {
  const room = rooms.get(roomId);
  if (room) {
    console.log(`Broadcasting to room ${roomId}, active clients: ${room.size}`);
    room.forEach(client => {
      if ((exclude === undefined || client !== exclude) && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Create HTTP server first
  const httpServer = createServer(app);

  // WebSocket server setup with direct server and path configuration
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws',
    perMessageDeflate: false,
    clientTracking: true
  });

  console.log('WebSocket server initialized on /ws path');

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection established');

    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data);
        console.log('Received message:', message);

        switch (message.type) {
          case 'join':
            const roomId = message.roomId?.trim();
            if (!roomId) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid room ID'
              }));
              return;
            }

            // Create room if it doesn't exist
            if (!rooms.has(roomId)) {
              rooms.set(roomId, new Set());
            }

            // Add client to room
            const room = rooms.get(roomId)!;
            room.add(ws);
            clientRooms.set(ws, roomId);

            console.log(`Client joined room: ${roomId}, total clients: ${room.size}`);

            // Get room history from database
            const roomHistory = await storage.getRecentTranslations(roomId, 100);
            const formattedHistory = roomHistory.map(t => ({
              type: 'chat',
              text: t.sourceText,
              translatedText: t.targetText,
              sourceLang: t.sourceLang,
              targetLang: t.targetLang,
              timestamp: t.timestamp.toISOString(),
              temp_user_uuid: t.temp_user_uuid,
              user_emoji: t.user_emoji
            }));

            ws.send(JSON.stringify({
              type: 'joined',
              roomId,
              history: formattedHistory,
              success: true
            }));
            break;

          case 'chat':
            const currentRoom = clientRooms.get(ws);
            if (!currentRoom) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not connected to any room'
              }));
              return;
            }

            try {
              console.log('Processing chat message:', message);

              // Store all messages, including those from OpenAI or WebSpeech with translations
              if (message.translatedText) {
                // Always store in database, even pre-translated messages
                const savedTranslation = await storage.addTranslation({
                  sourceText: message.text,
                  targetText: message.translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  roomId: currentRoom,
                  temp_user_uuid: message.temp_user_uuid,
                  user_emoji: message.user_emoji
                });

                // Broadcast to all clients in the room
                console.log('Broadcasting stored message to room:', currentRoom);
                
                // Create a consistent timestamp at the server level to avoid minute boundary issues
                const timestamp = new Date().toISOString();
                
                const chatMessage = {
                  type: 'chat',
                  text: message.text,
                  translatedText: message.translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  timestamp: timestamp, // Use server-generated timestamp
                  roomId: currentRoom,
                  temp_user_uuid: message.temp_user_uuid,
                  user_emoji: message.user_emoji,
                  isOpenAI: message.isOpenAI
                };
                
                broadcast(currentRoom, chatMessage, ws);
              } else {
                // If no translatedText, this is a new message that needs translation
                const translatedText = await translateText(
                  message.text,
                  message.targetLang
                );

                // Create a consistent timestamp at the server level
                const timestamp = new Date().toISOString();

                // Include temp_user_uuid, user_emoji, and voiceType in savedTranslation
                const savedTranslation = await storage.addTranslation({
                  sourceText: message.text,
                  targetText: translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  roomId: currentRoom,
                  temp_user_uuid: message.temp_user_uuid, // Pass through the UUID
                  user_emoji: message.user_emoji, // Pass through the emoji
                  voiceType: message.voiceType || "female", // Use provided voiceType or default to female
                  timestamp: new Date(timestamp) // Use consistent timestamp
                });

                const chatMessage = {
                  type: 'chat',
                  text: message.text,
                  translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  timestamp: timestamp, // Use consistent timestamp for WebSocket message
                  roomId: currentRoom,
                  temp_user_uuid: savedTranslation.temp_user_uuid,
                  user_emoji: savedTranslation.user_emoji,
                  voiceType: savedTranslation.voiceType
                };

                broadcast(currentRoom, chatMessage);
              }
            } catch (error) {
              console.error('Translation/database error:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process message'
              }));
            }
            break;

          case 'clear_room':
            const roomToClear = clientRooms.get(ws);
            if (!roomToClear) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not connected to any room'
              }));
              return;
            }

            try {
              // Clear messages for this room from storage
              await storage.clearRoomMessages(roomToClear);

              // Broadcast clear message to all clients in the room
              broadcast(roomToClear, {
                type: 'room_cleared',
                roomId: roomToClear,
                timestamp: new Date().toISOString()
              });
              
              // Confirm to the requester that the room was cleared
              ws.send(JSON.stringify({
                type: 'room_cleared_confirmed',
                roomId: roomToClear,
                success: true
              }));
              
              console.log(`Room ${roomToClear} cleared successfully, notification sent to all clients`);
            } catch (error) {
              console.error('Failed to clear room:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to clear room messages'
              }));
            }
            break;

          case 'openai-transcription':
            // Handle special OpenAI transcription messages
            const openaiRoom = clientRooms.get(ws);
            if (!openaiRoom) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not connected to any room'
              }));
              return;
            }

            try {
              console.log('Processing OpenAI transcription:', message);

              // Store the transcription in the database
              const savedTranscription = await storage.addTranslation({
                sourceText: message.sourceText,
                targetText: message.translatedText,
                sourceLang: message.sourceLang || "en",
                targetLang: message.targetLang || "ar",
                roomId: openaiRoom,
                temp_user_uuid: message.userId,
                user_emoji: message.userEmoji,
                voiceType: "female"
              });

              // Create a chat message to broadcast
              const transcriptionMessage = {
                type: 'chat',
                text: message.sourceText,
                translatedText: message.translatedText,
                sourceLang: message.sourceLang || "en",
                targetLang: message.targetLang || "ar",
                timestamp: savedTranscription.timestamp.toISOString(),
                roomId: openaiRoom,
                temp_user_uuid: message.userId,
                user_emoji: message.userEmoji,
                isOpenAI: true
              };

              // Broadcast to all clients in the room
              console.log('Broadcasting OpenAI transcription to room:', openaiRoom);
              broadcast(openaiRoom, transcriptionMessage);
            } catch (error) {
              console.error('OpenAI transcription processing error:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process OpenAI transcription'
              }));
            }
            break;
        }
      } catch (error) {
        console.error('WebSocket message handling error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });

    ws.on('close', () => {
      const roomId = clientRooms.get(ws);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.delete(ws);
          if (room.size === 0) {
            rooms.delete(roomId);
          }
        }
        clientRooms.delete(ws);
        console.log(`Client left room: ${roomId}, remaining clients: ${room?.size || 0}`);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  // API endpoints
  app.post("/api/translate", async (req, res) => {
    try {
      console.log('Translation request body:', req.body); 
      
      // Check if this is an OpenAI transcript (already translated)
      if (req.body.translatedText && req.body.isOpenAI) {
        console.log('Processing pre-translated OpenAI message');
        
        const sourceLang = req.body.sourceLang || "en";
        const targetLang = req.body.targetLang || "en";
        
        // Use the OpenAI translation that's already done
        const translation = await storage.addTranslation({
          sourceText: req.body.text,
          targetText: req.body.translatedText,
          sourceLang,
          targetLang,
          roomId: req.body.roomId,
          temp_user_uuid: req.body.temp_user_uuid,
          user_emoji: req.body.user_emoji,
          voiceType: req.body.voiceType || "female"
        });
        
        // Broadcast the message to others in the room if needed
        if (req.body.roomId) {
          broadcast(req.body.roomId, {
            type: 'chat',
            text: req.body.text, 
            translatedText: req.body.translatedText,
            sourceLang,
            targetLang,
            timestamp: new Date().toISOString(),
            roomId: req.body.roomId,
            temp_user_uuid: req.body.temp_user_uuid,
            user_emoji: req.body.user_emoji,
            voiceType: req.body.voiceType || "female"
          });
        }
        
        return res.json(translation);
      }
      
      // Standard translation flow
      const { sourceText, targetLang, roomId } = insertTranslationSchema.parse({
        sourceText: req.body.text,
        targetLang: req.body.targetLang,
        sourceLang: req.body.sourceLang || "en",
        targetText: "",
        roomId: req.body.roomId 
      });

      const targetText = await translateText(sourceText, targetLang);

      const translation = await storage.addTranslation({
        sourceText,
        targetText,
        sourceLang: req.body.sourceLang || "en",
        targetLang,
        roomId,
        temp_user_uuid: req.body.temp_user_uuid,
        user_emoji: req.body.user_emoji,
        voiceType: req.body.voiceType || "female"
      });

      console.log('Stored translation with room ID:', roomId);
      res.json(translation);
    } catch (error: unknown) {
      console.error('Translation error:', error); 
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Invalid request data", errors: error.errors });
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        res.status(500).json({ message });
      }
    }
  });

  app.get("/api/translations", async (_req, res) => {
    try {
      const translations = await storage.getTranslations();
      res.json(translations);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      res.status(500).json({ message });
    }
  });

  // Add new endpoint for checking room existence
  app.get("/api/rooms/:roomId/check", async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const exists = await storage.isRoomExists(roomId);
      res.json({ exists });
    } catch (error) {
      console.error('Error checking room existence:', error);
      res.status(500).json({ 
        message: "Failed to check room existence",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update room creation endpoint with better conflict handling
  app.post("/api/rooms", async (req, res) => {
    try {
      let roomId;
      let attempts = 0;
      const maxAttempts = 10; // Prevent infinite loops

      do {
        roomId = generateRoomId();
        attempts++;

        // Check if room exists in database
        const exists = await storage.isRoomExists(roomId);

        if (!exists) {
          rooms.set(roomId, new Set());
          console.log(`Created new room: ${roomId}`);
          return res.json({ roomId });
        }

        console.log(`Room ${roomId} already exists, trying another ID (attempt ${attempts})`);
      } while (attempts < maxAttempts);

      // If we couldn't find a unique room ID after max attempts
      throw new Error("Failed to generate unique room ID");
    } catch (error) {
      console.error('Error creating room:', error);
      res.status(500).json({ 
        message: "Failed to create room",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/translate-ui", async (req, res) => {
    try {
      const { text, targetLang } = req.body;

      if (!text || !targetLang) {
        res.status(400).json({ message: "Missing text or target language" });
        return;
      }

      const translation = await translateUIText(text, targetLang);
      res.json({ translation });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      res.status(500).json({ message });
    }
  });

  // Endpoint for creating a real-time speech session
  app.post("/api/realtime-session", async (req, res) => {
    try {
      const { sourceLang, targetLang } = req.body;

      if (!sourceLang || !targetLang) {
        res.status(400).json({ message: "Missing source or target language" });
        return;
      }

      const sessionData = await createRealtimeSpeechSession(sourceLang, targetLang);
      res.json(sessionData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Error creating real-time session:', message);
      res.status(500).json({ message });
    }
  });
  
  // New endpoint for creating a real-time transcription session (streaming as you speak)
  app.post("/api/realtime-transcription", async (req, res) => {
    try {
      console.log("Creating real-time transcription session with OpenAI");
      
      // Create a real-time transcription session with OpenAI
      const sessionData = await createRealtimeTranscriptionSession();
      
      console.log("Real-time transcription session created successfully", {
        sessionId: sessionData.sessionId,
        expiresAt: sessionData.expires_at
      });
      
      // Return the session data to the client
      res.json({
        success: true,
        session: sessionData
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Error creating real-time transcription session:', message);
      res.status(500).json({ 
        success: false,
        message
      });
    }
  });
  
  // Endpoint for our new realtime transcribe page that communicates with OpenAI streaming API
  app.post("/api/openai/realtime-session", async (req, res) => {
    try {
      const { sourceLang, targetLang } = req.body;
      
      if (!sourceLang || !targetLang) {
        res.status(400).json({ 
          success: false,
          message: "Missing source or target language" 
        });
        return;
      }
      
      console.log(`Creating OpenAI realtime session for languages: ${sourceLang} -> ${targetLang}`);
      
      // Get the session information from OpenAI
      const session = await createRealtimeTranscriptionSession();
      
      // Return the WebSocket URL to the client
      res.json({
        success: true,
        url: session.socket_url,
        sessionId: session.sessionId,
        expiresAt: session.expires_at
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Error creating OpenAI realtime session:', message);
      
      res.status(500).json({ 
        success: false,
        message 
      });
    }
  });
  
  // Endpoint for Whisper speech-to-text transcription
  // WebSocket handler for live speech-to-text with streaming
  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket client connected for speech-to-text streaming');
    
    // This event handler will also process whisper transcriptions
    ws.on('message', async (message: WebSocket.Data) => {
      try {
        // Convert the message to string if it's a Buffer
        const messageStr = message instanceof Buffer 
          ? message.toString() 
          : typeof message === 'string' 
            ? message 
            : JSON.stringify(message);
        
        // Parse the JSON message
        const data = JSON.parse(messageStr);
        
        // Debug log the message type and essential info
        console.log(`WS message received: type=${data.type}, requestId=${data.requestId || 'none'}`);
        
        // Handle ping message (for connection testing)
        if (data.type === 'ping') {
          console.log('Ping received from client, sending pong');
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
            received: data.timestamp
          }));
          return;
        }
        
        // Handle Whisper streaming transcription messages
        if (data.type === 'whisper_stream') {
          // Extract audio data and language
          const { audio, language, requestId } = data;
          
          if (!audio) {
            console.warn('Missing audio data in whisper_stream message');
            ws.send(JSON.stringify({
              type: 'whisper_error',
              error: 'Missing audio data',
              requestId
            }));
            return;
          }
          
          try {
            // Decode base64 audio data to a buffer
            const audioBuffer = Buffer.from(audio, 'base64');
            console.log(`Processing streaming audio chunk: ${audioBuffer.length} bytes, requestId=${requestId}, lang=${language || 'auto'}`);
            
            // Process the audio with Whisper - with shorter timeout for streaming
            const timeoutMs = 2500; // 2.5 seconds max for streaming chunks
            
            // Use Promise.race to implement a timeout for real-time needs
            const transcriptionPromise = transcribeAudio(audioBuffer, language);
            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error('Transcription timed out')), timeoutMs);
            });
            
            // Race the transcription against the timeout
            let transcription;
            try {
              transcription = await Promise.race([
                transcriptionPromise,
                timeoutPromise
              ]);
            } catch (timeoutError) {
              console.log(`Transcription timed out for requestId=${requestId}, continuing with streaming`);
              // Send an empty result on timeout to keep the stream going
              ws.send(JSON.stringify({
                type: 'whisper_result',
                transcription: '',
                language: language || 'auto',
                requestId,
                timestamp: Date.now(),
                timeout: true
              }));
              return;
            }
            
            // If we got an actual transcription, send it back
            if (transcription && transcription.trim()) {
              console.log(`Streaming transcription result: "${transcription.trim()}" for requestId=${requestId}`);
              
              // Send back the transcription immediately through WebSocket
              ws.send(JSON.stringify({
                type: 'whisper_result',
                transcription: transcription.trim(),
                language: language || 'auto',
                requestId,
                timestamp: Date.now()
              }));
            } else {
              console.log(`Empty transcription for requestId=${requestId}, likely silence`);
              // Send an empty result to keep the client informed
              ws.send(JSON.stringify({
                type: 'whisper_result',
                transcription: '',
                language: language || 'auto',
                requestId,
                timestamp: Date.now(),
                empty: true
              }));
            }
          } catch (transcriptionError: unknown) {
            const errorMessage = transcriptionError instanceof Error 
              ? transcriptionError.message 
              : 'Unknown transcription error';
            
            console.error(`WebSocket whisper error for requestId=${requestId}:`, errorMessage);
            
            // Send error back to client
            ws.send(JSON.stringify({
              type: 'whisper_error',
              error: errorMessage,
              requestId
            }));
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format'
        }));
      }
    });
  });

  // Keep the HTTP endpoint for compatibility, but recommend WebSocket for streaming
  app.post("/api/whisper-transcribe", async (req, res) => {
    try {
      console.log('Whisper transcription request received');
      // Check if we have audio data in the request
      if (!req.body || !req.body.audio) {
        return res.status(400).json({ 
          success: false, 
          error: "Missing audio data" 
        });
      }
      
      // Extract the base64 audio data and language code
      const { audio, language } = req.body;
      
      // Decode base64 audio data to a buffer
      const audioBuffer = Buffer.from(audio, 'base64');
      console.log(`Received audio data: ${audioBuffer.length} bytes`);
      
      // Set a reasonable timeout for real-time processing
      const timeoutMs = 3000; // 3 seconds max for processing chunks
      
      // Use Promise.race to implement a timeout for real-time needs
      const transcriptionPromise = transcribeAudio(audioBuffer, language);
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Transcription timed out')), timeoutMs);
      });
      
      // Race the transcription against the timeout
      const transcription = await Promise.race([
        transcriptionPromise,
        timeoutPromise
      ]);
      
      // Return the transcription
      res.json({
        success: true,
        transcription,
        language: language || 'auto'
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Whisper transcription error:', errorMessage);
      
      // If the error was a timeout, return a more helpful message for streaming
      const isTimeout = errorMessage === 'Transcription timed out';
      
      // For timeouts, we send a 200 status with empty transcription
      // This allows the client to continue streaming without breaking
      if (isTimeout) {
        return res.json({
          success: true,
          transcription: '', // Empty transcription when timeout occurs
          timeout: true,
          language: req.body.language || 'auto'
        });
      }
      
      // For other errors, return a 500 status
      res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  });
  
  // Special endpoint for direct message sending from OpenAI
  app.post("/api/send-message", async (req, res) => {
    try {
      console.log('Direct message API called with:', JSON.stringify(req.body));
      
      // Need roomId, text, and other fields
      const { roomId, text, translatedText, sourceLang, targetLang, temp_user_uuid, user_emoji } = req.body;
      
      if (!roomId || !text) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      // Save to database
      const translation = await storage.addTranslation({
        sourceText: text,
        targetText: translatedText || text, // If no translation, use source
        sourceLang: sourceLang || 'en',
        targetLang: targetLang || 'en',
        roomId,
        temp_user_uuid: temp_user_uuid || 'unknown',
        user_emoji: user_emoji || '🔷',
        voiceType: req.body.voiceType || "female"
      });
      
      // Broadcast to room if we have active connections
      broadcast(roomId, {
        type: 'chat',
        text, 
        translatedText: translatedText || text,
        sourceLang: sourceLang || 'en',
        targetLang: targetLang || 'en',
        timestamp: new Date().toISOString(),
        roomId,
        temp_user_uuid: temp_user_uuid || 'unknown',
        user_emoji: user_emoji || '🔷',
        voiceType: req.body.voiceType || "female"
      });
      
      res.json({ success: true, message: 'Message sent and stored', roomId, translation });
    } catch (error) {
      console.error('Error in send-message endpoint:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      res.status(500).json({ message });
    }
  });
  
  // Dedicated endpoint for OpenAI transcription messages
  app.post("/api/openai-transcription", async (req, res) => {
    try {
      // Extract fields from request
      const { 
        text,
        translatedText,
        sourceLang,
        targetLang,
        roomId,
        temp_user_uuid,
        user_emoji,
        voiceType = "female",
        isOpenAI = true
      } = req.body;
      
      console.log('Received OpenAI transcription:', {
        text: text?.substring(0, 30) + '...',
        translatedText: translatedText?.substring(0, 30) + '...',
        sourceLang, 
        targetLang, 
        roomId, 
        temp_user_uuid: temp_user_uuid?.substring(0, 8) + '...',
        user_emoji,
        timestamp: new Date().toISOString()
      });
      
      // More comprehensive validation
      if (!text || !translatedText) {
        return res.status(400).json({ 
          message: "Missing required text fields",
          received: { hasText: !!text, hasTranslatedText: !!translatedText }
        });
      }
      
      if (!roomId) {
        return res.status(400).json({ 
          message: "Missing required roomId field",
          received: { roomId }
        });
      }
      
      // Check for duplicate messages (using text content as a simple check)
      const recentMessages = await storage.getRecentTranslations(roomId, 5);
      const isDuplicate = recentMessages.some((msg: Translation) => 
        msg.sourceText === text && msg.targetText === translatedText
      );
      
      if (isDuplicate) {
        console.log('Detected duplicate OpenAI transcription, skipping');
        return res.status(200).json({ 
          success: true, 
          message: "Duplicate message detected, not saved again",
          isDuplicate: true
        });
      }
      
      // Make sure the room exists, or create it
      const roomExists = await storage.isRoomExists(roomId);
      if (!roomExists) {
        console.log(`Creating new room for OpenAI transcription: ${roomId}`);
        // Optional: Create the room explicitly if needed
      }
      
      // Prepare data with defaults for any missing fields
      const translationData = {
        sourceText: text,
        targetText: translatedText,
        sourceLang: sourceLang || "en",
        targetLang: targetLang || "en",
        roomId,
        temp_user_uuid: temp_user_uuid || `openai-${Date.now()}`,
        user_emoji: user_emoji || "🔊",
        voiceType: voiceType || "female"
      };
      
      console.log('Saving OpenAI transcription to database:', {
        roomId,
        temp_user_uuid: translationData.temp_user_uuid.substring(0, 8) + '...',
      });
      
      // Save the transcription to the database
      const translation = await storage.addTranslation(translationData);
      
      // Broadcast the message to other clients in the room
      broadcast(roomId, {
        type: 'chat',
        text,
        translatedText,
        sourceLang: sourceLang || "en",
        targetLang: targetLang || "en",
        timestamp: translation.timestamp.toISOString(),
        roomId,
        temp_user_uuid: translationData.temp_user_uuid,
        user_emoji: translationData.user_emoji,
        voiceType,
        isOpenAI: true
      });
      
      res.json({ 
        success: true, 
        message: "OpenAI transcription saved and broadcast",
        translation
      });
    } catch (error) {
      console.error('OpenAI transcription error:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      res.status(500).json({ message });
    }
  });

  // API endpoint to get recent transcriptions for a room
  app.get("/api/transcriptions/:roomId", async (req, res) => {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        return res.status(400).json({ message: "Room ID is required" });
      }
      
      // Get the last 20 transcriptions for this room
      const recentTranscriptions = await storage.getRecentTranslations(roomId, 20);
      
      res.json({
        success: true,
        count: recentTranscriptions.length,
        transcriptions: recentTranscriptions.map(t => ({
          id: t.id,
          sourceText: t.sourceText.substring(0, 50) + (t.sourceText.length > 50 ? '...' : ''),
          targetText: t.targetText.substring(0, 50) + (t.targetText.length > 50 ? '...' : ''),
          sourceLang: t.sourceLang,
          targetLang: t.targetLang,
          timestamp: t.timestamp,
          user: t.user_emoji + ' ' + (t.temp_user_uuid?.substring(0, 8) || '')
        }))
      });
    } catch (error) {
      console.error('Error fetching transcriptions:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      res.status(500).json({ message });
    }
  });

  // Endpoint to get all transcriptions (admin only, limit to recent ones)
  app.get("/api/transcriptions", async (req, res) => {
    try {
      // Get all translations from the database
      const allTranslations = await storage.getTranslations();
      
      // Limit to the most recent 100
      const recentTranslations = allTranslations.slice(0, 100);
      
      res.json({
        success: true,
        count: recentTranslations.length,
        transcriptions: recentTranslations.map(t => ({
          id: t.id,
          room: t.roomId,
          sourceText: t.sourceText.substring(0, 30) + (t.sourceText.length > 30 ? '...' : ''),
          targetText: t.targetText.substring(0, 30) + (t.targetText.length > 30 ? '...' : ''),
          sourceLang: t.sourceLang,
          targetLang: t.targetLang,
          timestamp: t.timestamp,
          user: t.user_emoji + ' ' + (t.temp_user_uuid?.substring(0, 8) || '')
        }))
      });
    } catch (error) {
      console.error('Error fetching all transcriptions:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      res.status(500).json({ message });
    }
  });

  return httpServer;
}
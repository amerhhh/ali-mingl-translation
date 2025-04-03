import { createServer, type Server } from "http";
import type { Express } from "express";
import { storage } from "./storage";
import { translateText, translateUIText, createRealtimeSpeechSession } from "./openai"; //Import translateUIText
import { insertTranslationSchema } from "@shared/schema";
import { ZodError } from "zod";
import { WebSocketServer, WebSocket } from 'ws';
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
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
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
            const translations = await storage.getTranslations();
            const roomHistory = translations
              .filter(t => t.roomId === roomId)
              .map(t => ({
                type: 'chat',
                text: t.sourceText,
                translatedText: t.targetText,
                sourceLang: t.sourceLang,
                targetLang: t.targetLang,
                timestamp: t.timestamp.toISOString(),
                temp_user_uuid: t.temp_user_uuid,  // Include UUID
                user_emoji: t.user_emoji  // Include emoji
              }));

            ws.send(JSON.stringify({
              type: 'joined',
              roomId,
              history: roomHistory,
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

              // Store all messages, including those from OpenAI
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

                const chatMessage = {
                  type: 'chat',
                  text: message.text,
                  translatedText: message.translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  timestamp: savedTranslation.timestamp.toISOString(),
                  roomId: currentRoom,
                  temp_user_uuid: message.temp_user_uuid,
                  user_emoji: message.user_emoji,
                  isOpenAI: message.isOpenAI
                };

                // Broadcast to all clients in the room
                console.log('Broadcasting stored message to room:', currentRoom);
                broadcast(currentRoom, chatMessage, ws);
              } else {
                // If no translatedText, this is a new message that needs translation
                const translatedText = await translateText(
                  message.text,
                  message.targetLang
                );

                // Include temp_user_uuid and user_emoji in savedTranslation
                const savedTranslation = await storage.addTranslation({
                  sourceText: message.text,
                  targetText: translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  roomId: currentRoom,
                  temp_user_uuid: message.temp_user_uuid, // Pass through the UUID
                  user_emoji: message.user_emoji // Pass through the emoji
                });

                const chatMessage = {
                  type: 'chat',
                  text: message.text,
                  translatedText,
                  sourceLang: message.sourceLang || "en",
                  targetLang: message.targetLang,
                  timestamp: savedTranslation.timestamp.toISOString(),
                  roomId: currentRoom,
                  temp_user_uuid: savedTranslation.temp_user_uuid,
                  user_emoji: savedTranslation.user_emoji
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
                roomId: roomToClear
              });
            } catch (error) {
              console.error('Failed to clear room:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to clear room messages'
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
      const { sourceText, targetLang, roomId } = insertTranslationSchema.parse({
        sourceText: req.body.text,
        targetLang: req.body.targetLang,
        sourceLang: "en",
        targetText: "",
        roomId: req.body.roomId 
      });

      const targetText = await translateText(sourceText, targetLang);

      const translation = await storage.addTranslation({
        sourceText,
        targetText,
        sourceLang: "en",
        targetLang,
        roomId 
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

  return httpServer;
}
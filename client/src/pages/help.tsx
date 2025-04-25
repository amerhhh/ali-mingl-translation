import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { supportedLanguages, type LanguageCode } from "@shared/schema";
import { translateUIText } from "@/lib/translations";
import { Documentation } from "@/components/documentation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  MessageSquare,
  Headphones,
  HelpCircle
} from "lucide-react";

const defaultUiText = {
  chat: "Chat",
  listen: "Listen",
  help: "Help",
  helpTitle: "Help and Documentation"
};

export default function Help() {
  const urlSearchParams = new URLSearchParams(window.location.search);
  const currentRoomId = urlSearchParams.get('id') || '';
  const [, setLocation] = useLocation();
  const [uiText, setUiText] = useState(defaultUiText);
  
  // Add a state to store both room IDs
  const [roomIds, setRoomIds] = useState<{chatRoomId: string, listenRoomId: string} | null>(null);

  const getInitialLanguages = () => {
    const deviceLang = navigator.language.split('-')[0].toLowerCase();
    if (deviceLang in supportedLanguages) {
      if (deviceLang !== 'en') {
        return deviceLang as LanguageCode;
      }
      return 'en' as LanguageCode;
    }
    return 'en' as LanguageCode;
  };

  const [sourceLang, setSourceLang] = useState<LanguageCode>(getInitialLanguages());

  const translateUI = async (lang: LanguageCode) => {
    if (lang === 'en') {
      setUiText(defaultUiText);
      return;
    }
    try {
      const translations = await Promise.all(
        Object.entries(defaultUiText).map(async ([key, text]) => {
          const translated = await translateUIText(text, lang);
          return [key, translated];
        })
      );
      const updatedUiText = Object.fromEntries(translations);
      setUiText(updatedUiText);
    } catch (error) {
      console.error('Failed to translate UI:', error);
      setUiText(defaultUiText);
    }
  };

  useEffect(() => {
    translateUI(sourceLang);
    
    // Load room IDs from localStorage if they exist
    const storedRoomIds = localStorage.getItem('streamflow_room_ids');
    if (storedRoomIds) {
      try {
        setRoomIds(JSON.parse(storedRoomIds));
      } catch (error) {
        console.error("Failed to parse stored room IDs:", error);
      }
    }
  }, [sourceLang]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F2F0FF] to-[#EDEDED] p-4 md:p-6">
      <div className="container mx-auto max-w-4xl">
        {/* Main Navigation Tabs */}
        <div className="mb-6">
          <Tabs defaultValue="help" className="w-full" onValueChange={value => {
            if (value === "chat") {
              // Use pre-created chat room ID if available
              if (roomIds?.chatRoomId) {
                setLocation(`/chat/${roomIds.chatRoomId}`);
              } else {
                // Fall back to current room ID or just navigate to base chat
                setLocation(currentRoomId ? `/chat/${currentRoomId}` : '/chat');
              }
            } else if (value === "listen") {
              // Use pre-created listen room ID if available
              if (roomIds?.listenRoomId) {
                setLocation(`/listen/${roomIds.listenRoomId}`);
              } else {
                // Fall back to current room ID or just navigate to base listen
                setLocation(currentRoomId ? `/listen/${currentRoomId}` : '/listen');
              }
            }
          }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="chat">
                <MessageSquare className="h-4 w-4 mr-2" />
                {uiText.chat}
              </TabsTrigger>
              <TabsTrigger value="listen">
                <Headphones className="h-4 w-4 mr-2" />
                {uiText.listen}
              </TabsTrigger>
              <TabsTrigger value="help">
                <HelpCircle className="h-4 w-4 mr-2" />
                {uiText.help}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="space-y-4 md:space-y-6">
          <Card className="p-6 md:p-8">
            <h1 className="text-2xl font-bold mb-6">{uiText.helpTitle}</h1>
            <Documentation sourceLang={sourceLang} className="w-full" />
          </Card>
        </div>
      </div>
    </div>
  );
}
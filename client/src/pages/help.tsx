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
  }, [sourceLang]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F2F0FF] to-[#EDEDED] p-4 md:p-6">
      <div className="container mx-auto max-w-4xl">
        {/* Main Navigation Tabs */}
        <div className="mb-6">
          <Tabs defaultValue="help" className="w-full" onValueChange={value => {
            if (value === "chat") {
              window.location.href = `/chat${currentRoomId ? `?id=${currentRoomId}` : ''}`;
            } else if (value === "listen") {
              window.location.href = `/listen${currentRoomId ? `?id=${currentRoomId}` : ''}`;
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
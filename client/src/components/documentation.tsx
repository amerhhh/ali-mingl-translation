import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { translateWithLanguage } from "@/lib/translations";
import { type LanguageCode, supportedLanguages } from "@shared/schema";

interface DocumentationProps {
  className?: string;
  sourceLang?: LanguageCode;
}

interface TranslatedContent {
  title: string;
  gettingStarted: {
    title: string;
    steps: string[];
  };
  connection: {
    title: string;
    description: string;
  };
  uniqueFeatures: {
    title: string;
    features: string[];
  };
  tips: {
    title: string;
    items: string[];
  };
}

const defaultContent: TranslatedContent = {
  title: "TranslatorLiveChat: Simplified Communication with Rooms",
  gettingStarted: {
    title: "Getting Started",
    steps: [
      "Choose your preferred source and target languages from the dropdown menus",
      "Use the swap button (↔️) to quickly switch between languages",
      "Start speaking to see real-time translations"
    ]
  },
  connection: {
    title: "Connecting with Someone",
    description: "Click on the Share Icon and show the QR Code. When you want to chat with someone, simply show them the QR Code displayed on your screen. They can scan it, and they will instantly join your Room for communication."
  },
  uniqueFeatures: {
    title: "Why This is Unique",
    features: [
      "No Need for Typing or Complex Setup: Just scan the code and start talking",
      "Natural, Fluid Conversations: Each participant communicates in their native language",
      "Eliminates Language Barriers: The app removes the challenge of different languages",
      "Real-time Translation: See translations as you speak",
      "Multiple Input Options: Use voice or text input as needed",
      "Device Selection: Choose your preferred microphone and speaker"
    ]
  },
  tips: {
    title: "Tips & Tricks",
    items: [
      "Speak clearly and at a normal pace for best results",
      "Use the built-in microphone for better ambient sound capture",
      "Toggle automatic playback for hands-free operation",
      "Share your room ID or QR code for quick connections",
      "Select your preferred input/output devices in settings"
    ]
  }
};

export function Documentation({ className, sourceLang = 'en' }: DocumentationProps) {
  const [content, setContent] = useState<TranslatedContent>(defaultContent);

  useEffect(() => {
    const translateContent = async () => {
      if (sourceLang === 'en') {
        setContent(defaultContent);
        return;
      }

      try {
        const translatedContent: TranslatedContent = {
          title: await translateWithLanguage(defaultContent.title, sourceLang, 'documentation'),
          gettingStarted: {
            title: await translateWithLanguage(defaultContent.gettingStarted.title, sourceLang, 'documentation'),
            steps: await Promise.all(
              defaultContent.gettingStarted.steps.map(step => 
                translateWithLanguage(step, sourceLang, 'documentation')
              )
            )
          },
          connection: {
            title: await translateWithLanguage(defaultContent.connection.title, sourceLang, 'documentation'),
            description: await translateWithLanguage(defaultContent.connection.description, sourceLang, 'documentation')
          },
          uniqueFeatures: {
            title: await translateWithLanguage(defaultContent.uniqueFeatures.title, sourceLang, 'documentation'),
            features: await Promise.all(
              defaultContent.uniqueFeatures.features.map(feature => 
                translateWithLanguage(feature, sourceLang, 'documentation')
              )
            )
          },
          tips: {
            title: await translateWithLanguage(defaultContent.tips.title, sourceLang, 'documentation'),
            items: await Promise.all(
              defaultContent.tips.items.map(item => 
                translateWithLanguage(item, sourceLang, 'documentation')
              )
            )
          }
        };

        setContent(translatedContent);
      } catch (error) {
        console.error('Failed to translate documentation:', error);
        setContent(defaultContent);
      }
    };

    translateContent();
  }, [sourceLang]);

  return (
    <Card className={className}>
      <div className="space-y-6 p-6">
        <section>
          <h2 className="text-2xl font-semibold mb-4">{content.title}</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">{content.gettingStarted.title}</h3>
              <ul className="list-disc pl-5 space-y-2">
                {content.gettingStarted.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">{content.connection.title}</h3>
              <p className="mb-4">{content.connection.description}</p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">{content.uniqueFeatures.title}</h3>
              <ul className="list-disc pl-5 space-y-2">
                {content.uniqueFeatures.features.map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">{content.tips.title}</h3>
              <ul className="list-disc pl-5 space-y-2">
                {content.tips.items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </Card>
  );
}
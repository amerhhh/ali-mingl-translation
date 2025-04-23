import OpenAI from "openai";
import axios from "axios";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function translateText(text: string, targetLang: string): Promise<string> {
  try {
    console.log(`Translating text to ${targetLang}: "${text}"`);

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate from English to ${targetLang}.
          Language-specific rules:
          - For Italian (it): Use formal 'Lei' form for instructions and polite speech
          - For Spanish (es): Use neutral Latin American Spanish
          - For Arabic (ar): Use Modern Standard Arabic (MSA)

          Important translation rules:
          1. Input text is in English, translate it to ${targetLang}
          2. Keep the translation natural and idiomatic in ${targetLang}
          3. Maintain the same tone and formality level appropriate for ${targetLang}
          4. Keep proper names unchanged
          5. If the text is a question, ensure it remains a question in ${targetLang}
          6. For technical terms, use standard translations in ${targetLang}

          Respond only with the translation, no explanations or additional text.`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3, // Lower temperature for more consistent translations
    });

    const translation = response.choices[0].message.content || text;
    console.log(`Translation result: "${translation}"`);
    return translation;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Translation error:', errorMessage);
    throw new Error(`Failed to translate text: ${errorMessage}`);
  }
}

// Function to translate UI text
export async function translateUIText(text: string, targetLang: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a professional UI translator. Translate from English to ${targetLang}.
          Language-specific rules:
          - For Italian (it): Use formal 'Lei' form for instructions, maintain technical terms in English
          - For Spanish (es): Use neutral Latin American Spanish, keep UI consistency
          - For Arabic (ar): Use Modern Standard Arabic (MSA), ensure RTL compatibility

          Important rules:
          1. Input text is in English, translate it to ${targetLang}
          2. Keep any placeholders (like {name} or %s) unchanged
          3. Preserve any HTML/JSX tags if present
          4. Keep technical terms in English if they are standard terms
          5. Ensure button texts and labels remain clear and concise in ${targetLang}
          6. Maintain cultural appropriateness in ${targetLang}

          Respond only with the translation, no explanations or additional text.`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3,
    });

    return response.choices[0].message.content || text;
  } catch (error) {
    console.error('UI translation error:', error);
    return text; // Fallback to original text on error
  }
}

/**
 * Helper function to convert language codes to full language names
 * This helps ensure OpenAI models properly understand the language request
 */
function getLanguageForOpenAI(langCode: string): string {
  // Normalize the language code first
  const normalizedCode = langCode.toLowerCase().split('-')[0];
  
  // Map language codes to their full names
  const languageMap: Record<string, string> = {
    'en': 'English',
    'ar': 'Arabic',
    'es': 'Spanish',
    'it': 'Italian',
    // Add more mappings as needed
  };
  
  // Return the full language name if available, otherwise return the original code
  return languageMap[normalizedCode] || langCode;
}

/**
 * Create a realtime speech session with OpenAI
 * @param {string} sourceLang - Source language code
 * @param {string} targetLang - Target language code
 * @returns {Promise<any>} - Session data with ephemeral token
 */
export async function createRealtimeSpeechSession(sourceLang: string, targetLang: string): Promise<any> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    // Set up configuration for the real-time speech session
    const sessionConfig = {
      // Model selection
      model: "gpt-4o-realtime-preview-2024-12-17",
      
      // Voice selection
      voice: "verse",
      
      // Audio processing settings
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_noise_reduction: {
        type: "far_field"
      },
      
      // Enhanced turn detection for better conversation flow
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        silence_duration_ms: 200,
        prefix_padding_ms: 300,
        create_response: true,
        interrupt_response: true
      },
      
      // Generation parameters
      temperature: 0.7,
      max_response_output_tokens: "inf",
      
      // Modalities
      modalities: ["text", "audio"],
      
      // Translation instructions - Using consistent language mapping for models
      instructions: `You are a real-time translator. 
      
      Listen to the input audio and provide both the original text and the translation. Be accurate and concise in your translations. 
      
      Source language: ${getLanguageForOpenAI(sourceLang)}
      Target language: ${getLanguageForOpenAI(targetLang)}
      
      Always format your response so that the original text appears first, followed by the translation on a new line.`
    };

    // Request the ephemeral key from OpenAI with translation config
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      sessionConfig,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Return the response data with the ephemeral key
    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Failed to create realtime speech session:', errorMessage);
    
    // Log more detailed error info if available
    if (error instanceof Error && 'response' in error) {
      const responseData = (error as any).response?.data;
      if (responseData) {
        console.error('OpenAI API error details:', JSON.stringify(responseData, null, 2));
      }
    }
    
    throw new Error(`Failed to create realtime speech session: ${errorMessage}`);
  }
}
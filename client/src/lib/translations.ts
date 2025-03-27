import type { LanguageCode } from "@shared/schema";

export async function translateUIText(text: string, targetLang: LanguageCode): Promise<string> {
  try {
    const response = await fetch('/api/translate-ui', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        targetLang
      })
    });

    if (!response.ok) {
      throw new Error('Failed to translate UI text');
    }

    const data = await response.json();
    return data.translation || text;
  } catch (error) {
    console.error('UI translation error:', error);
    return text; // Fallback to original text on error
  }
}

export async function translateWithLanguage(text: string, language: string, targetLang: LanguageCode): Promise<string> {
  try {
    const textWithLang = text.replace('[LANGUAGE]', language);
    console.log('Translating text:', {
      original: text,
      withLanguage: textWithLang,
      targetLang
    });

    const response = await fetch('/api/translate-ui', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: textWithLang,
        targetLang
      })
    });

    if (!response.ok) {
      throw new Error('Failed to translate text with language');
    }

    const data = await response.json();
    console.log('Translation response:', data);
    return data.translation || textWithLang;
  } catch (error) {
    console.error('Translation with language error:', error);
    return text.replace('[LANGUAGE]', language); // Fallback to original text with language
  }
}
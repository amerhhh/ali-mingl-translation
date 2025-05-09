import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supportedLanguages, type LanguageCode } from "@shared/schema";

interface LanguageSelectorProps {
  value: LanguageCode;
  onChange: (value: LanguageCode) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function LanguageSelector({ value, onChange, label, placeholder = "Select language", disabled = false }: LanguageSelectorProps) {
  const allowedLanguages: [LanguageCode, string][] = Object.entries(supportedLanguages).map(
    ([code, names]) => [code as LanguageCode, `${names.native} (${names.english})`]
  );

  const getDisplayName = (code: LanguageCode) => {
    const lang = supportedLanguages[code];
    return `${lang.native} (${lang.english})`;
  };

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-sm font-medium text-muted-foreground">{label}</span>}
      <Select value={value} onValueChange={(val) => onChange(val as LanguageCode)} disabled={disabled}>
        <SelectTrigger className={`w-full bg-white border-gray-200 transition-colors ${!disabled ? 'hover:bg-gray-50' : ''}`}>
          <SelectValue>
            {value ? getDisplayName(value) : placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowedLanguages.map(([code, displayName]) => (
            <SelectItem 
              key={code} 
              value={code}
              className="cursor-pointer hover:bg-gray-50"
            >
              {displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
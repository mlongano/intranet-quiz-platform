import { useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { getStoredTheme, setTheme, type ThemeMode } from "../lib/theme";

const OPTIONS: { value: ThemeMode; Icon: typeof Monitor; label: string }[] = [
  { value: "system", Icon: Monitor, label: "System" },
  { value: "light", Icon: Sun, label: "Light" },
  { value: "dark", Icon: Moon, label: "Dark" },
];

export default function ThemeToggle() {
  const [active, setActive] = useState<ThemeMode>(getStoredTheme());

  const handleSelect = (value: ThemeMode) => {
    setActive(value);
    setTheme(value);
  };

  return (
    <div className="bg-surface-container rounded-lg border border-outline-variant/30 flex p-1">
      {OPTIONS.map(({ value, Icon, label }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            onClick={() => handleSelect(value)}
            title={label}
            className={`flex items-center justify-center p-1.5 rounded-md transition-all ${
              isActive
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-bright"
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
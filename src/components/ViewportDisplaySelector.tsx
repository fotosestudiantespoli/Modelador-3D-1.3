import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { ViewportDisplayMode } from '../core/project/types';

interface ViewportDisplaySelectorProps {
  displayMode: ViewportDisplayMode;
  xrayTransparency: number;
  onSelectDisplayMode: (mode: ViewportDisplayMode) => void;
  onChangeXrayTransparency: (value: number) => void;
}

export interface ModeMeta {
  id: ViewportDisplayMode;
  label: string;
  shortDesc: string;
  disabled?: boolean;
}

export const DISPLAY_MODES: ModeMeta[] = [
  {
    id: 'wireframe',
    label: 'Wireframe',
    shortDesc: 'Wireframe · Solo aristas',
  },
  {
    id: 'solid',
    label: 'Sólido',
    shortDesc: 'Sólido · Sombreado neutro',
  },
  {
    id: 'xray',
    label: 'X-Ray',
    shortDesc: 'X-Ray · Superficie translúcida',
  },
  {
    id: 'material',
    label: 'Material Preview',
    shortDesc: 'Material Preview · Función futura',
    disabled: true,
  },
];

export const XRAY_PRESETS = [
  { value: 10, label: '10%', desc: 'Casi opaco' },
  { value: 30, label: '30%', desc: 'Transp. moderada' },
  { value: 50, label: '50%', desc: 'Equilibrada' },
  { value: 70, label: '70%', desc: 'Muy transparente' },
  { value: 90, label: '90%', desc: 'Casi invisible' },
] as const;

export function getXrayDescriptor(value: number): string {
  if (value <= 20) return 'Casi opaco';
  if (value <= 40) return 'Transp. moderada';
  if (value <= 60) return 'Equilibrada';
  if (value <= 80) return 'Muy transparente';
  return 'Casi invisible';
}

export const ShadingModeIcon: React.FC<{
  mode: ViewportDisplayMode;
  active: boolean;
}> = ({ mode, active }) => {
  switch (mode) {
    case 'wireframe':
      return (
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={active ? 1.9 : 1.65}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <ellipse cx="12" cy="12" rx="4.2" ry="8.5" />
          <path d="M3.8 12h16.4" />
          <path d="M5.2 7.8c2.2.9 4.5 1.35 6.8 1.35s4.6-.45 6.8-1.35" />
          <path d="M5.2 16.2c2.2-.9 4.5-1.35 6.8-1.35s4.6.45 6.8 1.35" />
        </svg>
      );
    case 'solid':
      return (
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="8.5"
            fill="currentColor"
            fillOpacity={active ? 0.92 : 0.78}
            stroke="currentColor"
            strokeWidth={1.4}
          />
          <path
            d="M8.5 6.2a6.5 6.5 0 0 0-3.2 5.8 6.5 6.5 0 0 0 1 3.5A7.2 7.2 0 0 1 13.5 5c-1.8-.1-3.5.3-5 1.2Z"
            fill="#ffffff"
            fillOpacity={active ? 0.45 : 0.35}
          />
          <circle
            cx="9.3"
            cy="9"
            r="1.7"
            fill="#ffffff"
            fillOpacity={active ? 0.7 : 0.55}
          />
        </svg>
      );
    case 'xray':
      return (
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={active ? 1.85 : 1.65}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect
            x="8.5"
            y="4"
            width="11"
            height="11"
            rx="1.8"
            strokeDasharray="2.4 2.2"
            opacity={0.75}
          />
          <rect
            x="4.5"
            y="9"
            width="11"
            height="11"
            rx="1.8"
            fill="currentColor"
            fillOpacity={active ? 0.24 : 0.14}
          />
        </svg>
      );
    case 'material':
      return (
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.55}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5v17" />
          <path d="M3.5 12h17" />
          <path
            d="M12 3.5A8.5 8.5 0 0 1 20.5 12H12V3.5Z"
            fill="currentColor"
            fillOpacity={0.45}
          />
          <path
            d="M3.5 12A8.5 8.5 0 0 0 12 20.5V12H3.5Z"
            fill="currentColor"
            fillOpacity={0.45}
          />
        </svg>
      );
  }
};

export const ViewportDisplaySelector: React.FC<ViewportDisplaySelectorProps> = ({
  displayMode,
  xrayTransparency,
  onSelectDisplayMode,
  onChangeXrayTransparency,
}) => {
  const [hintLabel, setHintLabel] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);

  const clearTimers = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const flashHint = (text: string, durationMs = 1900) => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    setHintLabel(text);
    hideTimerRef.current = window.setTimeout(() => {
      setHintLabel(null);
      hideTimerRef.current = null;
    }, durationMs);
  };

  const handlePointerDown = (
    mode: ModeMeta,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    holdTriggeredRef.current = false;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      setHintLabel(mode.shortDesc);
    }, 320);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdTriggeredRef.current) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = window.setTimeout(() => {
        setHintLabel(null);
        hideTimerRef.current = null;
      }, 1100);
    }
  };

  const handleTap = (
    mode: ModeMeta,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false;
      return;
    }
    if (mode.disabled) {
      flashHint('Vista de material · Próximamente', 2200);
      return;
    }
    onSelectDisplayMode(mode.id);
    flashHint(mode.shortDesc, 1600);
  };

  const activeModeMeta =
    DISPLAY_MODES.find((m) => m.id === displayMode) ?? DISPLAY_MODES[1];

  return (
    <div
      className="flex flex-col items-center gap-1.5 pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 4-Mode Visual Selector Bar */}
      <div
        role="toolbar"
        aria-label="Modos de visualización del viewport"
        className="flex items-center gap-1 p-1 rounded-lg bg-[#181a1f]/95 border border-[#2f333d] shadow-lg"
      >
        {DISPLAY_MODES.map((mode) => {
          const isActive = !mode.disabled && displayMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={isActive}
              aria-disabled={mode.disabled ? 'true' : undefined}
              aria-label={mode.shortDesc}
              title={mode.shortDesc}
              onPointerDown={(e) => handlePointerDown(mode, e)}
              onPointerUp={handlePointerUpOrCancel}
              onPointerCancel={handlePointerUpOrCancel}
              onMouseEnter={() => {
                if (hideTimerRef.current === null) {
                  setHintLabel(mode.shortDesc);
                }
              }}
              onMouseLeave={() => {
                if (hideTimerRef.current === null) {
                  setHintLabel(null);
                }
              }}
              onClick={(e) => handleTap(mode, e)}
              className={`relative w-11 h-10 rounded-md border flex items-center justify-center transition-colors touch-manipulation select-none ${
                mode.disabled
                  ? 'bg-[#14161b]/80 border-transparent text-[#626977] opacity-65 cursor-not-allowed hover:opacity-80'
                  : isActive
                    ? 'bg-[#2c313b] border-[#ff9900]/75 text-[#ff9900] shadow-inner'
                    : 'bg-transparent border-transparent text-[#b4bac4] hover:text-white hover:bg-[#242832]'
              }`}
            >
              <ShadingModeIcon mode={mode.id} active={isActive} />

              {/* Active bottom bar indicator */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-2.5 right-2.5 h-0.5 rounded-full bg-[#ff9900]"
                />
              )}

              {/* Future-feature subtle lock indicator on Material Preview */}
              {mode.disabled && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-[#1e222b] border border-[#3a404e] flex items-center justify-center"
                >
                  <Lock className="w-2 h-2 text-[#8e95a2]" />
                </span>
              )}
            </button>
          );
        })}

        <div className="hidden md:flex items-center pl-1.5 pr-2 border-l border-[#2c313b] text-[11px] font-medium text-[#d1d5db] whitespace-nowrap">
          <span>{activeModeMeta.label}</span>
        </div>
      </div>

      {/* Hover / Hold / Tap Mode Name Badge */}
      {hintLabel && (
        <div
          role="status"
          className="px-2.5 py-1 rounded-md bg-[#14161b]/95 border border-[#383e4c] text-[11px] font-medium text-[#f3f4f6] shadow-md whitespace-nowrap pointer-events-none"
        >
          {hintLabel}
        </div>
      )}

      {/* X-Ray Transparency Control (Visible ONLY when X-Ray mode is active) */}
      {displayMode === 'xray' && (
        <div
          className="w-[272px] sm:w-[308px] rounded-lg bg-[#181a1f]/95 border border-[#343a47] shadow-xl px-3 py-2 space-y-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-[#e4e6eb]">
              Transparencia X-Ray
            </span>
            <span className="font-mono-tabular font-semibold text-[#ff9900]">
              {xrayTransparency}% · {getXrayDescriptor(xrayTransparency)}
            </span>
          </div>

          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={xrayTransparency}
            aria-label="Nivel de transparencia X-Ray"
            onChange={(e) =>
              onChangeXrayTransparency(parseInt(e.target.value, 10))
            }
            className="w-full h-5 accent-[#ff9900] cursor-pointer touch-pan-x"
          />

          <div className="grid grid-cols-5 gap-1">
            {XRAY_PRESETS.map((preset) => {
              const selected = xrayTransparency === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onChangeXrayTransparency(preset.value)}
                  title={`${preset.label} · ${preset.desc}`}
                  className={`h-7 rounded text-[10px] font-mono-tabular font-semibold border transition-colors touch-manipulation ${
                    selected
                      ? 'bg-[#2c313b] border-[#ff9900]/75 text-[#ff9900]'
                      : 'bg-[#13151a] border-[#292d37] text-[#9ca3af] hover:text-white hover:bg-[#222630]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

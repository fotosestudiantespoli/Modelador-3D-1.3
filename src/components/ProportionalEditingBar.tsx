import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Link2,
  Minus,
  Plus,
} from 'lucide-react';
import {
  PROPORTIONAL_FALLOFF_LIST,
  ProportionalEditingSettings,
  ProportionalFalloff,
  clampProportionalRadius,
} from '../core/mesh/proportionalEditing';

interface ProportionalEditingBarProps {
  config: ProportionalEditingSettings;
  hasSelection: boolean;
  modifierWarning?: string | null;
  onToggleEnabled: () => void;
  onToggleConnectedOnly: () => void;
  onChangeFalloff: (falloff: ProportionalFalloff) => void;
  onChangeRadius: (radius: number) => void;
}

const FalloffCurveSvg: React.FC<{
  falloff: ProportionalFalloff;
  className?: string;
}> = ({ falloff, className = 'w-4 h-3.5' }) => {
  let d = 'M2 13 C6 13, 8 3, 12 3 C16 3, 18 13, 22 13';
  switch (falloff) {
    case 'smooth':
      d = 'M2 13 C6 13, 8 3, 12 3 C16 3, 18 13, 22 13';
      break;
    case 'sphere':
      d = 'M2 13 A10 10 0 0 1 22 13';
      break;
    case 'root':
      d = 'M2 13 Q5 4 12 3 Q19 4 22 13';
      break;
    case 'sharp':
      d = 'M2 13 Q9 12 12 3 Q15 12 22 13';
      break;
    case 'linear':
      d = 'M2 13 L12 3 L22 13';
      break;
    case 'constant':
      d = 'M2 13 L5 13 L5 3 L19 3 L19 13 L22 13';
      break;
  }
  return (
    <svg
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
};

export const ProportionalIcon: React.FC<{ className?: string }> = ({
  className = 'w-4 h-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" opacity="0.72" />
    <path d="M5 17c2.4 0 3.7-9 7-9s4.6 9 7 9" />
    <circle cx="12" cy="8" r="1.7" fill="currentColor" stroke="none" />
  </svg>
);

export const ProportionalEditingBar: React.FC<ProportionalEditingBarProps> = ({
  config,
  hasSelection,
  modifierWarning = null,
  onToggleEnabled,
  onToggleConnectedOnly,
  onChangeFalloff,
  onChangeRadius,
}) => {
  const [showFalloffMenu, setShowFalloffMenu] = useState(false);
  const [radiusInput, setRadiusInput] = useState(() =>
    config.radius.toFixed(2),
  );

  useEffect(() => {
    setRadiusInput(
      config.radius >= 10
        ? config.radius.toFixed(1)
        : config.radius.toFixed(2),
    );
  }, [config.radius]);

  useEffect(() => {
    if (!config.enabled) {
      setShowFalloffMenu(false);
    }
  }, [config.enabled]);

  const activeFalloffMeta =
    PROPORTIONAL_FALLOFF_LIST.find((f) => f.id === config.falloff) ??
    PROPORTIONAL_FALLOFF_LIST[0];

  const sliderMax = Math.max(10, Math.ceil(config.radius));

  const commitRadiusText = (raw: string) => {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      const clamped = clampProportionalRadius(parsed);
      onChangeRadius(clamped);
      setRadiusInput(clamped >= 10 ? clamped.toFixed(1) : clamped.toFixed(2));
    } else {
      setRadiusInput(
        config.radius >= 10
          ? config.radius.toFixed(1)
          : config.radius.toFixed(2),
      );
    }
  };

  const stepRadius = (factor: number) => {
    const next = clampProportionalRadius(config.radius * factor);
    onChangeRadius(next);
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute top-3 left-1/2 -translate-x-1/2 z-15 flex flex-col items-center gap-1.5 max-w-[calc(100%-140px)] pointer-events-none"
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl bg-[#181a1f]/95 border border-[#343a47] shadow-xl backdrop-blur-sm">
        {/* Toggle ON/OFF */}
        <button
          type="button"
          onClick={onToggleEnabled}
          aria-pressed={config.enabled}
          title="Alternar Edición Proporcional (O)"
          className={`h-8 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors touch-manipulation ${
            config.enabled
              ? 'bg-[#2a1f10] border-[#ff9900] text-[#ffb84d]'
              : 'bg-[#22252d] hover:bg-[#2a2e38] border-[#323640] text-[#b4bac4] hover:text-white'
          }`}
        >
          <ProportionalIcon className="w-4 h-4 shrink-0" />
          <span>Proporcional</span>
          <span
            className={`text-[10px] font-bold px-1 rounded ${
              config.enabled
                ? 'bg-[#ff9900] text-[#111215]'
                : 'bg-[#14161b] text-[#7e8592]'
            }`}
          >
            {config.enabled ? 'ON' : 'OFF'}
          </span>
        </button>

        {config.enabled && (
          <>
            {/* Connected Only Toggle */}
            <button
              type="button"
              onClick={onToggleConnectedOnly}
              aria-pressed={config.connectedOnly}
              title="Solo Conectados: propagar únicamente por vértices conectados (Alt+O)"
              className={`h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors touch-manipulation ${
                config.connectedOnly
                  ? 'bg-[#132638] border-[#38bdf8] text-[#7dd3fc]'
                  : 'bg-[#22252d] hover:bg-[#2a2e38] border-[#323640] text-[#d1d5db]'
              }`}
            >
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Conectados</span>
            </button>

            {/* Falloff Curve Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFalloffMenu((p) => !p)}
                aria-expanded={showFalloffMenu}
                title="Cambiar tipo de curva de caída (Shift+O)"
                className="h-8 px-2.5 rounded-lg bg-[#22252d] hover:bg-[#2a2e38] border border-[#323640] text-xs font-medium text-[#e4e6eb] flex items-center gap-1.5 transition-colors touch-manipulation"
              >
                <FalloffCurveSvg
                  falloff={config.falloff}
                  className="w-4 h-3.5 text-[#ff9900] shrink-0"
                />
                <span>{activeFalloffMeta.shortLabel}</span>
                {showFalloffMenu ? (
                  <ChevronUp className="w-3.5 h-3.5 text-[#9ca3af]" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-[#9ca3af]" />
                )}
              </button>

              {showFalloffMenu && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-10 left-0 w-56 rounded-xl bg-[#181a1f] border border-[#343a47] shadow-2xl p-1.5 space-y-0.5 z-30"
                >
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#8e95a2]">
                    Curva de caída
                  </div>
                  {PROPORTIONAL_FALLOFF_LIST.map((curve) => {
                    const active = curve.id === config.falloff;
                    return (
                      <button
                        key={curve.id}
                        type="button"
                        onClick={() => {
                          onChangeFalloff(curve.id);
                          setShowFalloffMenu(false);
                        }}
                        className={`w-full min-h-[38px] px-2.5 py-1.5 rounded-lg text-left flex items-center gap-2.5 transition-colors touch-manipulation ${
                          active
                            ? 'bg-[#2c313b] border border-[#ff9900]/65 text-[#ff9900]'
                            : 'hover:bg-[#252932] text-[#e4e6eb] border border-transparent'
                        }`}
                      >
                        <FalloffCurveSvg
                          falloff={curve.id}
                          className={`w-5 h-4 shrink-0 ${
                            active ? 'text-[#ff9900]' : 'text-[#9ca3af]'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold leading-tight">
                            {curve.label}
                          </div>
                          <div className="text-[10px] text-[#8e95a2] truncate">
                            {curve.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Touch-friendly Radius Step - / Slider / Numeric Input / Step + */}
            <div
              className="flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-lg bg-[#121418] border border-[#2b2f3a]"
              title="Radio de influencia (arrastra el deslizador, escribe un valor o usa [ y ] incluso durante la transformación)"
            >
              <span className="text-[11px] font-medium text-[#9ca3af] hidden md:inline">
                Radio
              </span>
              <button
                type="button"
                onClick={() => stepRadius(0.85)}
                aria-label="Reducir radio proporcional"
                className="w-7 h-7 rounded-md bg-[#20232b] hover:bg-[#2a2e38] active:bg-[#343a47] text-[#e4e6eb] flex items-center justify-center touch-manipulation"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min={0.05}
                max={sliderMax}
                step={0.05}
                value={Math.min(sliderMax, config.radius)}
                aria-label="Deslizador de radio proporcional"
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val)) {
                    onChangeRadius(clampProportionalRadius(val));
                  }
                }}
                className="w-20 sm:w-28 h-5 accent-[#ff9900] cursor-pointer touch-pan-x"
              />
              <input
                type="number"
                min={0.05}
                max={200}
                step={0.1}
                value={radiusInput}
                aria-label="Valor numérico del radio proporcional"
                onChange={(e) => setRadiusInput(e.target.value)}
                onBlur={() => commitRadiusText(radiusInput)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    commitRadiusText(radiusInput);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-14 h-7 px-1.5 rounded-md bg-[#1a1d24] border border-[#313643] focus:border-[#ff9900] text-xs font-mono-tabular text-right text-[#f3f4f6] outline-none"
              />
              <button
                type="button"
                onClick={() => stepRadius(1.18)}
                aria-label="Aumentar radio proporcional"
                className="w-7 h-7 rounded-md bg-[#20232b] hover:bg-[#2a2e38] active:bg-[#343a47] text-[#e4e6eb] flex items-center justify-center touch-manipulation"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Subtle contextual hints / warnings */}
      {config.enabled && !hasSelection && (
        <div className="px-2.5 py-0.5 rounded-md bg-[#181a1f]/90 border border-[#323640] text-[10px] text-[#9ca3af] shadow">
          Selecciona vértices, aristas o caras para ver y transformar el área proporcional
        </div>
      )}
      {config.enabled && modifierWarning && (
        <div className="px-2.5 py-1 rounded-md bg-[#2a1f10]/95 border border-[#f59e0b]/60 text-[10px] text-[#fcd34d] flex items-center gap-1.5 shadow">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{modifierWarning}</span>
        </div>
      )}
    </div>
  );
};

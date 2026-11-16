import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GripHorizontal } from 'lucide-react';
import {
  TouchControlSettings,
  TouchModifierBehaviorMode,
  TouchModifierKey,
  TouchModifierState,
} from '../core/project/types';

interface FloatingModifierPanelProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  settings: TouchControlSettings;
  effectiveModifiers: TouchModifierState;
  virtualModifiers: TouchModifierState;
  onSetModifier: (key: TouchModifierKey, active: boolean) => void;
  onToggleModifier: (key: TouchModifierKey) => void;
  onReleaseAll: () => void;
  onChangeBehaviorMode: (mode: TouchModifierBehaviorMode) => void;
}

const SESSION_POS_KEY = 'forma3d_modifier_panel_pos_v1';

interface PanelPosPct {
  xPct: number;
  yPct: number;
}

function loadSessionPanelPos(): PanelPosPct | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelPosPct>;
    if (
      typeof parsed.xPct === 'number' &&
      Number.isFinite(parsed.xPct) &&
      typeof parsed.yPct === 'number' &&
      Number.isFinite(parsed.yPct)
    ) {
      return {
        xPct: Math.max(0, Math.min(1, parsed.xPct)),
        yPct: Math.max(0, Math.min(1, parsed.yPct)),
      };
    }
  } catch {
    // Ignore storage errors on restricted Safari contexts
  }
  return null;
}

function saveSessionPanelPos(pos: PanelPosPct): void {
  try {
    window.sessionStorage.setItem(SESSION_POS_KEY, JSON.stringify(pos));
  } catch {
    // Ignore storage errors
  }
}

const MODIFIER_BUTTON_META: {
  key: TouchModifierKey;
  label: string;
  activeClass: string;
  dotClass: string;
  title: string;
}[] = [
  {
    key: 'shift',
    label: 'SHIFT',
    activeClass: 'bg-[#2a1f10] border-[#ff9900] text-[#ffb84d] shadow-[0_0_10px_rgba(255,153,0,0.22)]',
    dotClass: 'bg-[#ff9900]',
    title: 'SHIFT: Selección múltiple/aditiva, Caja aditiva y atajos combinados (Shift+O, Ctrl+Shift+Z)',
  },
  {
    key: 'ctrl',
    label: 'CTRL',
    activeClass: 'bg-[#122536] border-[#38bdf8] text-[#7dd3fc] shadow-[0_0_10px_rgba(56,189,248,0.22)]',
    dotClass: 'bg-[#38bdf8]',
    title: 'CTRL: Modificador virtual CTRL para atajos combinados (Ctrl+Z, Ctrl+Shift+Z, Ctrl+S)',
  },
  {
    key: 'alt',
    label: 'ALT',
    activeClass: 'bg-[#221936] border-[#a78bfa] text-[#c4b5fd] shadow-[0_0_10px_rgba(167,139,250,0.22)]',
    dotClass: 'bg-[#a78bfa]',
    title: 'ALT: Modificador virtual ALT para atajos combinados (Alt+A deseleccionar, Alt+O solo conectados)',
  },
];

export const FloatingModifierPanel: React.FC<FloatingModifierPanelProps> = ({
  containerRef,
  settings,
  effectiveModifiers,
  virtualModifiers,
  onSetModifier,
  onToggleModifier,
  onReleaseAll,
  onChangeBehaviorMode,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [panelSize, setPanelSize] = useState({ width: 76, height: 186 });
  const [savedPosPct, setSavedPosPct] = useState<PanelPosPct | null>(() =>
    loadSessionPanelPos(),
  );
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const heldPointersRef = useRef<Record<TouchModifierKey, Set<number>>>({
    shift: new Set(),
    ctrl: new Set(),
    alt: new Set(),
  });

  const behaviorMode = settings.modifierPanelMode ?? 'toggle';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setViewportSize({
        width: Math.max(240, el.clientWidth),
        height: Math.max(240, el.clientHeight),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => {
      setPanelSize({
        width: Math.max(68, el.offsetWidth),
        height: Math.max(80, el.offsetHeight),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Release any momentary held modifiers if window loses focus, panel unmounts, or mode changes
  useEffect(() => {
    const releaseHeldPointers = () => {
      const held = heldPointersRef.current;
      (['shift', 'ctrl', 'alt'] as TouchModifierKey[]).forEach((k) => {
        if (held[k].size > 0) {
          held[k].clear();
          onSetModifier(k, false);
        }
      });
    };

    window.addEventListener('blur', releaseHeldPointers);
    return () => {
      window.removeEventListener('blur', releaseHeldPointers);
      releaseHeldPointers();
    };
  }, [behaviorMode, onSetModifier]);

  const visibleButtons = useMemo(
    () =>
      MODIFIER_BUTTON_META.filter((m) => {
        const cfg = settings.modifiers[m.key];
        return cfg?.enabled && cfg?.showScreenButton;
      }),
    [settings.modifiers],
  );

  const activeKeys = useMemo(
    () =>
      (['shift', 'ctrl', 'alt'] as TouchModifierKey[]).filter(
        (k) => effectiveModifiers[k],
      ),
    [effectiveModifiers],
  );

  const hasAnyVirtualActive =
    virtualModifiers.shift || virtualModifiers.ctrl || virtualModifiers.alt;

  const isVisible =
    (settings.modifierPanelEnabled && visibleButtons.length > 0) ||
    activeKeys.length > 0;

  const panelPos = useMemo(() => {
    const pad = 12;
    const maxX = Math.max(pad, viewportSize.width - panelSize.width - pad);
    const maxY = Math.max(pad, viewportSize.height - panelSize.height - pad);

    if (dragPos) {
      return {
        x: Math.max(8, Math.min(maxX, dragPos.x)),
        y: Math.max(8, Math.min(maxY, dragPos.y)),
      };
    }

    if (savedPosPct) {
      return {
        x: Math.max(
          8,
          Math.min(maxX, savedPosPct.xPct * viewportSize.width),
        ),
        y: Math.max(
          8,
          Math.min(maxY, savedPosPct.yPct * viewportSize.height),
        ),
      };
    }

    // Default ZBrush-inspired compact left-side position (leaves center & bottom bar clear)
    return {
      x: 16,
      y: Math.max(16, Math.min(maxY, viewportSize.height - panelSize.height - 16)),
    };
  }, [dragPos, panelSize.height, panelSize.width, savedPosPct, viewportSize]);

  if (!isVisible) return null;

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: panelPos.x,
      origY: panelPos.y,
    };
  };

  const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setDragPos({
      x: d.origX + (e.clientX - d.startClientX),
      y: d.origY + (e.clientY - d.startClientY),
    });
  };

  const handleDragPointerUpOrCancel = (
    e: React.PointerEvent<HTMLDivElement>,
    commit: boolean,
  ) => {
    e.stopPropagation();
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    if (commit) {
      const pad = 12;
      const maxX = Math.max(pad, viewportSize.width - panelSize.width - pad);
      const maxY = Math.max(pad, viewportSize.height - panelSize.height - pad);
      const finalX = Math.max(
        8,
        Math.min(maxX, d.origX + (e.clientX - d.startClientX)),
      );
      const finalY = Math.max(
        8,
        Math.min(maxY, d.origY + (e.clientY - d.startClientY)),
      );
      const nextPct: PanelPosPct = {
        xPct: finalX / Math.max(1, viewportSize.width),
        yPct: finalY / Math.max(1, viewportSize.height),
      };
      setSavedPosPct(nextPct);
      saveSessionPanelPos(nextPct);
    }
    setDragPos(null);
  };

  const handleButtonPointerDown = (
    key: TouchModifierKey,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    if (behaviorMode !== 'hold') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic capture error
    }
    heldPointersRef.current[key].add(e.pointerId);
    onSetModifier(key, true);
  };

  const handleButtonPointerRelease = (
    key: TouchModifierKey,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    if (behaviorMode !== 'hold') return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    const set = heldPointersRef.current[key];
    if (set.delete(e.pointerId) && set.size === 0) {
      onSetModifier(key, false);
    }
  };

  return (
    <div
      ref={panelRef}
      data-testid="floating-modifier-panel"
      style={{
        left: `${panelPos.x}px`,
        top: `${panelPos.y}px`,
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="absolute z-20 w-[76px] rounded-xl bg-[#181a1f]/95 border border-[#2f333d] shadow-[0_10px_28px_rgba(0,0,0,0.45)] p-1.5 flex flex-col gap-1.5 select-none"
    >
      {/* Draggable Header + Mode Switch (Interruptor / Pulsación) */}
      <div className="flex items-center justify-between gap-1">
        <div
          role="slider"
          aria-label="Mover panel de modificadores"
          aria-valuetext={`${Math.round(panelPos.x)}, ${Math.round(panelPos.y)}`}
          tabIndex={-1}
          title="Arrastra para mover el panel por el visor"
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={(e) => handleDragPointerUpOrCancel(e, true)}
          onPointerCancel={(e) => handleDragPointerUpOrCancel(e, false)}
          className="h-5 flex-1 rounded bg-[#21242c] hover:bg-[#2a2e38] border border-[#2e333f] flex items-center justify-center text-[#8b92a1] hover:text-[#e5e7eb] cursor-grab active:cursor-grabbing"
        >
          <GripHorizontal className="w-3.5 h-3.5" />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const nextMode: TouchModifierBehaviorMode =
              behaviorMode === 'toggle' ? 'hold' : 'toggle';
            onReleaseAll();
            onChangeBehaviorMode(nextMode);
          }}
          title={
            behaviorMode === 'toggle'
              ? 'Modo Interruptor (tocar para activar/desactivar). Toca para cambiar a Modo Pulsación.'
              : 'Modo Pulsación (mantener presionado). Toca para cambiar a Modo Interruptor.'
          }
          className={`h-5 px-1.5 rounded border text-[9px] font-bold tracking-wider transition-colors ${
            behaviorMode === 'hold'
              ? 'bg-[#2a1f10] border-[#ff9900]/70 text-[#ffb84d]'
              : 'bg-[#20232b] border-[#313643] text-[#9aa1b0] hover:text-white'
          }`}
        >
          {behaviorMode === 'toggle' ? 'INT' : 'PUL'}
        </button>
      </div>

      {/* Modifier Buttons (SHIFT / CTRL / ALT) */}
      {settings.modifierPanelEnabled && visibleButtons.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {visibleButtons.map((btn) => {
            const isActive = effectiveModifiers[btn.key];
            return (
              <button
                key={btn.key}
                type="button"
                data-modifier-key={btn.key}
                aria-pressed={isActive}
                title={btn.title}
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => handleButtonPointerDown(btn.key, e)}
                onPointerUp={(e) => handleButtonPointerRelease(btn.key, e)}
                onPointerCancel={(e) => handleButtonPointerRelease(btn.key, e)}
                onLostPointerCapture={(e) =>
                  handleButtonPointerRelease(btn.key, e)
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (behaviorMode === 'toggle') {
                    onToggleModifier(btn.key);
                  }
                }}
                className={`w-full h-11 px-2 rounded-lg border text-xs font-bold tracking-wide flex items-center justify-between transition-colors ${
                  isActive
                    ? btn.activeClass
                    : 'bg-[#20232a] border-[#323744] text-[#b4bac4] hover:text-white hover:border-[#454c5c] active:bg-[#2a2e38]'
                }`}
              >
                <span>{btn.label}</span>
                <span
                  className={`w-2 h-2 rounded-full transition-opacity ${
                    isActive
                      ? `${btn.dotClass} opacity-100`
                      : 'bg-[#4b5262] opacity-55'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Active Combination Indicator (shows multi-modifier combos or gesture-only SHIFT) */}
      {activeKeys.length > 0 && (
        <div className="flex items-center justify-between gap-1 px-1 py-0.5 rounded bg-[#14161b] border border-[#2a2f3a]">
          <span
            data-testid="active-modifiers-indicator"
            className="text-[9px] font-bold tracking-tight text-[#e5e7eb] truncate"
            title={`Modificadores activos: ${activeKeys
              .map((k) => k.toUpperCase())
              .join(' + ')}`}
          >
            {activeKeys.map((k) => k.toUpperCase()).join('+')}
          </span>
          {hasAnyVirtualActive && behaviorMode === 'toggle' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReleaseAll();
              }}
              title="Desactivar todos los modificadores activos"
              className="text-[9px] font-bold text-[#9ca3af] hover:text-white px-0.5"
              aria-label="Limpiar modificadores activos"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
};

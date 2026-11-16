import React, { useState } from 'react';
import {
  Aperture,
  ArrowBigUpDash,
  Hand,
  Info,
  MousePointerClick,
  Plus,
  RotateCcw,
  Sliders,
  X,
} from 'lucide-react';
import {
  FloatingMenuCorner,
  FloatingMenuSize,
  ModelerSettings,
  TouchControlSettings,
  TouchModifierKey,
  TouchModifierSlotConfig,
} from '../core/project/types';
import {
  RADIAL_ACTION_MAP,
  RadialActionId,
  RadialWorkMode,
} from '../core/radial/radialActions';
import { TOUCH_MODIFIER_REGISTRY } from '../engine/TouchGestureManager';
import { RadialActionIcon } from './RadialActionIcon';
import { RadialSlotEditorModal } from './RadialSlotEditorModal';
import type { SceneStatsInfo } from './TopBar';

interface SettingsModalProps {
  settings: ModelerSettings;
  sceneStats?: SceneStatsInfo;
  onUpdateSettings: (patch: Partial<ModelerSettings>) => void;
  onUpdateTouchSettings: (patch: Partial<TouchControlSettings>) => void;
  onUpdateTouchModifier: (
    key: TouchModifierKey,
    patch: Partial<TouchModifierSlotConfig>,
  ) => void;
  onUpdateRadialSlot: (
    mode: RadialWorkMode,
    slotIndex: number,
    actionId: RadialActionId | null,
  ) => void;
  onResetRadialSlot: (mode: RadialWorkMode, slotIndex: number) => void;
  onResetRadialLayout: (mode: RadialWorkMode) => void;
  onResetTouchSettings: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  sceneStats,
  onUpdateSettings,
  onUpdateTouchSettings,
  onUpdateTouchModifier,
  onUpdateRadialSlot,
  onResetRadialSlot,
  onResetRadialLayout,
  onResetTouchSettings,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'viewer' | 'touch'>('touch');
  const [radialEditorMode, setRadialEditorMode] =
    useState<RadialWorkMode>('object');
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);

  const renderSwitch = (
    active: boolean,
    onToggle: () => void,
    label: string,
    disabled = false,
  ) => (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'bg-[#d97706]' : 'bg-[#2c3038]'
      }`}
    >
      <div
        className={`w-6 h-6 rounded-full bg-white transition-transform ${
          active ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );

  const gestureToggles: {
    key: keyof Pick<
      TouchControlSettings,
      | 'oneFingerOrbit'
      | 'oneFingerTapSelect'
      | 'doubleTapBoxSelect'
      | 'twoFingerPinchZoom'
      | 'twoFingerPan'
      | 'twoFingerUndo'
      | 'threeFingerRedo'
      | 'longPressContextMenu'
    >;
    badge: string;
    label: string;
    desc: string;
  }[] = [
    {
      key: 'oneFingerOrbit',
      badge: '1 dedo',
      label: 'Orbitar cámara',
      desc: 'Arrastrar con un dedo en el visor 3D',
    },
    {
      key: 'oneFingerTapSelect',
      badge: '1 toque',
      label: 'Seleccionar elemento',
      desc: 'Tocar objetos, vértices, aristas o caras',
    },
    {
      key: 'doubleTapBoxSelect',
      badge: '2 toques',
      label: 'Selección rectangular',
      desc: 'Doble toque rápido y arrastrar para seleccionar con caja',
    },
    {
      key: 'twoFingerPinchZoom',
      badge: '2 dedos',
      label: 'Zoom con pellizco',
      desc: 'Acercar y alejar la cámara al pellizcar',
    },
    {
      key: 'twoFingerPan',
      badge: '2 dedos',
      label: 'Desplazar cámara (Pan)',
      desc: 'Arrastrar con dos dedos para mover la vista',
    },
    {
      key: 'twoFingerUndo',
      badge: '2 toques',
      label: 'Deshacer (Undo)',
      desc: 'Toque simultáneo con dos dedos',
    },
    {
      key: 'threeFingerRedo',
      badge: '3 toques',
      label: 'Rehacer (Redo)',
      desc: 'Toque simultáneo con tres dedos',
    },
    {
      key: 'longPressContextMenu',
      badge: 'Mantener',
      label: 'Menú contextual',
      desc: 'Mantener presionado sobre objeto o componente',
    },
  ];

  const corners: { id: FloatingMenuCorner; label: string }[] = [
    { id: 'top-left', label: 'Sup. Izq.' },
    { id: 'top-right', label: 'Sup. Der.' },
    { id: 'bottom-left', label: 'Inf. Izq.' },
    { id: 'bottom-right', label: 'Inf. Der.' },
  ];

  const sizes: { id: FloatingMenuSize; label: string }[] = [
    { id: 'small', label: 'Pequeño' },
    { id: 'medium', label: 'Mediano' },
    { id: 'large', label: 'Grande' },
  ];

  const radialModes: { id: RadialWorkMode; label: string }[] = [
    { id: 'object', label: 'Modo Objeto' },
    { id: 'edit', label: 'Modo Edición' },
    { id: 'sculpt', label: 'Escultura (futuro)' },
  ];

  const currentModeSlots = settings.touch.radialLayouts[radialEditorMode];

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
      <div className="w-full max-w-xl max-h-[90vh] bg-[#1c1e24] border border-[#323640] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-4 py-3 border-b border-[#2b2e36] flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-[#f3f4f6]">
            Configuración y Controles Táctiles
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-md hover:bg-[#2a2e38] text-[#9ca3af] hover:text-white flex items-center justify-center"
            aria-label="Cerrar configuración"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="px-4 pt-3 shrink-0">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#13151a] border border-[#2b2e36]">
            <button
              type="button"
              onClick={() => setActiveTab('touch')}
              className={`h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                activeTab === 'touch'
                  ? 'bg-[#2c313b] text-[#ff9900]'
                  : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              <Hand className="w-3.5 h-3.5" />
              <span>Controles táctiles</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('viewer')}
              className={`h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                activeTab === 'viewer'
                  ? 'bg-[#2c313b] text-[#ff9900]'
                  : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Visor y Precisión</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 overflow-y-auto cad-scroll space-y-4">
          {activeTab === 'viewer' ? (
            <>
              {(
                [
                  {
                    key: 'showGrid',
                    label: 'Mostrar cuadrícula 3D',
                    desc: 'Plano de referencia en el origen',
                  },
                  {
                    key: 'showAxes',
                    label: 'Mostrar ejes X, Y, Z',
                    desc: 'Líneas de coordenadas rojo, verde y azul',
                  },
                  {
                    key: 'xrayEditMode',
                    label: 'Modo Rayos X (X-Ray)',
                    desc: 'Vista translúcida que permite seleccionar vértices y aristas posteriores',
                  },
                  {
                    key: 'multiSelectTouch',
                    label: 'Selección múltiple por toque',
                    desc: 'Acumula componentes seleccionados sin tecla Shift',
                  },
                  {
                    key: 'snapEnabled',
                    label: 'Ajuste incremental (Snap)',
                    desc: 'Limita las transformaciones a pasos discretos',
                  },
                ] as const
              ).map((item) => {
                const active =
                  item.key === 'xrayEditMode'
                    ? settings.displayMode === 'xray'
                    : settings[item.key];
                return (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#eceef2]">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-[#8e95a2]">
                        {item.desc}
                      </div>
                    </div>
                    {renderSwitch(
                      active,
                      () => onUpdateSettings({ [item.key]: !active }),
                      item.label,
                    )}
                  </div>
                );
              })}

              <div className="h-px bg-[#2b2e36]" />

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#eceef2]">
                    Tamaño del manipulador 3D
                  </span>
                  <span className="font-mono-tabular text-[#ff9900]">
                    {settings.gizmoSize.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.8"
                  step="0.05"
                  value={settings.gizmoSize}
                  onChange={(e) =>
                    onUpdateSettings({ gizmoSize: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[#ff9900] h-2 cursor-pointer"
                />
              </div>

              {settings.snapEnabled && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <label className="space-y-1">
                    <span className="block text-[11px] text-[#9ca3af]">
                      Paso Mover
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      value={settings.snapTranslateStep}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v) && v > 0) {
                          onUpdateSettings({ snapTranslateStep: v });
                        }
                      }}
                      className="w-full h-9 px-2 rounded bg-[#111317] border border-[#2f333d] text-xs font-mono-tabular text-[#e4e6eb] outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-[#9ca3af]">
                      Ángulo (°)
                    </span>
                    <input
                      type="number"
                      step="5"
                      min="1"
                      value={settings.snapRotateDeg}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v) && v > 0) {
                          onUpdateSettings({ snapRotateDeg: v });
                        }
                      }}
                      className="w-full h-9 px-2 rounded bg-[#111317] border border-[#2f333d] text-xs font-mono-tabular text-[#e4e6eb] outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-[#9ca3af]">
                      Paso Escala
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      value={settings.snapScaleStep}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v) && v > 0) {
                          onUpdateSettings({ snapScaleStep: v });
                        }
                      }}
                      className="w-full h-9 px-2 rounded bg-[#111317] border border-[#2f333d] text-xs font-mono-tabular text-[#e4e6eb] outline-none"
                    />
                  </label>
                </div>
              )}

              {sceneStats && (
                <div className="rounded-lg bg-[#15171c] border border-[#2b2e36] p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#eceef2]">
                      Información de escena
                    </span>
                    <span className="font-mono-tabular text-[#9ca3af]">
                      {sceneStats.objectCount} objeto
                      {sceneStats.objectCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#b4bac4] flex items-center justify-between gap-2">
                    <span className="truncate">
                      Activo: {sceneStats.activeObjectName ?? 'Ninguno'}
                    </span>
                    <span className="font-mono-tabular text-[#ff9900] shrink-0">
                      {sceneStats.workMode === 'edit'
                        ? `Edición (${sceneStats.selectedComponentCount} sel.)`
                        : `Objeto (${sceneStats.selectedObjectCount} sel.)`}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#252831] text-center font-mono-tabular">
                    <div className="rounded bg-[#1b1e25] py-1.5">
                      <div className="text-[10px] text-[#8e95a2]">Vértices</div>
                      <div className="text-xs font-semibold text-[#f3f4f6]">
                        {sceneStats.vertices}
                      </div>
                    </div>
                    <div className="rounded bg-[#1b1e25] py-1.5">
                      <div className="text-[10px] text-[#8e95a2]">Aristas</div>
                      <div className="text-xs font-semibold text-[#f3f4f6]">
                        {sceneStats.edges}
                      </div>
                    </div>
                    <div className="rounded bg-[#1b1e25] py-1.5">
                      <div className="text-[10px] text-[#8e95a2]">Caras</div>
                      <div className="text-xs font-semibold text-[#f3f4f6]">
                        {sceneStats.faces}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Floating Radial Menu & Per-Mode Customization */}
              <div className="rounded-lg bg-[#15171c] border border-[#2b2e36] p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Aperture className="w-4 h-4 text-[#ff9900] shrink-0" />
                    <div>
                      <div className="text-xs font-semibold text-[#eceef2]">
                        Botón flotante y Menú radial
                      </div>
                      <div className="text-[11px] text-[#8e95a2]">
                        Personaliza los 8 botones de cada modo manteniendo pulsado o aquí
                      </div>
                    </div>
                  </div>
                  {renderSwitch(
                    settings.touch.floatingMenuEnabled,
                    () =>
                      onUpdateTouchSettings({
                        floatingMenuEnabled: !settings.touch.floatingMenuEnabled,
                      }),
                    'Activar botón flotante',
                  )}
                </div>

                {settings.touch.floatingMenuEnabled && (
                  <>
                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-medium text-[#a1a7b3]">
                        Posición inicial (también puedes arrastrar el botón)
                      </span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {corners.map((c) => {
                          const selected =
                            !settings.touch.floatingMenuCustomPos &&
                            settings.touch.floatingMenuCorner === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                onUpdateTouchSettings({
                                  floatingMenuCorner: c.id,
                                  floatingMenuCustomPos: null,
                                })
                              }
                              className={`h-9 rounded-md text-[11px] font-medium border transition-colors ${
                                selected
                                  ? 'bg-[#2c313b] border-[#ff9900]/60 text-[#ff9900]'
                                  : 'bg-[#1c1f26] border-[#2e323d] text-[#b4bac4] hover:text-white'
                              }`}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-medium text-[#a1a7b3]">
                        Tamaño del botón
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {sizes.map((s) => {
                          const selected = settings.touch.floatingMenuSize === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() =>
                                onUpdateTouchSettings({ floatingMenuSize: s.id })
                              }
                              className={`h-9 rounded-md text-xs font-medium border transition-colors ${
                                selected
                                  ? 'bg-[#2c313b] border-[#ff9900]/60 text-[#ff9900]'
                                  : 'bg-[#1c1f26] border-[#2e323d] text-[#b4bac4] hover:text-white'
                              }`}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Per-Mode Radial Slot Configurator */}
                    <div className="pt-2 border-t border-[#252831] space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-[#a1a7b3]">
                          Distribución independiente por modo
                        </span>
                        <button
                          type="button"
                          onClick={() => onResetRadialLayout(radialEditorMode)}
                          className="text-[11px] font-medium text-[#ff9900] hover:underline flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restaurar modo</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5">
                        {radialModes.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setRadialEditorMode(m.id)}
                            className={`h-8 rounded-md text-[11px] font-semibold border transition-colors ${
                              radialEditorMode === m.id
                                ? 'bg-[#2c313b] border-[#ff9900]/70 text-[#ff9900]'
                                : 'bg-[#1c1f26] border-[#2e323d] text-[#a1a7b3] hover:text-white'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-4 gap-1.5">
                        {currentModeSlots.map((actionId, idx) => {
                          const def = actionId ? RADIAL_ACTION_MAP[actionId] : null;
                          return (
                            <button
                              key={`${radialEditorMode}-slot-${idx}`}
                              type="button"
                              onClick={() => setEditingSlotIndex(idx)}
                              className={`h-14 px-1.5 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${
                                def
                                  ? 'bg-[#1c1f26] hover:bg-[#252933] border-[#323744] text-[#e5e7eb]'
                                  : 'bg-[#16181e] hover:bg-[#20232b] border-dashed border-[#383e4c] text-[#7c8496]'
                              }`}
                            >
                              {def ? (
                                <RadialActionIcon
                                  icon={def.icon}
                                  className="w-3.5 h-3.5 text-[#ff9900]"
                                />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                              <span className="text-[10px] font-medium truncate max-w-full">
                                {def ? def.shortLabel : `Vacío ${idx + 1}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Modular Touch Modifiers Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#eceef2]">
                  <ArrowBigUpDash className="w-4 h-4 text-[#ff9900]" />
                  <span>Modificadores táctiles (SHIFT / CTRL / ALT)</span>
                </div>

                <div className="rounded-lg bg-[#15171c] border border-[#2b2e36] divide-y divide-[#252831]">
                  {/* Floating Modifier Panel Visibility & Behavior Mode */}
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#eceef2]">
                          Panel flotante de modificadores en el visor
                        </div>
                        <div className="text-[11px] text-[#8e95a2] leading-tight">
                          Muestra botones táctiles movibles para SHIFT, CTRL y ALT con soporte simultáneo.
                        </div>
                      </div>
                      {renderSwitch(
                        settings.touch.modifierPanelEnabled,
                        () =>
                          onUpdateTouchSettings({
                            modifierPanelEnabled:
                              !settings.touch.modifierPanelEnabled,
                          }),
                        'Panel flotante de modificadores',
                      )}
                    </div>

                    {settings.touch.modifierPanelEnabled && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-[#cbd5e1]">
                            Comportamiento de los botones
                          </div>
                          <div className="text-[10px] text-[#8e95a2]">
                            {settings.touch.modifierPanelMode === 'hold'
                              ? 'Mantén presionado el botón mientras usas el modificador.'
                              : 'Toca para activar y vuelve a tocar para desactivar.'}
                          </div>
                        </div>
                        <div className="inline-flex rounded-md bg-[#1d2027] border border-[#2e333e] p-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateTouchSettings({
                                modifierPanelMode: 'toggle',
                              })
                            }
                            className={`h-7 px-2.5 rounded text-[11px] font-semibold transition-colors ${
                              settings.touch.modifierPanelMode !== 'hold'
                                ? 'bg-[#2a1f10] text-[#ffb84d] border border-[#ff9900]/70'
                                : 'text-[#9ca3af] hover:text-white border border-transparent'
                            }`}
                          >
                            Interruptor
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateTouchSettings({
                                modifierPanelMode: 'hold',
                              })
                            }
                            className={`h-7 px-2.5 rounded text-[11px] font-semibold transition-colors ${
                              settings.touch.modifierPanelMode === 'hold'
                                ? 'bg-[#2a1f10] text-[#ffb84d] border border-[#ff9900]/70'
                                : 'text-[#9ca3af] hover:text-white border border-transparent'
                            }`}
                          >
                            Pulsación
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {TOUCH_MODIFIER_REGISTRY.map((mod) => {
                    const cfg = settings.touch.modifiers[mod.key];
                    return (
                      <div key={mod.key} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-14 shrink-0 py-1 rounded bg-[#22252e] border border-[#323746] text-[10px] font-bold text-center text-[#ff9900]">
                              {mod.badgeText}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-[#eceef2]">
                                  {mod.label}
                                </span>
                              </div>
                              <div className="text-[11px] text-[#8e95a2] leading-tight">
                                {mod.description}
                              </div>
                            </div>
                          </div>
                          {renderSwitch(
                            cfg.enabled,
                            () =>
                              onUpdateTouchModifier(mod.key, {
                                enabled: !cfg.enabled,
                              }),
                            mod.label,
                          )}
                        </div>

                        {cfg.enabled && (
                          <div className="pl-16 space-y-2 pt-1">
                            {mod.key === 'shift' && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-[#cbd5e1]">
                                  Gesto de 2 dedos (mantener dedo 1 + tocar con dedo 2)
                                </span>
                                {renderSwitch(
                                  cfg.twoFingerHold,
                                  () =>
                                    onUpdateTouchModifier('shift', {
                                      twoFingerHold: !cfg.twoFingerHold,
                                    }),
                                  'Gesto SHIFT con 2 dedos',
                                )}
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-[#cbd5e1]">
                                Botón {mod.badgeText} visible en el panel flotante
                              </span>
                              {renderSwitch(
                                cfg.showScreenButton,
                                () =>
                                  onUpdateTouchModifier(mod.key, {
                                    showScreenButton: !cfg.showScreenButton,
                                  }),
                                `Botón ${mod.badgeText} en pantalla`,
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Individual Gesture Toggles & Visual Guide */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#eceef2]">
                  <MousePointerClick className="w-4 h-4 text-[#ff9900]" />
                  <span>Guía visual y activación de gestos</span>
                </div>

                <div className="rounded-lg bg-[#15171c] border border-[#2b2e36] divide-y divide-[#252831]">
                  {gestureToggles.map((g) => {
                    const active = settings.touch[g.key];
                    return (
                      <div key={g.key} className="px-3 py-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-16 shrink-0 py-1 rounded bg-[#22252e] border border-[#323746] text-[10px] font-semibold text-center text-[#ff9900]">
                              {g.badge}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-[#eceef2]">
                                {g.label}
                              </div>
                              <div className="text-[11px] text-[#8e95a2] leading-tight">
                                {g.desc}
                              </div>
                            </div>
                          </div>
                          {renderSwitch(
                            active,
                            () => onUpdateTouchSettings({ [g.key]: !active }),
                            g.label,
                          )}
                        </div>
                        {g.key === 'doubleTapBoxSelect' && active && (
                          <div className="pl-[74px] flex items-center justify-between gap-3">
                            <span className="text-[11px] text-[#a1a7b3] whitespace-nowrap">
                              Intervalo doble toque
                            </span>
                            <div className="flex items-center gap-2 flex-1 max-w-[200px]">
                              <input
                                type="range"
                                min={180}
                                max={550}
                                step={10}
                                value={settings.touch.doubleTapIntervalMs}
                                onChange={(e) =>
                                  onUpdateTouchSettings({
                                    doubleTapIntervalMs: parseInt(
                                      e.target.value,
                                      10,
                                    ),
                                  })
                                }
                                className="w-full accent-[#ff9900] cursor-pointer"
                              />
                              <span className="text-[11px] font-mono-tabular text-[#ff9900] w-12 text-right shrink-0">
                                {settings.touch.doubleTapIntervalMs} ms
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* iPadOS Compatibility Info */}
              <div className="rounded-lg bg-[#171c24] border border-[#2d3b4e] p-3 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#60a5fa] shrink-0 mt-0.5" />
                <div className="text-[11px] text-[#b4c3d8] leading-relaxed">
                  <strong className="text-[#e2e8f0]">Compatibilidad con iPadOS / Safari:</strong>{' '}
                  El sistema operativo puede interceptar ciertos gestos de 3 dedos para funciones de edición de texto o multitarea. Si notas interferencia, puedes desactivar el gesto aquí y usar los botones de <strong>Deshacer / Rehacer</strong> en la barra superior o en el menú radial.
                </div>
              </div>

              {/* Restore Defaults */}
              <button
                type="button"
                onClick={onResetTouchSettings}
                className="w-full h-10 rounded-lg bg-[#23262e] hover:bg-[#2c313b] border border-[#353a46] text-xs font-semibold text-[#e5e7eb] flex items-center justify-center gap-2 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#ff9900]" />
                <span>Restaurar configuración predeterminada</span>
              </button>
            </>
          )}
        </div>
      </div>

      {editingSlotIndex !== null && (
        <RadialSlotEditorModal
          mode={radialEditorMode}
          slotIndex={editingSlotIndex}
          currentActionId={currentModeSlots[editingSlotIndex] ?? null}
          onAssignAction={(actionId) =>
            onUpdateRadialSlot(radialEditorMode, editingSlotIndex, actionId)
          }
          onRestoreDefaultSlot={() =>
            onResetRadialSlot(radialEditorMode, editingSlotIndex)
          }
          onRestoreEntireLayout={() => onResetRadialLayout(radialEditorMode)}
          onClose={() => setEditingSlotIndex(null)}
        />
      )}
    </div>
  );
};

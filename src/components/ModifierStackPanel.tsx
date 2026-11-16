import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Hexagon,
  Layers,
  Plus,
  Power,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  BevelLimitMethod,
  MODIFIER_LABELS,
  ModifierDiagnostic,
  ModifierSlot,
  ModifierType,
  SubdivisionLevel,
  TABLET_BEVEL_MAX_SEGMENTS,
  TABLET_SUBDIV_FACE_BUDGET,
  normalizeBevelParams,
  normalizeMirrorParams,
  normalizeSolidifyParams,
  normalizeSubdivisionParams,
} from '../core/modifiers/types';
import { isEditableMeshObject } from '../core/project/hierarchy';
import { SceneObjectData } from '../core/project/types';

interface ModifierStackPanelProps {
  selectedObject: SceneObjectData | null;
  sceneObjects: SceneObjectData[];
  diagnostics: Record<string, ModifierDiagnostic>;
  evaluatedVertexCount: number;
  evaluatedFaceCount: number;
  hasActiveModifiers: boolean;
  onAddModifier: (objectId: string, type: ModifierType) => void;
  onUpdateModifier: (
    objectId: string,
    modifierId: string,
    patch: Partial<ModifierSlot>,
    recordHistory?: boolean,
  ) => void;
  onReorderModifier: (
    objectId: string,
    modifierId: string,
    direction: 'up' | 'down',
  ) => void;
  onRemoveModifier: (objectId: string, modifierId: string) => void;
  onApplyModifier: (objectId: string, modifierId: string) => void;
  onRecalculateNormalsOutside?: (objectId: string) => void;
  onFlipNormals?: (objectId: string) => void;
}

function getModifierIcon(type: ModifierType | string) {
  switch (type) {
    case 'mirror':
      return <FlipHorizontal2 className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />;
    case 'solidify':
      return <Layers className="w-3.5 h-3.5 text-[#34d399] shrink-0" />;
    case 'bevel':
      return <Hexagon className="w-3.5 h-3.5 text-[#a78bfa] shrink-0" />;
    case 'subdivision':
    default:
      return <Sparkles className="w-3.5 h-3.5 text-[#ff9900] shrink-0" />;
  }
}

function getModifierShortTitle(type: ModifierType | string): string {
  switch (type) {
    case 'mirror':
      return 'Mirror';
    case 'subdivision':
      return 'Subdivision';
    case 'solidify':
      return 'Solidify';
    case 'bevel':
      return 'Bevel';
    default:
      return type;
  }
}

export const ModifierStackPanel: React.FC<ModifierStackPanelProps> = ({
  selectedObject,
  sceneObjects,
  diagnostics,
  evaluatedVertexCount,
  evaluatedFaceCount,
  hasActiveModifiers,
  onAddModifier,
  onUpdateModifier,
  onReorderModifier,
  onRemoveModifier,
  onApplyModifier,
  onRecalculateNormalsOutside,
  onFlipNormals,
}) => {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const sliderHistoryRecordedRef = useRef(false);

  const canModify = Boolean(
    selectedObject &&
      isEditableMeshObject(selectedObject) &&
      !selectedObject.locked,
  );
  const modifiers = selectedObject?.modifiers ?? [];

  const handleSelectAddType = (type: ModifierType) => {
    if (!selectedObject) return;
    setAddMenuOpen(false);
    onAddModifier(selectedObject.id, type);
  };

  if (!selectedObject) {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto cad-scroll p-3 space-y-3">
        <div className="pb-2 border-b border-[#262931] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#e4e6eb]">
            Pila de Modificadores
          </span>
        </div>
        <div className="flex-1 min-h-[160px] rounded-lg border border-dashed border-[#2f3440] bg-[#14161b] p-4 flex flex-col items-center justify-center text-center gap-2">
          <Sparkles className="w-5 h-5 text-[#6b7280]" />
          <p className="text-xs text-[#9ca3af] leading-relaxed max-w-[210px]">
            Selecciona un objeto de malla para añadir y configurar modificadores no destructivos.
          </p>
        </div>
      </div>
    );
  }

  if (!isEditableMeshObject(selectedObject)) {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto cad-scroll p-3 space-y-3">
        <div className="pb-2 border-b border-[#262931] flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#e4e6eb]">
            Pila de Modificadores
          </span>
          <span className="text-[11px] text-[#8e95a2] truncate max-w-[115px]">
            {selectedObject.name}
          </span>
        </div>
        <div className="rounded-lg border border-[#2b2e36] bg-[#14161b] p-3.5 text-xs text-[#9ca3af] leading-relaxed">
          Este tipo de objeto ({selectedObject.objectType === 'reference_image' ? 'imagen de referencia' : 'no malla'}) no admite modificadores de geometría.
        </div>
      </div>
    );
  }

  const mirrorRefCandidates = sceneObjects.filter(
    (o) => o.id !== selectedObject.id,
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto cad-scroll p-2.5 space-y-2.5">
      {/* Header + Stats */}
      <div className="pb-2 border-b border-[#262931] space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#e4e6eb]">
            Modificadores
          </span>
          <span className="text-[11px] text-[#ff9900] font-medium truncate max-w-[125px]">
            {selectedObject.name}
          </span>
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#8e95a2] font-mono-tabular">
          <span>
            Base: {selectedObject.mesh.vertices.length}v ·{' '}
            {selectedObject.mesh.faces.length}c
          </span>
          {hasActiveModifiers && (
            <span className="text-[#38bdf8]">
              Final: {evaluatedVertexCount}v · {evaluatedFaceCount}c
            </span>
          )}
        </div>
      </div>

      {/* Add Modifier Selector */}
      <div className="relative">
        <button
          type="button"
          disabled={!canModify}
          onClick={() => setAddMenuOpen((v) => !v)}
          className="w-full h-9 px-3 rounded-lg bg-[#222630] hover:bg-[#2a2f3c] disabled:opacity-45 border border-[#343947] text-xs font-semibold text-[#f3f4f6] flex items-center justify-between gap-2 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-[#ff9900]" />
            <span>Agregar modificador</span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#9ca3af] transition-transform ${
              addMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {addMenuOpen && (
          <div className="mt-1.5 rounded-lg bg-[#12141a] border border-[#2f3440] shadow-xl overflow-hidden divide-y divide-[#222630]">
            <button
              type="button"
              onClick={() => handleSelectAddType('mirror')}
              className="w-full px-3 py-2.5 text-left hover:bg-[#1e2330] flex items-center gap-2.5 transition-colors"
            >
              <FlipHorizontal2 className="w-4 h-4 text-[#38bdf8] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#e4e6eb]">
                  {MODIFIER_LABELS.mirror}
                </div>
                <div className="text-[10px] text-[#8e95a2]">
                  Simetría en tiempo real sobre X / Y / Z
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectAddType('solidify')}
              className="w-full px-3 py-2.5 text-left hover:bg-[#1e2330] flex items-center gap-2.5 transition-colors"
            >
              <Layers className="w-4 h-4 text-[#34d399] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#e4e6eb]">
                  {MODIFIER_LABELS.solidify}
                </div>
                <div className="text-[10px] text-[#8e95a2]">
                  Convierte superficies en paredes o láminas con volumen
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectAddType('bevel')}
              className="w-full px-3 py-2.5 text-left hover:bg-[#1e2330] flex items-center gap-2.5 transition-colors"
            >
              <Hexagon className="w-4 h-4 text-[#a78bfa] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#e4e6eb]">
                  {MODIFIER_LABELS.bevel}
                </div>
                <div className="text-[10px] text-[#8e95a2]">
                  Biselado y redondeo de aristas con control de segmentos
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectAddType('subdivision')}
              className="w-full px-3 py-2.5 text-left hover:bg-[#1e2330] flex items-center gap-2.5 transition-colors"
            >
              <Sparkles className="w-4 h-4 text-[#ff9900] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#e4e6eb]">
                  {MODIFIER_LABELS.subdivision}
                </div>
                <div className="text-[10px] text-[#8e95a2]">
                  Catmull-Clark optimizado para tablet (0–3)
                </div>
              </div>
            </button>
          </div>
        )}
      </div>

      {selectedObject.locked && (
        <div className="rounded-md bg-[#2a2115] border border-[#ff9900]/40 px-2.5 py-2 text-[11px] text-[#fbbf24]">
          Objeto bloqueado. Desbloquéalo en Jerarquía para editar modificadores.
        </div>
      )}

      {/* Modifier Stack */}
      {modifiers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#2b2e36] bg-[#14161b] px-3 py-5 text-center space-y-1.5">
          <p className="text-xs text-[#9ca3af]">
            Sin modificadores activos.
          </p>
          <p className="text-[11px] text-[#6b7280] leading-relaxed">
            La geometría original permanece intacta hasta que decidas aplicar un modificador.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {modifiers.map((mod, idx) => {
            const diag = diagnostics[mod.id];
            const isExpanded = mod.expanded !== false;
            const showPreview = mod.showInViewport !== false;
            const hasBlockingError = diag?.status === 'error';
            const mirrorParams =
              mod.type === 'mirror' ? normalizeMirrorParams(mod.params) : null;
            const subdivParams =
              mod.type === 'subdivision'
                ? normalizeSubdivisionParams(mod.params)
                : null;
            const solidifyParams =
              mod.type === 'solidify'
                ? normalizeSolidifyParams(mod.params)
                : null;
            const bevelParams =
              mod.type === 'bevel' ? normalizeBevelParams(mod.params) : null;

            return (
              <div
                key={mod.id}
                className={`rounded-lg border transition-colors ${
                  hasBlockingError
                    ? 'bg-[#1a1416] border-[#ef4444]/50'
                    : mod.enabled
                      ? 'bg-[#151820] border-[#2e3340]'
                      : 'bg-[#13151a] border-[#232630] opacity-75'
                }`}
              >
                {/* Card Header */}
                <div className="px-2 py-1.5 flex items-center justify-between gap-1 border-b border-[#232733]">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateModifier(
                        selectedObject.id,
                        mod.id,
                        { expanded: !isExpanded },
                        false,
                      )
                    }
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left py-1"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#8e95a2] shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#8e95a2] shrink-0" />
                    )}
                    {getModifierIcon(mod.type)}
                    <span className="text-[11px] font-semibold text-[#e4e6eb] truncate">
                      {getModifierShortTitle(mod.type)}
                    </span>
                    {subdivParams && (
                      <span className="px-1.5 py-0.5 rounded bg-[#232734] text-[10px] font-mono-tabular text-[#cbd5e1] shrink-0">
                        N{subdivParams.levels}
                      </span>
                    )}
                    {solidifyParams && (
                      <span className="px-1.5 py-0.5 rounded bg-[#232734] text-[10px] font-mono-tabular text-[#cbd5e1] shrink-0">
                        {solidifyParams.thickness.toFixed(2)}
                      </span>
                    )}
                    {bevelParams && (
                      <span className="px-1.5 py-0.5 rounded bg-[#232734] text-[10px] font-mono-tabular text-[#cbd5e1] shrink-0">
                        {bevelParams.segments}s
                      </span>
                    )}
                  </button>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={!canModify}
                      onClick={() =>
                        onUpdateModifier(selectedObject.id, mod.id, {
                          showInViewport: !showPreview,
                        })
                      }
                      title={
                        showPreview
                          ? 'Ocultar vista previa en viewport'
                          : 'Mostrar resultado en viewport'
                      }
                      aria-label="Mostrar resultado en viewport"
                      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                        showPreview
                          ? 'text-[#38bdf8] hover:bg-[#232834]'
                          : 'text-[#6b7280] hover:bg-[#232834]'
                      }`}
                    >
                      {showPreview ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={!canModify}
                      onClick={() =>
                        onUpdateModifier(selectedObject.id, mod.id, {
                          enabled: !mod.enabled,
                        })
                      }
                      title={
                        mod.enabled
                          ? 'Desactivar modificador'
                          : 'Activar modificador'
                      }
                      aria-label="Activar o desactivar modificador"
                      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                        mod.enabled
                          ? 'text-[#34d399] hover:bg-[#232834]'
                          : 'text-[#6b7280] hover:bg-[#232834]'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={!canModify || idx === 0}
                      onClick={() =>
                        onReorderModifier(selectedObject.id, mod.id, 'up')
                      }
                      title="Subir en la pila"
                      aria-label="Subir modificador"
                      className="w-7 h-7 rounded text-[#9ca3af] hover:text-white hover:bg-[#232834] disabled:opacity-30 flex items-center justify-center"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={!canModify || idx === modifiers.length - 1}
                      onClick={() =>
                        onReorderModifier(selectedObject.id, mod.id, 'down')
                      }
                      title="Bajar en la pila"
                      aria-label="Bajar modificador"
                      className="w-7 h-7 rounded text-[#9ca3af] hover:text-white hover:bg-[#232834] disabled:opacity-30 flex items-center justify-center"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={!canModify}
                      onClick={() =>
                        onRemoveModifier(selectedObject.id, mod.id)
                      }
                      title="Eliminar modificador sin alterar la malla base"
                      aria-label="Eliminar modificador"
                      className="w-7 h-7 rounded text-[#9ca3af] hover:text-[#f87171] hover:bg-[#2c1d21] disabled:opacity-30 flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Card Body */}
                {isExpanded && (
                  <div className="p-2.5 space-y-2.5">
                    {mirrorParams && (
                      <>
                        {/* Axes X / Y / Z */}
                        <div className="space-y-1">
                          <div className="text-[11px] font-medium text-[#9ca3af]">
                            Ejes de simetría
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(['x', 'y', 'z'] as const).map((axis) => {
                              const active = mirrorParams.axes[axis];
                              const accent =
                                axis === 'x'
                                  ? 'border-[#e05252]/70 bg-[#e05252]/20 text-[#fca5a5]'
                                  : axis === 'y'
                                    ? 'border-[#52b852]/70 bg-[#52b852]/20 text-[#86efac]'
                                    : 'border-[#48bce8]/70 bg-[#48bce8]/20 text-[#7dd3fc]';
                              return (
                                <button
                                  key={axis}
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onUpdateModifier(
                                      selectedObject.id,
                                      mod.id,
                                      {
                                        params: {
                                          ...mirrorParams,
                                          axes: {
                                            ...mirrorParams.axes,
                                            [axis]: !active,
                                          },
                                        },
                                      },
                                    )
                                  }
                                  className={`h-8 rounded-md text-xs font-bold uppercase border transition-colors ${
                                    active
                                      ? accent
                                      : 'bg-[#101216] border-[#292d38] text-[#9ca3af] hover:text-white'
                                  }`}
                                >
                                  {axis.toUpperCase()}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Bisect X / Y / Z */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-[#9ca3af]">
                              Bisect (cortar plano)
                            </span>
                            {(mirrorParams.bisect.x ||
                              mirrorParams.bisect.y ||
                              mirrorParams.bisect.z) && (
                              <span className="text-[10px] text-[#6b7280]">
                                Lado opuesto
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(['x', 'y', 'z'] as const).map((axis) => {
                              const active = mirrorParams.bisect[axis];
                              const flipped = mirrorParams.flipBisect[axis];
                              return (
                                <div key={axis} className="flex gap-1">
                                  <button
                                    type="button"
                                    disabled={!canModify}
                                    onClick={() =>
                                      onUpdateModifier(
                                        selectedObject.id,
                                        mod.id,
                                        {
                                          params: {
                                            ...mirrorParams,
                                            bisect: {
                                              ...mirrorParams.bisect,
                                              [axis]: !active,
                                            },
                                          },
                                        },
                                      )
                                    }
                                    className={`flex-1 h-8 rounded-md text-[11px] font-semibold uppercase border transition-colors ${
                                      active
                                        ? 'bg-[#2a2f3a] border-[#ff9900]/70 text-[#ff9900]'
                                        : 'bg-[#101216] border-[#292d38] text-[#9ca3af] hover:text-white'
                                    }`}
                                  >
                                    {axis.toUpperCase()}
                                  </button>
                                  {active && (
                                    <button
                                      type="button"
                                      disabled={!canModify}
                                      onClick={() =>
                                        onUpdateModifier(
                                          selectedObject.id,
                                          mod.id,
                                          {
                                            params: {
                                              ...mirrorParams,
                                              flipBisect: {
                                                ...mirrorParams.flipBisect,
                                                [axis]: !flipped,
                                              },
                                            },
                                          },
                                        )
                                      }
                                      title={`Invertir lado de corte en ${axis.toUpperCase()}`}
                                      className={`w-7 h-8 rounded-md text-[10px] font-bold border transition-colors ${
                                        flipped
                                          ? 'bg-[#3b2914] border-[#ff9900] text-[#fbbf24]'
                                          : 'bg-[#101216] border-[#292d38] text-[#9ca3af]'
                                      }`}
                                    >
                                      ±
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Merge & Clipping */}
                        <div className="space-y-2 pt-0.5">
                          <label className="flex items-center justify-between gap-2 min-h-[32px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Fusionar vértices (Merge)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={mirrorParams.merge}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...mirrorParams,
                                    merge: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#ff9900]"
                            />
                          </label>

                          {mirrorParams.merge && (
                            <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[#9ca3af]">
                                  Distancia de fusión
                                </span>
                                <span className="font-mono-tabular text-[#e4e6eb]">
                                  {mirrorParams.mergeDistance.toFixed(4)}
                                </span>
                              </div>
                              <input
                                type="range"
                                disabled={!canModify}
                                min={0.0005}
                                max={0.1}
                                step={0.0005}
                                value={Math.min(0.1, mirrorParams.mergeDistance)}
                                onPointerDown={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onPointerUp={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onPointerCancel={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onBlur={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onChange={(e) => {
                                  const shouldRecord =
                                    !sliderHistoryRecordedRef.current;
                                  sliderHistoryRecordedRef.current = true;
                                  onUpdateModifier(
                                    selectedObject.id,
                                    mod.id,
                                    {
                                      params: {
                                        ...mirrorParams,
                                        mergeDistance: Number(e.target.value),
                                      },
                                    },
                                    shouldRecord,
                                  );
                                }}
                                className="w-full accent-[#ff9900]"
                              />
                            </div>
                          )}

                          <label className="flex items-center justify-between gap-2 min-h-[32px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Clipping (bloquear plano)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={mirrorParams.clipping}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...mirrorParams,
                                    clipping: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#ff9900]"
                            />
                          </label>
                        </div>

                        {/* Mirror Object Reference */}
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-[#9ca3af]">
                            Objeto de simetría
                          </label>
                          <select
                            disabled={!canModify}
                            value={mirrorParams.mirrorObjectId ?? ''}
                            onChange={(e) =>
                              onUpdateModifier(selectedObject.id, mod.id, {
                                params: {
                                  ...mirrorParams,
                                  mirrorObjectId: e.target.value || null,
                                },
                              })
                            }
                            className="w-full h-8 px-2 rounded-md bg-[#101216] border border-[#292d38] focus:border-[#ff9900] text-[11px] text-[#e4e6eb] outline-none"
                          >
                            <option value="">Origen del objeto (Local)</option>
                            {mirrorRefCandidates.map((cand) => (
                              <option key={cand.id} value={cand.id}>
                                {cand.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}

                    {solidifyParams && (
                      <>
                        {/* Thickness */}
                        <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#9ca3af]">Thickness (Grosor)</span>
                            <input
                              type="number"
                              disabled={!canModify}
                              step={0.02}
                              min={-5}
                              max={5}
                              value={solidifyParams.thickness}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!Number.isNaN(val)) {
                                  onUpdateModifier(selectedObject.id, mod.id, {
                                    params: { ...solidifyParams, thickness: val },
                                  });
                                }
                              }}
                              className="w-16 h-6 px-1.5 rounded bg-[#181b22] border border-[#2f3544] text-right text-[11px] font-mono-tabular text-[#e4e6eb] outline-none focus:border-[#34d399]"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={!canModify}
                            min={-1.5}
                            max={1.5}
                            step={0.01}
                            value={Math.max(-1.5, Math.min(1.5, solidifyParams.thickness))}
                            onPointerDown={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerUp={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerCancel={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onBlur={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onChange={(e) => {
                              const shouldRecord = !sliderHistoryRecordedRef.current;
                              sliderHistoryRecordedRef.current = true;
                              onUpdateModifier(
                                selectedObject.id,
                                mod.id,
                                {
                                  params: {
                                    ...solidifyParams,
                                    thickness: Number(e.target.value),
                                  },
                                },
                                shouldRecord,
                              );
                            }}
                            className="w-full accent-[#34d399]"
                          />
                        </div>

                        {/* Offset (-1..1) */}
                        <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#9ca3af]">Offset</span>
                            <input
                              type="number"
                              disabled={!canModify}
                              step={0.1}
                              min={-1}
                              max={1}
                              value={solidifyParams.offset}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!Number.isNaN(val)) {
                                  onUpdateModifier(selectedObject.id, mod.id, {
                                    params: { ...solidifyParams, offset: val },
                                  });
                                }
                              }}
                              className="w-16 h-6 px-1.5 rounded bg-[#181b22] border border-[#2f3544] text-right text-[11px] font-mono-tabular text-[#e4e6eb] outline-none focus:border-[#34d399]"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={!canModify}
                            min={-1}
                            max={1}
                            step={0.05}
                            value={solidifyParams.offset}
                            onPointerDown={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerUp={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerCancel={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onBlur={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onChange={(e) => {
                              const shouldRecord = !sliderHistoryRecordedRef.current;
                              sliderHistoryRecordedRef.current = true;
                              onUpdateModifier(
                                selectedObject.id,
                                mod.id,
                                {
                                  params: {
                                    ...solidifyParams,
                                    offset: Number(e.target.value),
                                  },
                                },
                                shouldRecord,
                              );
                            }}
                            className="w-full accent-[#34d399]"
                          />
                          <div className="grid grid-cols-3 gap-1">
                            {[
                              { label: 'Interior (-1)', value: -1 },
                              { label: 'Centro (0)', value: 0 },
                              { label: 'Exterior (1)', value: 1 },
                            ].map((preset) => {
                              const active =
                                Math.abs(solidifyParams.offset - preset.value) < 0.02;
                              return (
                                <button
                                  key={preset.value}
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onUpdateModifier(selectedObject.id, mod.id, {
                                      params: {
                                        ...solidifyParams,
                                        offset: preset.value,
                                      },
                                    })
                                  }
                                  className={`h-7 rounded text-[10px] font-medium border transition-colors ${
                                    active
                                      ? 'bg-[#19332b] border-[#34d399]/70 text-[#6ee7b7]'
                                      : 'bg-[#151820] border-[#262b36] text-[#9ca3af] hover:text-white'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Even Thickness, Fill Rim, Only Rim */}
                        <div className="space-y-1.5">
                          <label className="flex items-center justify-between gap-2 min-h-[34px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Even Thickness (Grosor uniforme)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={solidifyParams.evenThickness}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...solidifyParams,
                                    evenThickness: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#34d399]"
                            />
                          </label>

                          <label className="flex items-center justify-between gap-2 min-h-[34px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Fill Rim (Cerrar bordes)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={solidifyParams.fillRim}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...solidifyParams,
                                    fillRim: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#34d399]"
                            />
                          </label>

                          <label className="flex items-center justify-between gap-2 min-h-[34px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Only Rim (Solo bordes laterales)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={solidifyParams.onlyRim}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...solidifyParams,
                                    onlyRim: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#34d399]"
                            />
                          </label>
                        </div>

                        {/* Clamp */}
                        <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#9ca3af]">
                              Clamp (0 = Desactivado)
                            </span>
                            <input
                              type="number"
                              disabled={!canModify}
                              step={0.05}
                              min={0}
                              max={2}
                              value={solidifyParams.clamp}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!Number.isNaN(val)) {
                                  onUpdateModifier(selectedObject.id, mod.id, {
                                    params: { ...solidifyParams, clamp: val },
                                  });
                                }
                              }}
                              className="w-16 h-6 px-1.5 rounded bg-[#181b22] border border-[#2f3544] text-right text-[11px] font-mono-tabular text-[#e4e6eb] outline-none focus:border-[#34d399]"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={!canModify}
                            min={0}
                            max={1.5}
                            step={0.05}
                            value={Math.min(1.5, solidifyParams.clamp)}
                            onPointerDown={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerUp={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerCancel={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onBlur={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onChange={(e) => {
                              const shouldRecord = !sliderHistoryRecordedRef.current;
                              sliderHistoryRecordedRef.current = true;
                              onUpdateModifier(
                                selectedObject.id,
                                mod.id,
                                {
                                  params: {
                                    ...solidifyParams,
                                    clamp: Number(e.target.value),
                                  },
                                },
                                shouldRecord,
                              );
                            }}
                            className="w-full accent-[#34d399]"
                          />
                        </div>
                      </>
                    )}

                    {bevelParams && (
                      <>
                        {/* Amount */}
                        <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#9ca3af]">Amount (Anchura)</span>
                            <input
                              type="number"
                              disabled={!canModify}
                              step={0.01}
                              min={0}
                              max={2}
                              value={bevelParams.amount}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!Number.isNaN(val)) {
                                  onUpdateModifier(selectedObject.id, mod.id, {
                                    params: { ...bevelParams, amount: val },
                                  });
                                }
                              }}
                              className="w-16 h-6 px-1.5 rounded bg-[#181b22] border border-[#2f3544] text-right text-[11px] font-mono-tabular text-[#e4e6eb] outline-none focus:border-[#a78bfa]"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={!canModify}
                            min={0}
                            max={0.6}
                            step={0.005}
                            value={Math.min(0.6, bevelParams.amount)}
                            onPointerDown={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerUp={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerCancel={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onBlur={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onChange={(e) => {
                              const shouldRecord = !sliderHistoryRecordedRef.current;
                              sliderHistoryRecordedRef.current = true;
                              onUpdateModifier(
                                selectedObject.id,
                                mod.id,
                                {
                                  params: {
                                    ...bevelParams,
                                    amount: Number(e.target.value),
                                  },
                                },
                                shouldRecord,
                              );
                            }}
                            className="w-full accent-[#a78bfa]"
                          />
                        </div>

                        {/* Segments (1..6) */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-medium text-[#9ca3af]">
                              Segments (Segmentos)
                            </span>
                            <span className="text-[10px] font-mono-tabular text-[#8e95a2]">
                              Máx: {TABLET_BEVEL_MAX_SEGMENTS}
                            </span>
                          </div>
                          <div className="grid grid-cols-6 gap-1">
                            {[1, 2, 3, 4, 5, 6].map((seg) => {
                              const active = bevelParams.segments === seg;
                              return (
                                <button
                                  key={seg}
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onUpdateModifier(selectedObject.id, mod.id, {
                                      params: { ...bevelParams, segments: seg },
                                    })
                                  }
                                  className={`h-8 rounded-md text-xs font-semibold font-mono-tabular border transition-colors ${
                                    active
                                      ? 'bg-[#251f38] border-[#a78bfa] text-[#ddd6fe]'
                                      : 'bg-[#101216] border-[#292d38] text-[#9ca3af] hover:text-white'
                                  }`}
                                >
                                  {seg}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Limit Method */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-[#9ca3af]">
                            Limit Method (Método límite)
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            {(
                              [
                                { id: 'angle', label: 'Angle' },
                                { id: 'all', label: 'All Edges' },
                                { id: 'weight', label: 'Weight' },
                              ] as { id: BevelLimitMethod; label: string }[]
                            ).map((opt) => {
                              const active = bevelParams.limitMethod === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onUpdateModifier(selectedObject.id, mod.id, {
                                      params: {
                                        ...bevelParams,
                                        limitMethod: opt.id,
                                      },
                                    })
                                  }
                                  className={`h-8 rounded-md text-[11px] font-semibold border transition-colors ${
                                    active
                                      ? 'bg-[#251f38] border-[#a78bfa] text-[#ddd6fe]'
                                      : 'bg-[#101216] border-[#292d38] text-[#9ca3af] hover:text-white'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>

                          {bevelParams.limitMethod === 'angle' && (
                            <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-[#9ca3af]">
                                  Angle Limit (°)
                                </span>
                                <input
                                  type="number"
                                  disabled={!canModify}
                                  step={1}
                                  min={0}
                                  max={180}
                                  value={bevelParams.angleLimit}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!Number.isNaN(val)) {
                                      onUpdateModifier(selectedObject.id, mod.id, {
                                        params: {
                                          ...bevelParams,
                                          angleLimit: val,
                                        },
                                      });
                                    }
                                  }}
                                  className="w-16 h-6 px-1.5 rounded bg-[#181b22] border border-[#2f3544] text-right text-[11px] font-mono-tabular text-[#e4e6eb] outline-none focus:border-[#a78bfa]"
                                />
                              </div>
                              <input
                                type="range"
                                disabled={!canModify}
                                min={0}
                                max={180}
                                step={1}
                                value={bevelParams.angleLimit}
                                onPointerDown={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onPointerUp={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onPointerCancel={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onBlur={() => {
                                  sliderHistoryRecordedRef.current = false;
                                }}
                                onChange={(e) => {
                                  const shouldRecord =
                                    !sliderHistoryRecordedRef.current;
                                  sliderHistoryRecordedRef.current = true;
                                  onUpdateModifier(
                                    selectedObject.id,
                                    mod.id,
                                    {
                                      params: {
                                        ...bevelParams,
                                        angleLimit: Number(e.target.value),
                                      },
                                    },
                                    shouldRecord,
                                  );
                                }}
                                className="w-full accent-[#a78bfa]"
                              />
                            </div>
                          )}
                        </div>

                        {/* Profile */}
                        <div className="px-2 py-1.5 rounded-md bg-[#101216] border border-[#242832] space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#9ca3af]">Profile (Perfil)</span>
                            <input
                              type="number"
                              disabled={!canModify}
                              step={0.05}
                              min={0.05}
                              max={1}
                              value={bevelParams.profile}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!Number.isNaN(val)) {
                                  onUpdateModifier(selectedObject.id, mod.id, {
                                    params: { ...bevelParams, profile: val },
                                  });
                                }
                              }}
                              className="w-16 h-6 px-1.5 rounded bg-[#181b22] border border-[#2f3544] text-right text-[11px] font-mono-tabular text-[#e4e6eb] outline-none focus:border-[#a78bfa]"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={!canModify}
                            min={0.05}
                            max={1}
                            step={0.05}
                            value={bevelParams.profile}
                            onPointerDown={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerUp={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onPointerCancel={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onBlur={() => {
                              sliderHistoryRecordedRef.current = false;
                            }}
                            onChange={(e) => {
                              const shouldRecord = !sliderHistoryRecordedRef.current;
                              sliderHistoryRecordedRef.current = true;
                              onUpdateModifier(
                                selectedObject.id,
                                mod.id,
                                {
                                  params: {
                                    ...bevelParams,
                                    profile: Number(e.target.value),
                                  },
                                },
                                shouldRecord,
                              );
                            }}
                            className="w-full accent-[#a78bfa]"
                          />
                        </div>

                        {/* Clamp Overlap & Harden Normals */}
                        <div className="space-y-1.5">
                          <label className="flex items-center justify-between gap-2 min-h-[34px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Clamp Overlap (Evitar cruces)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={bevelParams.clampOverlap}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...bevelParams,
                                    clampOverlap: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#a78bfa]"
                            />
                          </label>

                          <label className="flex items-center justify-between gap-2 min-h-[34px] px-2 rounded-md bg-[#101216] border border-[#242832] cursor-pointer">
                            <span className="text-[11px] text-[#d1d5db]">
                              Harden Normals (Normales limpias)
                            </span>
                            <input
                              type="checkbox"
                              disabled={!canModify}
                              checked={bevelParams.hardenNormals}
                              onChange={(e) =>
                                onUpdateModifier(selectedObject.id, mod.id, {
                                  params: {
                                    ...bevelParams,
                                    hardenNormals: e.target.checked,
                                  },
                                })
                              }
                              className="w-4 h-4 accent-[#a78bfa]"
                            />
                          </label>
                        </div>
                      </>
                    )}

                    {subdivParams && (
                      <>
                        {/* Subdivision Levels 0..3 */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-medium text-[#9ca3af]">
                              Niveles (Tablet)
                            </span>
                            <span className="text-[10px] font-mono-tabular text-[#8e95a2]">
                              Máx: 3 ({TABLET_SUBDIV_FACE_BUDGET.toLocaleString()} c)
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {([0, 1, 2, 3] as SubdivisionLevel[]).map((lvl) => {
                              const active = subdivParams.levels === lvl;
                              return (
                                <button
                                  key={lvl}
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onUpdateModifier(
                                      selectedObject.id,
                                      mod.id,
                                      {
                                        params: { levels: lvl },
                                      },
                                    )
                                  }
                                  className={`h-8 rounded-md text-xs font-semibold font-mono-tabular border transition-colors ${
                                    active
                                      ? lvl === 3
                                        ? 'bg-[#3b2914] border-[#ff9900] text-[#fbbf24]'
                                        : 'bg-[#2a2f3a] border-[#ff9900] text-[#ff9900]'
                                      : 'bg-[#101216] border-[#292d38] text-[#9ca3af] hover:text-white'
                                  }`}
                                >
                                  {lvl}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Diagnostics (Errors / Warnings) */}
                    {diag?.status === 'error' && diag.message && (
                      <div className="rounded-md bg-[#2a1518] border border-[#ef4444]/60 px-2.5 py-2 flex items-start gap-2 text-[11px] text-[#fca5a5] leading-snug">
                        <ShieldAlert className="w-4 h-4 text-[#f87171] shrink-0 mt-0.5" />
                        <span>{diag.message}</span>
                      </div>
                    )}

                    {diag?.status === 'warning' && diag.message && (
                      <div className="rounded-md bg-[#292114] border border-[#f59e0b]/50 px-2.5 py-2 space-y-2 text-[11px] text-[#fcd34d] leading-snug">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0 mt-0.5" />
                          <span>{diag.message}</span>
                        </div>
                        {diag.code === 'normals_warning' &&
                          (onRecalculateNormalsOutside || onFlipNormals) && (
                            <div className="flex items-center gap-1.5 pt-0.5">
                              {onRecalculateNormalsOutside && (
                                <button
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onRecalculateNormalsOutside(selectedObject.id)
                                  }
                                  className="flex-1 h-7 px-2 rounded bg-[#3b2a14] hover:bg-[#4f3819] border border-[#f59e0b]/50 text-[10px] font-semibold text-[#fde68a] flex items-center justify-center gap-1 transition-colors"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Recalcular afuera</span>
                                </button>
                              )}
                              {onFlipNormals && (
                                <button
                                  type="button"
                                  disabled={!canModify}
                                  onClick={() =>
                                    onFlipNormals(selectedObject.id)
                                  }
                                  className="h-7 px-2 rounded bg-[#272017] hover:bg-[#382d1e] border border-[#f59e0b]/40 text-[10px] font-semibold text-[#fde68a] transition-colors"
                                >
                                  Invertir
                                </button>
                              )}
                            </div>
                          )}
                      </div>
                    )}

                    {/* Card Footer: Step Counts + Apply */}
                    <div className="pt-1 flex items-center justify-between gap-2 border-t border-[#232733]">
                      <span className="text-[10px] font-mono-tabular text-[#8e95a2]">
                        {diag
                          ? `${diag.vertexCount}v · ${diag.faceCount}c`
                          : 'Vista previa desactivada'}
                      </span>

                      <button
                        type="button"
                        disabled={!canModify || hasBlockingError}
                        onClick={() =>
                          onApplyModifier(selectedObject.id, mod.id)
                        }
                        title={
                          hasBlockingError
                            ? 'Corrige los errores de topología antes de aplicar'
                            : 'Aplicar modificador definitivamente a la malla base'
                        }
                        className="h-7 px-2.5 rounded-md bg-[#222834] hover:bg-[#ff9900] hover:text-[#111317] disabled:opacity-40 disabled:hover:bg-[#222834] disabled:hover:text-[#9ca3af] border border-[#343b4a] text-[11px] font-semibold text-[#e4e6eb] flex items-center gap-1 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Aplicar</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};


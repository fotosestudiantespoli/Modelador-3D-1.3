import React, { useMemo, useState } from 'react';
import {
  Ban,
  Check,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DEFAULT_RADIAL_LAYOUTS,
  RADIAL_ACTION_CATEGORIES,
  RADIAL_ACTION_LIBRARY,
  RADIAL_ACTION_MAP,
  RadialActionCategoryId,
  RadialActionId,
  RadialWorkMode,
} from '../core/radial/radialActions';
import { RadialActionIcon } from './RadialActionIcon';

interface RadialSlotEditorModalProps {
  mode: RadialWorkMode;
  slotIndex: number;
  currentActionId: RadialActionId | null;
  onAssignAction: (actionId: RadialActionId | null) => void;
  onRestoreDefaultSlot: () => void;
  onRestoreEntireLayout: () => void;
  onClose: () => void;
}

const MODE_LABELS: Record<RadialWorkMode, string> = {
  object: 'Modo Objeto',
  edit: 'Modo Edición',
  sculpt: 'Modo Escultura (futuro)',
};

export const RadialSlotEditorModal: React.FC<RadialSlotEditorModalProps> = ({
  mode,
  slotIndex,
  currentActionId,
  onAssignAction,
  onRestoreDefaultSlot,
  onRestoreEntireLayout,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState<
    RadialActionCategoryId | 'all'
  >('all');
  const [query, setQuery] = useState('');

  const defaultActionId = DEFAULT_RADIAL_LAYOUTS[mode][slotIndex] ?? null;
  const currentAction = currentActionId
    ? RADIAL_ACTION_MAP[currentActionId]
    : null;
  const defaultAction = defaultActionId
    ? RADIAL_ACTION_MAP[defaultActionId]
    : null;

  const groupedActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RADIAL_ACTION_CATEGORIES.filter(
      (cat) => activeCategory === 'all' || activeCategory === cat.id,
    )
      .map((cat) => {
        const items = RADIAL_ACTION_LIBRARY.filter((act) => {
          if (act.category !== cat.id) return false;
          if (!q) return true;
          return (
            act.label.toLowerCase().includes(q) ||
            act.shortLabel.toLowerCase().includes(q) ||
            act.description.toLowerCase().includes(q)
          );
        });
        return { category: cat, items };
      })
      .filter((group) => group.items.length > 0);
  }, [activeCategory, query]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-4"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-2xl max-h-[90vh] bg-[#1a1c22] border border-[#343844] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2b2e37] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#ff9900] shrink-0" />
              <h2 className="text-sm font-semibold text-[#f3f4f6] truncate">
                Personalizar Botón #{slotIndex + 1} · {MODE_LABELS[mode]}
              </h2>
            </div>
            <p className="text-[11px] text-[#9ca3af] mt-0.5 truncate">
              Función actual:{' '}
              <span className="text-[#e5e7eb] font-medium">
                {currentAction ? currentAction.label : 'Espacio vacío'}
              </span>
              {' · '}
              Predeterminada:{' '}
              <span className="text-[#ff9900]">
                {defaultAction ? defaultAction.shortLabel : 'Espacio vacío'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-lg hover:bg-[#2a2e38] text-[#9ca3af] hover:text-white flex items-center justify-center shrink-0"
            aria-label="Cerrar editor de botón radial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Slot Actions: Leave Empty / Restore Slot / Restore All */}
        <div className="px-4 py-2.5 bg-[#15171c] border-b border-[#262a33] flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onAssignAction(null);
              onClose();
            }}
            className={`h-10 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              currentActionId === null
                ? 'bg-[#2c313b] border-[#ff9900] text-[#ff9900]'
                : 'bg-[#1f222a] hover:bg-[#272b35] border-[#343946] text-[#e5e7eb]'
            }`}
          >
            <Ban className="w-3.5 h-3.5" />
            <span>Dejar espacio vacío</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onRestoreDefaultSlot();
              onClose();
            }}
            className="h-10 px-3 rounded-lg bg-[#1f222a] hover:bg-[#272b35] border border-[#343946] text-xs font-medium text-[#e5e7eb] flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#ff9900]" />
            <span>Restaurar predeterminado</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onRestoreEntireLayout();
              onClose();
            }}
            className="h-10 px-3 rounded-lg bg-[#1f222a] hover:bg-[#2b2226] border border-[#343946] text-xs font-medium text-[#cbd5e1] ml-auto flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#9ca3af]" />
            <span>Restaurar todo {MODE_LABELS[mode]}</span>
          </button>
        </div>

        {/* Search & Category Filter */}
        <div className="px-4 pt-3 pb-2 space-y-2.5 border-b border-[#262a33] shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8e95a2] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar herramienta o acción..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-[#121419] border border-[#2f333d] text-xs text-[#f3f4f6] placeholder:text-[#6b7280] outline-none focus:border-[#ff9900]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 cad-scroll">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`h-8 px-2.5 rounded-md text-[11px] font-semibold whitespace-nowrap border transition-colors ${
                activeCategory === 'all'
                  ? 'bg-[#ff9900] border-[#ff9900] text-[#111215]'
                  : 'bg-[#1f222a] border-[#2e3340] text-[#b4bac4] hover:text-white'
              }`}
            >
              Todas
            </button>
            {RADIAL_ACTION_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`h-8 px-2.5 rounded-md text-[11px] font-semibold whitespace-nowrap border transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-[#ff9900] border-[#ff9900] text-[#111215]'
                    : 'bg-[#1f222a] border-[#2e3340] text-[#b4bac4] hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categorized Action Library */}
        <div className="p-4 overflow-y-auto cad-scroll space-y-4">
          {groupedActions.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#8e95a2]">
              No se encontraron funciones con ese filtro.
            </div>
          ) : (
            groupedActions.map(({ category, items }) => (
              <section key={category.id} className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">
                  {category.label}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {items.map((action) => {
                    const selected = currentActionId === action.id;
                    const modeRecommended = action.supportedModes.includes(mode);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => {
                          onAssignAction(action.id);
                          onClose();
                        }}
                        className={`min-h-[52px] p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition-colors ${
                          selected
                            ? 'bg-[#2c313b] border-[#ff9900] text-[#f3f4f6]'
                            : 'bg-[#15171c] hover:bg-[#222630] border-[#2c303b] text-[#e5e7eb]'
                        }`}
                      >
                        <div
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                            selected
                              ? 'bg-[#ff9900]/15 border-[#ff9900]/60 text-[#ff9900]'
                              : action.danger
                                ? 'bg-[#271b1e] border-[#593036] text-[#f87171]'
                                : 'bg-[#1f222a] border-[#333846] text-[#ff9900]'
                          }`}
                        >
                          <RadialActionIcon icon={action.icon} className="w-4 h-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold truncate">
                              {action.label}
                            </span>
                            {!modeRecommended && (
                              <span className="px-1.5 py-0.5 rounded bg-[#232732] text-[9px] font-medium text-[#9ca3af] shrink-0">
                                Otro modo
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#8e95a2] leading-tight line-clamp-2 mt-0.5">
                            {action.description}
                          </p>
                        </div>

                        {selected && (
                          <Check className="w-4 h-4 text-[#ff9900] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

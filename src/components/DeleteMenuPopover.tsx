import React from 'react';
import { Trash2, X } from 'lucide-react';
import { DeleteActionType } from '../core/mesh/advancedOperations';
import { EditSelectionMode } from '../core/mesh/operations';

interface DeleteMenuPopoverProps {
  editSelectionMode: EditSelectionMode;
  onSelectAction: (action: DeleteActionType) => void;
  onClose: () => void;
}

const OPTIONS_BY_MODE: Record<
  EditSelectionMode,
  { action: DeleteActionType; label: string; hint: string }[]
> = {
  vertex: [
    {
      action: 'delete_vertices',
      label: 'Eliminar vértices',
      hint: 'Borra vértices, aristas y caras conectadas',
    },
    {
      action: 'dissolve_vertices',
      label: 'Disolver vértices',
      hint: 'Fusiona caras adyacentes eliminando el vértice',
    },
  ],
  edge: [
    {
      action: 'delete_edges',
      label: 'Eliminar aristas',
      hint: 'Borra las aristas y sus caras adyacentes',
    },
    {
      action: 'delete_edges_and_vertices',
      label: 'Aristas y vértices',
      hint: 'Borra aristas y sus vértices extremos',
    },
    {
      action: 'dissolve_edges',
      label: 'Disolver aristas',
      hint: 'Une las caras separadas por la arista',
    },
  ],
  face: [
    {
      action: 'delete_only_faces',
      label: 'Eliminar solo caras',
      hint: 'Conserva vértices y aristas del contorno',
    },
    {
      action: 'delete_faces_and_edges',
      label: 'Caras y aristas',
      hint: 'Borra caras y sus aristas exclusivas',
    },
    {
      action: 'dissolve_faces',
      label: 'Disolver caras',
      hint: 'Funde las caras seleccionadas en una sola',
    },
  ],
};

export const DeleteMenuPopover: React.FC<DeleteMenuPopoverProps> = ({
  editSelectionMode,
  onSelectAction,
  onClose,
}) => {
  const options = OPTIONS_BY_MODE[editSelectionMode];
  const modeTitle =
    editSelectionMode === 'vertex'
      ? 'Vértices'
      : editSelectionMode === 'edge'
        ? 'Aristas'
        : 'Caras';

  return (
    <div className="w-64 rounded-lg bg-[#181a1f] border border-[#383e4a] shadow-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-[#282c35] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#e06c75]">
          <Trash2 className="w-3.5 h-3.5" />
          <span>Eliminar · {modeTitle}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded flex items-center justify-center text-[#9ca3af] hover:text-white hover:bg-[#23262e]"
          aria-label="Cerrar menú eliminar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-1.5 flex flex-col gap-1">
        {options.map((opt) => (
          <button
            key={opt.action}
            type="button"
            onClick={() => {
              onSelectAction(opt.action);
              onClose();
            }}
            className="w-full min-h-[44px] px-2.5 py-2 rounded-md text-left hover:bg-[#262a33] active:bg-[#2f3440] transition-colors flex flex-col justify-center gap-0.5"
          >
            <span className="text-xs font-semibold text-[#f3f4f6]">
              {opt.label}
            </span>
            <span className="text-[10px] text-[#9ca3af] leading-tight">
              {opt.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

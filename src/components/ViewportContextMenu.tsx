import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Box,
  Check,
  CheckSquare,
  Columns,
  Copy,
  EyeOff,
  FlipHorizontal,
  Focus,
  GitMerge,
  Grid,
  Maximize2,
  Minimize2,
  MousePointer,
  Move,
  PaintBucket,
  Plus,
  Redo2,
  RefreshCw,
  RotateCw,
  Scissors,
  ScissorsLineDashed,
  Square,
  Trash2,
  Triangle,
  Undo2,
  Waypoints,
  X,
} from 'lucide-react';
import { DeleteActionType } from '../core/mesh/advancedOperations';
import { EditSelectionMode } from '../core/mesh/operations';
import { PrimitiveType } from '../core/mesh/primitives';
import { TransformTool, WorkMode } from '../core/project/types';
import { EditOperatorType } from '../state/useModelerStore';
import { ProportionalIcon } from './ProportionalEditingBar';

export interface ContextMenuState {
  clientX: number;
  clientY: number;
  hitObjectId: string | null;
  hitComponentId: string | null;
}

interface ViewportContextMenuProps {
  menu: ContextMenuState;
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  selectedObjectName: string | null;
  hasSelectedObject: boolean;
  canEditSelected: boolean;
  selectedCount: number;
  selectedVertexCount: number;
  canInset: boolean;
  showFaceOrientation: boolean;
  proportionalEnabled?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
  onAddPrimitive: (type: PrimitiveType) => void;
  onSelectTool: (tool: TransformTool) => void;
  onToggleWorkMode: (mode: WorkMode) => void;
  onChangeEditSelectionMode: (mode: EditSelectionMode) => void;
  onDuplicateObject: () => void;
  onHideObject: () => void;
  onDeleteObject: () => void;
  onFocusCamera: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartOperator: (type: EditOperatorType) => void;
  onFillSelection: () => void;
  onConnectVertexPath: () => void;
  onToggleFaceOrientation: () => void;
  onToggleProportional?: () => void;
  onRecalculateOutside: () => void;
  onFlipNormals: () => void;
  onExecuteContextualDelete: (action: DeleteActionType) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface ContextAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  dividerAfter?: boolean;
  onSelect: () => void;
}

export const ViewportContextMenu: React.FC<ViewportContextMenuProps> = ({
  menu,
  workMode,
  editSelectionMode,
  selectedObjectName,
  hasSelectedObject,
  canEditSelected,
  selectedCount,
  selectedVertexCount,
  canInset,
  showFaceOrientation,
  proportionalEnabled = false,
  canUndo,
  canRedo,
  onClose,
  onAddPrimitive,
  onSelectTool,
  onToggleWorkMode,
  onChangeEditSelectionMode,
  onDuplicateObject,
  onHideObject,
  onDeleteObject,
  onFocusCamera,
  onSelectAll,
  onDeselectAll,
  onStartOperator,
  onFillSelection,
  onConnectVertexPath,
  onToggleFaceOrientation,
  onToggleProportional,
  onRecalculateOutside,
  onFlipNormals,
  onExecuteContextualDelete,
  onUndo,
  onRedo,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: menu.clientX, top: menu.clientY });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 12;
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    setPos({
      left: Math.max(pad, Math.min(maxX, menu.clientX + 8)),
      top: Math.max(pad, Math.min(maxY, menu.clientY + 8)),
    });
  }, [menu.clientX, menu.clientY, workMode, editSelectionMode, selectedCount]);

  const title =
    workMode === 'object'
      ? hasSelectedObject
        ? `Objeto · ${selectedObjectName ?? 'Selección'}`
        : 'Escena 3D'
      : `Edición · ${
          editSelectionMode === 'vertex'
            ? 'Vértices'
            : editSelectionMode === 'edge'
              ? 'Aristas'
              : 'Caras'
        } (${selectedCount})`;

  const actions: ContextAction[] = [];

  if (workMode === 'object') {
    if (hasSelectedObject) {
      actions.push(
        {
          id: 'enter_edit',
          label: 'Entrar en Modo Edición',
          icon: <Triangle className="w-4 h-4 text-[#ff9900]" />,
          disabled: !canEditSelected,
          dividerAfter: true,
          onSelect: () => {
            onToggleWorkMode('edit');
            onClose();
          },
        },
        {
          id: 'select',
          label: 'Seleccionar',
          icon: <MousePointer className="w-4 h-4" />,
          onSelect: () => {
            onSelectTool('select');
            onClose();
          },
        },
        {
          id: 'move',
          label: 'Mover',
          icon: <Move className="w-4 h-4" />,
          onSelect: () => {
            onSelectTool('move');
            onClose();
          },
        },
        {
          id: 'rotate',
          label: 'Rotar',
          icon: <RotateCw className="w-4 h-4" />,
          onSelect: () => {
            onSelectTool('rotate');
            onClose();
          },
        },
        {
          id: 'scale',
          label: 'Escalar',
          icon: <Maximize2 className="w-4 h-4" />,
          dividerAfter: true,
          onSelect: () => {
            onSelectTool('scale');
            onClose();
          },
        },
        {
          id: 'duplicate',
          label: 'Duplicar objeto',
          icon: <Copy className="w-4 h-4" />,
          onSelect: () => {
            onDuplicateObject();
            onClose();
          },
        },
        {
          id: 'focus',
          label: 'Centrar cámara',
          icon: <Focus className="w-4 h-4" />,
          onSelect: () => {
            onFocusCamera();
            onClose();
          },
        },
        {
          id: 'hide',
          label: 'Ocultar objeto',
          icon: <EyeOff className="w-4 h-4" />,
          onSelect: () => {
            onHideObject();
            onClose();
          },
        },
        {
          id: 'delete',
          label: 'Eliminar objeto',
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          onSelect: () => {
            onDeleteObject();
            onClose();
          },
        },
      );
    } else {
      actions.push(
        {
          id: 'add_cube',
          label: 'Agregar Cubo',
          icon: <Box className="w-4 h-4 text-[#ff9900]" />,
          onSelect: () => {
            onAddPrimitive('cube');
            onClose();
          },
        },
        {
          id: 'add_sphere',
          label: 'Agregar Esfera UV',
          icon: <Plus className="w-4 h-4 text-[#ff9900]" />,
          onSelect: () => {
            onAddPrimitive('uv_sphere');
            onClose();
          },
        },
        {
          id: 'add_cylinder',
          label: 'Agregar Cilindro',
          icon: <Plus className="w-4 h-4 text-[#ff9900]" />,
          dividerAfter: true,
          onSelect: () => {
            onAddPrimitive('cylinder');
            onClose();
          },
        },
        {
          id: 'focus_origin',
          label: 'Centrar vista',
          icon: <Focus className="w-4 h-4" />,
          onSelect: () => {
            onFocusCamera();
            onClose();
          },
        },
        {
          id: 'undo',
          label: 'Deshacer',
          icon: <Undo2 className="w-4 h-4" />,
          disabled: !canUndo,
          onSelect: () => {
            onUndo();
            onClose();
          },
        },
        {
          id: 'redo',
          label: 'Rehacer',
          icon: <Redo2 className="w-4 h-4" />,
          disabled: !canRedo,
          onSelect: () => {
            onRedo();
            onClose();
          },
        },
      );
    }
  } else {
    // EDIT MODE
    if (selectedCount > 0) {
      actions.push({
        id: 'extrude',
        label:
          editSelectionMode === 'face'
            ? 'Extruir caras'
            : editSelectionMode === 'edge'
              ? 'Extruir aristas'
              : 'Extruir vértices',
        icon: <FlipHorizontal className="w-4 h-4 text-[#ff9900]" />,
        onSelect: () => {
          onStartOperator('extrude');
          onClose();
        },
      });

      if (editSelectionMode === 'face' || canInset) {
        actions.push({
          id: 'inset',
          label: 'Insertar caras (Inset)',
          icon: <Square className="w-4 h-4 text-[#ff9900]" />,
          disabled: !canInset,
          onSelect: () => {
            onStartOperator('inset');
            onClose();
          },
        });
      }

      actions.push(
        {
          id: 'subdivide',
          label: 'Subdividir',
          icon: <Grid className="w-4 h-4" />,
          disabled: editSelectionMode === 'vertex' && selectedCount < 2,
          onSelect: () => {
            onStartOperator('subdivide');
            onClose();
          },
        },
        {
          id: 'bevel',
          label:
            editSelectionMode === 'vertex'
              ? 'Biselar vértices'
              : 'Biselar aristas',
          icon: <Columns className="w-4 h-4" />,
          onSelect: () => {
            onStartOperator('bevel');
            onClose();
          },
        },
      );

      if (editSelectionMode === 'edge') {
        actions.push({
          id: 'loop_cut',
          label: 'Corte de bucle',
          icon: <Scissors className="w-4 h-4 text-[#38bdf8]" />,
          onSelect: () => {
            onStartOperator('loop_cut');
            onClose();
          },
        });
      }

      if (editSelectionMode === 'vertex') {
        actions.push({
          id: 'connect_vertex_path',
          label: 'Connect Vertex Path (J)',
          icon: <Waypoints className="w-4 h-4 text-[#38bdf8]" />,
          disabled: selectedVertexCount < 2,
          onSelect: () => {
            onConnectVertexPath();
            onClose();
          },
        });
      }

      if (editSelectionMode !== 'face') {
        actions.push({
          id: 'fill',
          label:
            selectedVertexCount === 2
              ? 'Conectar arista (F)'
              : 'Crear cara (Make Face)',
          icon: <PaintBucket className="w-4 h-4" />,
          disabled: selectedVertexCount < 2,
          onSelect: () => {
            onFillSelection();
            onClose();
          },
        });
      }

      actions.push(
        {
          id: 'merge',
          label: 'Fusionar vértices',
          icon: <GitMerge className="w-4 h-4" />,
          disabled: selectedVertexCount < 2,
          onSelect: () => {
            onStartOperator('merge');
            onClose();
          },
        },
        {
          id: 'merge_by_distance',
          label: 'Fusionar por distancia',
          icon: <Minimize2 className="w-4 h-4 text-[#ff9900]" />,
          dividerAfter: true,
          onSelect: () => {
            onStartOperator('merge_by_distance');
            onClose();
          },
        },
      );

      // Dissolve & Delete per submode
      if (editSelectionMode === 'vertex') {
        actions.push(
          {
            id: 'dissolve_v',
            label: 'Disolver vértices',
            icon: <ScissorsLineDashed className="w-4 h-4" />,
            onSelect: () => {
              onExecuteContextualDelete('dissolve_vertices');
              onClose();
            },
          },
          {
            id: 'delete_v',
            label: 'Eliminar vértices',
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onSelect: () => {
              onExecuteContextualDelete('delete_vertices');
              onClose();
            },
          },
        );
      } else if (editSelectionMode === 'edge') {
        actions.push(
          {
            id: 'dissolve_e',
            label: 'Disolver aristas',
            icon: <ScissorsLineDashed className="w-4 h-4" />,
            onSelect: () => {
              onExecuteContextualDelete('dissolve_edges');
              onClose();
            },
          },
          {
            id: 'delete_e',
            label: 'Eliminar aristas',
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onSelect: () => {
              onExecuteContextualDelete('delete_edges');
              onClose();
            },
          },
        );
      } else {
        actions.push(
          {
            id: 'dissolve_f',
            label: 'Disolver caras',
            icon: <ScissorsLineDashed className="w-4 h-4" />,
            onSelect: () => {
              onExecuteContextualDelete('dissolve_faces');
              onClose();
            },
          },
          {
            id: 'delete_f',
            label: 'Eliminar solo caras',
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onSelect: () => {
              onExecuteContextualDelete('delete_only_faces');
              onClose();
            },
          },
        );
      }

      actions.push(
        {
          id: 'recalculate_outside',
          label: 'Recalculate Outside',
          icon: <RefreshCw className="w-4 h-4 text-[#60a5fa]" />,
          onSelect: () => {
            onRecalculateOutside();
            onClose();
          },
        },
        {
          id: 'flip_normals',
          label: 'Flip Normals',
          icon: <ArrowUpDown className="w-4 h-4 text-[#f87171]" />,
          onSelect: () => {
            onFlipNormals();
            onClose();
          },
        },
        {
          id: 'face_orientation',
          label: showFaceOrientation
            ? 'Face Orientation (Activo)'
            : 'Face Orientation',
          icon: showFaceOrientation ? (
            <Check className="w-4 h-4 text-[#60a5fa]" />
          ) : (
            <span className="inline-flex w-4 h-4 rounded-sm overflow-hidden border border-white/25">
              <span className="w-1/2 h-full bg-[#2563eb]" />
              <span className="w-1/2 h-full bg-[#e03131]" />
            </span>
          ),
          dividerAfter: !onToggleProportional,
          onSelect: () => {
            onToggleFaceOrientation();
            onClose();
          },
        },
        ...(onToggleProportional
          ? [
              {
                id: 'proportional_editing',
                label: proportionalEnabled
                  ? 'Edición proporcional (ON · O)'
                  : 'Edición proporcional (O)',
                icon: (
                  <ProportionalIcon
                    className={`w-4 h-4 ${
                      proportionalEnabled ? 'text-[#ff9900]' : ''
                    }`}
                  />
                ),
                dividerAfter: true,
                onSelect: () => {
                  onToggleProportional();
                  onClose();
                },
              },
            ]
          : []),
        {
          id: 'deselect',
          label: 'Limpiar selección',
          icon: <X className="w-4 h-4" />,
          onSelect: () => {
            onDeselectAll();
            onClose();
          },
        },
      );
    } else {
      // Edit mode without active component selection
      actions.push(
        {
          id: 'select_all',
          label: 'Seleccionar todo',
          icon: <CheckSquare className="w-4 h-4 text-[#ff9900]" />,
          onSelect: () => {
            onSelectAll();
            onClose();
          },
        },
        {
          id: 'loop_cut',
          label: 'Corte de bucle',
          icon: <Scissors className="w-4 h-4 text-[#38bdf8]" />,
          onSelect: () => {
            onStartOperator('loop_cut');
            onClose();
          },
        },
        {
          id: 'merge_by_distance_all',
          label: 'Fusionar por distancia',
          icon: <Minimize2 className="w-4 h-4 text-[#ff9900]" />,
          dividerAfter: true,
          onSelect: () => {
            onStartOperator('merge_by_distance');
            onClose();
          },
        },
        {
          id: 'recalculate_outside_all',
          label: 'Recalculate Outside',
          icon: <RefreshCw className="w-4 h-4 text-[#60a5fa]" />,
          onSelect: () => {
            onRecalculateOutside();
            onClose();
          },
        },
        {
          id: 'flip_normals_all',
          label: 'Flip Normals',
          icon: <ArrowUpDown className="w-4 h-4 text-[#f87171]" />,
          onSelect: () => {
            onFlipNormals();
            onClose();
          },
        },
        {
          id: 'face_orientation_all',
          label: showFaceOrientation
            ? 'Face Orientation (Activo)'
            : 'Face Orientation',
          icon: showFaceOrientation ? (
            <Check className="w-4 h-4 text-[#60a5fa]" />
          ) : (
            <span className="inline-flex w-4 h-4 rounded-sm overflow-hidden border border-white/25">
              <span className="w-1/2 h-full bg-[#2563eb]" />
              <span className="w-1/2 h-full bg-[#e03131]" />
            </span>
          ),
          dividerAfter: !onToggleProportional,
          onSelect: () => {
            onToggleFaceOrientation();
            onClose();
          },
        },
        ...(onToggleProportional
          ? [
              {
                id: 'proportional_editing_all',
                label: proportionalEnabled
                  ? 'Edición proporcional (ON · O)'
                  : 'Edición proporcional (O)',
                icon: (
                  <ProportionalIcon
                    className={`w-4 h-4 ${
                      proportionalEnabled ? 'text-[#ff9900]' : ''
                    }`}
                  />
                ),
                dividerAfter: true,
                onSelect: () => {
                  onToggleProportional();
                  onClose();
                },
              },
            ]
          : []),
        {
          id: 'mode_v',
          label: 'Modo Vértices',
          icon: <Triangle className="w-4 h-4" />,
          disabled: editSelectionMode === 'vertex',
          onSelect: () => {
            onChangeEditSelectionMode('vertex');
            onClose();
          },
        },
        {
          id: 'mode_e',
          label: 'Modo Aristas',
          icon: <Triangle className="w-4 h-4" />,
          disabled: editSelectionMode === 'edge',
          onSelect: () => {
            onChangeEditSelectionMode('edge');
            onClose();
          },
        },
        {
          id: 'mode_f',
          label: 'Modo Caras',
          icon: <Triangle className="w-4 h-4" />,
          disabled: editSelectionMode === 'face',
          dividerAfter: true,
          onSelect: () => {
            onChangeEditSelectionMode('face');
            onClose();
          },
        },
        {
          id: 'exit_edit',
          label: 'Volver a Modo Objeto',
          icon: <Box className="w-4 h-4" />,
          onSelect: () => {
            onToggleWorkMode('object');
            onClose();
          },
        },
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={menuRef}
        style={{ left: pos.left, top: pos.top }}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed w-64 max-h-[82vh] rounded-xl bg-[#181a1f] border border-[#383e4a] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-3 py-2 border-b border-[#282c35] flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs font-semibold text-[#f3f4f6] truncate">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-[#242832] text-[#9ca3af] hover:text-white flex items-center justify-center shrink-0"
            aria-label="Cerrar menú contextual"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-1.5 overflow-y-auto cad-scroll space-y-0.5">
          {actions.map((act) => (
            <React.Fragment key={act.id}>
              <button
                type="button"
                disabled={act.disabled}
                onClick={act.onSelect}
                className={`w-full min-h-[42px] px-2.5 py-2 rounded-lg text-left flex items-center gap-2.5 text-xs font-medium transition-colors disabled:opacity-35 disabled:pointer-events-none ${
                  act.danger
                    ? 'text-[#f87171] hover:bg-[#352024]'
                    : 'text-[#e5e7eb] hover:bg-[#252932]'
                }`}
              >
                <span className="shrink-0">{act.icon}</span>
                <span className="truncate">{act.label}</span>
              </button>
              {act.dividerAfter && (
                <div className="h-px bg-[#282c35] my-1 mx-1" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

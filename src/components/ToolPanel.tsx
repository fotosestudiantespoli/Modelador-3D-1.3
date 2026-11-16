import React, { useState } from 'react';
import {
  CheckSquare,
  Columns,
  Copy,
  FlipHorizontal,
  GitMerge,
  Grid,
  Layers,
  Maximize2,
  MousePointer,
  Move,
  PaintBucket,
  Plus,
  RotateCw,
  Scissors,
  Square,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { DeleteActionType } from '../core/mesh/advancedOperations';
import { EditSelectionMode } from '../core/mesh/operations';
import { PrimitiveOptions, PrimitiveType } from '../core/mesh/primitives';
import { TransformTool, WorkMode } from '../core/project/types';
import { EditOperatorType } from '../state/useModelerStore';
import { DeleteMenuPopover } from './DeleteMenuPopover';
import { PrimitiveMenu } from './PrimitiveMenu';
import { ProportionalIcon } from './ProportionalEditingBar';

interface ToolPanelProps {
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  activeTool: TransformTool;
  activeOperatorType: EditOperatorType | null;
  hasSelectedObject: boolean;
  hasSelectedComponents: boolean;
  multiSelectTouch: boolean;
  proportionalEnabled?: boolean;
  onSelectTool: (tool: TransformTool) => void;
  onAddPrimitive: (type: PrimitiveType, options?: PrimitiveOptions) => void;
  onDuplicateObject: () => void;
  onDeleteObject: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartOperator: (type: EditOperatorType) => void;
  onFillSelection: () => void;
  onConnectVertexPath?: () => void;
  onExecuteContextualDelete: (action: DeleteActionType) => void;
  onToggleMultiSelectTouch: () => void;
  onToggleProportional?: () => void;
}

export const ToolPanel: React.FC<ToolPanelProps> = ({
  workMode,
  editSelectionMode,
  activeTool,
  activeOperatorType,
  hasSelectedObject,
  hasSelectedComponents,
  multiSelectTouch,
  proportionalEnabled = false,
  onSelectTool,
  onAddPrimitive,
  onDuplicateObject,
  onDeleteObject,
  onSelectAll,
  onDeselectAll,
  onStartOperator,
  onFillSelection,
  onConnectVertexPath,
  onExecuteContextualDelete,
  onToggleMultiSelectTouch,
  onToggleProportional,
}) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);

  const transformTools: {
    id: TransformTool;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: 'select', label: 'Selec.', icon: <MousePointer className="w-5 h-5" /> },
    { id: 'move', label: 'Mover', icon: <Move className="w-5 h-5" /> },
    { id: 'rotate', label: 'Rotar', icon: <RotateCw className="w-5 h-5" /> },
    { id: 'scale', label: 'Escalar', icon: <Maximize2 className="w-5 h-5" /> },
  ];

  const meshTools: {
    id: EditOperatorType;
    label: string;
    title: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'extrude',
      label: 'Extruir',
      title: 'Extruir selección (E)',
      icon: <FlipHorizontal className="w-4 h-4" />,
    },
    {
      id: 'inset',
      label: 'Insertar',
      title: 'Insertar caras (I)',
      icon: <Square className="w-4 h-4" />,
    },
    {
      id: 'subdivide',
      label: 'Subdiv.',
      title: 'Subdividir aristas o caras',
      icon: <Grid className="w-4 h-4" />,
    },
    {
      id: 'bevel',
      label: 'Biselar',
      title: 'Biselar aristas o vértices (B)',
      icon: <Columns className="w-4 h-4" />,
    },
    {
      id: 'loop_cut',
      label: 'Bucle',
      title: 'Corte de bucle (K)',
      icon: <Scissors className="w-4 h-4" />,
    },
    {
      id: 'merge',
      label: 'Fusionar',
      title: 'Fusionar vértices (M)',
      icon: <GitMerge className="w-4 h-4" />,
    },
  ];

  return (
    <aside className="relative w-[72px] shrink-0 bg-[#181a1f] border-r border-[#2b2e36] flex flex-col items-center py-2 px-1.5 gap-1.5 overflow-y-auto cad-scroll z-20">
      {workMode === 'object' && (
        <>
          <button
            type="button"
            onClick={() => setShowAddMenu((prev) => !prev)}
            className={`w-full min-h-[52px] rounded-md flex flex-col items-center justify-center gap-1 text-[10px] font-bold tracking-wide transition-colors shrink-0 ${
              showAddMenu
                ? 'bg-[#ff9900] text-[#111215]'
                : 'bg-[#d97706] hover:bg-[#e5840b] text-[#111215]'
            }`}
          >
            <Plus className="w-5 h-5" />
            <span>AGREGAR</span>
          </button>

          <div className="w-10 h-px bg-[#2c3038] my-0.5 shrink-0" />
        </>
      )}

      {/* Transform Tools */}
      {transformTools.map((tool) => {
        const isActive = activeTool === tool.id && !activeOperatorType;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onSelectTool(tool.id)}
            className={`w-full min-h-[46px] rounded-md flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors shrink-0 ${
              isActive
                ? 'bg-[#2c313b] text-[#ff9900] border border-[#ff9900]/45'
                : 'text-[#b4bac4] hover:bg-[#23262d] hover:text-[#f3f4f6] border border-transparent'
            }`}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </button>
        );
      })}

      <div className="w-10 h-px bg-[#2c3038] my-0.5 shrink-0" />

      {workMode === 'object' ? (
        <>
          <button
            type="button"
            onClick={onDuplicateObject}
            disabled={!hasSelectedObject}
            className="w-full min-h-[48px] rounded-md flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-[#b4bac4] hover:bg-[#23262d] hover:text-[#f3f4f6] disabled:opacity-35 disabled:pointer-events-none transition-colors shrink-0"
          >
            <Copy className="w-5 h-5" />
            <span>Duplicar</span>
          </button>
          <button
            type="button"
            onClick={onDeleteObject}
            disabled={!hasSelectedObject}
            className="w-full min-h-[48px] rounded-md flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-[#e06c75] hover:bg-[#352024] disabled:opacity-35 disabled:pointer-events-none transition-colors shrink-0"
          >
            <Trash2 className="w-5 h-5" />
            <span>Eliminar</span>
          </button>
        </>
      ) : (
        <>
          {/* Edit Mode Mesh Modeling Tools */}
          {meshTools.map((tool) => {
            const isActive = activeOperatorType === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setShowDeleteMenu(false);
                  onStartOperator(tool.id);
                }}
                title={tool.title}
                className={`w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors shrink-0 ${
                  isActive
                    ? 'bg-[#2c313b] text-[#ff9900] border border-[#ff9900]/55'
                    : 'text-[#c9ced8] hover:bg-[#23262d] hover:text-[#ffffff] border border-transparent'
                }`}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setShowDeleteMenu(false);
              onFillSelection();
            }}
            disabled={!hasSelectedComponents}
            title="Rellenar arista o cara (F)"
            className="w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-[#c9ced8] hover:bg-[#23262d] hover:text-[#ffffff] disabled:opacity-35 disabled:pointer-events-none border border-transparent transition-colors shrink-0"
          >
            <PaintBucket className="w-4 h-4" />
            <span>Rellenar</span>
          </button>

          {onConnectVertexPath && (
            <button
              type="button"
              onClick={() => {
                setShowDeleteMenu(false);
                onConnectVertexPath();
              }}
              disabled={!hasSelectedComponents || editSelectionMode !== 'vertex'}
              title="Connect Vertex Path (J)"
              className="w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-[#c9ced8] hover:bg-[#23262d] hover:text-[#ffffff] disabled:opacity-35 disabled:pointer-events-none border border-transparent transition-colors shrink-0"
            >
              <Waypoints className="w-4 h-4 text-[#38bdf8]" />
              <span>Conectar</span>
            </button>
          )}

          <div className="w-10 h-px bg-[#2c3038] my-0.5 shrink-0" />

          <button
            type="button"
            onClick={onToggleMultiSelectTouch}
            className={`w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors shrink-0 ${
              multiSelectTouch
                ? 'bg-[#2c313b] text-[#ff9900] border border-[#ff9900]/45'
                : 'text-[#b4bac4] hover:bg-[#23262d] border border-transparent'
            }`}
            title="Activar selección múltiple por toque"
          >
            <Layers className="w-4 h-4" />
            <span>Múltiple</span>
          </button>

          {onToggleProportional && (
            <button
              type="button"
              onClick={onToggleProportional}
              className={`w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors shrink-0 ${
                proportionalEnabled
                  ? 'bg-[#2a1f10] text-[#ffb84d] border border-[#ff9900]/65'
                  : 'text-[#b4bac4] hover:bg-[#23262d] border border-transparent'
              }`}
              title="Edición Proporcional (O)"
            >
              <ProportionalIcon className="w-4 h-4" />
              <span>Proporc.</span>
            </button>
          )}

          <button
            type="button"
            onClick={onSelectAll}
            className="w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[#b4bac4] hover:bg-[#23262d] hover:text-[#f3f4f6] transition-colors shrink-0"
            title="Seleccionar todo"
          >
            <CheckSquare className="w-4 h-4" />
            <span>Sel. todo</span>
          </button>

          <button
            type="button"
            onClick={onDeselectAll}
            disabled={!hasSelectedComponents}
            className="w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[#b4bac4] hover:bg-[#23262d] hover:text-[#f3f4f6] disabled:opacity-35 disabled:pointer-events-none transition-colors shrink-0"
            title="Deseleccionar todo"
          >
            <Square className="w-4 h-4" />
            <span>Limpiar</span>
          </button>

          <button
            type="button"
            onClick={() => setShowDeleteMenu((prev) => !prev)}
            disabled={!hasSelectedComponents}
            className={`w-full min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors shrink-0 ${
              showDeleteMenu
                ? 'bg-[#352024] text-[#ff7b85] border border-[#e06c75]/50'
                : 'text-[#e06c75] hover:bg-[#352024] border border-transparent'
            } disabled:opacity-35 disabled:pointer-events-none`}
            title="Opciones de eliminar o disolver selección"
          >
            <Trash2 className="w-4 h-4" />
            <span>Eliminar</span>
          </button>
        </>
      )}

      {/* Floating Primitive Menu */}
      {showAddMenu && workMode === 'object' && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setShowAddMenu(false)}
          />
          <div className="fixed left-[78px] top-14 z-40">
            <PrimitiveMenu
              onAddPrimitive={onAddPrimitive}
              onClose={() => setShowAddMenu(false)}
            />
          </div>
        </>
      )}

      {/* Contextual Edit Mode Delete/Dissolve Menu */}
      {showDeleteMenu && workMode === 'edit' && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setShowDeleteMenu(false)}
          />
          <div className="fixed left-[78px] bottom-10 z-40">
            <DeleteMenuPopover
              editSelectionMode={editSelectionMode}
              onSelectAction={onExecuteContextualDelete}
              onClose={() => setShowDeleteMenu(false)}
            />
          </div>
        </>
      )}
    </aside>
  );
};


import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  ArrowUpDown,
  CheckSquare,
  Columns,
  Copy,
  FlipHorizontal,
  GitMerge,
  Grid,
  Layers,
  Link2,
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
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Waypoints,
  X,
} from 'lucide-react';
import { DeleteActionType } from '../core/mesh/advancedOperations';
import { EditSelectionMode } from '../core/mesh/operations';
import { PrimitiveOptions, PrimitiveType } from '../core/mesh/primitives';
import {
  AxisConstraint,
  CameraProjection,
  FloatingMenuCorner,
  FloatingMenuSize,
  TransformTool,
  WorkMode,
} from '../core/project/types';
import {
  RADIAL_ACTION_MAP,
  RadialActionDefinition,
  RadialActionId,
  RadialMenuLayouts,
  RadialWorkMode,
} from '../core/radial/radialActions';
import { CameraPreset } from '../engine/ViewportEngine';
import { EditOperatorType } from '../state/useModelerStore';
import { DeleteMenuPopover } from './DeleteMenuPopover';
import { PrimitiveMenu } from './PrimitiveMenu';
import { ProportionalIcon } from './ProportionalEditingBar';
import { RadialActionIcon } from './RadialActionIcon';
import { RadialSlotEditorModal } from './RadialSlotEditorModal';

interface FloatingRadialMenuProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  activeTool: TransformTool;
  activeOperatorType?: EditOperatorType | null;
  axisConstraint: AxisConstraint;
  projection: CameraProjection;
  xrayEditMode: boolean;
  showFaceOrientation: boolean;
  showGrid: boolean;
  multiSelectTouch: boolean;
  screenShiftActive: boolean;
  hasSelectedObject: boolean;
  canEditSelected: boolean;
  hasSelectedComponents: boolean;
  canUndo: boolean;
  canRedo: boolean;
  corner: FloatingMenuCorner;
  size: FloatingMenuSize;
  customPos: { xPct: number; yPct: number } | null;
  radialLayouts: RadialMenuLayouts;
  onUpdateCustomPos: (pos: { xPct: number; yPct: number }) => void;
  onUpdateRadialSlot: (
    mode: RadialWorkMode,
    slotIndex: number,
    actionId: RadialActionId | null,
  ) => void;
  onResetRadialSlot: (mode: RadialWorkMode, slotIndex: number) => void;
  onResetRadialLayout: (mode: RadialWorkMode) => void;
  onAddPrimitive: (type: PrimitiveType, options?: PrimitiveOptions) => void;
  onSelectTool: (tool: TransformTool) => void;
  onChangeAxisConstraint: (axis: AxisConstraint) => void;
  onDuplicateObject: () => void;
  onDeleteObject: () => void;
  onSetCameraPreset: (preset: CameraPreset) => void;
  onToggleProjection: () => void;
  onToggleWorkMode: (mode: WorkMode) => void;
  onChangeEditSelectionMode: (mode: EditSelectionMode) => void;
  onToggleXray: () => void;
  onToggleFaceOrientation: () => void;
  onToggleGrid: () => void;
  onToggleMultiSelectTouch: () => void;
  onToggleScreenShift: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onStartOperator: (type: EditOperatorType) => void;
  onFillSelection: () => void;
  onConnectVertexPath: () => void;
  onRecalculateOutside: () => void;
  onFlipNormals: () => void;
  onQuickDissolve: () => void;
  onExecuteContextualDelete: (action: DeleteActionType) => void;
  proportionalEnabled: boolean;
  proportionalConnectedOnly: boolean;
  onToggleProportional: () => void;
  onToggleProportionalConnected: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSaveProject: () => void;
  onOpenSettings: () => void;
}

const SIZE_PX: Record<FloatingMenuSize, number> = {
  small: 48,
  medium: 56,
  large: 64,
};

const RING_RADIUS: Record<FloatingMenuSize, number> = {
  small: 112,
  medium: 128,
  large: 142,
};

const SLOT_LONG_PRESS_MS = 450;

export const FloatingRadialMenu: React.FC<FloatingRadialMenuProps> = ({
  containerRef,
  workMode,
  editSelectionMode,
  activeTool,
  activeOperatorType = null,
  axisConstraint,
  projection,
  xrayEditMode,
  showFaceOrientation,
  showGrid,
  multiSelectTouch,
  screenShiftActive,
  hasSelectedObject,
  canEditSelected,
  hasSelectedComponents,
  canUndo,
  canRedo,
  corner,
  size,
  customPos,
  radialLayouts,
  onUpdateCustomPos,
  onUpdateRadialSlot,
  onResetRadialSlot,
  onResetRadialLayout,
  onAddPrimitive,
  onSelectTool,
  onChangeAxisConstraint,
  onDuplicateObject,
  onDeleteObject,
  onSetCameraPreset,
  onToggleProjection,
  onToggleWorkMode,
  onChangeEditSelectionMode,
  onToggleXray,
  onToggleFaceOrientation,
  onToggleGrid,
  onToggleMultiSelectTouch,
  onToggleScreenShift,
  onUndo,
  onRedo,
  onStartOperator,
  onFillSelection,
  onConnectVertexPath,
  onRecalculateOutside,
  onFlipNormals,
  onQuickDissolve,
  onExecuteContextualDelete,
  proportionalEnabled,
  proportionalConnectedOnly,
  onToggleProportional,
  onToggleProportionalConnected,
  onSelectAll,
  onDeselectAll,
  onSaveProject,
  onOpenSettings,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showPrimitivePicker, setShowPrimitivePicker] = useState(false);
  const [showDeletePicker, setShowDeletePicker] = useState(false);
  const [customizeMode, setCustomizeMode] = useState(false);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const slotHoldRef = useRef<{
    slotIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    timer: number | null;
    triggered: boolean;
  } | null>(null);

  const activeRadialMode: RadialWorkMode = workMode;
  const btnSize = SIZE_PX[size];

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
    setShowPrimitivePicker(false);
    setShowDeletePicker(false);
  }, [workMode]);

  useEffect(() => {
    return () => {
      if (slotHoldRef.current?.timer != null) {
        window.clearTimeout(slotHoldRef.current.timer);
      }
    };
  }, []);

  const clearSlotHold = () => {
    if (slotHoldRef.current?.timer != null) {
      window.clearTimeout(slotHoldRef.current.timer);
      slotHoldRef.current.timer = null;
    }
  };

  const buttonPos = useMemo(() => {
    const padX = 16;
    const padTop = 58;
    const padBottom = 16;
    const maxX = Math.max(padX, viewportSize.width - btnSize - padX);
    const maxY = Math.max(padTop, viewportSize.height - btnSize - padBottom);

    if (dragPos) {
      return {
        x: Math.max(8, Math.min(viewportSize.width - btnSize - 8, dragPos.x)),
        y: Math.max(8, Math.min(viewportSize.height - btnSize - 8, dragPos.y)),
      };
    }

    if (customPos) {
      return {
        x: Math.max(
          8,
          Math.min(
            viewportSize.width - btnSize - 8,
            customPos.xPct * viewportSize.width - btnSize / 2,
          ),
        ),
        y: Math.max(
          8,
          Math.min(
            viewportSize.height - btnSize - 8,
            customPos.yPct * viewportSize.height - btnSize / 2,
          ),
        ),
      };
    }

    switch (corner) {
      case 'top-left':
        return { x: padX, y: padTop };
      case 'top-right':
        return { x: maxX, y: padTop };
      case 'bottom-left':
        return { x: padX, y: maxY };
      case 'bottom-right':
      default:
        return { x: maxX, y: maxY };
    }
  }, [btnSize, corner, customPos, dragPos, viewportSize]);

  const effectiveRadius = useMemo(() => {
    const maxAllowed = Math.min(viewportSize.width, viewportSize.height) / 2 - 54;
    return Math.max(86, Math.min(RING_RADIUS[size], maxAllowed));
  }, [size, viewportSize]);

  const wheelCenter = useMemo(() => {
    const rawCx = buttonPos.x + btnSize / 2;
    const rawCy = buttonPos.y + btnSize / 2;
    const safeMargin = effectiveRadius + 46;
    return {
      x: Math.max(
        safeMargin,
        Math.min(viewportSize.width - safeMargin, rawCx),
      ),
      y: Math.max(
        safeMargin + 16,
        Math.min(viewportSize.height - safeMargin - 20, rawCy),
      ),
    };
  }, [btnSize, buttonPos, effectiveRadius, viewportSize]);

  const dockPlacement = useMemo(() => {
    const dockWidth = Math.min(520, viewportSize.width - 24);
    const estHeight = workMode === 'edit' ? 128 : 92;
    const left = Math.max(
      12,
      Math.min(viewportSize.width - dockWidth - 12, wheelCenter.x - dockWidth / 2),
    );
    const belowY = wheelCenter.y + effectiveRadius + 44;
    const canPlaceBelow = belowY + estHeight <= viewportSize.height - 10;
    const aboveY = Math.max(10, wheelCenter.y - effectiveRadius - 40 - estHeight);
    return {
      left,
      top: canPlaceBelow ? belowY : aboveY,
      width: dockWidth,
    };
  }, [effectiveRadius, viewportSize.height, viewportSize.width, wheelCenter, workMode]);

  const quickDeleteAction: DeleteActionType =
    editSelectionMode === 'vertex'
      ? 'delete_vertices'
      : editSelectionMode === 'edge'
        ? 'delete_edges'
        : 'delete_only_faces';

  const getActionMetaState = (
    def: RadialActionDefinition,
  ): { active: boolean; disabled: boolean; label: string } => {
    let active = false;
    let disabled = false;
    let label = def.shortLabel;

    switch (def.id) {
      case 'open_add_menu':
        active = showPrimitivePicker;
        disabled = workMode !== 'object';
        break;
      case 'add_plane':
      case 'add_cube':
      case 'add_circle':
      case 'add_uv_sphere':
      case 'add_cylinder':
      case 'add_pyramid':
      case 'add_suzanne':
        disabled = workMode !== 'object';
        break;
      case 'tool_select':
        active = activeTool === 'select' && !activeOperatorType;
        break;
      case 'tool_move':
        active = activeTool === 'move' && !activeOperatorType;
        break;
      case 'tool_rotate':
        active = activeTool === 'rotate' && !activeOperatorType;
        break;
      case 'tool_scale':
        active = activeTool === 'scale' && !activeOperatorType;
        break;
      case 'axis_free':
        active = axisConstraint === 'free';
        break;
      case 'axis_x':
        active = axisConstraint === 'x';
        break;
      case 'axis_y':
        active = axisConstraint === 'y';
        break;
      case 'axis_z':
        active = axisConstraint === 'z';
        break;
      case 'duplicate_object':
        disabled = workMode !== 'object' || !hasSelectedObject;
        break;
      case 'delete_contextual':
        disabled =
          workMode === 'object' ? !hasSelectedObject : !hasSelectedComponents;
        break;
      case 'dissolve_quick':
      case 'delete_edges_verts':
      case 'delete_faces_edges':
        disabled = workMode !== 'edit' || !hasSelectedComponents;
        break;
      case 'op_extrude':
      case 'op_inset':
      case 'op_subdivide':
      case 'op_bevel':
      case 'op_loop_cut':
      case 'op_merge':
      case 'op_merge_by_distance':
      case 'fill_mesh':
        disabled = workMode !== 'edit' || !hasSelectedComponents;
        break;
      case 'connect_vertex_path':
        disabled =
          workMode !== 'edit' ||
          editSelectionMode !== 'vertex' ||
          !hasSelectedComponents;
        break;
      case 'op_recalculate_normals':
      case 'op_flip_normals':
        disabled = workMode !== 'edit';
        break;
      case 'select_all':
        disabled = workMode !== 'edit';
        break;
      case 'mode_vertex':
        active = workMode === 'edit' && editSelectionMode === 'vertex';
        disabled = workMode !== 'edit';
        break;
      case 'mode_edge':
        active = workMode === 'edit' && editSelectionMode === 'edge';
        disabled = workMode !== 'edit';
        break;
      case 'mode_face':
        active = workMode === 'edit' && editSelectionMode === 'face';
        disabled = workMode !== 'edit';
        break;
      case 'toggle_multi_select':
        active = multiSelectTouch;
        disabled = workMode !== 'edit';
        break;
      case 'toggle_shift_modifier':
        active = screenShiftActive;
        disabled = false;
        break;
      case 'work_object':
        active = workMode === 'object';
        break;
      case 'work_edit':
        active = workMode === 'edit';
        disabled = workMode !== 'edit' && !canEditSelected;
        break;
      case 'toggle_xray':
        active = xrayEditMode;
        disabled = false;
        break;
      case 'toggle_face_orientation':
        active = showFaceOrientation;
        disabled = false;
        break;
      case 'toggle_proportional':
        active = proportionalEnabled;
        disabled = workMode !== 'edit';
        break;
      case 'toggle_proportional_connected':
        active = proportionalConnectedOnly;
        disabled = workMode !== 'edit' || !proportionalEnabled;
        break;
      case 'toggle_grid':
        active = showGrid;
        break;
      case 'toggle_projection':
        label = projection === 'perspective' ? 'Orto.' : 'Persp.';
        break;
      case 'undo':
        disabled = !canUndo;
        break;
      case 'redo':
        disabled = !canRedo;
        break;
      default:
        break;
    }

    return { active, disabled, label };
  };

  const closeAll = () => {
    setShowPrimitivePicker(false);
    setShowDeletePicker(false);
    setCustomizeMode(false);
    setIsOpen(false);
  };

  const executeRadialAction = (actionId: RadialActionId) => {
    switch (actionId) {
      case 'focus_camera':
        onSetCameraPreset('focus');
        closeAll();
        break;
      case 'view_iso':
        onSetCameraPreset('iso');
        closeAll();
        break;
      case 'view_front':
        onSetCameraPreset('front');
        closeAll();
        break;
      case 'view_top':
        onSetCameraPreset('top');
        closeAll();
        break;
      case 'view_right':
        onSetCameraPreset('right');
        closeAll();
        break;
      case 'toggle_projection':
        onToggleProjection();
        closeAll();
        break;
      case 'select_all':
        onSelectAll();
        closeAll();
        break;
      case 'deselect_all':
        onDeselectAll();
        closeAll();
        break;
      case 'mode_vertex':
        onChangeEditSelectionMode('vertex');
        closeAll();
        break;
      case 'mode_edge':
        onChangeEditSelectionMode('edge');
        closeAll();
        break;
      case 'mode_face':
        onChangeEditSelectionMode('face');
        closeAll();
        break;
      case 'toggle_multi_select':
        onToggleMultiSelectTouch();
        closeAll();
        break;
      case 'toggle_shift_modifier':
        onToggleScreenShift();
        closeAll();
        break;
      case 'tool_select':
        onSelectTool('select');
        closeAll();
        break;
      case 'tool_move':
        onSelectTool('move');
        closeAll();
        break;
      case 'tool_rotate':
        onSelectTool('rotate');
        closeAll();
        break;
      case 'tool_scale':
        onSelectTool('scale');
        closeAll();
        break;
      case 'axis_free':
        onChangeAxisConstraint('free');
        closeAll();
        break;
      case 'axis_x':
        onChangeAxisConstraint('x');
        closeAll();
        break;
      case 'axis_y':
        onChangeAxisConstraint('y');
        closeAll();
        break;
      case 'axis_z':
        onChangeAxisConstraint('z');
        closeAll();
        break;
      case 'open_add_menu':
        setShowDeletePicker(false);
        setShowPrimitivePicker((prev) => !prev);
        break;
      case 'add_plane':
        onAddPrimitive('plane');
        closeAll();
        break;
      case 'add_cube':
        onAddPrimitive('cube');
        closeAll();
        break;
      case 'add_circle':
        onAddPrimitive('circle');
        closeAll();
        break;
      case 'add_uv_sphere':
        onAddPrimitive('uv_sphere');
        closeAll();
        break;
      case 'add_cylinder':
        onAddPrimitive('cylinder');
        closeAll();
        break;
      case 'add_pyramid':
        onAddPrimitive('pyramid');
        closeAll();
        break;
      case 'add_suzanne':
        onAddPrimitive('suzanne');
        closeAll();
        break;
      case 'fill_mesh':
        onFillSelection();
        closeAll();
        break;
      case 'connect_vertex_path':
        onConnectVertexPath();
        closeAll();
        break;
      case 'op_recalculate_normals':
        onRecalculateOutside();
        closeAll();
        break;
      case 'op_flip_normals':
        onFlipNormals();
        closeAll();
        break;
      case 'op_extrude':
        onStartOperator('extrude');
        closeAll();
        break;
      case 'op_inset':
        onStartOperator('inset');
        closeAll();
        break;
      case 'op_subdivide':
        onStartOperator('subdivide');
        closeAll();
        break;
      case 'op_bevel':
        onStartOperator('bevel');
        closeAll();
        break;
      case 'op_loop_cut':
        onStartOperator('loop_cut');
        closeAll();
        break;
      case 'op_merge':
        onStartOperator('merge');
        closeAll();
        break;
      case 'op_merge_by_distance':
        onStartOperator('merge_by_distance');
        closeAll();
        break;
      case 'duplicate_object':
        onDuplicateObject();
        closeAll();
        break;
      case 'delete_contextual':
        if (workMode === 'object') {
          onDeleteObject();
        } else {
          onExecuteContextualDelete(quickDeleteAction);
        }
        closeAll();
        break;
      case 'dissolve_quick':
        onQuickDissolve();
        closeAll();
        break;
      case 'delete_edges_verts':
        onExecuteContextualDelete('delete_edges_and_vertices');
        closeAll();
        break;
      case 'delete_faces_edges':
        onExecuteContextualDelete('delete_faces_and_edges');
        closeAll();
        break;
      case 'undo':
        onUndo();
        closeAll();
        break;
      case 'redo':
        onRedo();
        closeAll();
        break;
      case 'work_object':
        onToggleWorkMode('object');
        closeAll();
        break;
      case 'work_edit':
        onToggleWorkMode('edit');
        closeAll();
        break;
      case 'toggle_xray':
        onToggleXray();
        closeAll();
        break;
      case 'toggle_face_orientation':
        onToggleFaceOrientation();
        closeAll();
        break;
      case 'toggle_proportional':
        onToggleProportional();
        closeAll();
        break;
      case 'toggle_proportional_connected':
        onToggleProportionalConnected();
        closeAll();
        break;
      case 'toggle_grid':
        onToggleGrid();
        closeAll();
        break;
      case 'save_project':
        onSaveProject();
        closeAll();
        break;
      case 'open_settings':
        closeAll();
        onOpenSettings();
        break;
    }
  };

  const handleTriggerPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isOpen) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: buttonPos.x,
      origY: buttonPos.y,
      moved: false,
    };
  };

  const handleTriggerPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (!d.moved && Math.hypot(dx, dy) > 8) {
      d.moved = true;
    }
    if (d.moved) {
      setDragPos({
        x: d.origX + dx,
        y: d.origY + dy,
      });
    }
  };

  const handleTriggerPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const d = dragRef.current;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (d && d.moved) {
      const clampedX = Math.max(
        8,
        Math.min(
          viewportSize.width - btnSize - 8,
          d.origX + (e.clientX - d.startClientX),
        ),
      );
      const clampedY = Math.max(
        8,
        Math.min(
          viewportSize.height - btnSize - 8,
          d.origY + (e.clientY - d.startClientY),
        ),
      );
      setDragPos(null);
      onUpdateCustomPos({
        xPct: (clampedX + btnSize / 2) / viewportSize.width,
        yPct: (clampedY + btnSize / 2) / viewportSize.height,
      });
      return;
    }

    setShowPrimitivePicker(false);
    setShowDeletePicker(false);
    setCustomizeMode(false);
    setIsOpen((prev) => !prev);
  };

  const handleTriggerPointerCancel = (
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    dragRef.current = null;
    setDragPos(null);
  };

  const handleSlotPointerDown = (
    slotIndex: number,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    clearSlotHold();
    const timer = window.setTimeout(() => {
      if (slotHoldRef.current && slotHoldRef.current.slotIndex === slotIndex) {
        slotHoldRef.current.triggered = true;
        slotHoldRef.current.timer = null;
        setShowPrimitivePicker(false);
        setShowDeletePicker(false);
        setEditingSlotIndex(slotIndex);
      }
    }, SLOT_LONG_PRESS_MS);

    slotHoldRef.current = {
      slotIndex,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      timer,
      triggered: false,
    };
  };

  const handleSlotPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const hold = slotHoldRef.current;
    if (!hold || hold.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - hold.startX, e.clientY - hold.startY) > 10) {
      clearSlotHold();
    }
  };

  const handleSlotPointerUpOrCancel = () => {
    clearSlotHold();
  };

  const slots = radialLayouts[activeRadialMode];

  const transformTools: {
    id: TransformTool;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: 'select', label: 'Selec.', icon: <MousePointer className="w-3.5 h-3.5" /> },
    { id: 'move', label: 'Mover', icon: <Move className="w-3.5 h-3.5" /> },
    { id: 'rotate', label: 'Rotar', icon: <RotateCw className="w-3.5 h-3.5" /> },
    { id: 'scale', label: 'Escalar', icon: <Maximize2 className="w-3.5 h-3.5" /> },
  ];

  const meshQuickOps: {
    id: EditOperatorType;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: 'extrude', label: 'Extruir', icon: <FlipHorizontal className="w-3.5 h-3.5" /> },
    { id: 'inset', label: 'Insertar', icon: <Square className="w-3.5 h-3.5" /> },
    { id: 'subdivide', label: 'Subdiv.', icon: <Grid className="w-3.5 h-3.5" /> },
    { id: 'bevel', label: 'Biselar', icon: <Columns className="w-3.5 h-3.5" /> },
    { id: 'loop_cut', label: 'Bucle', icon: <Scissors className="w-3.5 h-3.5" /> },
    { id: 'merge', label: 'Fusionar', icon: <GitMerge className="w-3.5 h-3.5" /> },
    { id: 'merge_by_distance', label: 'Dist.', icon: <Minimize2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <>
      {/* Backdrop when radial menu is open */}
      {isOpen && (
        <div
          className="absolute inset-0 z-20 bg-black/30 transition-opacity duration-150"
          onPointerDown={(e) => {
            e.stopPropagation();
            closeAll();
          }}
        />
      )}

      {/* Draggable Floating Circular Trigger (when closed) */}
      {!isOpen && (
        <button
          type="button"
          onPointerDown={handleTriggerPointerDown}
          onPointerMove={handleTriggerPointerMove}
          onPointerUp={handleTriggerPointerUp}
          onPointerCancel={handleTriggerPointerCancel}
          style={{
            width: btnSize,
            height: btnSize,
            left: buttonPos.x,
            top: buttonPos.y,
            touchAction: 'none',
          }}
          className="absolute z-20 rounded-full bg-[#181a1f] hover:bg-[#22252d] border-2 border-[#3d424f] shadow-xl flex items-center justify-center text-[#ff9900] transition-colors select-none cursor-grab active:cursor-grabbing"
          title="Abrir menú radial de herramientas (arrastrar para reubicar)"
          aria-label="Abrir menú radial de herramientas"
        >
          <Aperture className="w-6 h-6" />
        </button>
      )}

      {/* Expanded Radial Wheel Overlay */}
      {isOpen && (
        <>
          <div
            style={{
              left: wheelCenter.x,
              top: wheelCenter.y,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-30 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          >
            <div className="relative pointer-events-auto transition-transform duration-150 ease-out scale-100">
              {/* Subtle Connecting Ring Guide */}
              <div
                style={{
                  width: effectiveRadius * 2,
                  height: effectiveRadius * 2,
                }}
                className="rounded-full border border-[#3a3f4b]/75 bg-[#14161b]/65 -translate-x-1/2 -translate-y-1/2 absolute left-0 top-0 pointer-events-none"
              />

              {/* Configurable Radial Slots */}
              {slots.map((actionId, idx) => {
                const angle = -Math.PI / 2 + (idx / slots.length) * Math.PI * 2;
                const ix = Math.cos(angle) * effectiveRadius;
                const iy = Math.sin(angle) * effectiveRadius;
                const def = actionId ? RADIAL_ACTION_MAP[actionId] : null;
                const meta = def
                  ? getActionMetaState(def)
                  : { active: false, disabled: false, label: 'Vacío' };

                const isSlotDisabled =
                  !customizeMode && def !== null && meta.disabled;

                return (
                  <button
                    key={`slot-${idx}`}
                    type="button"
                    onPointerDown={(e) => handleSlotPointerDown(idx, e)}
                    onPointerMove={handleSlotPointerMove}
                    onPointerUp={handleSlotPointerUpOrCancel}
                    onPointerCancel={handleSlotPointerUpOrCancel}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingSlotIndex(idx);
                    }}
                    onClick={() => {
                      if (
                        slotHoldRef.current &&
                        slotHoldRef.current.slotIndex === idx &&
                        slotHoldRef.current.triggered
                      ) {
                        slotHoldRef.current = null;
                        return;
                      }
                      if (customizeMode || !def) {
                        setShowPrimitivePicker(false);
                        setShowDeletePicker(false);
                        setEditingSlotIndex(idx);
                        return;
                      }
                      if (isSlotDisabled) return;
                      executeRadialAction(def.id);
                    }}
                    style={{
                      left: ix,
                      top: iy,
                    }}
                    title={
                      def
                        ? `${def.label} (mantener pulsado para personalizar)`
                        : 'Espacio vacío (tocar o mantener pulsado para asignar)'
                    }
                    className={`absolute -translate-x-1/2 -translate-y-1/2 w-[68px] h-[58px] rounded-xl border shadow-lg flex flex-col items-center justify-center gap-1 px-1 transition-transform duration-150 active:scale-95 ${
                      !def
                        ? 'bg-[#171920]/90 hover:bg-[#232732] border-dashed border-[#3f4554] text-[#7c8496]'
                        : isSlotDisabled
                          ? 'bg-[#1a1c22] border-[#2c303a] text-[#6b7280] opacity-45'
                          : customizeMode
                            ? 'bg-[#212530] hover:bg-[#2b303e] border-[#ff9900]/65 text-[#f3f4f6]'
                            : meta.active
                              ? 'bg-[#2c313b] border-[#ff9900] text-[#ff9900]'
                              : def.danger
                                ? 'bg-[#23191c] hover:bg-[#352024] border-[#593036] text-[#f87171]'
                                : 'bg-[#1c1f26] hover:bg-[#272b35] border-[#383e4c] text-[#e5e7eb]'
                    }`}
                  >
                    {def ? (
                      <RadialActionIcon icon={def.icon} className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    <span className="text-[10px] font-semibold leading-none tracking-tight truncate max-w-[62px]">
                      {meta.label}
                    </span>
                  </button>
                );
              })}

              {/* Center Hub Close Button + Customize Trigger */}
              <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={closeAll}
                  style={{ width: btnSize, height: btnSize }}
                  className="rounded-full bg-[#242832] hover:bg-[#2d323e] border-2 border-[#ff9900]/75 text-[#f3f4f6] shadow-xl flex items-center justify-center transition-colors"
                  aria-label="Cerrar menú radial"
                >
                  <X className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowPrimitivePicker(false);
                    setShowDeletePicker(false);
                    setCustomizeMode((prev) => !prev);
                  }}
                  className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold whitespace-nowrap flex items-center gap-1 shadow-md transition-colors ${
                    customizeMode
                      ? 'bg-[#ff9900] border-[#ff9900] text-[#111215]'
                      : 'bg-[#181a1f] hover:bg-[#23262e] border-[#353a46] text-[#b4bac4]'
                  }`}
                  title="Alternar edición rápida del menú radial (o mantén presionado un botón)"
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>{customizeMode ? 'Editando' : 'Personalizar'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Contextual Quick Tools, Axis Constraints & Edit Helpers Dock (Replaces legacy left ToolPanel + top-left axis bar) */}
          <div
            style={{
              left: dockPlacement.left,
              top: dockPlacement.top,
              width: dockPlacement.width,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-30 rounded-xl bg-[#181a1f]/95 border border-[#343a47] shadow-2xl p-2 space-y-1.5"
          >
            {/* Row 1: Transform Tools + Axis Constraint (Libre/X/Y/Z) + Undo/Redo */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1">
                {transformTools.map((tool) => {
                  const active = activeTool === tool.id && !activeOperatorType;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => {
                        onSelectTool(tool.id);
                        closeAll();
                      }}
                      className={`h-9 px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-colors touch-manipulation ${
                        active
                          ? 'bg-[#2c313b] border-[#ff9900]/70 text-[#ff9900]'
                          : 'bg-[#21242c] hover:bg-[#2a2e38] border-[#303542] text-[#d1d5db]'
                      }`}
                    >
                      {tool.icon}
                      <span className="hidden sm:inline">{tool.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Transform Axis Constraint: Libre | X | Y | Z */}
              <div
                className="flex items-center p-0.5 rounded-lg bg-[#111317] border border-[#2c303a]"
                aria-label="Restricción de eje de transformación"
              >
                {(
                  [
                    { id: 'free', label: 'Libre', color: 'text-[#e4e6eb]' },
                    { id: 'x', label: 'X', color: 'text-[#e05252]' },
                    { id: 'y', label: 'Y', color: 'text-[#52b852]' },
                    { id: 'z', label: 'Z', color: 'text-[#48bce8]' },
                  ] as const
                ).map((ax) => {
                  const active = axisConstraint === ax.id;
                  return (
                    <button
                      key={ax.id}
                      type="button"
                      onClick={() => onChangeAxisConstraint(ax.id)}
                      className={`h-8 px-2.5 rounded-md text-[11px] font-semibold transition-colors touch-manipulation ${
                        active
                          ? `bg-[#2c313b] ${ax.color} border border-[#464c5a]`
                          : 'text-[#9ca3af] hover:text-white border border-transparent'
                      }`}
                    >
                      {ax.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={() => {
                    onUndo();
                    closeAll();
                  }}
                  title="Deshacer"
                  aria-label="Deshacer"
                  className="h-9 w-9 rounded-lg bg-[#21242c] hover:bg-[#2a2e38] disabled:opacity-35 disabled:pointer-events-none border border-[#303542] text-[#e4e6eb] flex items-center justify-center"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={() => {
                    onRedo();
                    closeAll();
                  }}
                  title="Rehacer"
                  aria-label="Rehacer"
                  className="h-9 w-9 rounded-lg bg-[#21242c] hover:bg-[#2a2e38] disabled:opacity-35 disabled:pointer-events-none border border-[#303542] text-[#e4e6eb] flex items-center justify-center"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Row 2: Mode-specific actions (Object: Add / Duplicate / Delete | Edit: Submodes / Ops / Selection) */}
            {workMode === 'object' ? (
              <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-[#272b34]">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeletePicker(false);
                    setShowPrimitivePicker((prev) => !prev);
                  }}
                  className={`h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors touch-manipulation ${
                    showPrimitivePicker
                      ? 'bg-[#ff9900] text-[#111215]'
                      : 'bg-[#d97706] hover:bg-[#e5840b] text-[#111215]'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span>Agregar objeto</span>
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!hasSelectedObject}
                    onClick={() => {
                      onDuplicateObject();
                      closeAll();
                    }}
                    className="h-9 px-2.5 rounded-lg bg-[#21242c] hover:bg-[#2a2e38] disabled:opacity-35 disabled:pointer-events-none border border-[#303542] text-[11px] font-medium text-[#e4e6eb] flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#ff9900]" />
                    <span>Duplicar</span>
                  </button>
                  <button
                    type="button"
                    disabled={!hasSelectedObject}
                    onClick={() => {
                      onDeleteObject();
                      closeAll();
                    }}
                    className="h-9 px-2.5 rounded-lg bg-[#271b1e] hover:bg-[#3a2226] disabled:opacity-35 disabled:pointer-events-none border border-[#4a2b31] text-[11px] font-medium text-[#f87171] flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 pt-1.5 border-t border-[#272b34]">
                {/* Edit Submodes + Selection Actions */}
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center p-0.5 rounded-lg bg-[#111317] border border-[#2c303a]">
                    {(
                      [
                        { id: 'vertex', label: 'Vértices' },
                        { id: 'edge', label: 'Aristas' },
                        { id: 'face', label: 'Caras' },
                      ] as const
                    ).map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => onChangeEditSelectionMode(sub.id)}
                        className={`h-8 px-2.5 rounded-md text-[11px] font-semibold transition-colors touch-manipulation ${
                          editSelectionMode === sub.id
                            ? 'bg-[#2c313b] text-[#ff9900]'
                            : 'text-[#9ca3af] hover:text-white'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onToggleMultiSelectTouch()}
                      className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-colors ${
                        multiSelectTouch
                          ? 'bg-[#2c313b] border-[#ff9900]/60 text-[#ff9900]'
                          : 'bg-[#21242c] border-[#303542] text-[#b4bac4] hover:text-white'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Múltiple</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectAll();
                        closeAll();
                      }}
                      className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2a2e38] border border-[#303542] text-[11px] font-medium text-[#d1d5db] flex items-center gap-1"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Todo</span>
                    </button>
                    <button
                      type="button"
                      disabled={!hasSelectedComponents}
                      onClick={() => {
                        onDeselectAll();
                        closeAll();
                      }}
                      className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2a2e38] disabled:opacity-35 disabled:pointer-events-none border border-[#303542] text-[11px] font-medium text-[#d1d5db]"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                {/* Mesh Modeling Operators + Contextual Delete */}
                <div className="flex flex-wrap items-center gap-1">
                  {meshQuickOps.map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => {
                        onStartOperator(op.id);
                        closeAll();
                      }}
                      className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2c313b] border border-[#303542] text-[11px] font-medium text-[#e4e6eb] flex items-center gap-1 touch-manipulation"
                    >
                      <span className="text-[#ff9900]">{op.icon}</span>
                      <span>{op.label}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!hasSelectedComponents}
                    onClick={() => {
                      onFillSelection();
                      closeAll();
                    }}
                    className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2c313b] disabled:opacity-35 disabled:pointer-events-none border border-[#303542] text-[11px] font-medium text-[#e4e6eb] flex items-center gap-1 touch-manipulation"
                  >
                    <PaintBucket className="w-3.5 h-3.5 text-[#ff9900]" />
                    <span>Crear cara</span>
                  </button>
                  <button
                    type="button"
                    disabled={
                      editSelectionMode !== 'vertex' || !hasSelectedComponents
                    }
                    onClick={() => {
                      onConnectVertexPath();
                      closeAll();
                    }}
                    title="Connect Vertex Path (J)"
                    className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2c313b] disabled:opacity-35 disabled:pointer-events-none border border-[#303542] text-[11px] font-medium text-[#e4e6eb] flex items-center gap-1 touch-manipulation"
                  >
                    <Waypoints className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Conectar (J)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!hasSelectedComponents}
                    onClick={() => {
                      setShowPrimitivePicker(false);
                      setShowDeletePicker((prev) => !prev);
                    }}
                    className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 touch-manipulation ${
                      showDeletePicker
                        ? 'bg-[#352024] border-[#e06c75]/60 text-[#ff8b94]'
                        : 'bg-[#271b1e] hover:bg-[#352024] border-[#4a2b31] text-[#f87171]'
                    } disabled:opacity-35 disabled:pointer-events-none`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar...</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleFaceOrientation();
                      closeAll();
                    }}
                    title="Face Orientation (Azul: exterior · Rojo: invertida)"
                    className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 touch-manipulation ${
                      showFaceOrientation
                        ? 'bg-[#2c313b] border-[#3b82f6]/75 text-[#93c5fd]'
                        : 'bg-[#21242c] hover:bg-[#2c313b] border-[#303542] text-[#e4e6eb]'
                    }`}
                  >
                    <span
                      className="inline-flex w-3.5 h-3.5 rounded-sm overflow-hidden border border-white/25 shrink-0"
                      aria-hidden="true"
                    >
                      <span className="w-1/2 h-full bg-[#2563eb]" />
                      <span className="w-1/2 h-full bg-[#e03131]" />
                    </span>
                    <span>Face Orientation</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRecalculateOutside();
                      closeAll();
                    }}
                    title="Recalculate Outside"
                    className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2c313b] border border-[#303542] text-[11px] font-medium text-[#e4e6eb] flex items-center gap-1 touch-manipulation"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#60a5fa]" />
                    <span>Recalculate Outside</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFlipNormals();
                      closeAll();
                    }}
                    title="Flip Normals"
                    className="h-8 px-2 rounded-lg bg-[#21242c] hover:bg-[#2c313b] border border-[#303542] text-[11px] font-medium text-[#e4e6eb] flex items-center gap-1 touch-manipulation"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5 text-[#f87171]" />
                    <span>Flip Normals</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleProportional();
                      closeAll();
                    }}
                    title="Edición Proporcional (O)"
                    className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 touch-manipulation ${
                      proportionalEnabled
                        ? 'bg-[#2a1f10] border-[#ff9900] text-[#ffb84d]'
                        : 'bg-[#21242c] hover:bg-[#2c313b] border-[#303542] text-[#e4e6eb]'
                    }`}
                  >
                    <ProportionalIcon className="w-3.5 h-3.5" />
                    <span>Proporcional (O)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!proportionalEnabled}
                    onClick={() => {
                      onToggleProportionalConnected();
                      closeAll();
                    }}
                    title="Solo Conectados (Alt+O)"
                    className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 touch-manipulation disabled:opacity-35 disabled:pointer-events-none ${
                      proportionalConnectedOnly && proportionalEnabled
                        ? 'bg-[#132638] border-[#38bdf8] text-[#7dd3fc]'
                        : 'bg-[#21242c] hover:bg-[#2c313b] border-[#303542] text-[#e4e6eb]'
                    }`}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Conectados</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Full Primitive Menu Popover (with Cubo, Círculo, Esfera UV, Cilindro, Pirámide & resolution controls) */}
          {showPrimitivePicker && workMode === 'object' && (
            <div
              style={{
                left: Math.max(
                  12,
                  Math.min(viewportSize.width - 300, wheelCenter.x - 144),
                ),
                top: Math.max(12, Math.min(viewportSize.height - 380, 16)),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute z-40"
            >
              <PrimitiveMenu
                onAddPrimitive={(type, options) => {
                  onAddPrimitive(type, options);
                  closeAll();
                }}
                onClose={() => setShowPrimitivePicker(false)}
              />
            </div>
          )}

          {/* Contextual Edit Delete/Dissolve Popover */}
          {showDeletePicker && workMode === 'edit' && (
            <div
              style={{
                left: Math.max(
                  12,
                  Math.min(viewportSize.width - 268, wheelCenter.x - 128),
                ),
                top: Math.max(
                  12,
                  Math.min(viewportSize.height - 230, dockPlacement.top - 10),
                ),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute z-40"
            >
              <DeleteMenuPopover
                editSelectionMode={editSelectionMode}
                onSelectAction={(action) => {
                  onExecuteContextualDelete(action);
                  closeAll();
                }}
                onClose={() => setShowDeletePicker(false)}
              />
            </div>
          )}
        </>
      )}

      {/* Radial Slot Configuration Editor */}
      {editingSlotIndex !== null && (
        <RadialSlotEditorModal
          mode={activeRadialMode}
          slotIndex={editingSlotIndex}
          currentActionId={slots[editingSlotIndex] ?? null}
          onAssignAction={(actionId) =>
            onUpdateRadialSlot(activeRadialMode, editingSlotIndex, actionId)
          }
          onRestoreDefaultSlot={() =>
            onResetRadialSlot(activeRadialMode, editingSlotIndex)
          }
          onRestoreEntireLayout={() => onResetRadialLayout(activeRadialMode)}
          onClose={() => setEditingSlotIndex(null)}
        />
      )}
    </>
  );
};


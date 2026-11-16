import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditableMesh, Vec3 } from '../core/mesh/EditableMesh';
import { DeleteActionType } from '../core/mesh/advancedOperations';
import { EditSelectionMode } from '../core/mesh/operations';
import { PrimitiveOptions, PrimitiveType } from '../core/mesh/primitives';
import { ProportionalFalloff } from '../core/mesh/proportionalEditing';
import {
  AxisConstraint,
  CameraProjection,
  ModelerSettings,
  ObjectTransform,
  SceneObjectData,
  TouchControlSettings,
  TouchModifierKey,
  TouchModifierState,
  TransformTool,
  WorkMode,
} from '../core/project/types';
import {
  RadialActionId,
  RadialWorkMode,
} from '../core/radial/radialActions';
import { EMPTY_MODIFIER_STATE } from '../engine/TouchGestureManager';
import {
  BoxSelectOverlayState,
  CameraPreset,
  CameraQuaternionTuple,
  ViewportContextInfo,
  ViewportEngine,
} from '../engine/ViewportEngine';
import {
  EditOperatorParams,
  EditOperatorSession,
  EditOperatorType,
} from '../state/useModelerStore';
import { AxisGizmoHandle, AxisGizmoWidget } from './AxisGizmoWidget';
import { EditOperatorBar } from './EditOperatorBar';
import { FloatingModifierPanel } from './FloatingModifierPanel';
import { FloatingRadialMenu } from './FloatingRadialMenu';
import { ProportionalEditingBar } from './ProportionalEditingBar';
import {
  ContextMenuState,
  ViewportContextMenu,
} from './ViewportContextMenu';

export interface Viewport3DHandle {
  focusSelected: () => void;
}

interface Viewport3DProps {
  objects: SceneObjectData[];
  selectedObject: SceneObjectData | null;
  selectedObjectId: string | null;
  selectedObjectIds?: Set<string>;
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  selectedComponentIds: Set<string>;
  activeTool: TransformTool;
  axisConstraint: AxisConstraint;
  projection: CameraProjection;
  settings: ModelerSettings;
  meshRevision: number;
  toastMessage: string | null;
  screenShiftActive: boolean;
  screenModifiers: TouchModifierState;
  operatorSession: EditOperatorSession | null;
  operatorMergedCount?: number;
  loopCutPreviewSegments: [Vec3, Vec3][];
  loopCutRingEdgeIds?: string[];
  loopCutFaceIds?: string[];
  loopCutIsClosed?: boolean;
  loopCutError?: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onSelectObject: (id: string | null, additive?: boolean) => void;
  onBoxSelectObjects?: (ids: string[], additive: boolean) => void;
  onSelectComponent: (
    id: string | null,
    additive: boolean,
    addOnly?: boolean,
  ) => void;
  onBoxSelectComponents?: (ids: string[], additive: boolean) => void;
  onPickLoopCutEdge: (edgeId: string | null) => void;
  onTwoFingerUndo: () => void;
  onThreeFingerRedo: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onLiveObjectTransform: (id: string, transform: ObjectTransform) => void;
  onCommitObjectTransform: (
    id: string,
    before: ObjectTransform,
    after: ObjectTransform,
  ) => void;
  onCommitMeshEdit: (
    id: string,
    before: EditableMesh,
    after: EditableMesh,
  ) => void;
  onUpdateOperatorConfig: (config: EditOperatorParams) => void;
  onConfirmOperator: () => void;
  onCancelOperator: () => void;
  onChangeAxisConstraint: (axis: AxisConstraint) => void;
  onToggleProjection: (projection: CameraProjection) => void;
  onToggleXray: () => void;
  onToggleFaceOrientation: () => void;
  onToggleGrid: () => void;
  onToggleMultiSelectTouch: () => void;
  onToggleScreenShift: () => void;
  onSetScreenModifier: (key: TouchModifierKey, active: boolean) => void;
  onToggleScreenModifier: (key: TouchModifierKey) => void;
  onReleaseScreenModifiers: () => void;
  onUpdateTouchSettings: (patch: Partial<TouchControlSettings>) => void;
  onUpdateRadialSlot: (
    mode: RadialWorkMode,
    slotIndex: number,
    actionId: RadialActionId | null,
  ) => void;
  onResetRadialSlot: (mode: RadialWorkMode, slotIndex: number) => void;
  onResetRadialLayout: (mode: RadialWorkMode) => void;
  onAddPrimitive: (type: PrimitiveType, options?: PrimitiveOptions) => void;
  onSelectTool: (tool: TransformTool) => void;
  onDuplicateObject: () => void;
  onHideObject: (id: string) => void;
  onDeleteObject: () => void;
  onToggleWorkMode: (mode: WorkMode) => void;
  onChangeEditSelectionMode: (mode: EditSelectionMode) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartOperator: (type: EditOperatorType) => void;
  onFillSelection: () => void;
  onConnectVertexPath: () => void;
  onRecalculateOutside: () => void;
  onFlipNormals: () => void;
  onQuickDissolve: () => void;
  onExecuteContextualDelete: (action: DeleteActionType) => void;
  proportionalModifierWarning?: string | null;
  onToggleProportional: () => void;
  onToggleProportionalConnected: () => void;
  onChangeProportionalFalloff: (falloff: ProportionalFalloff) => void;
  onChangeProportionalRadius: (radius: number) => void;
  onSaveProject: () => void;
  onOpenSettings: () => void;
}

export const Viewport3D = React.forwardRef<Viewport3DHandle, Viewport3DProps>(
  (
    {
      objects,
      selectedObject,
      selectedObjectId,
      selectedObjectIds,
      workMode,
      editSelectionMode,
      selectedComponentIds,
      activeTool,
      axisConstraint,
      projection,
      settings,
      meshRevision,
      toastMessage,
      screenShiftActive,
      screenModifiers,
      operatorSession,
      operatorMergedCount = 0,
      loopCutPreviewSegments,
      loopCutRingEdgeIds = [],
      loopCutFaceIds = [],
      loopCutIsClosed = false,
      loopCutError = null,
      canUndo,
      canRedo,
      onSelectObject,
      onBoxSelectObjects,
      onSelectComponent,
      onBoxSelectComponents,
      onPickLoopCutEdge,
      onTwoFingerUndo,
      onThreeFingerRedo,
      onUndo,
      onRedo,
      onLiveObjectTransform,
      onCommitObjectTransform,
      onCommitMeshEdit,
      onUpdateOperatorConfig,
      onConfirmOperator,
      onCancelOperator,
      onChangeAxisConstraint,
      onToggleProjection,
      onToggleXray,
      onToggleFaceOrientation,
      onToggleGrid,
      onToggleMultiSelectTouch,
      onToggleScreenShift,
      onSetScreenModifier,
      onToggleScreenModifier,
      onReleaseScreenModifiers,
      onUpdateTouchSettings,
      onUpdateRadialSlot,
      onResetRadialSlot,
      onResetRadialLayout,
      onAddPrimitive,
      onSelectTool,
      onDuplicateObject,
      onHideObject,
      onDeleteObject,
      onToggleWorkMode,
      onChangeEditSelectionMode,
      onSelectAll,
      onDeselectAll,
      onStartOperator,
      onFillSelection,
      onConnectVertexPath,
      onRecalculateOutside,
      onFlipNormals,
      onQuickDissolve,
      onExecuteContextualDelete,
      proportionalModifierWarning = null,
      onToggleProportional,
      onToggleProportionalConnected,
      onChangeProportionalFalloff,
      onChangeProportionalRadius,
      onSaveProject,
      onOpenSettings,
    },
    ref,
  ) => {
    const viewportContainerRef = useRef<HTMLDivElement | null>(null);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<ViewportEngine | null>(null);
    const gizmoRef = useRef<AxisGizmoHandle | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [boxOverlay, setBoxOverlay] = useState<BoxSelectOverlayState | null>(
      null,
    );
    const [gestureModifiers, setGestureModifiers] =
      useState<TouchModifierState>(EMPTY_MODIFIER_STATE);
    const [physicalModifiers, setPhysicalModifiers] =
      useState<TouchModifierState>(EMPTY_MODIFIER_STATE);
    const [loopCutSlideActive, setLoopCutSlideActive] = useState(false);

    useEffect(() => {
      const updateFromKeyboardEvent = (e: KeyboardEvent) => {
        setPhysicalModifiers((prev) => {
          const nextShift = e.shiftKey;
          const nextCtrl = e.ctrlKey || e.metaKey;
          const nextAlt = e.altKey;
          if (
            prev.shift === nextShift &&
            prev.ctrl === nextCtrl &&
            prev.alt === nextAlt
          ) {
            return prev;
          }
          return { shift: nextShift, ctrl: nextCtrl, alt: nextAlt };
        });
      };
      const resetPhysical = () => setPhysicalModifiers(EMPTY_MODIFIER_STATE);
      window.addEventListener('keydown', updateFromKeyboardEvent);
      window.addEventListener('keyup', updateFromKeyboardEvent);
      window.addEventListener('blur', resetPhysical);
      return () => {
        window.removeEventListener('keydown', updateFromKeyboardEvent);
        window.removeEventListener('keyup', updateFromKeyboardEvent);
        window.removeEventListener('blur', resetPhysical);
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focusSelected() {
          engineRef.current?.setCameraPreset('focus');
        },
      }),
      [],
    );

  const handleSelectCameraPreset = useCallback(
    (preset: CameraPreset) => {
      if (
        preset === 'front' ||
        preset === 'back' ||
        preset === 'top' ||
        preset === 'bottom' ||
        preset === 'right' ||
        preset === 'left'
      ) {
        if (projection !== 'orthographic') {
          engineRef.current?.switchProjection('orthographic');
          onToggleProjection('orthographic');
        }
      } else if (preset === 'iso') {
        if (projection !== 'perspective') {
          engineRef.current?.switchProjection('perspective');
          onToggleProjection('perspective');
        }
      }
      engineRef.current?.setCameraPreset(preset);
    },
    [onToggleProjection, projection],
  );

  const handleOpenContextMenu = useCallback(
    (info: ViewportContextInfo) => {
      if (workMode === 'object') {
        if (info.hitObjectId && info.hitObjectId !== selectedObjectId) {
          onSelectObject(info.hitObjectId);
        }
      } else if (
        info.hitComponentId &&
        !selectedComponentIds.has(info.hitComponentId)
      ) {
        onSelectComponent(
          info.hitComponentId,
          Boolean(settings.multiSelectTouch || screenShiftActive),
          false,
        );
      }
      setContextMenu({
        clientX: info.clientX,
        clientY: info.clientY,
        hitObjectId: info.hitObjectId,
        hitComponentId: info.hitComponentId,
      });
    },
    [
      onSelectComponent,
      onSelectObject,
      screenShiftActive,
      selectedComponentIds,
      selectedObjectId,
      settings.multiSelectTouch,
      workMode,
    ],
  );

  const handleLoopCutSlideDelta = useCallback(
    (delta: number) => {
      if (!operatorSession || operatorSession.config.type !== 'loop_cut') return;
      const nextSlide = Math.max(
        -1,
        Math.min(1, operatorSession.config.params.slide + delta),
      );
      onUpdateOperatorConfig({
        type: 'loop_cut',
        params: { ...operatorSession.config.params, slide: nextSlide },
      });
    },
    [onUpdateOperatorConfig, operatorSession],
  );

  const callbacksRef = useRef({
    onSelectObject,
    onBoxSelectObjects,
    onSelectComponent,
    onBoxSelectComponents,
    onPickLoopCutEdge,
    onLoopCutSlideDelta: handleLoopCutSlideDelta,
    onTwoFingerUndo,
    onThreeFingerRedo,
    onOpenContextMenu: handleOpenContextMenu,
    onModifierStateChange: (mods: TouchModifierState) =>
      setGestureModifiers(mods),
    onCameraPoseChange: (quat: CameraQuaternionTuple) => {
      gizmoRef.current?.updateOrientation(quat);
    },
    onLiveObjectTransform,
    onCommitObjectTransform,
    onCommitMeshEdit,
    onChangeProportionalRadius,
  });
  callbacksRef.current = {
    onSelectObject,
    onBoxSelectObjects,
    onSelectComponent,
    onBoxSelectComponents,
    onPickLoopCutEdge,
    onLoopCutSlideDelta: handleLoopCutSlideDelta,
    onTwoFingerUndo,
    onThreeFingerRedo,
    onOpenContextMenu: handleOpenContextMenu,
    onModifierStateChange: (mods: TouchModifierState) =>
      setGestureModifiers(mods),
    onCameraPoseChange: (quat: CameraQuaternionTuple) => {
      gizmoRef.current?.updateOrientation(quat);
    },
    onLiveObjectTransform,
    onCommitObjectTransform,
    onCommitMeshEdit,
    onChangeProportionalRadius,
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new ViewportEngine(container, {
      onSelectObject: (id, additive) =>
        callbacksRef.current.onSelectObject(id, additive),
      onBoxSelectObjects: (ids, additive) =>
        callbacksRef.current.onBoxSelectObjects?.(ids, additive),
      onSelectComponent: (id, additive, addOnly) =>
        callbacksRef.current.onSelectComponent(id, additive, addOnly),
      onBoxSelectComponents: (ids, additive) =>
        callbacksRef.current.onBoxSelectComponents?.(ids, additive),
      onBoxSelectOverlayChange: (overlay) => setBoxOverlay(overlay),
      onPickLoopCutEdge: (edgeId) =>
        callbacksRef.current.onPickLoopCutEdge(edgeId),
      onLoopCutSlideDelta: (delta) =>
        callbacksRef.current.onLoopCutSlideDelta(delta),
      onTwoFingerUndo: () => callbacksRef.current.onTwoFingerUndo(),
      onThreeFingerRedo: () => callbacksRef.current.onThreeFingerRedo(),
      onOpenContextMenu: (info) =>
        callbacksRef.current.onOpenContextMenu(info),
      onModifierStateChange: (mods) =>
        callbacksRef.current.onModifierStateChange(mods),
      onCameraPoseChange: (quat) =>
        callbacksRef.current.onCameraPoseChange(quat),
      onLiveObjectTransform: (id, transform) =>
        callbacksRef.current.onLiveObjectTransform(id, transform),
      onCommitObjectTransform: (id, before, after) =>
        callbacksRef.current.onCommitObjectTransform(id, before, after),
      onCommitMeshEdit: (id, before, after) =>
        callbacksRef.current.onCommitMeshEdit(id, before, after),
      onChangeProportionalRadius: (radius) =>
        callbacksRef.current.onChangeProportionalRadius(radius),
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.syncScene({
      objects,
      selectedObjectId,
      selectedObjectIds,
      workMode,
      editSelectionMode,
      selectedComponentIds,
      activeTool,
      axisConstraint,
      projection,
      settings,
      meshRevision,
      suppressGizmo: Boolean(operatorSession),
      virtualModifiers: screenModifiers,
      loopCutPreviewMode: operatorSession?.config.type === 'loop_cut',
      loopCutPreviewSegments,
      loopCutPreviewRingEdgeIds: loopCutRingEdgeIds,
      loopCutPreviewFaceIds: loopCutFaceIds,
      loopCutSlideActive,
    });
  }, [
    objects,
    selectedObjectId,
    selectedObjectIds,
    workMode,
    editSelectionMode,
    selectedComponentIds,
    activeTool,
    axisConstraint,
    projection,
    settings,
    meshRevision,
    operatorSession,
    screenModifiers,
    loopCutPreviewSegments,
    loopCutRingEdgeIds,
    loopCutFaceIds,
    loopCutSlideActive,
  ]);

  useEffect(() => {
    setContextMenu(null);
    if (operatorSession?.config.type !== 'loop_cut') {
      setLoopCutSlideActive(false);
    }
  }, [workMode, operatorSession]);

  const editSelectionDetails = useMemo(() => {
    if (workMode !== 'edit' || !selectedObject) {
      return { vertexCount: 0, canInset: false };
    }
    const editable = EditableMesh.fromJSON(selectedObject.mesh);
    const verts = editable.getVertexIdsFromSelection(
      editSelectionMode,
      selectedComponentIds,
    );
    const canInset =
      (editSelectionMode === 'face' && selectedComponentIds.size > 0) ||
      editable.faces.some((f) => f.vertexIds.every((vid) => verts.has(vid)));
    return { vertexCount: verts.size, canInset };
  }, [editSelectionMode, selectedComponentIds, selectedObject, workMode]);

  const effectiveModifiers: TouchModifierState = useMemo(
    () => ({
      shift:
        gestureModifiers.shift ||
        screenModifiers.shift ||
        physicalModifiers.shift,
      ctrl:
        gestureModifiers.ctrl ||
        screenModifiers.ctrl ||
        physicalModifiers.ctrl,
      alt:
        gestureModifiers.alt ||
        screenModifiers.alt ||
        physicalModifiers.alt,
    }),
    [gestureModifiers, physicalModifiers, screenModifiers],
  );

  return (
    <main className="relative flex-1 min-w-0 h-full flex flex-col bg-[#1d1f24] overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={viewportContainerRef}
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        className="relative flex-1 min-h-0 w-full select-none"
      >
        <div
          ref={mountRef}
          style={{
            touchAction: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
          className="w-full h-full"
        />

        {/* Double-Tap + Drag Rectangular Box Selection Overlay */}
        {boxOverlay && (
          <div
            style={{
              left: boxOverlay.left,
              top: boxOverlay.top,
              width: boxOverlay.width,
              height: boxOverlay.height,
            }}
            className={`absolute z-20 pointer-events-none border-[1.5px] border-dashed ${
              boxOverlay.additive
                ? 'border-[#38bdf8] bg-[#38bdf8]/15'
                : 'border-[#ff9900] bg-[#ff9900]/14'
            } shadow-[0_0_0_1px_rgba(17,18,21,0.75)]`}
          >
            {(boxOverlay.width > 34 || boxOverlay.height > 22) && (
              <div className="absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-[#14161b]/92 border border-[#3a3f4b] text-[10px] font-mono-tabular font-semibold text-[#f3f4f6] whitespace-nowrap shadow">
                {boxOverlay.additive ? '+ ' : ''}
                {boxOverlay.matchCount}{' '}
                {workMode === 'object' ? 'obj.' : 'sel.'}
              </div>
            )}
          </div>
        )}

        {/* Top-Center: Proportional Editing HUD in Edit Mode */}
        {workMode === 'edit' && !operatorSession && (
          <ProportionalEditingBar
            config={settings.proportionalEditing}
            hasSelection={selectedComponentIds.size > 0}
            modifierWarning={proportionalModifierWarning}
            onToggleEnabled={onToggleProportional}
            onToggleConnectedOnly={onToggleProportionalConnected}
            onChangeFalloff={onChangeProportionalFalloff}
            onChangeRadius={onChangeProportionalRadius}
          />
        )}

        {/* Top-Right: Interactive Z-Up Orientation Gizmo */}
        <div className="absolute top-3 right-3 z-10 pointer-events-none">
          <AxisGizmoWidget
            ref={gizmoRef}
            onSelectPreset={handleSelectCameraPreset}
          />
        </div>

        {/* ZBrush-inspired Movable Floating Modifiers Panel (SHIFT / CTRL / ALT) */}
        <FloatingModifierPanel
          containerRef={viewportContainerRef}
          settings={settings.touch}
          effectiveModifiers={effectiveModifiers}
          virtualModifiers={screenModifiers}
          onSetModifier={onSetScreenModifier}
          onToggleModifier={onToggleScreenModifier}
          onReleaseAll={onReleaseScreenModifiers}
          onChangeBehaviorMode={(mode) =>
            onUpdateTouchSettings({ modifierPanelMode: mode })
          }
        />

        {/* Floating Draggable Button & Customizable Radial Menu */}
        {settings.touch.floatingMenuEnabled && !operatorSession && (
          <FloatingRadialMenu
            containerRef={viewportContainerRef}
            workMode={workMode}
            editSelectionMode={editSelectionMode}
            activeTool={activeTool}
            activeOperatorType={null}
            axisConstraint={axisConstraint}
            projection={projection}
            xrayEditMode={settings.displayMode === 'xray'}
            showFaceOrientation={Boolean(settings.showFaceOrientation)}
            showGrid={settings.showGrid}
            multiSelectTouch={settings.multiSelectTouch}
            screenShiftActive={screenShiftActive}
            hasSelectedObject={Boolean(selectedObject)}
            canEditSelected={Boolean(
              selectedObject &&
                selectedObject.objectType === 'mesh' &&
                !selectedObject.locked,
            )}
            hasSelectedComponents={selectedComponentIds.size > 0}
            canUndo={canUndo}
            canRedo={canRedo}
            corner={settings.touch.floatingMenuCorner}
            size={settings.touch.floatingMenuSize}
            customPos={settings.touch.floatingMenuCustomPos}
            radialLayouts={settings.touch.radialLayouts}
            onUpdateCustomPos={(pos) =>
              onUpdateTouchSettings({ floatingMenuCustomPos: pos })
            }
            onUpdateRadialSlot={onUpdateRadialSlot}
            onResetRadialSlot={onResetRadialSlot}
            onResetRadialLayout={onResetRadialLayout}
            onAddPrimitive={onAddPrimitive}
            onSelectTool={onSelectTool}
            onChangeAxisConstraint={onChangeAxisConstraint}
            onDuplicateObject={onDuplicateObject}
            onDeleteObject={onDeleteObject}
            onSetCameraPreset={handleSelectCameraPreset}
            onToggleProjection={() =>
              onToggleProjection(
                projection === 'perspective' ? 'orthographic' : 'perspective',
              )
            }
            onToggleWorkMode={onToggleWorkMode}
            onChangeEditSelectionMode={onChangeEditSelectionMode}
            onToggleXray={onToggleXray}
            onToggleFaceOrientation={onToggleFaceOrientation}
            onToggleGrid={onToggleGrid}
            onToggleMultiSelectTouch={onToggleMultiSelectTouch}
            onToggleScreenShift={onToggleScreenShift}
            onUndo={onUndo}
            onRedo={onRedo}
            onStartOperator={onStartOperator}
            onFillSelection={onFillSelection}
            onConnectVertexPath={onConnectVertexPath}
            onRecalculateOutside={onRecalculateOutside}
            onFlipNormals={onFlipNormals}
            onQuickDissolve={onQuickDissolve}
            onExecuteContextualDelete={onExecuteContextualDelete}
            proportionalEnabled={settings.proportionalEditing.enabled}
            proportionalConnectedOnly={
              settings.proportionalEditing.connectedOnly
            }
            onToggleProportional={onToggleProportional}
            onToggleProportionalConnected={onToggleProportionalConnected}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onSaveProject={onSaveProject}
            onOpenSettings={onOpenSettings}
          />
        )}

        {/* Long-Press Contextual Menu */}
        {contextMenu && (
          <ViewportContextMenu
            menu={contextMenu}
            workMode={workMode}
            editSelectionMode={editSelectionMode}
            selectedObjectName={selectedObject?.name ?? null}
            hasSelectedObject={
              workMode === 'object'
                ? Boolean(contextMenu.hitObjectId)
                : Boolean(selectedObject)
            }
            canEditSelected={Boolean(
              selectedObject &&
                selectedObject.objectType === 'mesh' &&
                !selectedObject.locked,
            )}
            selectedCount={selectedComponentIds.size}
            selectedVertexCount={editSelectionDetails.vertexCount}
            canInset={editSelectionDetails.canInset}
            showFaceOrientation={Boolean(settings.showFaceOrientation)}
            proportionalEnabled={settings.proportionalEditing.enabled}
            canUndo={canUndo}
            canRedo={canRedo}
            onClose={() => setContextMenu(null)}
            onAddPrimitive={onAddPrimitive}
            onSelectTool={onSelectTool}
            onToggleWorkMode={onToggleWorkMode}
            onChangeEditSelectionMode={onChangeEditSelectionMode}
            onDuplicateObject={onDuplicateObject}
            onHideObject={() => {
              if (selectedObjectId) onHideObject(selectedObjectId);
            }}
            onDeleteObject={onDeleteObject}
            onFocusCamera={() => engineRef.current?.setCameraPreset('focus')}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onStartOperator={onStartOperator}
            onFillSelection={onFillSelection}
            onConnectVertexPath={onConnectVertexPath}
            onToggleFaceOrientation={onToggleFaceOrientation}
            onToggleProportional={onToggleProportional}
            onRecalculateOutside={onRecalculateOutside}
            onFlipNormals={onFlipNormals}
            onExecuteContextualDelete={onExecuteContextualDelete}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        )}

        {/* Live Edit Mode Operator Parameter Bar */}
        {operatorSession && (
          <EditOperatorBar
            session={operatorSession}
            mergedCount={operatorMergedCount}
            loopCutFaceCount={loopCutFaceIds.length}
            loopCutIsClosed={loopCutIsClosed}
            loopCutError={loopCutError}
            loopCutSlideActive={loopCutSlideActive}
            onToggleLoopCutSlideActive={() =>
              setLoopCutSlideActive((prev) => !prev)
            }
            onUpdateConfig={onUpdateOperatorConfig}
            onConfirm={onConfirmOperator}
            onCancel={onCancelOperator}
          />
        )}

        {/* Transient Action Feedback Toast */}
        {toastMessage && (
          <div
            className={`absolute ${
              operatorSession ? 'bottom-28' : 'bottom-4'
            } left-1/2 -translate-x-1/2 z-20 px-3.5 py-2 rounded-md bg-[#181a1f] border border-[#3a3f4b] text-xs font-medium text-[#f3f4f6] shadow-lg pointer-events-none`}
          >
            {toastMessage}
          </div>
        )}
      </div>
    </main>
  );
  },
);

Viewport3D.displayName = 'Viewport3D';

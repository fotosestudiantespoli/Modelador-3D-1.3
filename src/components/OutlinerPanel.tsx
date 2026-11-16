import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  Pyramid,
  SlidersHorizontal,
  Square,
  Sun,
  Trash2,
  Unlock,
  Box,
  Circle,
  Cylinder,
  X,
  ArrowRightLeft,
} from 'lucide-react';
import * as THREE from 'three';
import { EditableMesh } from '../core/mesh/EditableMesh';
import { EditSelectionMode } from '../core/mesh/operations';
import {
  DeleteCollectionResolution,
  getCollectionObjectCount,
} from '../core/project/hierarchy';
import {
  CollectionData,
  ObjectTransform,
  ReferenceImageData,
  ReferenceImageOrientation,
  SceneData,
  SceneObjectData,
  WorkMode,
} from '../core/project/types';
import {
  ModifierDiagnostic,
  ModifierSlot,
  ModifierType,
} from '../core/modifiers/types';
import { ModifierStackPanel } from './ModifierStackPanel';

interface OutlinerPanelProps {
  scenes: SceneData[];
  activeSceneId: string;
  activeCollectionId: string;
  objects: SceneObjectData[];
  selectedObjectId: string | null;
  selectedObjectIds?: Set<string>;
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  selectedComponentIds: Set<string>;
  liveTransformOverride: { id: string; transform: ObjectTransform } | null;
  onSelectObject: (id: string) => void;
  onSelectObjectInScene: (
    sceneId: string,
    objectId: string,
    additive?: boolean,
  ) => void;
  onRenameObject: (id: string, name: string) => void;
  onDuplicateObject: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onUpdateObjectTransform: (id: string, transform: ObjectTransform) => void;
  onUpdateEditCentroidAxis: (axis: 0 | 1 | 2, value: number) => void;
  onCreateScene: () => void;
  onSwitchScene: (sceneId: string) => void;
  onRenameScene: (sceneId: string, name: string) => void;
  onDeleteScene: (sceneId: string) => void;
  onCreateCollection: (
    sceneId: string,
    name?: string,
    parentId?: string | null,
  ) => void;
  onSelectCollection: (sceneId: string, collectionId: string) => void;
  onRenameCollection: (
    sceneId: string,
    collectionId: string,
    name: string,
  ) => void;
  onToggleCollectionExpanded: (sceneId: string, collectionId: string) => void;
  onDeleteCollection: (
    sceneId: string,
    collectionId: string,
    resolution: DeleteCollectionResolution,
  ) => void;
  onMoveObjectToCollection: (
    sceneId: string,
    objectId: string,
    targetCollectionId: string,
  ) => void;
  onUpdateReferenceImageProps: (
    objectId: string,
    patch: Partial<
      Pick<ReferenceImageData, 'opacity' | 'orientation' | 'depthMode'>
    >,
    recordHistory?: boolean,
  ) => void;
  modifierDiagnostics: Record<string, ModifierDiagnostic>;
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
  onClose?: () => void;
}

type HierarchyItemMenu =
  | { kind: 'scene'; sceneId: string; x: number; y: number }
  | { kind: 'collection'; sceneId: string; collectionId: string; x: number; y: number }
  | { kind: 'object'; sceneId: string; objectId: string; x: number; y: number };

type RenamingTarget =
  | { kind: 'scene'; id: string }
  | { kind: 'collection'; sceneId: string; id: string }
  | { kind: 'object'; id: string };

interface DeleteCollectionPrompt {
  sceneId: string;
  collection: CollectionData;
  objectCount: number;
  otherCollections: CollectionData[];
}

function getObjectIcon(obj: SceneObjectData) {
  switch (obj.objectType) {
    case 'reference_image':
      return <ImageIcon className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />;
    case 'camera':
      return <Camera className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />;
    case 'light':
      return <Sun className="w-3.5 h-3.5 text-[#facc15] shrink-0" />;
    case 'empty':
      return <Crosshair className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />;
    case 'mesh':
    default:
      switch (obj.primitiveType) {
        case 'plane':
          return <Square className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />;
        case 'cube':
          return <Box className="w-3.5 h-3.5 text-[#ff9900] shrink-0" />;
        case 'circle':
          return <Circle className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />;
        case 'uv_sphere':
          return <Globe className="w-3.5 h-3.5 text-[#34d399] shrink-0" />;
        case 'cylinder':
          return <Cylinder className="w-3.5 h-3.5 text-[#a78bfa] shrink-0" />;
        case 'pyramid':
          return <Pyramid className="w-3.5 h-3.5 text-[#f472b6] shrink-0" />;
        case 'suzanne':
          return (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5 text-[#ff9900] shrink-0"
            >
              <circle cx="4.5" cy="11" r="2.5" />
              <circle cx="19.5" cy="11" r="2.5" />
              <path d="M7 10.5C7 7 9.2 4.5 12 4.5s5 2.5 5 6c0 2-.7 3.5-1.5 4.8-.6 1-1.3 3.7-3.5 3.7s-2.9-2.7-3.5-3.7C7.7 14 7 12.5 7 10.5Z" />
            </svg>
          );
        default:
          return <Box className="w-3.5 h-3.5 text-[#9ca3af] shrink-0" />;
      }
  }
}

export const OutlinerPanel: React.FC<OutlinerPanelProps> = ({
  scenes,
  activeSceneId,
  activeCollectionId,
  objects,
  selectedObjectId,
  selectedObjectIds,
  workMode,
  editSelectionMode,
  selectedComponentIds,
  liveTransformOverride,
  onSelectObjectInScene,
  onRenameObject,
  onDuplicateObject,
  onToggleVisibility,
  onToggleLock,
  onDeleteObject,
  onUpdateObjectTransform,
  onUpdateEditCentroidAxis,
  onCreateScene,
  onSwitchScene,
  onRenameScene,
  onDeleteScene,
  onCreateCollection,
  onSelectCollection,
  onRenameCollection,
  onToggleCollectionExpanded,
  onDeleteCollection,
  onMoveObjectToCollection,
  onUpdateReferenceImageProps,
  modifierDiagnostics,
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
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'modifiers'>(
    'hierarchy',
  );
  const [expandedScenes, setExpandedScenes] = useState<Record<string, boolean>>(
    () => ({ [activeSceneId]: true }),
  );
  const [renaming, setRenaming] = useState<RenamingTarget | null>(null);
  const [draftName, setDraftName] = useState('');
  const [contextMenu, setContextMenu] = useState<HierarchyItemMenu | null>(null);
  const [movePickerFor, setMovePickerFor] = useState<{
    sceneId: string;
    objectId: string;
  } | null>(null);
  const [deletePrompt, setDeletePrompt] =
    useState<DeleteCollectionPrompt | null>(null);
  const [deleteTargetColId, setDeleteTargetColId] = useState<string>('');

  // Pointer & HTML5 Drag State for moving objects between collections cleanly
  const [dragState, setDragState] = useState<{
    sceneId: string;
    objectId: string;
    objectName: string;
    hoverCollectionId: string | null;
    clientX: number;
    clientY: number;
  } | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  // Auto-expand active scene when switching/creating scenes
  useEffect(() => {
    setExpandedScenes((prev) =>
      prev[activeSceneId] ? prev : { ...prev, [activeSceneId]: true },
    );
  }, [activeSceneId]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const selectedObj = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId],
  );

  const activeTransform: ObjectTransform | null = useMemo(() => {
    if (!selectedObj) return null;
    if (liveTransformOverride && liveTransformOverride.id === selectedObj.id) {
      return liveTransformOverride.transform;
    }
    return selectedObj.transform;
  }, [liveTransformOverride, selectedObj]);

  const editCentroid = useMemo(() => {
    if (workMode !== 'edit' || !selectedObj || selectedComponentIds.size === 0) {
      return null;
    }
    const mesh = EditableMesh.fromJSON(selectedObj.mesh);
    const vertIds = mesh.getVertexIdsFromSelection(
      editSelectionMode,
      selectedComponentIds,
    );
    return {
      centroid: mesh.computeCentroid(vertIds),
      vertexCount: vertIds.size,
    };
  }, [editSelectionMode, selectedComponentIds, selectedObj, workMode]);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  const scheduleLongPress = (
    e: React.PointerEvent,
    buildMenu: (x: number, y: number) => HierarchyItemMenu,
  ) => {
    clearLongPress();
    const x = e.clientX;
    const y = e.clientY;
    longPressStartRef.current = { x, y };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      setContextMenu(buildMenu(x, y));
    }, 460);
  };

  const handleRowPointerMoveForLongPress = (e: React.PointerEvent) => {
    if (!longPressStartRef.current || longPressTimerRef.current === null) return;
    if (
      Math.hypot(
        e.clientX - longPressStartRef.current.x,
        e.clientY - longPressStartRef.current.y,
      ) > 10
    ) {
      clearLongPress();
    }
  };

  const commitRename = () => {
    if (!renaming) return;
    const trimmed = draftName.trim();
    if (trimmed) {
      if (renaming.kind === 'scene') {
        onRenameScene(renaming.id, trimmed);
      } else if (renaming.kind === 'collection') {
        onRenameCollection(renaming.sceneId, renaming.id, trimmed);
      } else {
        onRenameObject(renaming.id, trimmed);
      }
    }
    setRenaming(null);
  };

  const requestDeleteCollection = (
    scene: SceneData,
    collection: CollectionData,
  ) => {
    if (scene.collections.length <= 1) return;
    const count = getCollectionObjectCount(scene, collection.id);
    if (count === 0) {
      onDeleteCollection(scene.id, collection.id, { mode: 'delete_objects' });
      return;
    }
    const others = scene.collections.filter((c) => c.id !== collection.id);
    setDeleteTargetColId(others[0]?.id ?? '');
    setDeletePrompt({
      sceneId: scene.id,
      collection,
      objectCount: count,
      otherCollections: others,
    });
  };

  const handleNumericTransform = (
    field: 'position' | 'rotation' | 'scale',
    axis: 0 | 1 | 2,
    raw: string,
  ) => {
    if (!selectedObj || !activeTransform || selectedObj.locked) return;
    const val = parseFloat(raw);
    if (Number.isNaN(val)) return;
    const next: ObjectTransform = {
      position: [...activeTransform.position],
      rotation: [...activeTransform.rotation],
      scale: [...activeTransform.scale],
    };
    if (field === 'rotation') {
      next.rotation[axis] = THREE.MathUtils.degToRad(val);
    } else if (field === 'scale') {
      next.scale[axis] = Math.abs(val) < 0.001 ? 0.001 : val;
    } else {
      next.position[axis] = val;
    }
    onUpdateObjectTransform(selectedObj.id, next);
  };

  // Pointer-based touch-safe drag from dedicated grip handle
  const handleGripPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    sceneId: string,
    obj: SceneObjectData,
  ) => {
    e.stopPropagation();
    clearLongPress();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      sceneId,
      objectId: obj.id,
      objectName: obj.name,
      hoverCollectionId: obj.collectionId,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  const handleGripPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const colEl = el?.closest('[data-drop-collection-id]') as HTMLElement | null;
    const targetSceneId = colEl?.dataset.dropSceneId ?? null;
    const targetColId =
      colEl && targetSceneId === dragState.sceneId
        ? (colEl.dataset.dropCollectionId ?? null)
        : null;
    setDragState((prev) =>
      prev
        ? {
            ...prev,
            hoverCollectionId: targetColId,
            clientX: e.clientX,
            clientY: e.clientY,
          }
        : null,
    );
  };

  const handleGripPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (dragState.hoverCollectionId) {
      onMoveObjectToCollection(
        dragState.sceneId,
        dragState.objectId,
        dragState.hoverCollectionId,
      );
    }
    setDragState(null);
  };

  const renderCollectionBranch = (
    scene: SceneData,
    collection: CollectionData,
    depth: number,
  ): React.ReactNode => {
    const childCollections = scene.collections.filter(
      (c) => c.parentId === collection.id,
    );
    const colObjects = scene.objects.filter(
      (o) => o.collectionId === collection.id,
    );
    const count = getCollectionObjectCount(scene, collection.id, true);
    const isActiveCollection =
      scene.id === activeSceneId && collection.id === activeCollectionId;
    const isDropTarget =
      dragState?.sceneId === scene.id &&
      dragState.hoverCollectionId === collection.id;
    const isRenamingCol =
      renaming?.kind === 'collection' && renaming.id === collection.id;

    return (
      <div key={collection.id} className="space-y-0.5">
        {/* Collection Row */}
        <div
          data-drop-scene-id={scene.id}
          data-drop-collection-id={collection.id}
          onDragOver={(e) => {
            if (dragState?.sceneId === scene.id) e.preventDefault();
          }}
          onPointerDown={(e) =>
            scheduleLongPress(e, (x, y) => ({
              kind: 'collection',
              sceneId: scene.id,
              collectionId: collection.id,
              x,
              y,
            }))
          }
          onPointerMove={handleRowPointerMoveForLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onClick={() => onSelectCollection(scene.id, collection.id)}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          className={`min-h-[38px] pr-1 rounded-md flex items-center justify-between gap-1 cursor-pointer transition-colors ${
            isDropTarget
              ? 'bg-[#3b2e19] border border-[#ff9900]'
              : isActiveCollection
                ? 'bg-[#232730] border border-[#3a404f]'
                : 'hover:bg-[#20232b] border border-transparent'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollectionExpanded(scene.id, collection.id);
              }}
              className="w-6 h-6 rounded hover:bg-[#2f3440] text-[#9ca3af] hover:text-white flex items-center justify-center shrink-0"
              aria-label={
                collection.expanded ? 'Contraer colección' : 'Expandir colección'
              }
            >
              {collection.expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {collection.expanded ? (
              <FolderOpen
                className={`w-3.5 h-3.5 shrink-0 ${
                  isActiveCollection ? 'text-[#ff9900]' : 'text-[#cbd5e1]'
                }`}
              />
            ) : (
              <Folder
                className={`w-3.5 h-3.5 shrink-0 ${
                  isActiveCollection ? 'text-[#ff9900]' : 'text-[#94a3b8]'
                }`}
              />
            )}

            {isRenamingCol ? (
              <div
                className="flex items-center gap-1 flex-1 min-w-0"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  autoFocus
                  className="w-full h-7 px-1.5 rounded bg-[#111317] border border-[#ff9900] text-xs text-white outline-none"
                />
                <button
                  type="button"
                  onClick={commitRename}
                  className="w-7 h-7 rounded bg-[#ff9900] text-[#111215] flex items-center justify-center shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span
                  className={`text-xs font-medium truncate ${
                    isActiveCollection ? 'text-[#f3f4f6]' : 'text-[#cbd5e1]'
                  }`}
                >
                  {collection.name}
                </span>
                <span className="text-[11px] font-mono-tabular text-[#7c8494] shrink-0">
                  ({count})
                </span>
              </div>
            )}
          </div>

          {!isRenamingCol && (
            <div
              className="flex items-center gap-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextMenu({
                    kind: 'collection',
                    sceneId: scene.id,
                    collectionId: collection.id,
                    x: rect.right,
                    y: rect.bottom,
                  });
                }}
                className="w-7 h-7 rounded hover:bg-[#323640] text-[#8e95a2] hover:text-white flex items-center justify-center"
                title="Opciones de colección"
                aria-label={`Opciones de ${collection.name}`}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Children inside Collection */}
        {collection.expanded && (
          <div className="space-y-0.5">
            {childCollections.map((sub) =>
              renderCollectionBranch(scene, sub, depth + 1),
            )}

            {colObjects.map((obj) => {
              const isSelected =
                scene.id === activeSceneId &&
                (selectedObjectIds
                  ? selectedObjectIds.has(obj.id)
                  : obj.id === selectedObjectId);
              const isRenamingObj =
                renaming?.kind === 'object' && renaming.id === obj.id;
              const isBeingDragged = dragState?.objectId === obj.id;

              return (
                <div
                  key={obj.id}
                  onPointerDown={(e) =>
                    scheduleLongPress(e, (x, y) => ({
                      kind: 'object',
                      sceneId: scene.id,
                      objectId: obj.id,
                      x,
                      y,
                    }))
                  }
                  onPointerMove={handleRowPointerMoveForLongPress}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onClick={(e) =>
                    onSelectObjectInScene(scene.id, obj.id, e.shiftKey)
                  }
                  style={{ paddingLeft: `${26 + depth * 12}px` }}
                  className={`min-h-[40px] pr-1 rounded-md flex items-center justify-between gap-1 cursor-pointer transition-colors ${
                    isBeingDragged
                      ? 'opacity-50 bg-[#272b35] border border-dashed border-[#ff9900]'
                      : isSelected
                        ? 'bg-[#2a2f3a] border border-[#ff9900]/55'
                        : 'hover:bg-[#22252c] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {scene.collections.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) =>
                          handleGripPointerDown(e, scene.id, obj)
                        }
                        onPointerMove={handleGripPointerMove}
                        onPointerUp={handleGripPointerUp}
                        onPointerCancel={() => setDragState(null)}
                        style={{ touchAction: 'none' }}
                        className="w-5 h-7 -ml-1 rounded hover:bg-[#323744] text-[#6b7280] hover:text-[#cbd5e1] flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing"
                        title="Arrastrar a otra colección"
                        aria-label={`Mover ${obj.name} entre colecciones`}
                      >
                        <GripVertical className="w-3 h-3" />
                      </button>
                    )}

                    {getObjectIcon(obj)}

                    {isRenamingObj ? (
                      <div
                        className="flex items-center gap-1 flex-1 min-w-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          autoFocus
                          className="w-full h-7 px-1.5 rounded bg-[#111317] border border-[#ff9900] text-xs text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={commitRename}
                          className="w-7 h-7 rounded bg-[#ff9900] text-[#111215] flex items-center justify-center shrink-0"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`text-xs font-medium truncate ${
                          isSelected ? 'text-[#f3f4f6]' : 'text-[#c4c9d4]'
                        } ${!obj.visible ? 'opacity-45 line-through' : ''}`}
                      >
                        {obj.name}
                      </span>
                    )}
                  </div>

                  {!isRenamingObj && (
                    <div
                      className="flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onToggleVisibility(obj.id)}
                        className="w-7 h-7 rounded hover:bg-[#323640] text-[#9ca3af] hover:text-white flex items-center justify-center"
                        title={obj.visible ? 'Ocultar' : 'Mostrar'}
                        aria-label={obj.visible ? 'Ocultar' : 'Mostrar'}
                      >
                        {obj.visible ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-[#6b7280]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleLock(obj.id)}
                        className="w-7 h-7 rounded hover:bg-[#323640] text-[#9ca3af] hover:text-white flex items-center justify-center"
                        title={
                          obj.locked
                            ? 'Desbloquear selección'
                            : 'Bloquear selección'
                        }
                        aria-label={
                          obj.locked
                            ? 'Desbloquear selección'
                            : 'Bloquear selección'
                        }
                      >
                        {obj.locked ? (
                          <Lock className="w-3.5 h-3.5 text-[#ff9900]" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setContextMenu({
                            kind: 'object',
                            sceneId: scene.id,
                            objectId: obj.id,
                            x: rect.right,
                            y: rect.bottom,
                          });
                        }}
                        className="w-7 h-7 rounded hover:bg-[#323640] text-[#8e95a2] hover:text-white flex items-center justify-center"
                        title="Más acciones"
                        aria-label={`Opciones de ${obj.name}`}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
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

  const activeContextScene = contextMenu
    ? scenes.find((s) => s.id === contextMenu.sceneId) ?? null
    : null;
  const activeContextCollection =
    contextMenu && contextMenu.kind === 'collection' && activeContextScene
      ? activeContextScene.collections.find(
          (c) => c.id === contextMenu.collectionId,
        ) ?? null
      : null;
  const activeContextObject =
    contextMenu && contextMenu.kind === 'object' && activeContextScene
      ? activeContextScene.objects.find((o) => o.id === contextMenu.objectId) ??
        null
      : null;

  return (
    <aside className="w-64 sm:w-72 shrink-0 bg-[#181a1f] border-l border-[#2b2e36] flex flex-col overflow-hidden z-20 relative">
      {/* Main Outliner Tabs: Jerarquía | Modificadores */}
      <div className="p-1.5 border-b border-[#2b2e36] bg-[#15171b] shrink-0 flex items-center gap-1.5">
        <div
          role="tablist"
          aria-label="Secciones del panel lateral"
          className="flex-1 grid grid-cols-2 gap-1 p-0.5 rounded-md bg-[#101216] border border-[#262932]"
        >
          <button
            id="outliner-tab-hierarchy"
            type="button"
            role="tab"
            aria-selected={activeTab === 'hierarchy'}
            aria-controls="outliner-tabpanel-hierarchy"
            onClick={() => setActiveTab('hierarchy')}
            className={`h-8 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'hierarchy'
                ? 'bg-[#2a2f3a] text-[#ff9900]'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Jerarquía</span>
          </button>
          <button
            id="outliner-tab-modifiers"
            type="button"
            role="tab"
            aria-selected={activeTab === 'modifiers'}
            aria-controls="outliner-tabpanel-modifiers"
            onClick={() => setActiveTab('modifiers')}
            className={`h-8 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'modifiers'
                ? 'bg-[#2a2f3a] text-[#ff9900]'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Modificadores</span>
          </button>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel lateral"
            title="Cerrar panel lateral"
            className="w-8 h-8 rounded-md bg-[#1c1f27] hover:bg-[#2a2e38] border border-[#2c303a] text-[#9ca3af] hover:text-white flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {activeTab === 'modifiers' ? (
        /* PESTAÑA MODIFICADORES */
        <div
          id="outliner-tabpanel-modifiers"
          role="tabpanel"
          aria-labelledby="outliner-tab-modifiers"
          className="flex-1 min-h-0 flex flex-col"
        >
          <ModifierStackPanel
            selectedObject={selectedObj}
            sceneObjects={objects}
            diagnostics={modifierDiagnostics}
            evaluatedVertexCount={evaluatedVertexCount}
            evaluatedFaceCount={evaluatedFaceCount}
            hasActiveModifiers={hasActiveModifiers}
            onAddModifier={onAddModifier}
            onUpdateModifier={onUpdateModifier}
            onReorderModifier={onReorderModifier}
            onRemoveModifier={onRemoveModifier}
            onApplyModifier={onApplyModifier}
            onRecalculateNormalsOutside={onRecalculateNormalsOutside}
            onFlipNormals={onFlipNormals}
          />
        </div>
      ) : (
        /* PESTAÑA JERARQUÍA */
        <div
          id="outliner-tabpanel-hierarchy"
          role="tabpanel"
          aria-labelledby="outliner-tab-hierarchy"
          className="flex-1 min-h-0 flex flex-col"
        >
          {/* Quick Creation Header: + Escena / + Colección */}
          <div className="px-2.5 py-2 border-b border-[#262931] flex items-center justify-between gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onCreateScene}
              className="flex-1 h-8 px-2 rounded bg-[#20232b] hover:bg-[#2a2e38] border border-[#2f3440] text-[11px] font-medium text-[#e4e6eb] flex items-center justify-center gap-1 transition-colors"
              title="Crear nueva escena"
            >
              <Plus className="w-3.5 h-3.5 text-[#ff9900]" />
              <span>Escena</span>
            </button>
            <button
              type="button"
              onClick={() => onCreateCollection(activeSceneId)}
              className="flex-1 h-8 px-2 rounded bg-[#20232b] hover:bg-[#2a2e38] border border-[#2f3440] text-[11px] font-medium text-[#e4e6eb] flex items-center justify-center gap-1 transition-colors"
              title="Crear nueva colección en la escena activa"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#ff9900]" />
              <span>Colección</span>
            </button>
          </div>

          {/* Hierarchical Tree: Scene -> Collection -> Object */}
          <div className="flex-1 min-h-0 overflow-y-auto cad-scroll p-1.5 space-y-1">
            {scenes.map((scene) => {
              const isActiveScene = scene.id === activeSceneId;
              const isExpanded = expandedScenes[scene.id] ?? isActiveScene;
              const isRenamingScene =
                renaming?.kind === 'scene' && renaming.id === scene.id;
              const rootCollections = scene.collections.filter(
                (c) => c.parentId === null,
              );

              return (
                <div key={scene.id} className="space-y-0.5">
                  {/* Scene Row */}
                  <div
                    onPointerDown={(e) =>
                      scheduleLongPress(e, (x, y) => ({
                        kind: 'scene',
                        sceneId: scene.id,
                        x,
                        y,
                      }))
                    }
                    onPointerMove={handleRowPointerMoveForLongPress}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onClick={() => onSwitchScene(scene.id)}
                    className={`min-h-[38px] px-1.5 rounded-md flex items-center justify-between gap-1 cursor-pointer transition-colors ${
                      isActiveScene
                        ? 'bg-[#21252f] border border-[#ff9900]/40'
                        : 'hover:bg-[#20232b] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedScenes((prev) => ({
                            ...prev,
                            [scene.id]: !isExpanded,
                          }));
                        }}
                        className="w-6 h-6 rounded hover:bg-[#2f3440] text-[#9ca3af] hover:text-white flex items-center justify-center shrink-0"
                        aria-label={
                          isExpanded ? 'Contraer escena' : 'Expandir escena'
                        }
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <Clapperboard
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isActiveScene ? 'text-[#ff9900]' : 'text-[#8e95a2]'
                        }`}
                      />

                      {isRenamingScene ? (
                        <div
                          className="flex items-center gap-1 flex-1 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenaming(null);
                            }}
                            autoFocus
                            className="w-full h-7 px-1.5 rounded bg-[#111317] border border-[#ff9900] text-xs text-white outline-none"
                          />
                          <button
                            type="button"
                            onClick={commitRename}
                            className="w-7 h-7 rounded bg-[#ff9900] text-[#111215] flex items-center justify-center shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isActiveScene ? 'text-[#f3f4f6]' : 'text-[#9ca3af]'
                            }`}
                          >
                            {scene.name}
                          </span>
                          {isActiveScene && (
                            <span className="text-[10px] font-medium text-[#ff9900] shrink-0">
                              · Activa
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {!isRenamingScene && (
                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setContextMenu({
                              kind: 'scene',
                              sceneId: scene.id,
                              x: rect.right,
                              y: rect.bottom,
                            });
                          }}
                          className="w-7 h-7 rounded hover:bg-[#323640] text-[#8e95a2] hover:text-white flex items-center justify-center"
                          title="Opciones de escena"
                          aria-label={`Opciones de ${scene.name}`}
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Scene Collections & Objects */}
                  {isExpanded && (
                    <div className="space-y-0.5">
                      {rootCollections.map((col) =>
                        renderCollectionBranch(scene, col, 1),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Lower: Transformación / Selección en Edición */}
          <div className="shrink-0 bg-[#16181c] border-t border-[#2b2e36] p-3 space-y-3 max-h-[44%] overflow-y-auto cad-scroll">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#e4e6eb]">
                {workMode === 'edit' ? 'Selección en Edición' : 'Transformación'}
              </span>
              {selectedObj && (
                <span className="text-[11px] text-[#8e95a2] truncate max-w-[120px]">
                  {selectedObj.name}
                </span>
              )}
            </div>

            {!selectedObj || !activeTransform ? (
              <div className="text-xs text-[#7c8391] py-1">
                Selecciona un objeto para ver sus coordenadas.
              </div>
            ) : workMode === 'edit' ? (
              editCentroid && editCentroid.centroid ? (
                <div className="space-y-2">
                  <div className="text-[11px] text-[#9ca3af]">
                    Centroide local ({editCentroid.vertexCount} vértices afectados)
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['X', 'Y', 'Z'] as const).map((axisLabel, idx) => {
                      const axisColors = [
                        'text-[#e05252]',
                        'text-[#52b852]',
                        'text-[#48bce8]',
                      ];
                      return (
                        <label
                          key={axisLabel}
                          className="flex items-center bg-[#111317] border border-[#2b2e36] rounded px-1.5 h-9"
                        >
                          <span
                            className={`text-[11px] font-bold mr-1 ${axisColors[idx]}`}
                          >
                            {axisLabel}
                          </span>
                          <input
                            type="number"
                            step="0.1"
                            value={Number(editCentroid.centroid![idx].toFixed(3))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isNaN(v)) {
                                onUpdateEditCentroidAxis(idx as 0 | 1 | 2, v);
                              }
                            }}
                            className="w-full bg-transparent text-xs font-mono-tabular text-[#e4e6eb] outline-none text-right"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[#7c8391] py-1">
                  Toca vértices, aristas o caras en el visor para editar la geometría.
                </div>
              )
            ) : (
              <div className="space-y-3">
                {selectedObj.objectType === 'reference_image' &&
                  selectedObj.referenceImage && (
                    <div className="space-y-2.5 pb-2.5 border-b border-[#262931]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-[#38bdf8]">
                          Referencia de imagen
                        </span>
                        <span className="text-[10px] text-[#8e95a2] font-mono-tabular">
                          {selectedObj.referenceImage.naturalWidth}×
                          {selectedObj.referenceImage.naturalHeight}
                        </span>
                      </div>

                      {/* Opacidad */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                          <span>Opacidad</span>
                          <span className="font-mono-tabular text-[#e4e6eb]">
                            {Math.round(
                              selectedObj.referenceImage.opacity * 100,
                            )}
                            %
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.05}
                          max={1}
                          step={0.05}
                          value={selectedObj.referenceImage.opacity}
                          onChange={(e) =>
                            onUpdateReferenceImageProps(
                              selectedObj.id,
                              { opacity: parseFloat(e.target.value) },
                              false,
                            )
                          }
                          className="w-full accent-[#ff9900] h-2 cursor-pointer"
                        />
                      </div>

                      {/* Orientación */}
                      <div className="space-y-1">
                        <div className="text-[11px] text-[#9ca3af]">
                          Orientación
                        </div>
                        <select
                          disabled={selectedObj.locked}
                          value={selectedObj.referenceImage.orientation}
                          onChange={(e) =>
                            onUpdateReferenceImageProps(selectedObj.id, {
                              orientation: e.target
                                .value as ReferenceImageOrientation,
                            })
                          }
                          className="w-full h-9 px-2 rounded bg-[#111317] border border-[#2b2e36] text-xs text-[#e4e6eb] outline-none focus:border-[#ff9900] disabled:opacity-45"
                        >
                          <option value="front">Frontal (-Y)</option>
                          <option value="back">Posterior (+Y)</option>
                          <option value="left">Lateral izquierda (-X)</option>
                          <option value="right">Lateral derecha (+X)</option>
                          <option value="top">Superior (+Z)</option>
                          <option value="bottom">Inferior (-Z)</option>
                          <option value="free">Orientación libre</option>
                        </select>
                      </div>

                      {/* Orden respecto a la geometría */}
                      <div className="space-y-1">
                        <div className="text-[11px] text-[#9ca3af]">
                          Posición visual
                        </div>
                        <div className="grid grid-cols-2 gap-1 p-0.5 rounded bg-[#111317] border border-[#2b2e36]">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateReferenceImageProps(selectedObj.id, {
                                depthMode: 'back',
                              })
                            }
                            className={`h-8 rounded text-[11px] font-medium transition-colors ${
                              selectedObj.referenceImage.depthMode === 'back'
                                ? 'bg-[#2a2f3a] text-[#ff9900]'
                                : 'text-[#9ca3af] hover:text-white'
                            }`}
                          >
                            Detrás
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateReferenceImageProps(selectedObj.id, {
                                depthMode: 'front',
                              })
                            }
                            className={`h-8 rounded text-[11px] font-medium transition-colors ${
                              selectedObj.referenceImage.depthMode === 'front'
                                ? 'bg-[#2a2f3a] text-[#ff9900]'
                                : 'text-[#9ca3af] hover:text-white'
                            }`}
                          >
                            Delante
                          </button>
                        </div>
                      </div>

                      {/* Restaurar proporción original */}
                      <button
                        type="button"
                        disabled={selectedObj.locked}
                        onClick={() => {
                          const uniform =
                            (Math.abs(activeTransform.scale[0]) +
                              Math.abs(activeTransform.scale[1])) /
                              2 || 1;
                          onUpdateObjectTransform(selectedObj.id, {
                            ...activeTransform,
                            scale: [uniform, uniform, uniform],
                          });
                        }}
                        className="w-full h-8 rounded bg-[#20232b] hover:bg-[#2a2e38] disabled:opacity-45 border border-[#2f3440] text-[11px] font-medium text-[#d1d5db] transition-colors"
                      >
                        Restaurar proporción original
                      </button>
                    </div>
                  )}

                {(
                  [
                    {
                      key: 'position',
                      label: 'Posición',
                      values: activeTransform.position,
                      step: '0.1',
                    },
                    {
                      key: 'rotation',
                      label: 'Rotación (°)',
                      values: activeTransform.rotation.map((r) =>
                        THREE.MathUtils.radToDeg(r),
                      ),
                      step: '5',
                    },
                    {
                      key: 'scale',
                      label: 'Escala',
                      values: activeTransform.scale,
                      step: '0.1',
                    },
                  ] as const
                ).map((row) => (
                  <div key={row.key} className="space-y-1">
                    <div className="text-[11px] text-[#9ca3af]">{row.label}</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((axisLabel, idx) => {
                        const axisColors = [
                          'text-[#e05252]',
                          'text-[#52b852]',
                          'text-[#48bce8]',
                        ];
                        return (
                          <label
                            key={axisLabel}
                            className="flex items-center bg-[#111317] border border-[#2b2e36] focus-within:border-[#ff9900]/60 rounded px-1.5 h-9"
                          >
                            <span
                              className={`text-[11px] font-bold mr-1 ${axisColors[idx]}`}
                            >
                              {axisLabel}
                            </span>
                            <input
                              type="number"
                              step={row.step}
                              disabled={selectedObj.locked}
                              value={Number(row.values[idx].toFixed(2))}
                              onChange={(e) =>
                                handleNumericTransform(
                                  row.key,
                                  idx as 0 | 1 | 2,
                                  e.target.value,
                                )
                              }
                              className="w-full bg-transparent text-xs font-mono-tabular text-[#e4e6eb] outline-none text-right disabled:opacity-45"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Drag Ghost Badge */}
      {dragState && (
        <div
          style={{
            left: Math.min(window.innerWidth - 180, dragState.clientX - 60),
            top: Math.max(12, dragState.clientY - 38),
          }}
          className="fixed z-50 px-2.5 py-1.5 rounded-md bg-[#222630] border border-[#ff9900] text-xs font-semibold text-[#f3f4f6] shadow-xl pointer-events-none flex items-center gap-1.5"
        >
          <ArrowRightLeft className="w-3.5 h-3.5 text-[#ff9900]" />
          <span className="truncate max-w-[140px]">{dragState.objectName}</span>
        </div>
      )}

      {/* 3-Dots / Long-Press Action Menu Popover */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setContextMenu(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              left: Math.max(
                12,
                Math.min(window.innerWidth - 216, contextMenu.x - 196),
              ),
              top: Math.max(
                12,
                Math.min(window.innerHeight - 260, contextMenu.y + 4),
              ),
            }}
            className="fixed z-50 w-52 rounded-lg bg-[#1d2027] border border-[#353a46] shadow-2xl py-1 text-xs text-[#e5e7eb]"
          >
            {contextMenu.kind === 'scene' && activeContextScene && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9ca3af] border-b border-[#2b2f3a] truncate">
                  Escena: {activeContextScene.name}
                </div>
                {activeContextScene.id !== activeSceneId && (
                  <button
                    type="button"
                    onClick={() => {
                      onSwitchScene(activeContextScene.id);
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    <Clapperboard className="w-3.5 h-3.5 text-[#ff9900]" />
                    <span>Activar escena</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onCreateCollection(activeContextScene.id);
                    setContextMenu(null);
                  }}
                  className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-[#ff9900]" />
                  <span>Nueva colección</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(activeContextScene.name);
                    setRenaming({ kind: 'scene', id: activeContextScene.id });
                    setContextMenu(null);
                  }}
                  className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Renombrar escena</span>
                </button>
                <button
                  type="button"
                  disabled={scenes.length <= 1}
                  onClick={() => {
                    onDeleteScene(activeContextScene.id);
                    setContextMenu(null);
                  }}
                  className="w-full h-9 px-3 hover:bg-[#352024] text-[#f87171] disabled:opacity-35 disabled:pointer-events-none flex items-center gap-2 text-left"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar escena</span>
                </button>
              </>
            )}

            {contextMenu.kind === 'collection' &&
              activeContextScene &&
              activeContextCollection && (
                <>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9ca3af] border-b border-[#2b2f3a] truncate">
                    Colección: {activeContextCollection.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCollection(
                        activeContextScene.id,
                        activeContextCollection.id,
                      );
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#ff9900]" />
                    <span>Usar como activa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCreateCollection(activeContextScene.id);
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>Nueva colección</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(activeContextCollection.name);
                      setRenaming({
                        kind: 'collection',
                        sceneId: activeContextScene.id,
                        id: activeContextCollection.id,
                      });
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Renombrar colección</span>
                  </button>
                  <button
                    type="button"
                    disabled={activeContextScene.collections.length <= 1}
                    onClick={() => {
                      setContextMenu(null);
                      requestDeleteCollection(
                        activeContextScene,
                        activeContextCollection,
                      );
                    }}
                    className="w-full h-9 px-3 hover:bg-[#352024] text-[#f87171] disabled:opacity-35 disabled:pointer-events-none flex items-center gap-2 text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar colección</span>
                  </button>
                </>
              )}

            {contextMenu.kind === 'object' &&
              activeContextScene &&
              activeContextObject && (
                <>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9ca3af] border-b border-[#2b2f3a] truncate">
                    Objeto: {activeContextObject.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(activeContextObject.name);
                      setRenaming({
                        kind: 'object',
                        id: activeContextObject.id,
                      });
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Renombrar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDuplicateObject(activeContextObject.id);
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Duplicar</span>
                  </button>
                  {activeContextScene.collections.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMovePickerFor({
                          sceneId: activeContextScene.id,
                          objectId: activeContextObject.id,
                        });
                        setContextMenu(null);
                      }}
                      className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 text-[#ff9900]" />
                      <span>Mover a colección...</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onToggleVisibility(activeContextObject.id);
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    {activeContextObject.visible ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {activeContextObject.visible ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleLock(activeContextObject.id);
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#2a2f3a] flex items-center gap-2 text-left"
                  >
                    {activeContextObject.locked ? (
                      <Unlock className="w-3.5 h-3.5 text-[#ff9900]" />
                    ) : (
                      <Lock className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {activeContextObject.locked
                        ? 'Desbloquear selección'
                        : 'Bloquear selección'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={activeContextObject.locked}
                    onClick={() => {
                      onDeleteObject(activeContextObject.id);
                      setContextMenu(null);
                    }}
                    className="w-full h-9 px-3 hover:bg-[#352024] text-[#f87171] disabled:opacity-35 disabled:pointer-events-none flex items-center gap-2 text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar</span>
                  </button>
                </>
              )}
          </div>
        </div>
      )}

      {/* Move Object to Collection Modal (accessible touch fallback alongside drag) */}
      {movePickerFor &&
        (() => {
          const targetScene = scenes.find((s) => s.id === movePickerFor.sceneId);
          const targetObj = targetScene?.objects.find(
            (o) => o.id === movePickerFor.objectId,
          );
          if (!targetScene || !targetObj) return null;
          return (
            <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-[#1c1e24] border border-[#323640] rounded-xl shadow-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#2b2e36] flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#f3f4f6] truncate">
                    Mover «{targetObj.name}» a colección
                  </h3>
                  <button
                    type="button"
                    onClick={() => setMovePickerFor(null)}
                    className="w-8 h-8 rounded hover:bg-[#2a2e38] text-[#9ca3af] hover:text-white flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto cad-scroll">
                  {targetScene.collections.map((col) => {
                    const isCurrent = col.id === targetObj.collectionId;
                    return (
                      <button
                        key={col.id}
                        type="button"
                        disabled={isCurrent}
                        onClick={() => {
                          onMoveObjectToCollection(
                            targetScene.id,
                            targetObj.id,
                            col.id,
                          );
                          setMovePickerFor(null);
                        }}
                        className={`w-full h-10 px-3 rounded-lg border text-xs font-medium flex items-center justify-between transition-colors ${
                          isCurrent
                            ? 'bg-[#252933] border-[#ff9900]/45 text-[#9ca3af]'
                            : 'bg-[#15171c] hover:bg-[#232732] border-[#2e3340] text-[#e5e7eb]'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Folder className="w-3.5 h-3.5 text-[#ff9900]" />
                          <span className="truncate">{col.name}</span>
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] text-[#ff9900]">
                            Actual
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

      {/* Delete Non-Empty Collection Resolution Modal */}
      {deletePrompt && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1c1e24] border border-[#343844] rounded-xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2b2e36] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#f3f4f6]">
                Eliminar colección «{deletePrompt.collection.name}»
              </h3>
              <button
                type="button"
                onClick={() => setDeletePrompt(null)}
                className="w-8 h-8 rounded hover:bg-[#2a2e38] text-[#9ca3af] hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-[#cbd5e1] leading-relaxed">
                Esta colección contiene{' '}
                <strong className="text-[#ff9900]">
                  {deletePrompt.objectCount}{' '}
                  {deletePrompt.objectCount === 1 ? 'objeto' : 'objetos'}
                </strong>
                . ¿Qué deseas hacer con ellos?
              </p>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-[#9ca3af]">
                  Mover objetos a otra colección:
                </label>
                <select
                  value={deleteTargetColId}
                  onChange={(e) => setDeleteTargetColId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-[#121419] border border-[#2f333d] text-xs text-[#f3f4f6] outline-none focus:border-[#ff9900]"
                >
                  {deletePrompt.otherCollections.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  disabled={!deleteTargetColId}
                  onClick={() => {
                    onDeleteCollection(
                      deletePrompt.sceneId,
                      deletePrompt.collection.id,
                      {
                        mode: 'move_objects',
                        targetCollectionId: deleteTargetColId,
                      },
                    );
                    setDeletePrompt(null);
                  }}
                  className="w-full h-10 px-3 rounded-lg bg-[#d97706] hover:bg-[#e5840b] text-[#111215] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Mover objetos y eliminar colección</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDeleteCollection(
                      deletePrompt.sceneId,
                      deletePrompt.collection.id,
                      { mode: 'delete_objects' },
                    );
                    setDeletePrompt(null);
                  }}
                  className="w-full h-10 px-3 rounded-lg bg-[#2a1a1d] hover:bg-[#3a2226] border border-[#593036] text-[#f87171] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar colección y sus objetos</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDeletePrompt(null)}
                  className="w-full h-9 px-3 rounded-lg bg-[#23262e] hover:bg-[#2c303a] text-xs font-medium text-[#cbd5e1]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

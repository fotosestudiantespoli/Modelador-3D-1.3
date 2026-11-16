import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditableMesh, Vec3 } from '../core/mesh/EditableMesh';
import {
  computeDerivedEditSelection,
  deleteSelectedComponents,
  EditSelectionMode,
  selectAllComponents,
} from '../core/mesh/operations';
import {
  createPrimitiveMesh,
  PRIMITIVE_LABELS,
  PrimitiveOptions,
  PrimitiveType,
} from '../core/mesh/primitives';
import {
  cloneDefaultRadialLayouts,
  DEFAULT_RADIAL_LAYOUTS,
  RADIAL_SLOT_COUNT,
  RadialActionId,
  RadialWorkMode,
} from '../core/radial/radialActions';
import {
  createNewProject,
  createDefaultTouchSettings,
  deleteProjectLocally,
  generateId,
  getActiveStoredProjectId,
  listSavedProjects,
  loadInitialProject,
  loadProjectFromAnyStorage,
  loadProjectLocally,
  loadSettingsLocally,
  saveProjectLocally,
  saveSettingsLocally,
} from '../core/project/storage';
import {
  analyzeEdgeLoopRing,
  applyDeleteAction,
  bevelMesh,
  BevelParams,
  computeLoopCutPreviewSegments,
  DeleteActionType,
  extrudeMesh,
  ExtrudeParams,
  fillMesh,
  findFirstValidLoopEdge,
  insetFacesMesh,
  InsetParams,
  loopCutMesh,
  LoopCutParams,
  mergeByDistanceMesh,
  MergeByDistanceParams,
  mergeVerticesMesh,
  MergeParams,
  subdivideMesh,
  SubdivideParams,
} from '../core/mesh/advancedOperations';
import { connectVertexPathMesh } from '../core/mesh/connectVertexPath';
import { flipNormalsMesh, recalculateOutsideMesh } from '../core/mesh/normals';
import {
  PROPORTIONAL_FALLOFF_LIST,
  PROPORTIONAL_FALLOFF_ORDER,
  ProportionalEditingSettings,
  ProportionalFalloff,
  applyProportionalMove,
  buildProportionalDistanceField,
  clampProportionalRadius,
  computeProportionalWeights,
  inspectProportionalModifierCompatibility,
  normalizeProportionalSettings,
} from '../core/mesh/proportionalEditing';
import {
  addCollectionToScene,
  addSceneToProject,
  createReferenceImageObject,
  DeleteCollectionResolution,
  deleteCollectionFromScene,
  deleteSceneFromProject,
  detectOrientationFromRotation,
  getActiveScene,
  isEditableMeshObject,
  moveObjectToCollectionInScene,
  REFERENCE_ORIENTATION_ROTATIONS,
  renameCollectionInScene,
  renameSceneInProject,
  setActiveCollectionInScene,
  switchSceneInProject,
  toggleCollectionExpandedInScene,
  updateActiveScene,
} from '../core/project/hierarchy';
import { ObjImportResult } from '../core/io/objImport';
import { StlImportResult } from '../core/io/stlImport';
import { LoadedImageReferencePayload } from '../core/io/imageReference';
import {
  AxisConstraint,
  CameraProjection,
  ModelerSettings,
  ObjectTransform,
  ProjectData,
  ProjectSummary,
  ReferenceImageData,
  ReferenceImageOrientation,
  SceneData,
  SceneObjectData,
  TouchControlSettings,
  TouchModifierKey,
  TouchModifierSlotConfig,
  TouchModifierState,
  TransformTool,
  ViewportDisplayMode,
  WorkMode,
} from '../core/project/types';
import { SerializedEditableMesh } from '../core/mesh/EditableMesh';
import {
  applySingleModifierToMesh,
  buildTransformRefsFromObjects,
  evaluateObjectModifiers,
} from '../core/modifiers/evaluateModifiers';
import { clampVerticesForMirrorClipping } from '../core/modifiers/mirrorModifier';
import {
  MODIFIER_LABELS,
  ModifierDiagnostic,
  ModifierSlot,
  ModifierTransformRef,
  ModifierType,
  createDefaultBevelParams,
  createDefaultMirrorParams,
  createDefaultSolidifyParams,
  createDefaultSubdivisionParams,
  normalizeBevelParams,
  normalizeMirrorParams,
  normalizeSolidifyParams,
  normalizeSubdivisionParams,
} from '../core/modifiers/types';

export function applyComponentSelection(
  prev: ReadonlySet<string>,
  id: string | null,
  additive: boolean,
  addOnly = false,
): Set<string> {
  if (id === null) {
    if (additive || addOnly) {
      return new Set(prev);
    }
    return new Set();
  }
  if (addOnly) {
    const next = new Set(prev);
    next.add(id);
    return next;
  }
  const next = new Set(additive ? prev : []);
  if (additive && prev.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export type EditOperatorType =
  | 'extrude'
  | 'inset'
  | 'subdivide'
  | 'bevel'
  | 'loop_cut'
  | 'merge'
  | 'merge_by_distance';

export type EditOperatorParams =
  | { type: 'extrude'; params: ExtrudeParams }
  | { type: 'inset'; params: InsetParams }
  | { type: 'subdivide'; params: SubdivideParams }
  | { type: 'bevel'; params: BevelParams }
  | { type: 'loop_cut'; params: LoopCutParams }
  | { type: 'merge'; params: MergeParams }
  | { type: 'merge_by_distance'; params: MergeByDistanceParams };

export interface EditOperatorSession {
  objectId: string;
  baseMesh: SerializedEditableMesh;
  baseSelectionMode: EditSelectionMode;
  baseSelectedIds: string[];
  config: EditOperatorParams;
}

interface HistorySnapshot {
  scenes: SceneData[];
  activeSceneId: string;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  selectedComponentIds: string[];
}

const MAX_HISTORY = 50;

function cloneScenes(scenes: SceneData[]): SceneData[] {
  return JSON.parse(JSON.stringify(scenes)) as SceneData[];
}

export function useModelerStore() {
  const initialProject = useMemo(() => loadInitialProject(), []);

  const [project, setProject] = useState<ProjectData>(initialProject);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>(() =>
    listSavedProjects(),
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    () => getActiveScene(initialProject).objects[0]?.id ?? null,
  );
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(() => {
    const firstId = getActiveScene(initialProject).objects[0]?.id ?? null;
    return firstId ? new Set([firstId]) : new Set();
  });
  const [workMode, setWorkMode] = useState<WorkMode>('object');
  const [editSelectionMode, setEditSelectionMode] =
    useState<EditSelectionMode>('vertex');
  const [selectedComponentIds, setSelectedComponentIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [activeTool, setActiveToolState] = useState<TransformTool>('move');
  const [axisConstraint, setAxisConstraint] = useState<AxisConstraint>('free');
  const [projection, setProjection] = useState<CameraProjection>('perspective');
  const [settings, setSettings] = useState<ModelerSettings>(() =>
    loadSettingsLocally(),
  );

  const [meshRevision, setMeshRevision] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [screenModifiers, setScreenModifiers] = useState<TouchModifierState>({
    shift: false,
    ctrl: false,
    alt: false,
  });
  const screenShiftActive = screenModifiers.shift;
  const setScreenShiftActive = useCallback((next: boolean) => {
    setScreenModifiers((prev) =>
      prev.shift === next ? prev : { ...prev, shift: next },
    );
  }, []);
  const setScreenModifier = useCallback(
    (key: TouchModifierKey, active: boolean) => {
      setScreenModifiers((prev) =>
        prev[key] === active ? prev : { ...prev, [key]: active },
      );
    },
    [],
  );
  const toggleScreenModifier = useCallback((key: TouchModifierKey) => {
    setScreenModifiers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const releaseScreenModifiers = useCallback(() => {
    setScreenModifiers((prev) =>
      prev.shift || prev.ctrl || prev.alt
        ? { shift: false, ctrl: false, alt: false }
        : prev,
    );
  }, []);
  const setActiveTool = useCallback(
    (tool: TransformTool) => {
      setActiveToolState(tool);
      releaseScreenModifiers();
    },
    [releaseScreenModifiers],
  );
  const [operatorSession, setOperatorSession] =
    useState<EditOperatorSession | null>(null);
  const [loopCutPickError, setLoopCutPickError] = useState<string | null>(null);

  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  // Hydrate active project from IndexedDB if it holds a newer/larger copy (e.g. embedded reference images)
  const initialHydrateRef = useRef(false);
  useEffect(() => {
    if (initialHydrateRef.current) return;
    initialHydrateRef.current = true;
    const storedId = getActiveStoredProjectId() ?? initialProject.id;
    void loadProjectFromAnyStorage(storedId).then((idbProj) => {
      if (!idbProj) return;
      setProject((curr) => {
        if (curr.id === idbProj.id && idbProj.updatedAt <= curr.updatedAt) {
          return curr;
        }
        const firstId = getActiveScene(idbProj).objects[0]?.id ?? null;
        setSelectedObjectId(firstId);
        setSelectedObjectIds(firstId ? new Set([firstId]) : new Set());
        setMeshRevision((r) => r + 1);
        return idbProj;
      });
    });
  }, [initialProject.id]);

  const activeScene = useMemo(() => getActiveScene(project), [project]);
  const activeObjects = activeScene.objects;

  const setSingleSelectedObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
    setSelectedObjectIds(id ? new Set([id]) : new Set());
  }, []);

  const makeSnapshot = useCallback(
    (
      scenes = project.scenes,
      actSceneId = project.activeSceneId,
      selObjId = selectedObjectId,
      selObjIds = selectedObjectIds,
      mode = workMode,
      subMode = editSelectionMode,
      compIds = selectedComponentIds,
    ): HistorySnapshot => ({
      scenes: cloneScenes(scenes),
      activeSceneId: actSceneId,
      selectedObjectId: selObjId,
      selectedObjectIds: Array.from(selObjIds),
      workMode: mode,
      editSelectionMode: subMode,
      selectedComponentIds: Array.from(compIds),
    }),
    [
      project.scenes,
      project.activeSceneId,
      selectedObjectId,
      selectedObjectIds,
      workMode,
      editSelectionMode,
      selectedComponentIds,
    ],
  );

  const pushHistory = useCallback((snapshot: HistorySnapshot) => {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const selectedObject = useMemo(
    () => activeObjects.find((o) => o.id === selectedObjectId) ?? null,
    [activeObjects, selectedObjectId],
  );

  const sceneTransformRefs = useMemo(
    () => buildTransformRefsFromObjects(activeObjects),
    [activeObjects],
  );

  const canUndo = undoStackRef.current.length > 0 && historyVersion >= 0;
  const canRedo = redoStackRef.current.length > 0 && historyVersion >= 0;

  const undo = useCallback(
    (fromGesture = false) => {
      const prev = undoStackRef.current.pop();
      if (!prev) {
        if (fromGesture) showToast('Nada que deshacer');
        return;
      }
      setOperatorSession(null);
      redoStackRef.current.push(makeSnapshot());
      setProject((p) => ({
        ...p,
        activeSceneId: prev.activeSceneId,
        scenes: cloneScenes(prev.scenes),
      }));
      setSelectedObjectId(prev.selectedObjectId);
      setSelectedObjectIds(
        new Set(
          prev.selectedObjectIds ??
            (prev.selectedObjectId ? [prev.selectedObjectId] : []),
        ),
      );
      setWorkMode(prev.workMode);
      setEditSelectionMode(prev.editSelectionMode);
      setSelectedComponentIds(new Set(prev.selectedComponentIds));
      releaseScreenModifiers();
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      setHistoryVersion((v) => v + 1);
      if (fromGesture) showToast('Deshacer');
    },
    [makeSnapshot, releaseScreenModifiers, showToast],
  );

  const redo = useCallback(
    (fromGesture = false) => {
      const next = redoStackRef.current.pop();
      if (!next) {
        if (fromGesture) showToast('Nada que rehacer');
        return;
      }
      setOperatorSession(null);
      undoStackRef.current.push(makeSnapshot());
      setProject((p) => ({
        ...p,
        activeSceneId: next.activeSceneId,
        scenes: cloneScenes(next.scenes),
      }));
      setSelectedObjectId(next.selectedObjectId);
      setSelectedObjectIds(
        new Set(
          next.selectedObjectIds ??
            (next.selectedObjectId ? [next.selectedObjectId] : []),
        ),
      );
      setWorkMode(next.workMode);
      setEditSelectionMode(next.editSelectionMode);
      setSelectedComponentIds(new Set(next.selectedComponentIds));
      releaseScreenModifiers();
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      setHistoryVersion((v) => v + 1);
      if (fromGesture) showToast('Rehacer');
    },
    [makeSnapshot, releaseScreenModifiers, showToast],
  );

  const setProjectName = useCallback((name: string) => {
    setProject((p) => ({ ...p, name }));
    setHasUnsavedChanges(true);
  }, []);

  const saveProject = useCallback(() => {
    const saved = saveProjectLocally(project);
    setProject(saved);
    setSavedProjects(listSavedProjects());
    setHasUnsavedChanges(false);
    showToast(`Proyecto "${saved.name}" guardado`);
  }, [project, showToast]);

  const saveProjectAs = useCallback(
    (newName: string) => {
      const trimmed = newName.trim() || `${project.name} (copia)`;
      const now = Date.now();
      const cloned: ProjectData = {
        ...JSON.parse(JSON.stringify(project)),
        id: generateId('proj'),
        name: trimmed,
        createdAt: now,
        updatedAt: now,
      };
      const saved = saveProjectLocally(cloned);
      setProject(saved);
      setSavedProjects(listSavedProjects());
      setHasUnsavedChanges(false);
      showToast(`Proyecto guardado como "${saved.name}"`);
    },
    [project, showToast],
  );

  const createProject = useCallback(
    (name: string) => {
      setOperatorSession(null);
      const fresh = saveProjectLocally(createNewProject(name.trim() || 'Nuevo Proyecto'));
      undoStackRef.current = [];
      redoStackRef.current = [];
      setProject(fresh);
      setSavedProjects(listSavedProjects());
      setSingleSelectedObject(getActiveScene(fresh).objects[0]?.id ?? null);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(false);
      setMeshRevision((r) => r + 1);
      setHistoryVersion((v) => v + 1);
      showToast(`Proyecto "${fresh.name}" creado`);
    },
    [releaseScreenModifiers, setSingleSelectedObject, showToast],
  );

  const openProject = useCallback(
    async (projectId: string) => {
      const loaded =
        (await loadProjectFromAnyStorage(projectId)) ??
        loadProjectLocally(projectId);
      if (!loaded) {
        showToast('No se pudo cargar el proyecto');
        return;
      }
      setOperatorSession(null);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setProject(loaded);
      setSingleSelectedObject(getActiveScene(loaded).objects[0]?.id ?? null);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(false);
      setMeshRevision((r) => r + 1);
      setHistoryVersion((v) => v + 1);
      showToast(`Proyecto "${loaded.name}" abierto`);
    },
    [releaseScreenModifiers, setSingleSelectedObject, showToast],
  );

  const removeSavedProject = useCallback(
    (projectId: string) => {
      deleteProjectLocally(projectId);
      setSavedProjects(listSavedProjects());
    },
    [],
  );

  const addPrimitive = useCallback(
    (
      type: PrimitiveType,
      options?: PrimitiveOptions,
      targetCollectionId?: string,
    ) => {
      pushHistory(makeSnapshot());
      const mesh = createPrimitiveMesh(type, options);
      const baseName = PRIMITIVE_LABELS[type];
      const existingCount = activeObjects.filter((o) =>
        o.name.startsWith(baseName),
      ).length;
      const name = existingCount === 0 ? baseName : `${baseName} ${existingCount + 1}`;
      const resolvedCollectionId =
        targetCollectionId &&
        activeScene.collections.some((c) => c.id === targetCollectionId)
          ? targetCollectionId
          : activeScene.activeCollectionId;

      const newObj: SceneObjectData = {
        id: generateId('obj'),
        name,
        objectType: 'mesh',
        primitiveType: type,
        collectionId: resolvedCollectionId,
        visible: true,
        locked: false,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        mesh: mesh.toJSON(),
        material: {
          color: '#9aa0a6',
          roughness: 0.55,
          metalness: 0.08,
        },
        modifiers: [],
      };

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          collections: scene.collections.map((c) =>
            c.id === resolvedCollectionId ? { ...c, expanded: true } : c,
          ),
          objects: [...scene.objects, newObj],
        })),
      );
      setSingleSelectedObject(newObj.id);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(`${name} agregado`);
    },
    [
      activeObjects,
      activeScene.activeCollectionId,
      activeScene.collections,
      makeSnapshot,
      pushHistory,
      releaseScreenModifiers,
      setSingleSelectedObject,
      showToast,
    ],
  );

  const selectObject = useCallback(
    (id: string | null, additive = false) => {
      const effectiveAdditive = additive || screenShiftActive;
      setOperatorSession(null);
      if (workMode === 'edit' && id !== selectedObjectId) {
        setWorkMode('object');
        setSelectedComponentIds(new Set());
        releaseScreenModifiers();
      }
      if (effectiveAdditive) {
        if (id === null) return;
        const next = new Set(selectedObjectIds);
        if (next.has(id)) {
          next.delete(id);
          const remaining = Array.from(next);
          setSelectedObjectIds(next);
          setSelectedObjectId(
            id === selectedObjectId
              ? (remaining[remaining.length - 1] ?? null)
              : selectedObjectId,
          );
        } else {
          next.add(id);
          setSelectedObjectIds(next);
          setSelectedObjectId(id);
        }
        return;
      }
      setSingleSelectedObject(id);
    },
    [
      releaseScreenModifiers,
      screenShiftActive,
      selectedObjectId,
      selectedObjectIds,
      setSingleSelectedObject,
      workMode,
    ],
  );

  const selectObjectsFromBox = useCallback(
    (ids: string[], additive: boolean) => {
      const effectiveAdditive = additive || screenShiftActive;
      setOperatorSession(null);
      const next = new Set<string>(effectiveAdditive ? selectedObjectIds : []);
      for (const id of ids) next.add(id);

      let nextPrimary: string | null = null;
      if (next.size > 0) {
        if (selectedObjectId && next.has(selectedObjectId)) {
          nextPrimary = selectedObjectId;
        } else {
          const ordered = ids.length > 0 ? ids : Array.from(next);
          nextPrimary = ordered[ordered.length - 1] ?? null;
        }
      }

      if (workMode === 'edit' && nextPrimary !== selectedObjectId) {
        setWorkMode('object');
        setSelectedComponentIds(new Set());
        releaseScreenModifiers();
      }
      setSelectedObjectIds(next);
      setSelectedObjectId(nextPrimary);
    },
    [
      releaseScreenModifiers,
      screenShiftActive,
      selectedObjectId,
      selectedObjectIds,
      workMode,
    ],
  );

  const selectObjectInScene = useCallback(
    (sceneId: string, objectId: string, additive = false) => {
      setOperatorSession(null);
      if (sceneId !== project.activeSceneId) {
        setProject((p) => switchSceneInProject(p, sceneId));
        setWorkMode('object');
        releaseScreenModifiers();
        setSelectedComponentIds(new Set());
        setMeshRevision((r) => r + 1);
        setSingleSelectedObject(objectId);
        return;
      }
      selectObject(objectId, additive);
    },
    [
      project.activeSceneId,
      releaseScreenModifiers,
      selectObject,
      setSingleSelectedObject,
    ],
  );

  const toggleWorkMode = useCallback(
    (nextMode: WorkMode) => {
      setOperatorSession(null);
      releaseScreenModifiers();
      if (nextMode === 'edit') {
        if (!selectedObject) {
          showToast('Selecciona un objeto para entrar en Modo Edición');
          return;
        }
        if (selectedObject.objectType === 'reference_image') {
          showToast('Las referencias de imagen no permiten el Modo Edición');
          return;
        }
        if (!isEditableMeshObject(selectedObject)) {
          showToast('Este tipo de objeto no es editable por topología');
          return;
        }
        if (selectedObject.locked) {
          showToast('El objeto está bloqueado');
          return;
        }
        setSelectedComponentIds(new Set());
      } else {
        setSelectedComponentIds(new Set());
      }
      setWorkMode(nextMode);
    },
    [releaseScreenModifiers, selectedObject, showToast],
  );

  const changeEditSelectionMode = useCallback(
    (mode: EditSelectionMode) => {
      setOperatorSession(null);
      if (mode === editSelectionMode) return;
      if (selectedObject && selectedComponentIds.size > 0) {
        const mesh = EditableMesh.fromJSON(selectedObject.mesh);
        const derived = computeDerivedEditSelection(
          mesh,
          editSelectionMode,
          selectedComponentIds,
        );
        const converted =
          mode === 'vertex'
            ? derived.vertexIds
            : mode === 'edge'
              ? derived.edgeIds
              : derived.faceIds;
        setSelectedComponentIds(new Set(converted));
      } else {
        setSelectedComponentIds(new Set());
      }
      setEditSelectionMode(mode);
    },
    [editSelectionMode, selectedComponentIds, selectedObject],
  );

  const updateObjectTransform = useCallback(
    (objectId: string, transform: ObjectTransform, recordHistory = true) => {
      if (recordHistory) {
        pushHistory(makeSnapshot());
      }
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) => {
            if (o.id !== objectId) return o;
            if (o.objectType === 'reference_image' && o.referenceImage) {
              return {
                ...o,
                transform,
                referenceImage: {
                  ...o.referenceImage,
                  orientation: detectOrientationFromRotation(transform.rotation),
                },
              };
            }
            return { ...o, transform };
          }),
        })),
      );
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const commitObjectTransformFromGizmo = useCallback(
    (
      objectId: string,
      beforeTransform: ObjectTransform,
      afterTransform: ObjectTransform,
    ) => {
      const snapshot = makeSnapshot();
      snapshot.scenes = snapshot.scenes.map((s) =>
        s.id === snapshot.activeSceneId
          ? {
              ...s,
              objects: s.objects.map((o) =>
                o.id === objectId ? { ...o, transform: beforeTransform } : o,
              ),
            }
          : s,
      );
      pushHistory(snapshot);

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) => {
            if (o.id !== objectId) return o;
            if (o.objectType === 'reference_image' && o.referenceImage) {
              return {
                ...o,
                transform: afterTransform,
                referenceImage: {
                  ...o.referenceImage,
                  orientation: detectOrientationFromRotation(
                    afterTransform.rotation,
                  ),
                },
              };
            }
            return { ...o, transform: afterTransform };
          }),
        })),
      );
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const commitMeshEditFromGizmo = useCallback(
    (objectId: string, beforeMesh: EditableMesh, afterMesh: EditableMesh) => {
      const snapshot = makeSnapshot();
      snapshot.scenes = snapshot.scenes.map((s) =>
        s.id === snapshot.activeSceneId
          ? {
              ...s,
              objects: s.objects.map((o) =>
                o.id === objectId ? { ...o, mesh: beforeMesh.toJSON() } : o,
              ),
            }
          : s,
      );
      pushHistory(snapshot);

      const cleanAfterMesh = afterMesh.clone();
      const targetObj = activeObjects.find((o) => o.id === objectId);
      if (targetObj?.modifiers && targetObj.modifiers.length > 0) {
        const startPositions = new Map<string, Vec3>();
        const movedIds: string[] = [];
        for (const bv of beforeMesh.vertices) {
          startPositions.set(bv.id, [...bv.position]);
          const av = cleanAfterMesh.getVertex(bv.id);
          if (
            av &&
            (Math.abs(av.position[0] - bv.position[0]) > 1e-8 ||
              Math.abs(av.position[1] - bv.position[1]) > 1e-8 ||
              Math.abs(av.position[2] - bv.position[2]) > 1e-8)
          ) {
            movedIds.push(bv.id);
          }
        }
        const ownerRef: ModifierTransformRef = {
          id: targetObj.id,
          position: targetObj.transform.position,
          rotation: targetObj.transform.rotation,
          scale: targetObj.transform.scale,
        };
        clampVerticesForMirrorClipping(
          cleanAfterMesh,
          movedIds,
          startPositions,
          targetObj.modifiers,
          ownerRef,
          sceneTransformRefs,
        );
      }
      cleanAfterMesh.clearCustomNormals();

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId ? { ...o, mesh: cleanAfterMesh.toJSON() } : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
    },
    [activeObjects, makeSnapshot, pushHistory, sceneTransformRefs],
  );

  const renameObject = useCallback(
    (objectId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      pushHistory(makeSnapshot());
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId ? { ...o, name: trimmed } : o,
          ),
        })),
      }));
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const toggleObjectVisibility = useCallback(
    (objectId: string) => {
      pushHistory(makeSnapshot());
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId ? { ...o, visible: !o.visible } : o,
          ),
        })),
      }));
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const toggleObjectLock = useCallback(
    (objectId: string) => {
      pushHistory(makeSnapshot());
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId ? { ...o, locked: !o.locked } : o,
          ),
        })),
      }));
      if (objectId === selectedObjectId && workMode === 'edit') {
        setWorkMode('object');
        setScreenShiftActive(false);
        setSelectedComponentIds(new Set());
      }
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory, selectedObjectId, workMode],
  );

  const duplicateObjectById = useCallback(
    (objectId: string) => {
      const targetScene =
        project.scenes.find((s) => s.objects.some((o) => o.id === objectId)) ??
        null;
      const target =
        targetScene?.objects.find((o) => o.id === objectId) ?? null;
      if (!targetScene || !target) return;

      pushHistory(makeSnapshot());
      const copy: SceneObjectData = {
        ...JSON.parse(JSON.stringify(target)),
        id: generateId('obj'),
        name: `${target.name} Copia`,
        transform: {
          position: [
            target.transform.position[0] + 0.5,
            target.transform.position[1],
            target.transform.position[2] + 0.5,
          ],
          rotation: [...target.transform.rotation] as Vec3,
          scale: [...target.transform.scale] as Vec3,
        },
      };
      setProject((p) => ({
        ...p,
        activeSceneId: targetScene.id,
        scenes: p.scenes.map((s) =>
          s.id === targetScene.id ? { ...s, objects: [...s.objects, copy] } : s,
        ),
      }));
      setSingleSelectedObject(copy.id);
      setWorkMode('object');
      setScreenShiftActive(false);
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(`Objeto duplicado: ${copy.name}`);
    },
    [makeSnapshot, project.scenes, pushHistory, setSingleSelectedObject, showToast],
  );

  const duplicateSelectedObject = useCallback(() => {
    if (!selectedObject) return;
    duplicateObjectById(selectedObject.id);
  }, [duplicateObjectById, selectedObject]);

  const deleteObject = useCallback(
    (objectId: string) => {
      const targetScene =
        project.scenes.find((s) => s.objects.some((o) => o.id === objectId)) ??
        null;
      const target =
        targetScene?.objects.find((o) => o.id === objectId) ?? null;
      if (!targetScene || !target) return;
      if (target.locked) {
        showToast('Desbloquea el objeto antes de eliminarlo');
        return;
      }
      pushHistory(makeSnapshot());
      const remaining = targetScene.objects.filter((o) => o.id !== objectId);
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s) =>
          s.id === targetScene.id ? { ...s, objects: remaining } : s,
        ),
      }));
      const nextSet = new Set(selectedObjectIds);
      nextSet.delete(objectId);
      if (nextSet.size === 0 && selectedObjectId === objectId) {
        setSingleSelectedObject(remaining[0]?.id ?? null);
        setWorkMode('object');
        releaseScreenModifiers();
        setSelectedComponentIds(new Set());
      } else {
        setSelectedObjectIds(nextSet);
        if (selectedObjectId === objectId) {
          const fallback = Array.from(nextSet)[0] ?? remaining[0]?.id ?? null;
          setSelectedObjectId(fallback);
          setWorkMode('object');
          releaseScreenModifiers();
          setSelectedComponentIds(new Set());
        }
      }
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
    },
    [
      makeSnapshot,
      project.scenes,
      pushHistory,
      releaseScreenModifiers,
      selectedObjectId,
      selectedObjectIds,
      setSingleSelectedObject,
      showToast,
    ],
  );

  const deleteSelectedObjects = useCallback(() => {
    const idsToDelete = new Set<string>(selectedObjectIds);
    if (selectedObjectId) idsToDelete.add(selectedObjectId);
    if (idsToDelete.size === 0) return;

    if (idsToDelete.size === 1) {
      const onlyId = Array.from(idsToDelete)[0];
      deleteObject(onlyId);
      return;
    }

    const targets = activeObjects.filter((o) => idsToDelete.has(o.id));
    const unlockedIds = new Set(targets.filter((o) => !o.locked).map((o) => o.id));
    if (unlockedIds.size === 0) {
      showToast('Desbloquea los objetos antes de eliminarlos');
      return;
    }

    pushHistory(makeSnapshot());
    const remaining = activeObjects.filter((o) => !unlockedIds.has(o.id));
    setProject((p) =>
      updateActiveScene(p, (scene) => ({
        ...scene,
        objects: remaining,
      })),
    );
    setSingleSelectedObject(remaining[0]?.id ?? null);
    setWorkMode('object');
    releaseScreenModifiers();
    setSelectedComponentIds(new Set());
    setHasUnsavedChanges(true);
    setMeshRevision((r) => r + 1);
    showToast(`${unlockedIds.size} objetos eliminados`);
  }, [
    activeObjects,
    deleteObject,
    makeSnapshot,
    pushHistory,
    releaseScreenModifiers,
    selectedObjectId,
    selectedObjectIds,
    setSingleSelectedObject,
    showToast,
  ]);

  /* ==========================================================================
   * Scene & Collection Hierarchy Actions
   * ======================================================================== */
  const createScene = useCallback(
    (name?: string) => {
      pushHistory(makeSnapshot());
      const res = addSceneToProject(project, name);
      setProject(res.project);
      setOperatorSession(null);
      setSelectedObjectId(res.scene.objects[0]?.id ?? null);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(`Escena "${res.scene.name}" creada`);
    },
    [makeSnapshot, project, pushHistory, releaseScreenModifiers, showToast],
  );

  const switchScene = useCallback(
    (sceneId: string) => {
      if (sceneId === project.activeSceneId) return;
      const target = project.scenes.find((s) => s.id === sceneId);
      if (!target) return;
      setOperatorSession(null);
      setProject((p) => switchSceneInProject(p, sceneId));
      setSelectedObjectId(target.objects[0]?.id ?? null);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setMeshRevision((r) => r + 1);
    },
    [project.activeSceneId, project.scenes, releaseScreenModifiers],
  );

  const renameScene = useCallback(
    (sceneId: string, name: string) => {
      if (!name.trim()) return;
      pushHistory(makeSnapshot());
      setProject((p) => renameSceneInProject(p, sceneId, name));
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const deleteScene = useCallback(
    (sceneId: string) => {
      if (project.scenes.length <= 1) {
        showToast('No se puede eliminar la última escena');
        return;
      }
      pushHistory(makeSnapshot());
      const res = deleteSceneFromProject(project, sceneId);
      if (res.error) {
        showToast(res.error);
        return;
      }
      setProject(res.project);
      const nextScene = getActiveScene(res.project);
      setOperatorSession(null);
      setSelectedObjectId(nextScene.objects[0]?.id ?? null);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast('Escena eliminada');
    },
    [makeSnapshot, project, pushHistory, releaseScreenModifiers, showToast],
  );

  const createCollection = useCallback(
    (sceneId = activeScene.id, name?: string, parentId: string | null = null) => {
      pushHistory(makeSnapshot());
      const res = addCollectionToScene(project, sceneId, name, parentId);
      if (res.collection) {
        setProject(res.project);
        setHasUnsavedChanges(true);
        showToast(`Colección "${res.collection.name}" creada`);
      }
    },
    [activeScene.id, makeSnapshot, project, pushHistory, showToast],
  );

  const selectCollection = useCallback(
    (sceneId: string, collectionId: string) => {
      setProject((p) => {
        const switched =
          sceneId !== p.activeSceneId ? switchSceneInProject(p, sceneId) : p;
        return setActiveCollectionInScene(switched, sceneId, collectionId);
      });
      if (sceneId !== project.activeSceneId) {
        const target = project.scenes.find((s) => s.id === sceneId);
        setOperatorSession(null);
        setSelectedObjectId(target?.objects[0]?.id ?? null);
        setWorkMode('object');
        releaseScreenModifiers();
        setSelectedComponentIds(new Set());
        setMeshRevision((r) => r + 1);
      }
    },
    [project.activeSceneId, project.scenes, releaseScreenModifiers],
  );

  const renameCollection = useCallback(
    (sceneId: string, collectionId: string, name: string) => {
      if (!name.trim()) return;
      pushHistory(makeSnapshot());
      setProject((p) => renameCollectionInScene(p, sceneId, collectionId, name));
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const toggleCollectionExpanded = useCallback(
    (sceneId: string, collectionId: string) => {
      setProject((p) =>
        toggleCollectionExpandedInScene(p, sceneId, collectionId),
      );
    },
    [],
  );

  const deleteCollection = useCallback(
    (
      sceneId: string,
      collectionId: string,
      resolution: DeleteCollectionResolution,
    ) => {
      const targetScene = project.scenes.find((s) => s.id === sceneId);
      if (!targetScene) return;
      if (targetScene.collections.length <= 1) {
        showToast('Cada escena debe mantener al menos una colección');
        return;
      }
      pushHistory(makeSnapshot());
      const res = deleteCollectionFromScene(
        project,
        sceneId,
        collectionId,
        resolution,
      );
      if (res.error) {
        showToast(res.error);
        return;
      }
      setProject(res.project);
      if (
        selectedObjectId &&
        res.deletedObjectIds.includes(selectedObjectId)
      ) {
        const nextActiveScene = getActiveScene(res.project);
        setSelectedObjectId(nextActiveScene.objects[0]?.id ?? null);
        setWorkMode('object');
        setScreenShiftActive(false);
        setSelectedComponentIds(new Set());
      }
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(
        resolution.mode === 'move_objects'
          ? 'Colección eliminada y objetos reubicados'
          : 'Colección eliminada',
      );
    },
    [makeSnapshot, project, pushHistory, selectedObjectId, showToast],
  );

  const moveObjectToCollection = useCallback(
    (sceneId: string, objectId: string, targetCollectionId: string) => {
      const scene = project.scenes.find((s) => s.id === sceneId);
      const obj = scene?.objects.find((o) => o.id === objectId);
      if (!scene || !obj || obj.collectionId === targetCollectionId) return;

      pushHistory(makeSnapshot());
      setProject((p) =>
        moveObjectToCollectionInScene(p, sceneId, objectId, targetCollectionId),
      );
      setHasUnsavedChanges(true);
      const destCol = scene.collections.find((c) => c.id === targetCollectionId);
      if (destCol) {
        showToast(`"${obj.name}" movido a ${destCol.name}`);
      }
    },
    [makeSnapshot, project.scenes, pushHistory, showToast],
  );

  /* ==========================================================================
   * Model Import (OBJ / STL) & Reference Image Actions
   * ======================================================================== */
  const importObjParts = useCallback(
    (result: ObjImportResult, targetCollectionId?: string) => {
      if (result.parts.length === 0) return;
      pushHistory(makeSnapshot());

      const baseColId =
        targetCollectionId &&
        activeScene.collections.some((c) => c.id === targetCollectionId)
          ? targetCollectionId
          : activeScene.activeCollectionId;

      let nextProject = project;
      let destCollectionId = baseColId;

      // Preserve multi-group organization by creating a dedicated collection if multiple OBJ groups exist
      if (result.parts.length > 1) {
        const colRes = addCollectionToScene(
          nextProject,
          activeScene.id,
          result.baseName,
          baseColId,
        );
        nextProject = colRes.project;
        if (colRes.collection) {
          destCollectionId = colRes.collection.id;
        }
      }

      const newObjects: SceneObjectData[] = result.parts.map((part) => ({
        id: generateId('obj'),
        name: part.name,
        objectType: 'mesh',
        primitiveType: 'custom',
        collectionId: destCollectionId,
        visible: true,
        locked: false,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        mesh: part.mesh.toJSON(),
        material: part.material,
        modifiers: [],
      }));

      nextProject = updateActiveScene(nextProject, (scene) => ({
        ...scene,
        collections: scene.collections.map((c) =>
          c.id === destCollectionId || c.id === baseColId
            ? { ...c, expanded: true }
            : c,
        ),
        objects: [...scene.objects, ...newObjects],
      }));

      setProject(nextProject);
      setOperatorSession(null);
      setSingleSelectedObject(newObjects[0].id);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);

      const summary =
        newObjects.length > 1
          ? `OBJ "${result.baseName}" importado (${newObjects.length} grupos)`
          : `OBJ "${newObjects[0].name}" importado`;
      showToast(summary);
    },
    [
      activeScene.activeCollectionId,
      activeScene.collections,
      activeScene.id,
      makeSnapshot,
      project,
      pushHistory,
      releaseScreenModifiers,
      setSingleSelectedObject,
      showToast,
    ],
  );

  const importStlResult = useCallback(
    (result: StlImportResult, targetCollectionId?: string) => {
      pushHistory(makeSnapshot());

      const resolvedCollectionId =
        targetCollectionId &&
        activeScene.collections.some((c) => c.id === targetCollectionId)
          ? targetCollectionId
          : activeScene.activeCollectionId;

      const existingCount = activeObjects.filter((o) =>
        o.name.startsWith(result.name),
      ).length;
      const finalName =
        existingCount === 0
          ? result.name
          : `${result.name} ${existingCount + 1}`;

      const newObj: SceneObjectData = {
        id: generateId('obj'),
        name: finalName,
        objectType: 'mesh',
        primitiveType: 'custom',
        collectionId: resolvedCollectionId,
        visible: true,
        locked: false,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        mesh: result.mesh.toJSON(),
        material: result.material,
        modifiers: [],
      };

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          collections: scene.collections.map((c) =>
            c.id === resolvedCollectionId ? { ...c, expanded: true } : c,
          ),
          objects: [...scene.objects, newObj],
        })),
      );
      setOperatorSession(null);
      setSingleSelectedObject(newObj.id);
      setWorkMode('object');
      releaseScreenModifiers();
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(
        `STL "${finalName}" importado (${result.triangleCount.toLocaleString()} triángulos)`,
      );
    },
    [
      activeObjects,
      activeScene.activeCollectionId,
      activeScene.collections,
      makeSnapshot,
      pushHistory,
      releaseScreenModifiers,
      setSingleSelectedObject,
      showToast,
    ],
  );

  const addReferenceImage = useCallback(
    (
      payload: LoadedImageReferencePayload,
      orientation: ReferenceImageOrientation = 'front',
      targetCollectionId?: string,
    ) => {
      pushHistory(makeSnapshot());
      const resolvedCollectionId =
        targetCollectionId &&
        activeScene.collections.some((c) => c.id === targetCollectionId)
          ? targetCollectionId
          : activeScene.activeCollectionId;

      const baseName = payload.name || 'Referencia';
      const existingCount = activeObjects.filter((o) =>
        o.name.startsWith(baseName),
      ).length;
      const finalName =
        existingCount === 0 ? baseName : `${baseName} ${existingCount + 1}`;

      const refObj = createReferenceImageObject({
        name: finalName,
        collectionId: resolvedCollectionId,
        imageDataUrl: payload.imageDataUrl,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        naturalWidth: payload.naturalWidth,
        naturalHeight: payload.naturalHeight,
        orientation,
      });

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          collections: scene.collections.map((c) =>
            c.id === resolvedCollectionId ? { ...c, expanded: true } : c,
          ),
          objects: [...scene.objects, refObj],
        })),
      );
      setOperatorSession(null);
      setSingleSelectedObject(refObj.id);
      setWorkMode('object');
      setScreenShiftActive(false);
      setSelectedComponentIds(new Set());
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(`Referencia "${finalName}" añadida`);
    },
    [
      activeObjects,
      activeScene.activeCollectionId,
      activeScene.collections,
      makeSnapshot,
      pushHistory,
      setSingleSelectedObject,
      showToast,
    ],
  );

  const updateReferenceImageProps = useCallback(
    (
      objectId: string,
      patch: Partial<
        Pick<ReferenceImageData, 'opacity' | 'orientation' | 'depthMode'>
      >,
      recordHistory = true,
    ) => {
      if (recordHistory) {
        pushHistory(makeSnapshot());
      }
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((o) => {
            if (
              o.id !== objectId ||
              o.objectType !== 'reference_image' ||
              !o.referenceImage
            ) {
              return o;
            }
            const nextRef: ReferenceImageData = {
              ...o.referenceImage,
              ...patch,
            };
            let nextTransform = o.transform;
            if (patch.orientation && patch.orientation !== 'free') {
              nextTransform = {
                ...o.transform,
                rotation: [...REFERENCE_ORIENTATION_ROTATIONS[patch.orientation]],
              };
            }
            return {
              ...o,
              transform: nextTransform,
              referenceImage: nextRef,
            };
          }),
        })),
      }));
      setHasUnsavedChanges(true);
    },
    [makeSnapshot, pushHistory],
  );

  const selectAllEditComponents = useCallback(() => {
    if (!selectedObject || workMode !== 'edit') return;
    const mesh = EditableMesh.fromJSON(selectedObject.mesh);
    setSelectedComponentIds(selectAllComponents(mesh, editSelectionMode));
  }, [editSelectionMode, selectedObject, workMode]);

  const deselectAllEditComponents = useCallback(() => {
    setSelectedComponentIds(new Set());
  }, []);

  const deleteSelectedEditComponents = useCallback(() => {
    if (!selectedObject || workMode !== 'edit') return;
    if (selectedComponentIds.size === 0) {
      showToast('No hay componentes seleccionados');
      return;
    }
    pushHistory(makeSnapshot());
    const mesh = EditableMesh.fromJSON(selectedObject.mesh);
    deleteSelectedComponents(mesh, editSelectionMode, selectedComponentIds);
    mesh.clearCustomNormals();
    const updatedMeshJson = mesh.toJSON();
    setProject((p) =>
      updateActiveScene(p, (scene) => ({
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === selectedObject.id ? { ...o, mesh: updatedMeshJson } : o,
        ),
      })),
    );
    setSelectedComponentIds(new Set());
    setHasUnsavedChanges(true);
    setMeshRevision((r) => r + 1);
  }, [
    editSelectionMode,
    makeSnapshot,
    pushHistory,
    selectedComponentIds,
    selectedObject,
    showToast,
    workMode,
  ]);

  const toggleScreenShift = useCallback(() => {
    toggleScreenModifier('shift');
  }, [toggleScreenModifier]);

  const selectComponentFromViewport = useCallback(
    (id: string | null, additive: boolean, addOnly = false) => {
      if (operatorSession) return;
      const effectiveAdditive = additive || screenShiftActive;
      setSelectedComponentIds((prev) =>
        applyComponentSelection(prev, id, effectiveAdditive, addOnly),
      );
    },
    [operatorSession, screenShiftActive],
  );

  const selectComponentsFromBox = useCallback(
    (ids: string[], additive: boolean) => {
      if (operatorSession) return;
      const effectiveAdditive = additive || screenShiftActive;
      setSelectedComponentIds((prev) => {
        const next = new Set<string>(effectiveAdditive ? prev : []);
        for (const id of ids) next.add(id);
        return next;
      });
    },
    [operatorSession, screenShiftActive],
  );

  const lastNonXrayModeRef = useRef<'solid' | 'wireframe'>(
    settings.displayMode === 'wireframe' ? 'wireframe' : 'solid',
  );

  const updateSettings = useCallback((patch: Partial<ModelerSettings>) => {
    setSettings((prev) => {
      const nextDisplayMode: ViewportDisplayMode =
        patch.displayMode && patch.displayMode !== 'material'
          ? patch.displayMode
          : patch.xrayEditMode !== undefined
            ? patch.xrayEditMode
              ? 'xray'
              : lastNonXrayModeRef.current
            : prev.displayMode;
      if (nextDisplayMode === 'solid' || nextDisplayMode === 'wireframe') {
        lastNonXrayModeRef.current = nextDisplayMode;
      }
      const nextXrayTransparency =
        patch.xrayTransparency !== undefined
          ? Math.max(10, Math.min(90, Math.round(patch.xrayTransparency)))
          : prev.xrayTransparency;

      const next: ModelerSettings = {
        ...prev,
        ...patch,
        displayMode: nextDisplayMode,
        xrayEditMode: nextDisplayMode === 'xray',
        xrayTransparency: nextXrayTransparency,
        touch: patch.touch ? { ...prev.touch, ...patch.touch } : prev.touch,
      };
      saveSettingsLocally(next);
      return next;
    });
  }, []);

  const setDisplayMode = useCallback(
    (mode: ViewportDisplayMode) => {
      if (mode === 'material') {
        showToast('Vista de material disponible en una futura actualización');
        return;
      }
      updateSettings({
        displayMode: mode,
        xrayEditMode: mode === 'xray',
      });
    },
    [showToast, updateSettings],
  );

  const setXrayTransparency = useCallback(
    (value: number) => {
      const clamped = Math.max(10, Math.min(90, Math.round(value)));
      updateSettings({ xrayTransparency: clamped });
    },
    [updateSettings],
  );

  const toggleXrayDisplayMode = useCallback(() => {
    setSettings((prev) => {
      const nextMode: ViewportDisplayMode =
        prev.displayMode === 'xray' ? lastNonXrayModeRef.current : 'xray';
      if (prev.displayMode === 'solid' || prev.displayMode === 'wireframe') {
        lastNonXrayModeRef.current = prev.displayMode;
      }
      const next: ModelerSettings = {
        ...prev,
        displayMode: nextMode,
        xrayEditMode: nextMode === 'xray',
      };
      saveSettingsLocally(next);
      return next;
    });
  }, []);

  const toggleFaceOrientation = useCallback(() => {
    setSettings((prev) => {
      const nextValue = !prev.showFaceOrientation;
      const next: ModelerSettings = {
        ...prev,
        showFaceOrientation: nextValue,
      };
      saveSettingsLocally(next);
      showToast(
        nextValue
          ? 'Face Orientation activado (Azul: exterior · Rojo: invertida)'
          : 'Face Orientation desactivado',
      );
      return next;
    });
  }, [showToast]);

  const updateProportionalSettings = useCallback(
    (patch: Partial<ProportionalEditingSettings>) => {
      setSettings((prev) => {
        const nextProp = normalizeProportionalSettings({
          ...prev.proportionalEditing,
          ...patch,
        });
        const next: ModelerSettings = {
          ...prev,
          proportionalEditing: nextProp,
        };
        saveSettingsLocally(next);
        return next;
      });
    },
    [],
  );

  const toggleProportionalEditing = useCallback(() => {
    setSettings((prev) => {
      const nextEnabled = !prev.proportionalEditing.enabled;
      const next: ModelerSettings = {
        ...prev,
        proportionalEditing: {
          ...prev.proportionalEditing,
          enabled: nextEnabled,
        },
      };
      saveSettingsLocally(next);
      showToast(
        nextEnabled
          ? `Edición proporcional activada (Radio: ${next.proportionalEditing.radius.toFixed(2)})`
          : 'Edición proporcional desactivada',
      );
      return next;
    });
  }, [showToast]);

  const toggleProportionalConnected = useCallback(() => {
    setSettings((prev) => {
      const nextConnected = !prev.proportionalEditing.connectedOnly;
      const next: ModelerSettings = {
        ...prev,
        proportionalEditing: {
          ...prev.proportionalEditing,
          connectedOnly: nextConnected,
        },
      };
      saveSettingsLocally(next);
      showToast(
        nextConnected
          ? 'Proporcional: Solo vértices conectados activado'
          : 'Proporcional: Todos los vértices dentro del radio',
      );
      return next;
    });
  }, [showToast]);

  const setProportionalFalloff = useCallback(
    (falloff: ProportionalFalloff) => {
      updateProportionalSettings({ falloff });
      const meta = PROPORTIONAL_FALLOFF_LIST.find((f) => f.id === falloff);
      if (meta) {
        showToast(`Caída proporcional: ${meta.label}`);
      }
    },
    [showToast, updateProportionalSettings],
  );

  const cycleProportionalFalloff = useCallback(() => {
    setSettings((prev) => {
      const idx = PROPORTIONAL_FALLOFF_ORDER.indexOf(
        prev.proportionalEditing.falloff,
      );
      const nextFalloff =
        PROPORTIONAL_FALLOFF_ORDER[(idx + 1) % PROPORTIONAL_FALLOFF_ORDER.length];
      const next: ModelerSettings = {
        ...prev,
        proportionalEditing: {
          ...prev.proportionalEditing,
          falloff: nextFalloff,
        },
      };
      saveSettingsLocally(next);
      const meta = PROPORTIONAL_FALLOFF_LIST.find((f) => f.id === nextFalloff);
      if (meta) {
        showToast(`Caída proporcional: ${meta.label}`);
      }
      return next;
    });
  }, [showToast]);

  const setProportionalRadius = useCallback(
    (radius: number) => {
      updateProportionalSettings({
        radius: clampProportionalRadius(radius),
      });
    },
    [updateProportionalSettings],
  );

  const updateTouchSettings = useCallback(
    (patch: Partial<TouchControlSettings>) => {
      if (
        patch.modifierPanelEnabled === false ||
        patch.modifierPanelMode !== undefined
      ) {
        releaseScreenModifiers();
      }
      setSettings((prev) => {
        const next: ModelerSettings = {
          ...prev,
          touch: { ...prev.touch, ...patch },
        };
        saveSettingsLocally(next);
        return next;
      });
    },
    [releaseScreenModifiers],
  );

  const updateTouchModifier = useCallback(
    (key: TouchModifierKey, patch: Partial<TouchModifierSlotConfig>) => {
      if (patch.enabled === false || patch.showScreenButton === false) {
        setScreenModifier(key, false);
      }
      setSettings((prev) => {
        const next: ModelerSettings = {
          ...prev,
          touch: {
            ...prev.touch,
            modifiers: {
              ...prev.touch.modifiers,
              [key]: {
                ...prev.touch.modifiers[key],
                ...patch,
              },
            },
          },
        };
        saveSettingsLocally(next);
        return next;
      });
    },
    [setScreenModifier],
  );

  const updateRadialSlot = useCallback(
    (
      mode: RadialWorkMode,
      slotIndex: number,
      actionId: RadialActionId | null,
    ) => {
      if (slotIndex < 0 || slotIndex >= RADIAL_SLOT_COUNT) return;
      setSettings((prev) => {
        const currentSlots = [...prev.touch.radialLayouts[mode]];
        currentSlots[slotIndex] = actionId;
        const next: ModelerSettings = {
          ...prev,
          touch: {
            ...prev.touch,
            radialLayouts: {
              ...prev.touch.radialLayouts,
              [mode]: currentSlots,
            },
          },
        };
        saveSettingsLocally(next);
        return next;
      });
    },
    [],
  );

  const resetRadialSlot = useCallback(
    (mode: RadialWorkMode, slotIndex: number) => {
      if (slotIndex < 0 || slotIndex >= RADIAL_SLOT_COUNT) return;
      const fallback = DEFAULT_RADIAL_LAYOUTS[mode][slotIndex] ?? null;
      updateRadialSlot(mode, slotIndex, fallback);
      showToast('Botón restaurado al valor predeterminado');
    },
    [showToast, updateRadialSlot],
  );

  const resetRadialLayout = useCallback(
    (mode: RadialWorkMode) => {
      const defaults = cloneDefaultRadialLayouts();
      setSettings((prev) => {
        const next: ModelerSettings = {
          ...prev,
          touch: {
            ...prev.touch,
            radialLayouts: {
              ...prev.touch.radialLayouts,
              [mode]: defaults[mode],
            },
          },
        };
        saveSettingsLocally(next);
        return next;
      });
      showToast('Distribución radial restaurada');
    },
    [showToast],
  );

  const resetTouchSettings = useCallback(() => {
    setSettings((prev) => {
      const next: ModelerSettings = {
        ...prev,
        touch: createDefaultTouchSettings(),
      };
      saveSettingsLocally(next);
      return next;
    });
    showToast('Controles táctiles y menú radial restaurados');
  }, [showToast]);

  const updateSelectedVerticesPosition = useCallback(
    (axis: 0 | 1 | 2, targetValue: number) => {
      if (
        operatorSession ||
        !selectedObject ||
        workMode !== 'edit' ||
        selectedComponentIds.size === 0
      ) {
        return;
      }
      const mesh = EditableMesh.fromJSON(selectedObject.mesh);
      const vertIds = mesh.getVertexIdsFromSelection(
        editSelectionMode,
        selectedComponentIds,
      );
      const centroid = mesh.computeCentroid(vertIds);
      if (!centroid) return;
      const delta = targetValue - centroid[axis];
      if (Math.abs(delta) < 1e-6) return;

      pushHistory(makeSnapshot());
      const startPositions = new Map<string, Vec3>();
      for (const v of mesh.vertices) {
        startPositions.set(v.id, [...v.position]);
      }

      let affectedIds: Iterable<string> = vertIds;
      if (settings.proportionalEditing.enabled) {
        const field = buildProportionalDistanceField(
          mesh,
          editSelectionMode,
          selectedComponentIds,
          {
            connectedOnly: settings.proportionalEditing.connectedOnly,
            objectScale: selectedObject.transform.scale,
          },
        );
        const weights = computeProportionalWeights(
          field,
          settings.proportionalEditing.radius,
          settings.proportionalEditing.falloff,
        );
        const deltaVec: Vec3 = [0, 0, 0];
        deltaVec[axis] = delta;
        applyProportionalMove(mesh, weights, deltaVec);
        affectedIds = weights.keys();
      } else {
        for (const vid of vertIds) {
          const v = mesh.getVertex(vid);
          if (v) {
            v.position[axis] += delta;
          }
        }
      }

      if (selectedObject.modifiers && selectedObject.modifiers.length > 0) {
        const ownerRef: ModifierTransformRef = {
          id: selectedObject.id,
          position: selectedObject.transform.position,
          rotation: selectedObject.transform.rotation,
          scale: selectedObject.transform.scale,
        };
        clampVerticesForMirrorClipping(
          mesh,
          affectedIds,
          startPositions,
          selectedObject.modifiers,
          ownerRef,
          sceneTransformRefs,
        );
      }
      mesh.clearCustomNormals();
      const updated = mesh.toJSON();
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === selectedObject.id ? { ...o, mesh: updated } : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
    },
    [
      editSelectionMode,
      makeSnapshot,
      operatorSession,
      pushHistory,
      sceneTransformRefs,
      selectedComponentIds,
      selectedObject,
      settings.proportionalEditing.connectedOnly,
      settings.proportionalEditing.enabled,
      settings.proportionalEditing.falloff,
      settings.proportionalEditing.radius,
      workMode,
    ],
  );

  /* ==========================================================================
   * Non-Destructive Modifiers (Mirror & Subdivision Surface)
   * ======================================================================== */
  const addModifier = useCallback(
    (objectId: string, type: ModifierType) => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target) return;
      if (!isEditableMeshObject(target)) {
        showToast('Solo los objetos de malla admiten modificadores');
        return;
      }
      if (target.locked) {
        showToast('Desbloquea el objeto antes de añadir modificadores');
        return;
      }

      pushHistory(makeSnapshot());
      const defaultParams =
        type === 'mirror'
          ? createDefaultMirrorParams()
          : type === 'subdivision'
            ? createDefaultSubdivisionParams()
            : type === 'solidify'
              ? createDefaultSolidifyParams()
              : createDefaultBevelParams();

      const newSlot: ModifierSlot = {
        id: generateId('mod'),
        type,
        enabled: true,
        showInViewport: true,
        expanded: true,
        params: defaultParams,
      };

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId
              ? { ...o, modifiers: [...(o.modifiers ?? []), newSlot] }
              : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
      showToast(`Modificador ${MODIFIER_LABELS[type]} añadido`);
    },
    [activeObjects, makeSnapshot, pushHistory, showToast],
  );

  const updateModifier = useCallback(
    (
      objectId: string,
      modifierId: string,
      patch: Partial<ModifierSlot>,
      recordHistory = true,
    ) => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target) return;
      if (target.locked) {
        showToast('El objeto está bloqueado');
        return;
      }
      if (recordHistory) {
        pushHistory(makeSnapshot());
      }
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) => {
            if (o.id !== objectId) return o;
            const nextMods = (o.modifiers ?? []).map((m) => {
              if (m.id !== modifierId) return m;
              const mergedRaw = patch.params
                ? {
                    ...(m.params as Record<string, unknown>),
                    ...(patch.params as Record<string, unknown>),
                  }
                : null;
              const nextParams = mergedRaw
                ? m.type === 'mirror'
                  ? normalizeMirrorParams(mergedRaw)
                  : m.type === 'subdivision'
                    ? normalizeSubdivisionParams(mergedRaw)
                    : m.type === 'solidify'
                      ? normalizeSolidifyParams(mergedRaw)
                      : m.type === 'bevel'
                        ? normalizeBevelParams(mergedRaw)
                        : mergedRaw
                : m.params;
              return {
                ...m,
                ...patch,
                params: nextParams,
              };
            });
            return { ...o, modifiers: nextMods };
          }),
        })),
      );
      setHasUnsavedChanges(true);
    },
    [activeObjects, makeSnapshot, pushHistory, showToast],
  );

  const reorderModifier = useCallback(
    (objectId: string, modifierId: string, direction: 'up' | 'down') => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target || target.locked) return;
      const list = [...(target.modifiers ?? [])];
      const idx = list.findIndex((m) => m.id === modifierId);
      if (idx < 0) return;
      const nextIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= list.length) return;

      pushHistory(makeSnapshot());
      const [item] = list.splice(idx, 1);
      list.splice(nextIdx, 0, item);

      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId ? { ...o, modifiers: list } : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
    },
    [activeObjects, makeSnapshot, pushHistory],
  );

  const removeModifier = useCallback(
    (objectId: string, modifierId: string) => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target) return;
      if (target.locked) {
        showToast('El objeto está bloqueado');
        return;
      }
      pushHistory(makeSnapshot());
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId
              ? {
                  ...o,
                  modifiers: (o.modifiers ?? []).filter((m) => m.id !== modifierId),
                }
              : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
      showToast('Modificador eliminado sin alterar la malla base');
    },
    [activeObjects, makeSnapshot, pushHistory, showToast],
  );

  const applyModifier = useCallback(
    (objectId: string, modifierId: string) => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target) return;
      if (target.locked) {
        showToast('Desbloquea el objeto antes de aplicar modificadores');
        return;
      }
      setOperatorSession(null);

      const ownerRef: ModifierTransformRef = {
        id: target.id,
        position: target.transform.position,
        rotation: target.transform.rotation,
        scale: target.transform.scale,
      };
      const res = applySingleModifierToMesh(
        target.mesh,
        target.modifiers ?? [],
        modifierId,
        ownerRef,
        sceneTransformRefs,
      );
      if (!res.success || !res.mesh) {
        showToast(res.error ?? 'No se pudo aplicar el modificador');
        return;
      }

      pushHistory(makeSnapshot());
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId
              ? {
                  ...o,
                  mesh: res.mesh!,
                  modifiers: res.remainingModifiers ?? [],
                }
              : o,
          ),
        })),
      );
      if (workMode === 'edit' && selectedObjectId === objectId) {
        setSelectedComponentIds(new Set());
      }
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast('Modificador aplicado a la geometría');
    },
    [
      activeObjects,
      makeSnapshot,
      pushHistory,
      sceneTransformRefs,
      selectedObjectId,
      showToast,
      workMode,
    ],
  );

  /* ==========================================================================
   * Advanced Edit Mode Operators (v0.2)
   * ======================================================================== */
  const startEditOperator = useCallback(
    (type: EditOperatorType) => {
      if (!selectedObject || workMode !== 'edit') return;
      if (selectedObject.locked) {
        showToast('El objeto está bloqueado');
        return;
      }
      releaseScreenModifiers();

      const mesh = EditableMesh.fromJSON(selectedObject.mesh);
      const baseIds = Array.from(selectedComponentIds);

      if (type === 'loop_cut') {
        setLoopCutPickError(null);
        const anyValidEdge = findFirstValidLoopEdge(mesh);
        if (!anyValidEdge) {
          showToast(
            'Esta malla no contiene caras cuadrangulares compatibles para Loop Cut',
          );
          return;
        }

        let initialEdgeId: string | null = null;
        let initialError: string | null = null;

        if (editSelectionMode === 'edge' && selectedComponentIds.size > 0) {
          for (const eid of selectedComponentIds) {
            const analysis = analyzeEdgeLoopRing(mesh, eid);
            if (analysis.valid && analysis.ring && analysis.ring.quadSteps.length > 0) {
              initialEdgeId = eid;
              initialError = null;
              break;
            }
            if (!initialError && analysis.reason) {
              initialError = analysis.reason;
            }
          }
          if (!initialEdgeId && initialError) {
            setLoopCutPickError(initialError);
            showToast(initialError);
          }
        }

        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'loop_cut',
            params: { edgeId: initialEdgeId, cuts: 1, slide: 0 },
          },
        });
        return;
      }

      if (type === 'merge_by_distance') {
        if (mesh.vertices.length < 2) {
          showToast('La malla necesita al menos 2 vértices para fusionar por distancia');
          return;
        }
        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'merge_by_distance',
            params: {
              distance: 0.005,
              scope: baseIds.length > 0 ? 'selection' : 'all',
            },
          },
        });
        return;
      }

      if (selectedComponentIds.size === 0) {
        showToast('Selecciona al menos un componente antes de aplicar la herramienta');
        return;
      }

      if (type === 'extrude') {
        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'extrude',
            params: { distance: 0.5, axis: 'normal', individual: false },
          },
        });
      } else if (type === 'inset') {
        const hasFullFace =
          editSelectionMode === 'face' ||
          (() => {
            const verts = mesh.getVertexIdsFromSelection(
              editSelectionMode,
              selectedComponentIds,
            );
            return mesh.faces.some((f) => f.vertexIds.every((v) => verts.has(v)));
          })();
        if (!hasFullFace) {
          showToast('Selecciona al menos una cara completa para insertar');
          return;
        }
        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'inset',
            params: { thickness: 0.25, depth: 0, individual: false },
          },
        });
      } else if (type === 'subdivide') {
        if (editSelectionMode === 'vertex' && selectedComponentIds.size < 2) {
          showToast('Selecciona al menos 2 vértices conectados para subdividir');
          return;
        }
        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'subdivide',
            params: { cuts: 1, smoothness: 0, fractal: 0 },
          },
        });
      } else if (type === 'bevel') {
        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'bevel',
            params: { width: 0.2, segments: 1, profile: 0.5, clampOverlap: true },
          },
        });
      } else if (type === 'merge') {
        const vertIds = mesh.getVertexIdsFromSelection(
          editSelectionMode,
          selectedComponentIds,
        );
        if (vertIds.size < 2) {
          showToast('Selecciona al menos 2 vértices para fusionar');
          return;
        }
        const centroid = mesh.computeCentroid(vertIds) ?? [0, 0, 0];
        setOperatorSession({
          objectId: selectedObject.id,
          baseMesh: selectedObject.mesh,
          baseSelectionMode: editSelectionMode,
          baseSelectedIds: baseIds,
          config: {
            type: 'merge',
            params: { mode: 'center', cursorPosition: centroid },
          },
        });
      }
    },
    [
      editSelectionMode,
      releaseScreenModifiers,
      selectedComponentIds,
      selectedObject,
      showToast,
      workMode,
    ],
  );

  const updateOperatorConfig = useCallback((config: EditOperatorParams) => {
    setOperatorSession((prev) => (prev ? { ...prev, config } : null));
  }, []);

  const pickLoopCutEdge = useCallback(
    (edgeId: string | null) => {
      if (!operatorSession || operatorSession.config.type !== 'loop_cut') return;
      if (!edgeId) return;
      const mesh = EditableMesh.fromJSON(operatorSession.baseMesh);
      const analysis = analyzeEdgeLoopRing(mesh, edgeId);
      if (!analysis.valid || !analysis.ring || analysis.ring.quadSteps.length === 0) {
        const msg =
          analysis.reason ??
          'Esta arista no pertenece a un bucle de caras cuadrangulares compatible.';
        setLoopCutPickError(msg);
        showToast(msg);
        return;
      }
      setLoopCutPickError(null);
      setOperatorSession((prev) =>
        prev && prev.config.type === 'loop_cut'
          ? {
              ...prev,
              config: {
                type: 'loop_cut',
                params: { ...prev.config.params, edgeId },
              },
            }
          : prev,
      );
      showToast(
        `${analysis.ring.isClosed ? 'Bucle cerrado' : 'Bucle abierto'} · ${analysis.ring.faceIds.length} cara${analysis.ring.faceIds.length === 1 ? '' : 's'}`,
      );
    },
    [operatorSession, showToast],
  );

  const operatorPreview = useMemo(() => {
    if (!operatorSession) {
      return {
        previewMesh: null as SerializedEditableMesh | null,
        previewSelectedIds: null as Set<string> | null,
        loopCutSegments: [] as [Vec3, Vec3][],
        loopCutRingEdgeIds: [] as string[],
        loopCutFaceIds: [] as string[],
        loopCutIsClosed: false,
        loopCutError: null as string | null,
        mergedCount: 0,
      };
    }

    const baseMesh = EditableMesh.fromJSON(operatorSession.baseMesh);
    const baseSel = new Set(operatorSession.baseSelectedIds);
    const mode = operatorSession.baseSelectionMode;
    const cfg = operatorSession.config;

    if (cfg.type === 'loop_cut') {
      if (!cfg.params.edgeId) {
        return {
          previewMesh: null,
          previewSelectedIds: null,
          loopCutSegments: [] as [Vec3, Vec3][],
          loopCutRingEdgeIds: [] as string[],
          loopCutFaceIds: [] as string[],
          loopCutIsClosed: false,
          loopCutError: loopCutPickError,
          mergedCount: 0,
        };
      }
      const analysis = analyzeEdgeLoopRing(baseMesh, cfg.params.edgeId);
      if (!analysis.valid || !analysis.ring || analysis.ring.quadSteps.length === 0) {
        return {
          previewMesh: null,
          previewSelectedIds: null,
          loopCutSegments: [] as [Vec3, Vec3][],
          loopCutRingEdgeIds: [] as string[],
          loopCutFaceIds: [] as string[],
          loopCutIsClosed: false,
          loopCutError:
            analysis.reason ??
            loopCutPickError ??
            'La topología actual no forma un bucle cuadrangular.',
          mergedCount: 0,
        };
      }
      const segments = computeLoopCutPreviewSegments(
        baseMesh,
        analysis.ring,
        cfg.params.cuts,
        cfg.params.slide,
      );
      return {
        previewMesh: null,
        previewSelectedIds: null,
        loopCutSegments: segments,
        loopCutRingEdgeIds: analysis.ring.edgeIds,
        loopCutFaceIds: analysis.ring.faceIds,
        loopCutIsClosed: analysis.ring.isClosed,
        loopCutError: loopCutPickError,
        mergedCount: 0,
      };
    }

    if (cfg.type === 'merge_by_distance') {
      const mergeRes = mergeByDistanceMesh(baseMesh, mode, baseSel, cfg.params);
      return {
        previewMesh: mergeRes.mesh.toJSON(),
        previewSelectedIds: mergeRes.nextSelectedIds,
        loopCutSegments: [] as [Vec3, Vec3][],
        loopCutRingEdgeIds: [] as string[],
        loopCutFaceIds: [] as string[],
        loopCutIsClosed: false,
        loopCutError: null,
        mergedCount: mergeRes.mergedCount,
      };
    }

    let res;
    if (cfg.type === 'extrude') {
      res = extrudeMesh(baseMesh, mode, baseSel, cfg.params);
    } else if (cfg.type === 'inset') {
      res = insetFacesMesh(baseMesh, mode, baseSel, cfg.params);
    } else if (cfg.type === 'subdivide') {
      res = subdivideMesh(baseMesh, mode, baseSel, cfg.params);
    } else if (cfg.type === 'bevel') {
      res = bevelMesh(baseMesh, mode, baseSel, cfg.params);
    } else {
      res = mergeVerticesMesh(baseMesh, mode, baseSel, cfg.params);
    }

    return {
      previewMesh: res.mesh.toJSON(),
      previewSelectedIds: res.nextSelectedIds,
      loopCutSegments: [] as [Vec3, Vec3][],
      loopCutRingEdgeIds: [] as string[],
      loopCutFaceIds: [] as string[],
      loopCutIsClosed: false,
      loopCutError: null,
      mergedCount: 0,
    };
  }, [loopCutPickError, operatorSession]);

  const confirmEditOperator = useCallback(() => {
    if (!operatorSession) return;
    const baseMesh = EditableMesh.fromJSON(operatorSession.baseMesh);
    const cfg = operatorSession.config;

    let finalMesh: EditableMesh;
    let nextSelected: Set<string>;
    let nextMode: EditSelectionMode = operatorSession.baseSelectionMode;
    let loopCutFeedback: string | null = null;

    if (cfg.type === 'loop_cut') {
      if (!cfg.params.edgeId) {
        showToast('Toca una arista cuadrangular válida antes de confirmar');
        return;
      }
      const { result, error, stats } = loopCutMesh(baseMesh, cfg.params);
      if (error) {
        setLoopCutPickError(error);
        showToast(error);
        return;
      }
      finalMesh = result.mesh;
      nextSelected = result.nextSelectedIds;
      nextMode = 'edge';
      if (stats) {
        loopCutFeedback = `Loop Cut aplicado · ${stats.splitFaces} cara${stats.splitFaces === 1 ? '' : 's'} dividida${stats.splitFaces === 1 ? '' : 's'} (${cfg.params.cuts} corte${cfg.params.cuts === 1 ? '' : 's'})`;
      }
    } else if (operatorPreview.previewMesh) {
      finalMesh = EditableMesh.fromJSON(operatorPreview.previewMesh);
      nextSelected = operatorPreview.previewSelectedIds ?? new Set();
    } else {
      setOperatorSession(null);
      setLoopCutPickError(null);
      return;
    }

    const snapshot = makeSnapshot();
    snapshot.scenes = snapshot.scenes.map((s) =>
      s.id === snapshot.activeSceneId
        ? {
            ...s,
            objects: s.objects.map((o) =>
              o.id === operatorSession.objectId
                ? { ...o, mesh: operatorSession.baseMesh }
                : o,
            ),
          }
        : s,
    );
    snapshot.editSelectionMode = operatorSession.baseSelectionMode;
    snapshot.selectedComponentIds = [...operatorSession.baseSelectedIds];
    pushHistory(snapshot);

    finalMesh.clearCustomNormals();
    const serialized = finalMesh.toJSON();
    setProject((p) =>
      updateActiveScene(p, (scene) => ({
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === operatorSession.objectId ? { ...o, mesh: serialized } : o,
        ),
      })),
    );
    setEditSelectionMode(nextMode);
    setSelectedComponentIds(nextSelected);
    const mergedCountFeedback =
      cfg.type === 'merge_by_distance' ? operatorPreview.mergedCount : null;
    setOperatorSession(null);
    setLoopCutPickError(null);
    releaseScreenModifiers();
    setHasUnsavedChanges(true);
    setMeshRevision((r) => r + 1);
    if (loopCutFeedback) {
      showToast(loopCutFeedback);
    } else if (mergedCountFeedback !== null) {
      showToast(
        mergedCountFeedback === 0
          ? 'No hubo vértices dentro del umbral de distancia'
          : `${mergedCountFeedback} vértice${mergedCountFeedback === 1 ? '' : 's'} fusionado${mergedCountFeedback === 1 ? '' : 's'} por distancia`,
      );
    }
  }, [
    makeSnapshot,
    operatorPreview,
    operatorSession,
    pushHistory,
    releaseScreenModifiers,
    showToast,
  ]);

  const cancelEditOperator = useCallback(() => {
    setOperatorSession(null);
    setLoopCutPickError(null);
    releaseScreenModifiers();
    setMeshRevision((r) => r + 1);
  }, [releaseScreenModifiers]);

  const executeContextualDelete = useCallback(
    (action: DeleteActionType) => {
      if (!selectedObject || workMode !== 'edit') return;
      if (selectedComponentIds.size === 0) {
        showToast('No hay componentes seleccionados');
        return;
      }
      setOperatorSession(null);
      pushHistory(makeSnapshot());
      const mesh = EditableMesh.fromJSON(selectedObject.mesh);
      const res = applyDeleteAction(
        mesh,
        editSelectionMode,
        selectedComponentIds,
        action,
      );
      res.mesh.clearCustomNormals();
      const updated = res.mesh.toJSON();
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === selectedObject.id ? { ...o, mesh: updated } : o,
          ),
        })),
      );
      setSelectedComponentIds(res.nextSelectedIds);
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
    },
    [
      editSelectionMode,
      makeSnapshot,
      pushHistory,
      selectedComponentIds,
      selectedObject,
      showToast,
      workMode,
    ],
  );

  const executeFillSelection = useCallback(() => {
    if (!selectedObject || workMode !== 'edit') return;
    if (selectedObject.locked) {
      showToast('El objeto está bloqueado');
      return;
    }
    if (selectedComponentIds.size === 0) {
      showToast('Selecciona al menos 2 vértices o aristas para crear geometría');
      return;
    }
    setOperatorSession(null);
    const mesh = EditableMesh.fromJSON(selectedObject.mesh);
    const {
      result,
      nextMode,
      selectExisting,
      message,
      error,
    } = fillMesh(mesh, editSelectionMode, selectedComponentIds);
    if (error) {
      showToast(error);
      return;
    }
    if (selectExisting) {
      if (nextMode && nextMode !== editSelectionMode) {
        setEditSelectionMode(nextMode);
      }
      setSelectedComponentIds(result.nextSelectedIds);
      if (message) showToast(message);
      return;
    }
    pushHistory(makeSnapshot());
    result.mesh.clearCustomNormals();
    const updated = result.mesh.toJSON();
    setProject((p) =>
      updateActiveScene(p, (scene) => ({
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === selectedObject.id ? { ...o, mesh: updated } : o,
        ),
      })),
    );
    if (nextMode && nextMode !== editSelectionMode) {
      setEditSelectionMode(nextMode);
    }
    setSelectedComponentIds(result.nextSelectedIds);
    setHasUnsavedChanges(true);
    setMeshRevision((r) => r + 1);
    showToast(message ?? 'Geometría creada');
  }, [
    editSelectionMode,
    makeSnapshot,
    pushHistory,
    selectedComponentIds,
    selectedObject,
    showToast,
    workMode,
  ]);

  const executeConnectVertexPath = useCallback(() => {
    if (!selectedObject || workMode !== 'edit') return;
    if (selectedObject.locked) {
      showToast('El objeto está bloqueado');
      return;
    }
    if (editSelectionMode !== 'vertex') {
      showToast('Cambia al submodo Vértices para usar Connect Vertex Path (J)');
      return;
    }
    if (selectedComponentIds.size < 2) {
      showToast('Selecciona al menos 2 vértices para conectar');
      return;
    }
    setOperatorSession(null);
    const mesh = EditableMesh.fromJSON(selectedObject.mesh);
    const res = connectVertexPathMesh(
      mesh,
      editSelectionMode,
      selectedComponentIds,
    );
    if (!res.success) {
      showToast(
        res.error ??
          res.message ??
          'No existe un recorrido topológicamente válido entre los vértices seleccionados',
      );
      return;
    }
    pushHistory(makeSnapshot());
    res.result.mesh.clearCustomNormals();
    res.result.mesh.rebuildIndices();
    const updated = res.result.mesh.toJSON();
    setProject((p) =>
      updateActiveScene(p, (scene) => ({
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === selectedObject.id ? { ...o, mesh: updated } : o,
        ),
      })),
    );
    setSelectedComponentIds(res.result.nextSelectedIds);
    setHasUnsavedChanges(true);
    setMeshRevision((r) => r + 1);
    showToast(res.message ?? 'Connect Vertex Path aplicado');
  }, [
    editSelectionMode,
    makeSnapshot,
    pushHistory,
    selectedComponentIds,
    selectedObject,
    showToast,
    workMode,
  ]);

  const executeQuickDissolve = useCallback(() => {
    const action: DeleteActionType =
      editSelectionMode === 'vertex'
        ? 'dissolve_vertices'
        : editSelectionMode === 'edge'
          ? 'dissolve_edges'
          : 'dissolve_faces';
    executeContextualDelete(action);
  }, [editSelectionMode, executeContextualDelete]);

  const executeRecalculateOutside = useCallback(() => {
    if (!selectedObject || workMode !== 'edit') return;
    if (selectedObject.locked) {
      showToast('El objeto está bloqueado');
      return;
    }
    setOperatorSession(null);
    const mesh = EditableMesh.fromJSON(selectedObject.mesh);
    const res = recalculateOutsideMesh(
      mesh,
      editSelectionMode,
      selectedComponentIds,
    );
    if (!res.success) {
      showToast(res.error ?? res.message);
      return;
    }
    if (res.flippedCount > 0) {
      pushHistory(makeSnapshot());
      const updated = res.mesh.toJSON();
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === selectedObject.id ? { ...o, mesh: updated } : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
    }
    showToast(res.message);
  }, [
    editSelectionMode,
    makeSnapshot,
    pushHistory,
    selectedComponentIds,
    selectedObject,
    showToast,
    workMode,
  ]);

  const executeFlipNormals = useCallback(() => {
    if (!selectedObject || workMode !== 'edit') return;
    if (selectedObject.locked) {
      showToast('El objeto está bloqueado');
      return;
    }
    setOperatorSession(null);
    const mesh = EditableMesh.fromJSON(selectedObject.mesh);
    const res = flipNormalsMesh(
      mesh,
      editSelectionMode,
      selectedComponentIds,
    );
    if (!res.success) {
      showToast(res.error ?? res.message);
      return;
    }
    pushHistory(makeSnapshot());
    const updated = res.mesh.toJSON();
    setProject((p) =>
      updateActiveScene(p, (scene) => ({
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === selectedObject.id ? { ...o, mesh: updated } : o,
        ),
      })),
    );
    setHasUnsavedChanges(true);
    setMeshRevision((r) => r + 1);
    showToast(res.message);
  }, [
    editSelectionMode,
    makeSnapshot,
    pushHistory,
    selectedComponentIds,
    selectedObject,
    showToast,
    workMode,
  ]);

  const recalculateObjectNormalsOutside = useCallback(
    (objectId: string) => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target || !isEditableMeshObject(target)) return;
      if (target.locked) {
        showToast('El objeto está bloqueado');
        return;
      }
      setOperatorSession(null);
      const mesh = EditableMesh.fromJSON(target.mesh);
      const res = recalculateOutsideMesh(mesh, 'face', new Set());
      if (!res.success) {
        showToast(res.error ?? res.message);
        return;
      }
      if (res.flippedCount > 0) {
        pushHistory(makeSnapshot());
        const updated = res.mesh.toJSON();
        setProject((p) =>
          updateActiveScene(p, (scene) => ({
            ...scene,
            objects: scene.objects.map((o) =>
              o.id === objectId ? { ...o, mesh: updated } : o,
            ),
          })),
        );
        setHasUnsavedChanges(true);
        setMeshRevision((r) => r + 1);
      }
      showToast(res.message);
    },
    [activeObjects, makeSnapshot, pushHistory, showToast],
  );

  const flipObjectNormals = useCallback(
    (objectId: string) => {
      const target = activeObjects.find((o) => o.id === objectId);
      if (!target || !isEditableMeshObject(target)) return;
      if (target.locked) {
        showToast('El objeto está bloqueado');
        return;
      }
      setOperatorSession(null);
      const mesh = EditableMesh.fromJSON(target.mesh);
      const res = flipNormalsMesh(mesh, 'face', new Set());
      if (!res.success) {
        showToast(res.error ?? res.message);
        return;
      }
      pushHistory(makeSnapshot());
      const updated = res.mesh.toJSON();
      setProject((p) =>
        updateActiveScene(p, (scene) => ({
          ...scene,
          objects: scene.objects.map((o) =>
            o.id === objectId ? { ...o, mesh: updated } : o,
          ),
        })),
      );
      setHasUnsavedChanges(true);
      setMeshRevision((r) => r + 1);
      showToast(res.message);
    },
    [activeObjects, makeSnapshot, pushHistory, showToast],
  );

  // Rendered objects & selection include live operator preview when active
  const renderedObjects = useMemo(() => {
    if (!operatorSession || !operatorPreview.previewMesh) {
      return activeObjects;
    }
    return activeObjects.map((o) =>
      o.id === operatorSession.objectId
        ? { ...o, mesh: operatorPreview.previewMesh! }
        : o,
    );
  }, [activeObjects, operatorPreview.previewMesh, operatorSession]);

  const renderedScenes = useMemo(() => {
    if (!operatorSession || !operatorPreview.previewMesh) {
      return project.scenes;
    }
    return project.scenes.map((scene) =>
      scene.id === project.activeSceneId
        ? { ...scene, objects: renderedObjects }
        : scene,
    );
  }, [
    operatorPreview.previewMesh,
    operatorSession,
    project.activeSceneId,
    project.scenes,
    renderedObjects,
  ]);

  const renderedSelectedObject = useMemo(
    () => renderedObjects.find((o) => o.id === selectedObjectId) ?? null,
    [renderedObjects, selectedObjectId],
  );

  const renderedSelectedComponentIds = useMemo(
    () => operatorPreview.previewSelectedIds ?? selectedComponentIds,
    [operatorPreview.previewSelectedIds, selectedComponentIds],
  );

  const selectedModifierDiagnostics = useMemo(() => {
    const empty: {
      diagnostics: Record<string, ModifierDiagnostic>;
      evaluatedVertexCount: number;
      evaluatedEdgeCount: number;
      evaluatedFaceCount: number;
      hasActiveModifiers: boolean;
    } = {
      diagnostics: {},
      evaluatedVertexCount: renderedSelectedObject?.mesh.vertices.length ?? 0,
      evaluatedEdgeCount: renderedSelectedObject?.mesh.edges.length ?? 0,
      evaluatedFaceCount: renderedSelectedObject?.mesh.faces.length ?? 0,
      hasActiveModifiers: false,
    };
    if (
      !renderedSelectedObject ||
      !isEditableMeshObject(renderedSelectedObject) ||
      !renderedSelectedObject.modifiers ||
      renderedSelectedObject.modifiers.length === 0
    ) {
      return empty;
    }
    const ownerRef: ModifierTransformRef = {
      id: renderedSelectedObject.id,
      position: renderedSelectedObject.transform.position,
      rotation: renderedSelectedObject.transform.rotation,
      scale: renderedSelectedObject.transform.scale,
    };
    const evalRes = evaluateObjectModifiers(
      renderedSelectedObject.mesh,
      renderedSelectedObject.modifiers,
      {
        ownerTransform: ownerRef,
        sceneTransformRefs,
      },
    );
    return {
      diagnostics: evalRes.diagnostics,
      evaluatedVertexCount: evalRes.mesh.vertices.length,
      evaluatedEdgeCount: evalRes.mesh.edges.length,
      evaluatedFaceCount: evalRes.mesh.faces.length,
      hasActiveModifiers: evalRes.hasActiveModifiers,
    };
  }, [renderedSelectedObject, sceneTransformRefs]);

  const proportionalModifierWarning = useMemo(() => {
    if (
      workMode !== 'edit' ||
      !settings.proportionalEditing.enabled ||
      !renderedSelectedObject
    ) {
      return null;
    }
    return inspectProportionalModifierCompatibility(
      renderedSelectedObject.modifiers,
      renderedSelectedObject.mesh.vertices.length,
    );
  }, [
    renderedSelectedObject,
    settings.proportionalEditing.enabled,
    workMode,
  ]);

  return {
    project,
    scenes: renderedScenes,
    activeScene,
    activeSceneId: activeScene.id,
    activeCollectionId: activeScene.activeCollectionId,
    renderedObjects,
    savedProjects,
    hasUnsavedChanges,
    selectedObject: renderedSelectedObject,
    selectedObjectId,
    selectedObjectIds,
    workMode,
    editSelectionMode,
    selectedComponentIds: renderedSelectedComponentIds,
    selectedModifierDiagnostics,
    proportionalModifierWarning,
    activeTool,
    axisConstraint,
    projection,
    settings,
    meshRevision,
    toastMessage,
    screenShiftActive,
    screenModifiers,
    canUndo,
    canRedo,
    operatorSession,
    operatorMergedCount: operatorPreview.mergedCount,
    loopCutPreviewSegments: operatorPreview.loopCutSegments,
    loopCutRingEdgeIds: operatorPreview.loopCutRingEdgeIds,
    loopCutFaceIds: operatorPreview.loopCutFaceIds,
    loopCutIsClosed: operatorPreview.loopCutIsClosed,
    loopCutError: operatorPreview.loopCutError,
    setActiveTool,
    setAxisConstraint,
    setProjection,
    setProjectName,
    saveProject,
    saveProjectAs,
    createProject,
    openProject,
    removeSavedProject,
    addPrimitive,
    selectObject,
    selectObjectsFromBox,
    selectObjectInScene,
    toggleWorkMode,
    changeEditSelectionMode,
    updateObjectTransform,
    commitObjectTransformFromGizmo,
    commitMeshEditFromGizmo,
    renameObject,
    toggleObjectVisibility,
    toggleObjectLock,
    duplicateSelectedObject,
    duplicateObjectById,
    deleteObject,
    deleteSelectedObjects,
    createScene,
    switchScene,
    renameScene,
    deleteScene,
    createCollection,
    selectCollection,
    renameCollection,
    toggleCollectionExpanded,
    deleteCollection,
    moveObjectToCollection,
    importObjParts,
    importStlResult,
    addReferenceImage,
    updateReferenceImageProps,
    showToast,
    selectAllEditComponents,
    deselectAllEditComponents,
    deleteSelectedEditComponents,
    executeContextualDelete,
    executeFillSelection,
    executeConnectVertexPath,
    executeQuickDissolve,
    executeRecalculateOutside,
    executeFlipNormals,
    recalculateObjectNormalsOutside,
    flipObjectNormals,
    selectComponentFromViewport,
    selectComponentsFromBox,
    toggleScreenShift,
    setScreenShiftActive,
    setScreenModifier,
    toggleScreenModifier,
    releaseScreenModifiers,
    updateSettings,
    setDisplayMode,
    setXrayTransparency,
    toggleXrayDisplayMode,
    toggleFaceOrientation,
    updateProportionalSettings,
    toggleProportionalEditing,
    toggleProportionalConnected,
    setProportionalFalloff,
    cycleProportionalFalloff,
    setProportionalRadius,
    updateTouchSettings,
    updateTouchModifier,
    updateRadialSlot,
    resetRadialSlot,
    resetRadialLayout,
    resetTouchSettings,
    updateSelectedVerticesPosition,
    addModifier,
    updateModifier,
    reorderModifier,
    removeModifier,
    applyModifier,
    startEditOperator,
    updateOperatorConfig,
    pickLoopCutEdge,
    confirmEditOperator,
    cancelEditOperator,
    undo,
    redo,
  };
}

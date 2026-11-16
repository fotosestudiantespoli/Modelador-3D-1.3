import * as THREE from 'three';
import { createCubeMesh } from '../mesh/primitives';
import { normalizeModifierSlot } from '../modifiers/types';
import {
  CollectionData,
  ModifierSlot,
  ObjectTransform,
  ProjectData,
  ReferenceImageData,
  ReferenceImageDepthMode,
  ReferenceImageOrientation,
  SceneData,
  SceneObjectData,
} from './types';

// Local Vec3 alias compatibility if needed
type EulerVec3 = [number, number, number];

export const REFERENCE_ORIENTATION_ROTATIONS: Record<
  Exclude<ReferenceImageOrientation, 'free'>,
  EulerVec3
> = {
  front: [Math.PI / 2, 0, 0],
  back: [Math.PI / 2, Math.PI, 0],
  right: [Math.PI / 2, Math.PI / 2, 0],
  left: [Math.PI / 2, -Math.PI / 2, 0],
  top: [0, 0, 0],
  bottom: [Math.PI, 0, 0],
};

const _legacyYUpToZUpQuat = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ'),
);
const _migrationEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _migrationQuat = new THREE.Quaternion();

function cleanZero(n: number): number {
  return Math.abs(n) < 1e-12 ? 0 : n;
}

/**
 * Migrates a legacy Y-up ObjectTransform into Blender Z-up space using a rigid
 * Rx(+90 deg) rotation on object position and rotation without modifying local mesh geometry.
 */
export function migrateLegacyYUpTransform(
  transform?: Partial<ObjectTransform>,
): ObjectTransform {
  const pos: EulerVec3 =
    Array.isArray(transform?.position) && transform.position.length === 3
      ? [
          Number(transform.position[0]) || 0,
          Number(transform.position[1]) || 0,
          Number(transform.position[2]) || 0,
        ]
      : [0, 0, 0];
  const rot: EulerVec3 =
    Array.isArray(transform?.rotation) && transform.rotation.length === 3
      ? [
          Number(transform.rotation[0]) || 0,
          Number(transform.rotation[1]) || 0,
          Number(transform.rotation[2]) || 0,
        ]
      : [0, 0, 0];
  const scale: EulerVec3 =
    Array.isArray(transform?.scale) && transform.scale.length === 3
      ? [
          Number(transform.scale[0]) || 1,
          Number(transform.scale[1]) || 1,
          Number(transform.scale[2]) || 1,
        ]
      : [1, 1, 1];

  const nextPos: EulerVec3 = [cleanZero(pos[0]), cleanZero(-pos[2]), cleanZero(pos[1])];
  _migrationEuler.set(rot[0], rot[1], rot[2], 'XYZ');
  _migrationQuat.setFromEuler(_migrationEuler).premultiply(_legacyYUpToZUpQuat);
  _migrationEuler.setFromQuaternion(_migrationQuat, 'XYZ');

  return {
    position: nextPos,
    rotation: [
      cleanZero(_migrationEuler.x),
      cleanZero(_migrationEuler.y),
      cleanZero(_migrationEuler.z),
    ],
    scale: [scale[0], scale[1], scale[2]],
  };
}

export function isEditableMeshObject(
  obj: SceneObjectData | null | undefined,
): boolean {
  return Boolean(obj && obj.objectType === 'mesh');
}

export function detectOrientationFromRotation(
  rotation: EulerVec3,
): ReferenceImageOrientation {
  const eps = 0.02;
  const wrapDiff = (a: number, b: number) => {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  };
  for (const [key, rot] of Object.entries(REFERENCE_ORIENTATION_ROTATIONS)) {
    if (
      wrapDiff(rotation[0], rot[0]) < eps &&
      wrapDiff(rotation[1], rot[1]) < eps &&
      wrapDiff(rotation[2], rot[2]) < eps
    ) {
      return key as Exclude<ReferenceImageOrientation, 'free'>;
    }
  }
  return 'free';
}

export function createReferenceImageObject(params: {
  name: string;
  collectionId: string;
  imageDataUrl: string;
  fileName: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  orientation?: ReferenceImageOrientation;
  opacity?: number;
  depthMode?: ReferenceImageDepthMode;
}): SceneObjectData {
  const orientation = params.orientation ?? 'front';
  const rotation: EulerVec3 =
    orientation === 'free'
      ? [0, 0, 0]
      : [...REFERENCE_ORIENTATION_ROTATIONS[orientation]];
  const aspectRatio =
    params.naturalHeight > 0
      ? params.naturalWidth / params.naturalHeight
      : 1;

  return {
    id: createHierarchyId('ref'),
    name: params.name,
    objectType: 'reference_image',
    primitiveType: 'custom',
    collectionId: params.collectionId,
    visible: true,
    locked: false,
    transform: {
      position: [0, 0, 0],
      rotation,
      scale: [1, 1, 1],
    },
    mesh: {
      vertices: [],
      edges: [],
      faces: [],
      nextVertexNum: 1,
      nextEdgeNum: 1,
      nextFaceNum: 1,
    },
    material: {
      color: '#ffffff',
      roughness: 1,
      metalness: 0,
    },
    modifiers: [],
    referenceImage: {
      imageDataUrl: params.imageDataUrl,
      fileName: params.fileName,
      mimeType: params.mimeType,
      naturalWidth: Math.max(1, params.naturalWidth),
      naturalHeight: Math.max(1, params.naturalHeight),
      opacity: Math.max(0.05, Math.min(1, params.opacity ?? 0.75)),
      orientation,
      depthMode: params.depthMode ?? 'back',
      aspectRatio,
    },
  };
}

export function createHierarchyId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultSceneObject(
  collectionId: string,
): SceneObjectData {
  const cube = createCubeMesh(2);
  return {
    id: createHierarchyId('obj'),
    name: 'Cubo',
    objectType: 'mesh',
    primitiveType: 'cube',
    collectionId,
    visible: true,
    locked: false,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    mesh: cube.toJSON(),
    material: {
      color: '#9aa0a6',
      roughness: 0.55,
      metalness: 0.08,
    },
    modifiers: [],
  };
}

export function createDefaultScene(
  name = 'Scene',
  includeDefaultCube = false,
): SceneData {
  const sceneId = createHierarchyId('scene');
  const rootCollectionId = createHierarchyId('col');
  const rootCollection: CollectionData = {
    id: rootCollectionId,
    name: 'Collection',
    sceneId,
    parentId: null,
    expanded: true,
  };
  return {
    id: sceneId,
    name,
    activeCollectionId: rootCollectionId,
    collections: [rootCollection],
    objects: includeDefaultCube ? [createDefaultSceneObject(rootCollectionId)] : [],
  };
}

/**
 * Ensures any loaded or legacy v1 project satisfies all hierarchy invariants:
 * - At least one Scene (default "Scene")
 * - Each Scene has at least one root Collection (default "Collection")
 * - Every Object references a valid Collection within its Scene and has objectType
 */
export function normalizeProjectHierarchy(raw: unknown): ProjectData | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ProjectData> & {
    objects?: SceneObjectData[];
  };

  const shouldMigrateFromYUp = candidate.coordinateSystem !== 'z-up';
  const now = Date.now();
  const baseId =
    typeof candidate.id === 'string' && candidate.id
      ? candidate.id
      : createHierarchyId('proj');
  const baseName =
    typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name
      : 'Proyecto Sin Título';
  const createdAt =
    typeof candidate.createdAt === 'number' ? candidate.createdAt : now;
  const updatedAt =
    typeof candidate.updatedAt === 'number' ? candidate.updatedAt : now;

  let rawScenes: Partial<SceneData>[] = [];
  if (Array.isArray(candidate.scenes) && candidate.scenes.length > 0) {
    rawScenes = candidate.scenes;
  } else if (Array.isArray(candidate.objects)) {
    // Migrate legacy v1 project that stored flat objects
    const sceneId = createHierarchyId('scene');
    const colId = createHierarchyId('col');
    rawScenes = [
      {
        id: sceneId,
        name: 'Scene',
        activeCollectionId: colId,
        collections: [
          {
            id: colId,
            name: 'Collection',
            sceneId,
            parentId: null,
            expanded: true,
          },
        ],
        objects: candidate.objects,
      },
    ];
  } else {
    rawScenes = [createDefaultScene('Scene', true)];
  }

  const normalizedScenes: SceneData[] = rawScenes.map((rs, idx) => {
    const sceneId =
      typeof rs.id === 'string' && rs.id ? rs.id : createHierarchyId('scene');
    const sceneName =
      typeof rs.name === 'string' && rs.name.trim()
        ? rs.name
        : idx === 0
          ? 'Scene'
          : `Scene ${idx + 1}`;

    let collections: CollectionData[] = Array.isArray(rs.collections)
      ? rs.collections
          .filter((c): c is CollectionData => Boolean(c && typeof c.id === 'string'))
          .map((c, cIdx) => ({
            id: c.id,
            name:
              typeof c.name === 'string' && c.name.trim()
                ? c.name
                : cIdx === 0
                  ? 'Collection'
                  : `Collection ${cIdx + 1}`,
            sceneId,
            parentId: typeof c.parentId === 'string' ? c.parentId : null,
            expanded: typeof c.expanded === 'boolean' ? c.expanded : true,
          }))
      : [];

    if (collections.length === 0) {
      collections = [
        {
          id: createHierarchyId('col'),
          name: 'Collection',
          sceneId,
          parentId: null,
          expanded: true,
        },
      ];
    }

    const colIdSet = new Set(collections.map((c) => c.id));
    // Guard against invalid or self-referential parentIds
    collections = collections.map((c) => ({
      ...c,
      parentId:
        c.parentId && c.parentId !== c.id && colIdSet.has(c.parentId)
          ? c.parentId
          : null,
    }));

    const fallbackColId = collections[0].id;
    const activeCollectionId =
      typeof rs.activeCollectionId === 'string' &&
      colIdSet.has(rs.activeCollectionId)
        ? rs.activeCollectionId
        : fallbackColId;

    const objects: SceneObjectData[] = Array.isArray(rs.objects)
      ? rs.objects
          .filter((o): o is SceneObjectData => Boolean(o && typeof o.id === 'string'))
          .map((o) => {
            const objectType = o.objectType ?? 'mesh';
            const normalizedRef: ReferenceImageData | undefined =
              objectType === 'reference_image' && o.referenceImage
                ? {
                    imageDataUrl: String(o.referenceImage.imageDataUrl ?? ''),
                    fileName: String(o.referenceImage.fileName ?? o.name),
                    mimeType: String(o.referenceImage.mimeType ?? 'image/png'),
                    naturalWidth: Math.max(
                      1,
                      Number(o.referenceImage.naturalWidth) || 512,
                    ),
                    naturalHeight: Math.max(
                      1,
                      Number(o.referenceImage.naturalHeight) || 512,
                    ),
                    opacity:
                      typeof o.referenceImage.opacity === 'number'
                        ? Math.max(0.05, Math.min(1, o.referenceImage.opacity))
                        : 0.75,
                    orientation: o.referenceImage.orientation ?? 'front',
                    depthMode:
                      o.referenceImage.depthMode === 'front' ? 'front' : 'back',
                    aspectRatio:
                      typeof o.referenceImage.aspectRatio === 'number' &&
                      o.referenceImage.aspectRatio > 0
                        ? o.referenceImage.aspectRatio
                        : 1,
                  }
                : undefined;

            const migratedTransform = shouldMigrateFromYUp
              ? migrateLegacyYUpTransform(o.transform)
              : o.transform;
            const migratedRef =
              normalizedRef && shouldMigrateFromYUp
                ? {
                    ...normalizedRef,
                    orientation:
                      normalizedRef.orientation === 'free'
                        ? ('free' as const)
                        : detectOrientationFromRotation(migratedTransform.rotation),
                  }
                : normalizedRef;

            return {
              ...o,
              transform: migratedTransform,
              objectType,
              collectionId:
                typeof o.collectionId === 'string' && colIdSet.has(o.collectionId)
                  ? o.collectionId
                  : fallbackColId,
              visible: typeof o.visible === 'boolean' ? o.visible : true,
              locked: typeof o.locked === 'boolean' ? o.locked : false,
              modifiers: Array.isArray(o.modifiers)
                ? o.modifiers
                    .map((mod, mIdx) =>
                      normalizeModifierSlot(
                        mod,
                        createHierarchyId(`mod_${mIdx}`),
                      ),
                    )
                    .filter((m): m is ModifierSlot => m !== null)
                : [],
              ...(migratedRef ? { referenceImage: migratedRef } : {}),
            };
          })
      : [];

    return {
      id: sceneId,
      name: sceneName,
      activeCollectionId,
      collections,
      objects,
    };
  });

  const sceneIdSet = new Set(normalizedScenes.map((s) => s.id));
  const activeSceneId =
    typeof candidate.activeSceneId === 'string' &&
    sceneIdSet.has(candidate.activeSceneId)
      ? candidate.activeSceneId
      : normalizedScenes[0].id;

  return {
    version: 2,
    coordinateSystem: 'z-up',
    id: baseId,
    name: baseName,
    createdAt,
    updatedAt,
    activeSceneId,
    scenes: normalizedScenes,
  };
}

export function getActiveScene(project: ProjectData): SceneData {
  return (
    project.scenes.find((s) => s.id === project.activeSceneId) ??
    project.scenes[0]
  );
}

export function updateActiveScene(
  project: ProjectData,
  updater: (scene: SceneData) => SceneData,
): ProjectData {
  const active = getActiveScene(project);
  return {
    ...project,
    scenes: project.scenes.map((s) => (s.id === active.id ? updater(s) : s)),
  };
}

export function getCollectionObjectCount(
  scene: SceneData,
  collectionId: string,
  recursive = false,
): number {
  if (!recursive) {
    let count = 0;
    for (const obj of scene.objects) {
      if (obj.collectionId === collectionId) count++;
    }
    return count;
  }

  const targetIds = new Set<string>([collectionId]);
  let added = true;
  while (added) {
    added = false;
    for (const col of scene.collections) {
      if (col.parentId && targetIds.has(col.parentId) && !targetIds.has(col.id)) {
        targetIds.add(col.id);
        added = true;
      }
    }
  }
  let count = 0;
  for (const obj of scene.objects) {
    if (targetIds.has(obj.collectionId)) count++;
  }
  return count;
}

/* ============================================================================
 * Scene Operations
 * ========================================================================== */

export function addSceneToProject(
  project: ProjectData,
  name?: string,
): { project: ProjectData; scene: SceneData } {
  const trimmed = name?.trim();
  const baseName = 'Scene';
  const existingNames = new Set(project.scenes.map((s) => s.name));
  let finalName = trimmed || baseName;
  if (!trimmed) {
    let idx = project.scenes.length + 1;
    while (existingNames.has(`Scene ${idx}`)) idx++;
    finalName = `Scene ${idx}`;
  }

  const newScene = createDefaultScene(finalName, false);
  return {
    scene: newScene,
    project: {
      ...project,
      activeSceneId: newScene.id,
      scenes: [...project.scenes, newScene],
    },
  };
}

export function switchSceneInProject(
  project: ProjectData,
  sceneId: string,
): ProjectData {
  if (!project.scenes.some((s) => s.id === sceneId)) return project;
  return {
    ...project,
    activeSceneId: sceneId,
  };
}

export function renameSceneInProject(
  project: ProjectData,
  sceneId: string,
  name: string,
): ProjectData {
  const trimmed = name.trim();
  if (!trimmed) return project;
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === sceneId ? { ...s, name: trimmed } : s,
    ),
  };
}

export function deleteSceneFromProject(
  project: ProjectData,
  sceneId: string,
): { project: ProjectData; error?: string } {
  if (project.scenes.length <= 1) {
    return {
      project,
      error: 'No se puede eliminar la última escena del proyecto',
    };
  }
  if (!project.scenes.some((s) => s.id === sceneId)) {
    return { project };
  }
  const remaining = project.scenes.filter((s) => s.id !== sceneId);
  const nextActiveId =
    project.activeSceneId === sceneId ? remaining[0].id : project.activeSceneId;

  return {
    project: {
      ...project,
      activeSceneId: nextActiveId,
      scenes: remaining,
    },
  };
}

/* ============================================================================
 * Collection Operations
 * ========================================================================== */

export function addCollectionToScene(
  project: ProjectData,
  sceneId: string,
  name?: string,
  parentId: string | null = null,
): { project: ProjectData; collection: CollectionData | null } {
  const targetScene = project.scenes.find((s) => s.id === sceneId);
  if (!targetScene) return { project, collection: null };

  const trimmed = name?.trim();
  const existingNames = new Set(targetScene.collections.map((c) => c.name));
  let finalName = trimmed || 'Collection';
  if (!trimmed) {
    let idx = targetScene.collections.length + 1;
    finalName = `Collection ${idx}`;
    while (existingNames.has(finalName)) {
      idx++;
      finalName = `Collection ${idx}`;
    }
  }

  const validParentId =
    parentId && targetScene.collections.some((c) => c.id === parentId)
      ? parentId
      : null;

  const newCol: CollectionData = {
    id: createHierarchyId('col'),
    name: finalName,
    sceneId,
    parentId: validParentId,
    expanded: true,
  };

  return {
    collection: newCol,
    project: {
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              activeCollectionId: newCol.id,
              collections: [...s.collections, newCol],
            }
          : s,
      ),
    },
  };
}

export function setActiveCollectionInScene(
  project: ProjectData,
  sceneId: string,
  collectionId: string,
): ProjectData {
  return {
    ...project,
    scenes: project.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      if (!s.collections.some((c) => c.id === collectionId)) return s;
      return {
        ...s,
        activeCollectionId: collectionId,
      };
    }),
  };
}

export function renameCollectionInScene(
  project: ProjectData,
  sceneId: string,
  collectionId: string,
  name: string,
): ProjectData {
  const trimmed = name.trim();
  if (!trimmed) return project;
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === sceneId
        ? {
            ...s,
            collections: s.collections.map((c) =>
              c.id === collectionId ? { ...c, name: trimmed } : c,
            ),
          }
        : s,
    ),
  };
}

export function toggleCollectionExpandedInScene(
  project: ProjectData,
  sceneId: string,
  collectionId: string,
): ProjectData {
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === sceneId
        ? {
            ...s,
            collections: s.collections.map((c) =>
              c.id === collectionId ? { ...c, expanded: !c.expanded } : c,
            ),
          }
        : s,
    ),
  };
}

export type DeleteCollectionResolution =
  | { mode: 'delete_objects' }
  | { mode: 'move_objects'; targetCollectionId: string };

export function deleteCollectionFromScene(
  project: ProjectData,
  sceneId: string,
  collectionId: string,
  resolution: DeleteCollectionResolution,
): { project: ProjectData; deletedObjectIds: string[]; error?: string } {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return { project, deletedObjectIds: [], error: 'Escena no encontrada' };
  }
  const targetCol = scene.collections.find((c) => c.id === collectionId);
  if (!targetCol) {
    return { project, deletedObjectIds: [], error: 'Colección no encontrada' };
  }
  if (scene.collections.length <= 1) {
    return {
      project,
      deletedObjectIds: [],
      error: 'Cada escena debe conservar al menos una colección',
    };
  }

  if (resolution.mode === 'move_objects') {
    const destExists =
      resolution.targetCollectionId !== collectionId &&
      scene.collections.some((c) => c.id === resolution.targetCollectionId);
    if (!destExists) {
      return {
        project,
        deletedObjectIds: [],
        error: 'La colección de destino no es válida',
      };
    }
  }

  const remainingCollections = scene.collections
    .filter((c) => c.id !== collectionId)
    .map((c) =>
      c.parentId === collectionId ? { ...c, parentId: targetCol.parentId } : c,
    );

  const deletedObjectIds: string[] = [];
  let nextObjects: SceneObjectData[];

  if (resolution.mode === 'delete_objects') {
    nextObjects = scene.objects.filter((obj) => {
      if (obj.collectionId === collectionId) {
        deletedObjectIds.push(obj.id);
        return false;
      }
      return true;
    });
  } else {
    // Move objects cleanly by reference without duplicating mesh geometry
    const destId = resolution.targetCollectionId;
    nextObjects = scene.objects.map((obj) =>
      obj.collectionId === collectionId ? { ...obj, collectionId: destId } : obj,
    );
  }

  const nextActiveCollectionId =
    scene.activeCollectionId === collectionId
      ? resolution.mode === 'move_objects'
        ? resolution.targetCollectionId
        : remainingCollections[0].id
      : scene.activeCollectionId;

  const nextCollections =
    resolution.mode === 'move_objects'
      ? remainingCollections.map((c) =>
          c.id === resolution.targetCollectionId ? { ...c, expanded: true } : c,
        )
      : remainingCollections;

  return {
    deletedObjectIds,
    project: {
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              activeCollectionId: nextActiveCollectionId,
              collections: nextCollections,
              objects: nextObjects,
            }
          : s,
      ),
    },
  };
}

/* ============================================================================
 * Object Hierarchy Operations (Zero Mesh Duplication)
 * ========================================================================== */

export function moveObjectToCollectionInScene(
  project: ProjectData,
  sceneId: string,
  objectId: string,
  targetCollectionId: string,
): ProjectData {
  return {
    ...project,
    scenes: project.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      if (!s.collections.some((c) => c.id === targetCollectionId)) return s;
      const obj = s.objects.find((o) => o.id === objectId);
      if (!obj || obj.collectionId === targetCollectionId) return s;

      return {
        ...s,
        collections: s.collections.map((c) =>
          c.id === targetCollectionId ? { ...c, expanded: true } : c,
        ),
        // Preserves exact obj.mesh reference — no cloning or geometry duplication!
        objects: s.objects.map((o) =>
          o.id === objectId ? { ...o, collectionId: targetCollectionId } : o,
        ),
      };
    }),
  };
}

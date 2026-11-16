import {
  canonicalEdgeKey,
  EditableMesh,
  MeshFace,
  Vec3,
} from './EditableMesh';
import { EditSelectionMode } from './operations';

export type FaceOrientationStatus =
  | 'outward'
  | 'inverted'
  | 'inconsistent'
  | 'consistent_open'
  | 'non_orientable'
  | 'degenerate';

export interface ComponentNormalsInfo {
  componentIndex: number;
  faceIds: string[];
  isClosed: boolean;
  nonOrientable: boolean;
  signedVolume: number;
  boundaryEdgeCount: number;
  inconsistentEdgeCount: number;
  nonManifoldEdgeCount: number;
  outwardFaceIds: string[];
  invertedFaceIds: string[];
  inconsistentFaceIds: string[];
}

export interface MeshNormalsAnalysis {
  totalFaces: number;
  validFaceCount: number;
  degenerateFaceIds: string[];
  components: ComponentNormalsInfo[];
  faceStatusById: Map<string, FaceOrientationStatus>;
  outwardFaceIds: string[];
  invertedFaceIds: string[];
  inconsistentFaceIds: string[];
  inconsistentEdgeIds: string[];
  nonManifoldEdgeIds: string[];
  boundaryEdgeIds: string[];
  hasOpenSurfaces: boolean;
  hasDisconnectedComponents: boolean;
  isClean: boolean;
}

export interface NormalsOperationResult {
  success: boolean;
  mesh: EditableMesh;
  flippedCount: number;
  flippedFaceIds: string[];
  degenerateCount: number;
  openSurfaceCount: number;
  closedComponentCount: number;
  disconnectedComponentCount: number;
  hasOpenSurfaceWarning: boolean;
  analysisBefore: MeshNormalsAnalysis;
  analysisAfter: MeshNormalsAnalysis;
  message: string;
  error?: string;
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function computeRawNewellVector(mesh: EditableMesh, face: MeshFace): Vec3 | null {
  const n = face.vertexIds.length;
  if (n < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const a = mesh.getVertex(face.vertexIds[i])?.position;
    const b = mesh.getVertex(face.vertexIds[(i + 1) % n])?.position;
    if (!a || !b) return null;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/**
 * Checks geometrically and topologically whether a face lacks a valid normal:
 * - fewer than 3 vertices or duplicate vertex references inside the polygon loop
 * - missing vertices
 * - zero-length edges
 * - zero/near-zero Newell area (collinear or collapsed vertices)
 */
export function isFaceDegenerate(mesh: EditableMesh, face: MeshFace): boolean {
  const n = face.vertexIds.length;
  if (n < 3) return true;
  if (new Set(face.vertexIds).size !== n) return true;

  const pts: Vec3[] = [];
  for (const vid of face.vertexIds) {
    const v = mesh.getVertex(vid);
    if (!v) return true;
    const p = v.position;
    if (
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1]) ||
      !Number.isFinite(p[2])
    ) {
      return true;
    }
    pts.push(p);
  }

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    if (dx * dx + dy * dy + dz * dz <= 1e-12) {
      return true;
    }
  }

  const raw = computeRawNewellVector(mesh, face);
  if (!raw) return true;
  const newellLenSq = raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2];
  return newellLenSq <= 1e-18;
}

interface EdgeFaceRef {
  faceId: string;
  dir: 1 | -1;
}

interface EdgeAdjacencyEntry {
  key: string;
  edgeId: string | undefined;
  refs: EdgeFaceRef[];
}

/**
 * Computes signed volume contribution (x6) of a single polygon face relative to an origin `refCenter`.
 * Uses exact Stokes/tetrahedral fan over edge loop + face centroid so both convex and concave polygons are exact.
 * Positive contribution corresponds to CCW outward winding.
 */
function computeFaceSignedVolume6(
  mesh: EditableMesh,
  face: MeshFace,
  refCenter: Vec3,
  reversed: boolean,
): number {
  const verts = reversed ? [...face.vertexIds].reverse() : face.vertexIds;
  const n = verts.length;
  if (n < 3) return 0;

  let fx = 0;
  let fy = 0;
  let fz = 0;
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const p = mesh.getVertex(verts[i])?.position;
    if (!p) return 0;
    pts.push(p);
    fx += p[0];
    fy += p[1];
    fz += p[2];
  }
  const fc: Vec3 = [fx / n - refCenter[0], fy / n - refCenter[1], fz / n - refCenter[2]];

  let vol6 = 0;
  for (let i = 0; i < n; i++) {
    const a = subVec(pts[i], refCenter);
    const b = subVec(pts[(i + 1) % n], refCenter);
    vol6 += dotVec(a, crossVec(b, fc));
  }
  return vol6;
}

/**
 * Real geometric & topological normal orientation inspection across the mesh.
 * Detects inverted faces on closed shells, inconsistent neighbor winding,
 * disconnected components, open surfaces, and degenerate faces.
 */
export function analyzeMeshNormals(mesh: EditableMesh): MeshNormalsAnalysis {
  const degenerateFaceIds: string[] = [];
  const validFaces: MeshFace[] = [];
  const validFaceMap = new Map<string, MeshFace>();
  const faceStatusById = new Map<string, FaceOrientationStatus>();

  for (const face of mesh.faces) {
    if (isFaceDegenerate(mesh, face)) {
      degenerateFaceIds.push(face.id);
      faceStatusById.set(face.id, 'degenerate');
    } else {
      validFaces.push(face);
      validFaceMap.set(face.id, face);
    }
  }

  // Build undirected canonical edge adjacency across valid faces
  const edgeAdjacency = new Map<string, EdgeAdjacencyEntry>();
  const faceToEdgeKeys = new Map<string, string[]>();

  for (const face of validFaces) {
    const keys: string[] = [];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const key = canonicalEdgeKey(a, b);
      const dir: 1 | -1 = a < b ? 1 : -1;
      keys.push(key);
      let entry = edgeAdjacency.get(key);
      if (!entry) {
        entry = {
          key,
          edgeId: mesh.findEdgeId(a, b),
          refs: [],
        };
        edgeAdjacency.set(key, entry);
      }
      entry.refs.push({ faceId: face.id, dir });
    }
    faceToEdgeKeys.set(face.id, keys);
  }

  const boundaryEdgeIds: string[] = [];
  const nonManifoldEdgeIds: string[] = [];
  const inconsistentEdgeIds: string[] = [];

  for (const entry of edgeAdjacency.values()) {
    if (entry.refs.length === 1) {
      if (entry.edgeId) boundaryEdgeIds.push(entry.edgeId);
    } else if (entry.refs.length > 2) {
      if (entry.edgeId) nonManifoldEdgeIds.push(entry.edgeId);
    } else if (entry.refs.length === 2) {
      if (entry.refs[0].dir === entry.refs[1].dir && entry.edgeId) {
        inconsistentEdgeIds.push(entry.edgeId);
      }
    }
  }

  // Group valid faces into connected components across shared edges
  const visitedComponent = new Set<string>();
  const components: ComponentNormalsInfo[] = [];
  const outwardFaceIds: string[] = [];
  const invertedFaceIds: string[] = [];
  const inconsistentFaceIds: string[] = [];

  for (const startFace of validFaces) {
    if (visitedComponent.has(startFace.id)) continue;

    const compFaceIds: string[] = [];
    const compQueue: string[] = [startFace.id];
    visitedComponent.add(startFace.id);

    while (compQueue.length > 0) {
      const fid = compQueue.shift()!;
      compFaceIds.push(fid);
      const keys = faceToEdgeKeys.get(fid) ?? [];
      for (const k of keys) {
        const entry = edgeAdjacency.get(k);
        if (!entry) continue;
        for (const ref of entry.refs) {
          if (!visitedComponent.has(ref.faceId)) {
            visitedComponent.add(ref.faceId);
            compQueue.push(ref.faceId);
          }
        }
      }
    }

    const compEdgeKeys = new Set<string>();
    for (const fid of compFaceIds) {
      for (const k of faceToEdgeKeys.get(fid) ?? []) {
        compEdgeKeys.add(k);
      }
    }

    let compBoundaryCount = 0;
    let compInconsistentEdgeCount = 0;
    let compNonManifoldEdgeCount = 0;
    for (const k of compEdgeKeys) {
      const entry = edgeAdjacency.get(k)!;
      if (entry.refs.length === 1) compBoundaryCount++;
      else if (entry.refs.length > 2) compNonManifoldEdgeCount++;
      else if (entry.refs.length === 2 && entry.refs[0].dir === entry.refs[1].dir) {
        compInconsistentEdgeCount++;
      }
    }

    // BFS orientation consistency propagation inside this component across 2-manifold edges
    const alignedWithSeed = new Map<string, boolean>();
    let nonOrientable = false;

    for (const patchSeedId of compFaceIds) {
      if (alignedWithSeed.has(patchSeedId)) continue;
      alignedWithSeed.set(patchSeedId, true);
      const q: string[] = [patchSeedId];

      while (q.length > 0) {
        const currId = q.shift()!;
        const currAligned = alignedWithSeed.get(currId)!;
        const currKeys = faceToEdgeKeys.get(currId) ?? [];

        for (const k of currKeys) {
          const entry = edgeAdjacency.get(k);
          if (!entry || entry.refs.length !== 2) continue;
          const ref0 = entry.refs[0];
          const ref1 = entry.refs[1];
          const currRef = ref0.faceId === currId ? ref0 : ref1;
          const otherRef = ref0.faceId === currId ? ref1 : ref0;

          // Opposite direction along shared edge => windings already match
          const agrees = currRef.dir !== otherRef.dir;
          const expectedOtherAligned = agrees ? currAligned : !currAligned;

          if (!alignedWithSeed.has(otherRef.faceId)) {
            alignedWithSeed.set(otherRef.faceId, expectedOtherAligned);
            q.push(otherRef.faceId);
          } else if (alignedWithSeed.get(otherRef.faceId) !== expectedOtherAligned) {
            nonOrientable = true;
          }
        }
      }
    }

    // Component reference centroid for stable signed-volume calculation
    const compVerts = new Set<string>();
    for (const fid of compFaceIds) {
      const f = validFaceMap.get(fid)!;
      for (const vid of f.vertexIds) compVerts.add(vid);
    }
    const centroid = mesh.computeCentroid(compVerts) ?? [0, 0, 0];

    let alignedSignedVol6 = 0;
    for (const fid of compFaceIds) {
      const f = validFaceMap.get(fid)!;
      const isAligned = alignedWithSeed.get(fid) ?? true;
      alignedSignedVol6 += computeFaceSignedVolume6(mesh, f, centroid, !isAligned);
    }
    const alignedSignedVolume = alignedSignedVol6 / 6;

    const isClosedShell =
      compBoundaryCount === 0 &&
      compFaceIds.length >= 4 &&
      Math.abs(alignedSignedVolume) > 1e-8;

    const compOutward: string[] = [];
    const compInverted: string[] = [];
    const compInconsistent: string[] = [];

    if (isClosedShell && !nonOrientable) {
      // Closed orientable shell: true signed volume determines true outward side
      const outwardMatchesAligned = alignedSignedVolume > 0;
      for (const fid of compFaceIds) {
        const isOutward = alignedWithSeed.get(fid) === outwardMatchesAligned;
        if (isOutward) {
          compOutward.push(fid);
          outwardFaceIds.push(fid);
          faceStatusById.set(fid, 'outward');
        } else {
          compInverted.push(fid);
          invertedFaceIds.push(fid);
          faceStatusById.set(fid, 'inverted');
        }
      }
    } else if (nonOrientable) {
      for (const fid of compFaceIds) {
        compInconsistent.push(fid);
        inconsistentFaceIds.push(fid);
        faceStatusById.set(fid, 'non_orientable');
      }
    } else {
      // Open surface (or zero-volume shell): cannot unambiguously define absolute outside.
      // Detect internal winding inconsistencies relative to the component's majority orientation.
      let trueCount = 0;
      let falseCount = 0;
      for (const fid of compFaceIds) {
        if (alignedWithSeed.get(fid)) trueCount++;
        else falseCount++;
      }
      const majorityAligned = trueCount >= falseCount;
      for (const fid of compFaceIds) {
        if (alignedWithSeed.get(fid) === majorityAligned) {
          faceStatusById.set(fid, 'consistent_open');
        } else {
          compInconsistent.push(fid);
          inconsistentFaceIds.push(fid);
          faceStatusById.set(fid, 'inconsistent');
        }
      }
    }

    components.push({
      componentIndex: components.length,
      faceIds: compFaceIds,
      isClosed: isClosedShell,
      nonOrientable,
      signedVolume: alignedSignedVolume,
      boundaryEdgeCount: compBoundaryCount,
      inconsistentEdgeCount: compInconsistentEdgeCount,
      nonManifoldEdgeCount: compNonManifoldEdgeCount,
      outwardFaceIds: compOutward,
      invertedFaceIds: compInverted,
      inconsistentFaceIds: compInconsistent,
    });
  }

  const hasOpenSurfaces = components.some((c) => !c.isClosed);
  const hasDisconnectedComponents = components.length > 1;
  const isClean =
    degenerateFaceIds.length === 0 &&
    invertedFaceIds.length === 0 &&
    inconsistentFaceIds.length === 0 &&
    inconsistentEdgeIds.length === 0;

  return {
    totalFaces: mesh.faces.length,
    validFaceCount: validFaces.length,
    degenerateFaceIds,
    components,
    faceStatusById,
    outwardFaceIds,
    invertedFaceIds,
    inconsistentFaceIds,
    inconsistentEdgeIds,
    nonManifoldEdgeIds,
    boundaryEdgeIds,
    hasOpenSurfaces,
    hasDisconnectedComponents,
    isClean,
  };
}

function resolveTargetFaceScope(
  mesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: ReadonlySet<string>,
): { targetFaceIds: Set<string>; hasSelectionScope: boolean; error?: string } {
  if (selectedIds.size === 0) {
    return {
      targetFaceIds: new Set(mesh.faces.map((f) => f.id)),
      hasSelectionScope: false,
    };
  }

  const targetFaceIds = new Set<string>();
  if (mode === 'face') {
    for (const fid of selectedIds) {
      if (mesh.getFace(fid)) {
        targetFaceIds.add(fid);
      }
    }
  } else {
    const selVerts = mesh.getVertexIdsFromSelection(mode, new Set(selectedIds));
    for (const face of mesh.faces) {
      if (face.vertexIds.every((vid) => selVerts.has(vid))) {
        targetFaceIds.add(face.id);
      }
    }
  }

  if (targetFaceIds.size === 0) {
    return {
      targetFaceIds,
      hasSelectionScope: true,
      error:
        'Selecciona al menos una cara completa (o limpia la selección) para operar sobre las normales',
    };
  }

  return { targetFaceIds, hasSelectionScope: true };
}

function reverseFaceWinding(face: MeshFace): void {
  face.vertexIds.reverse();
  if (Array.isArray(face.uvs) && face.uvs.length === face.vertexIds.length) {
    face.uvs.reverse();
  }
}

/**
 * Recalculate Outside (Shift+N style):
 * - Works on current selection or whole mesh when nothing is selected.
 * - Analyses face connectivity per component, aligns inconsistent neighbor orientations,
 *   and orients each closed orientable shell outward via signed volume.
 * - For open surfaces, aligns internal inconsistencies if present, never arbitrarily
 *   flipping an already-consistent open surface, and warns the user.
 * - Never falsely alters or validates degenerate faces.
 */
export function recalculateOutsideMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode = 'face',
  selectedIds: ReadonlySet<string> = new Set(),
): NormalsOperationResult {
  const mesh = sourceMesh.clone();
  const analysisBefore = analyzeMeshNormals(mesh);

  if (mesh.faces.length === 0) {
    return {
      success: false,
      mesh,
      flippedCount: 0,
      flippedFaceIds: [],
      degenerateCount: 0,
      openSurfaceCount: 0,
      closedComponentCount: 0,
      disconnectedComponentCount: 0,
      hasOpenSurfaceWarning: false,
      analysisBefore,
      analysisAfter: analysisBefore,
      message: 'La malla no tiene caras para recalcular',
      error: 'La malla no tiene caras para recalcular',
    };
  }

  const scope = resolveTargetFaceScope(mesh, mode, selectedIds);
  if (scope.error) {
    return {
      success: false,
      mesh,
      flippedCount: 0,
      flippedFaceIds: [],
      degenerateCount: analysisBefore.degenerateFaceIds.length,
      openSurfaceCount: analysisBefore.components.filter((c) => !c.isClosed).length,
      closedComponentCount: analysisBefore.components.filter((c) => c.isClosed).length,
      disconnectedComponentCount: analysisBefore.components.length,
      hasOpenSurfaceWarning: analysisBefore.hasOpenSurfaces,
      analysisBefore,
      analysisAfter: analysisBefore,
      message: scope.error,
      error: scope.error,
    };
  }

  const degenerateSet = new Set(analysisBefore.degenerateFaceIds);
  const facesToFlip = new Set<string>();
  let touchedOpenCount = 0;
  let touchedClosedCount = 0;
  let touchedNonOrientableCount = 0;
  let targetDegenerateCount = 0;

  for (const fid of scope.targetFaceIds) {
    if (degenerateSet.has(fid)) {
      targetDegenerateCount++;
    }
  }

  for (const comp of analysisBefore.components) {
    const compTargets = comp.faceIds.filter((fid) => scope.targetFaceIds.has(fid));
    if (compTargets.length === 0) continue;

    if (comp.isClosed && !comp.nonOrientable) {
      touchedClosedCount++;
      const invertedSet = new Set(comp.invertedFaceIds);
      for (const fid of compTargets) {
        if (invertedSet.has(fid)) {
          facesToFlip.add(fid);
        }
      }
    } else if (comp.nonOrientable) {
      touchedNonOrientableCount++;
    } else {
      // Open surface component: only fix minority inconsistent faces relative to majority
      // (or match unselected neighbor reference if partially selected); never arbitrarily flip a consistent open sheet.
      touchedOpenCount++;
      if (comp.inconsistentFaceIds.length > 0) {
        const inconsistentSet = new Set(comp.inconsistentFaceIds);
        if (compTargets.length === comp.faceIds.length) {
          for (const fid of compTargets) {
            if (inconsistentSet.has(fid)) {
              facesToFlip.add(fid);
            }
          }
        } else {
          // Partial selection inside an inconsistent open surface: align selected faces with majority orientation
          for (const fid of compTargets) {
            if (inconsistentSet.has(fid)) {
              facesToFlip.add(fid);
            }
          }
        }
      }
    }
  }

  const flippedFaceIds: string[] = [];
  for (const fid of facesToFlip) {
    const face = mesh.getFace(fid);
    if (!face) continue;
    reverseFaceWinding(face);
    flippedFaceIds.push(fid);
  }

  if (flippedFaceIds.length > 0) {
    mesh.clearCustomNormals();
    mesh.rebuildIndices();
  }

  const analysisAfter = analyzeMeshNormals(mesh);
  const hasOpenSurfaceWarning = touchedOpenCount > 0;

  const parts: string[] = [];
  if (flippedFaceIds.length > 0) {
    parts.push(
      `Normales recalculadas (${flippedFaceIds.length} cara${flippedFaceIds.length === 1 ? '' : 's'} corregida${flippedFaceIds.length === 1 ? '' : 's'})`,
    );
  } else if (touchedClosedCount > 0 && touchedOpenCount === 0 && targetDegenerateCount === 0) {
    parts.push('Las normales ya estaban orientadas hacia afuera');
  }

  if (hasOpenSurfaceWarning) {
    parts.push(
      'Superficie abierta: no siempre existe una orientación exterior inequívoca',
    );
  }
  if (touchedNonOrientableCount > 0) {
    parts.push('Geometría no orientable detectada');
  }
  if (targetDegenerateCount > 0) {
    parts.push(
      `${targetDegenerateCount} cara${targetDegenerateCount === 1 ? '' : 's'} degenerada${targetDegenerateCount === 1 ? '' : 's'} sin normal válida`,
    );
  }

  const message =
    parts.join(' · ') || 'Análisis de normales completado';

  return {
    success: true,
    mesh,
    flippedCount: flippedFaceIds.length,
    flippedFaceIds,
    degenerateCount: targetDegenerateCount,
    openSurfaceCount: touchedOpenCount,
    closedComponentCount: touchedClosedCount,
    disconnectedComponentCount: analysisBefore.components.length,
    hasOpenSurfaceWarning,
    analysisBefore,
    analysisAfter,
    message,
  };
}

/**
 * Flip Normals:
 * - Flips selected faces (or all faces if nothing is selected).
 * - Reverses face vertex order and per-face UVs while preserving mesh connectivity.
 */
export function flipNormalsMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode = 'face',
  selectedIds: ReadonlySet<string> = new Set(),
): NormalsOperationResult {
  const mesh = sourceMesh.clone();
  const analysisBefore = analyzeMeshNormals(mesh);

  if (mesh.faces.length === 0) {
    return {
      success: false,
      mesh,
      flippedCount: 0,
      flippedFaceIds: [],
      degenerateCount: 0,
      openSurfaceCount: 0,
      closedComponentCount: 0,
      disconnectedComponentCount: 0,
      hasOpenSurfaceWarning: false,
      analysisBefore,
      analysisAfter: analysisBefore,
      message: 'La malla no tiene caras para invertir',
      error: 'La malla no tiene caras para invertir',
    };
  }

  const scope = resolveTargetFaceScope(mesh, mode, selectedIds);
  if (scope.error) {
    return {
      success: false,
      mesh,
      flippedCount: 0,
      flippedFaceIds: [],
      degenerateCount: analysisBefore.degenerateFaceIds.length,
      openSurfaceCount: analysisBefore.components.filter((c) => !c.isClosed).length,
      closedComponentCount: analysisBefore.components.filter((c) => c.isClosed).length,
      disconnectedComponentCount: analysisBefore.components.length,
      hasOpenSurfaceWarning: analysisBefore.hasOpenSurfaces,
      analysisBefore,
      analysisAfter: analysisBefore,
      message: scope.error,
      error: scope.error,
    };
  }

  const degenerateSet = new Set(analysisBefore.degenerateFaceIds);
  const flippedFaceIds: string[] = [];
  let targetDegenerateCount = 0;

  for (const fid of scope.targetFaceIds) {
    if (degenerateSet.has(fid)) {
      targetDegenerateCount++;
      continue;
    }
    const face = mesh.getFace(fid);
    if (!face) continue;
    reverseFaceWinding(face);
    flippedFaceIds.push(fid);
  }

  if (flippedFaceIds.length > 0) {
    mesh.clearCustomNormals();
    mesh.rebuildIndices();
  }

  const analysisAfter = analyzeMeshNormals(mesh);
  const parts: string[] = [];
  if (flippedFaceIds.length > 0) {
    parts.push(
      `${flippedFaceIds.length} normal${flippedFaceIds.length === 1 ? '' : 'es'} invertida${flippedFaceIds.length === 1 ? '' : 's'}`,
    );
  }
  if (targetDegenerateCount > 0) {
    parts.push(
      `${targetDegenerateCount} cara${targetDegenerateCount === 1 ? '' : 's'} degenerada${targetDegenerateCount === 1 ? '' : 's'} omitida${targetDegenerateCount === 1 ? '' : 's'}`,
    );
  }

  const success = flippedFaceIds.length > 0;
  const error = !success
    ? 'Solo se seleccionaron caras degeneradas sin normal válida'
    : undefined;

  return {
    success,
    mesh,
    flippedCount: flippedFaceIds.length,
    flippedFaceIds,
    degenerateCount: targetDegenerateCount,
    openSurfaceCount: analysisAfter.components.filter((c) => !c.isClosed).length,
    closedComponentCount: analysisAfter.components.filter((c) => c.isClosed).length,
    disconnectedComponentCount: analysisAfter.components.length,
    hasOpenSurfaceWarning: analysisAfter.hasOpenSurfaces,
    analysisBefore,
    analysisAfter,
    message: error ?? (parts.join(' · ') || 'Normales invertidas'),
    error,
  };
}

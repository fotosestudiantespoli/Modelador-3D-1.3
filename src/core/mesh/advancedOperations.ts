import {
  canonicalEdgeKey,
  EditableMesh,
  MeshFace,
  Vec3,
} from './EditableMesh';
import {
  EditSelectionMode,
  MeshOperatorContext,
  MeshOperatorResult,
  meshOperatorRegistry,
} from './operations';
import { connectVertexPathMesh } from './connectVertexPath';
import { flipNormalsMesh, recalculateOutsideMesh } from './normals';

import {
  analyzeEdgeLoopRing,
  computeLoopCutFractions,
  computeLoopCutPreviewSegments,
  EdgeLoopQuadStep,
  EdgeLoopRing,
  findEdgeLoopRing,
  findFirstValidLoopEdge,
  LoopCutAnalysis,
  LoopCutBlockReason,
  LoopCutExecutionResult,
  loopCutMesh,
  LoopCutParams,
} from './loopCut';

export type {
  EdgeLoopQuadStep,
  EdgeLoopRing,
  LoopCutAnalysis,
  LoopCutBlockReason,
  LoopCutExecutionResult,
  LoopCutParams,
};
export {
  analyzeEdgeLoopRing,
  computeLoopCutFractions,
  computeLoopCutPreviewSegments,
  findEdgeLoopRing,
  findFirstValidLoopEdge,
  loopCutMesh,
};

export type ExtrudeAxis = 'normal' | 'x' | 'y' | 'z';

export interface ExtrudeParams {
  distance: number;
  axis: ExtrudeAxis;
  individual: boolean;
}

export interface InsetParams {
  thickness: number; // 0.02 .. 0.9
  depth: number;
  individual: boolean;
}

export interface SubdivideParams {
  cuts: number; // 1 .. 6
  smoothness: number; // 0 .. 1
  fractal: number; // 0 .. 0.5
}

export interface BevelParams {
  width: number; // 0.02 .. 0.8
  segments: number; // 1 .. 5
  profile: number; // 0.1 .. 1.0
  clampOverlap: boolean;
}

export type MergeMode = 'center' | 'first' | 'last' | 'cursor';

export interface MergeParams {
  mode: MergeMode;
  cursorPosition?: Vec3;
}

export interface MergeByDistanceParams {
  distance: number;
  scope?: 'selection' | 'all';
}

export interface MergeByDistanceResult extends MeshOperatorResult {
  mergedCount: number;
}

export type DeleteActionType =
  | 'delete_vertices'
  | 'dissolve_vertices'
  | 'delete_edges'
  | 'delete_edges_and_vertices'
  | 'dissolve_edges'
  | 'delete_only_faces'
  | 'delete_faces_and_edges'
  | 'dissolve_faces';

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
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

function lenVec(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normVec(a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const l = lenVec(a);
  if (l < 1e-8) return fallback;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function axisVector(axis: ExtrudeAxis): Vec3 {
  if (axis === 'x') return [1, 0, 0];
  if (axis === 'y') return [0, 1, 0];
  if (axis === 'z') return [0, 0, 1];
  return [0, 0, 1];
}

function deterministicJitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 500 - 1; // [-1, 1]
}

/* ============================================================================
 * A. EXTRUDE — EXTRUSIÓN (Caras, Aristas, Vértices)
 * ========================================================================== */
export function extrudeMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  params: ExtrudeParams,
): MeshOperatorResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();
  const { distance, axis, individual } = params;

  if (selectedIds.size === 0) {
    return { mesh, nextSelectedIds: nextSelected };
  }

  if (mode === 'vertex') {
    for (const vid of selectedIds) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      const dir =
        axis === 'normal' ? mesh.computeVertexNormal(vid) : axisVector(axis);
      const pos = addVec(v.position, scaleVec(dir, distance));
      const newV = mesh.addVertex(pos[0], pos[1], pos[2]);
      mesh.addEdge(vid, newV.id);
      nextSelected.add(newV.id);
    }
    return { mesh, nextSelectedIds: nextSelected };
  }

  if (mode === 'edge') {
    const validEdges = Array.from(selectedIds)
      .map((id) => mesh.getEdge(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    if (validEdges.length === 0) return { mesh, nextSelectedIds: nextSelected };

    const vertSet = new Set<string>();
    for (const e of validEdges) {
      vertSet.add(e.v0);
      vertSet.add(e.v1);
    }

    const vertMap = new Map<string, string>();
    for (const vid of vertSet) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      const dir =
        axis === 'normal' ? mesh.computeVertexNormal(vid) : axisVector(axis);
      const pos = addVec(v.position, scaleVec(dir, distance));
      const newV = mesh.addVertex(pos[0], pos[1], pos[2]);
      vertMap.set(vid, newV.id);
    }

    for (const e of validEdges) {
      const n0 = vertMap.get(e.v0);
      const n1 = vertMap.get(e.v1);
      if (!n0 || !n1) continue;

      // Orient wall quad continuously with an existing adjacent face if any
      let reverseWinding = false;
      const adjFaceIds = mesh.getFacesForEdge(e.id);
      if (adjFaceIds.length > 0) {
        const f = mesh.getFace(adjFaceIds[0]);
        if (f) {
          const idx = f.vertexIds.indexOf(e.v0);
          if (idx !== -1 && f.vertexIds[(idx + 1) % f.vertexIds.length] === e.v1) {
            reverseWinding = true;
          }
        }
      }

      if (reverseWinding) {
        mesh.addFace([e.v1, e.v0, n0, n1]);
      } else {
        mesh.addFace([e.v0, e.v1, n1, n0]);
      }

      const extrudedEdgeId = mesh.findEdgeId(n0, n1);
      if (extrudedEdgeId) nextSelected.add(extrudedEdgeId);
    }

    return { mesh, nextSelectedIds: nextSelected };
  }

  // FACE MODE
  const selectedFaces = Array.from(selectedIds)
    .map((id) => mesh.getFace(id))
    .filter((f): f is MeshFace => Boolean(f));
  if (selectedFaces.length === 0) return { mesh, nextSelectedIds: nextSelected };

  const reverseFaceWinding = (face: MeshFace) => {
    face.vertexIds.reverse();
    if (face.uvs) {
      face.uvs.reverse();
    }
    if (face.normals) {
      face.normals.reverse();
    }
  };

  if (individual) {
    const faceIdsToDelete = new Set<string>();

    for (const face of selectedFaces) {
      const faceNormal = mesh.computeFaceNormal(face);
      const dir = axis === 'normal' ? faceNormal : axisVector(axis);
      const offset = scaleVec(dir, distance);

      // Keep and orient the original face ONLY if it is an isolated open single face
      // (every edge belongs solely to this face, e.g. a Plane or disconnected polygon).
      const edgeIds = mesh.getEdgesForFace(face.id);
      const isIsolatedOpenFace =
        edgeIds.length > 0 &&
        edgeIds.every((eid) => mesh.getFacesForEdge(eid).length === 1);

      const oldIds = [...face.vertexIds];
      const newIds: string[] = [];
      for (const vid of oldIds) {
        const v = mesh.getVertex(vid);
        if (!v) continue;
        const pos = addVec(v.position, offset);
        newIds.push(mesh.addVertex(pos[0], pos[1], pos[2]).id);
      }
      if (newIds.length !== oldIds.length) continue;

      const flipOpenExtrusion =
        isIsolatedOpenFace && dotVec(offset, faceNormal) < -1e-7;

      if (isIsolatedOpenFace) {
        if (!flipOpenExtrusion) {
          reverseFaceWinding(face);
        }
      } else {
        faceIdsToDelete.add(face.id);
      }

      const k = oldIds.length;
      for (let i = 0; i < k; i++) {
        const nextI = (i + 1) % k;
        if (flipOpenExtrusion) {
          mesh.addFace([oldIds[nextI], oldIds[i], newIds[i], newIds[nextI]]);
        } else {
          mesh.addFace([oldIds[i], oldIds[nextI], newIds[nextI], newIds[i]]);
        }
      }

      const capVerts = flipOpenExtrusion ? [...newIds].reverse() : newIds;
      const capFace = mesh.addFace(capVerts);
      if (capFace) nextSelected.add(capFace.id);
    }

    if (faceIdsToDelete.size > 0) {
      mesh.deleteFaces(faceIdsToDelete);
    }
    mesh.clearCustomNormals();
    return { mesh, nextSelectedIds: nextSelected };
  }

  // REGION EXTRUDE (Connected faces share new extruded vertices)
  const selectedFaceIdSet = new Set(selectedFaces.map((f) => f.id));
  const vertexNormalsAccum = new Map<string, Vec3>();
  const vertSet = new Set<string>();

  for (const face of selectedFaces) {
    const fn = mesh.computeFaceNormal(face);
    for (const vid of face.vertexIds) {
      vertSet.add(vid);
      const prev = vertexNormalsAccum.get(vid) ?? [0, 0, 0];
      vertexNormalsAccum.set(vid, addVec(prev, fn));
    }
  }

  const vertMap = new Map<string, string>();
  for (const vid of vertSet) {
    const v = mesh.getVertex(vid);
    if (!v) continue;
    const dir =
      axis === 'normal'
        ? normVec(vertexNormalsAccum.get(vid) ?? [0, 0, 1])
        : axisVector(axis);
    const pos = addVec(v.position, scaleVec(dir, distance));
    const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
    vertMap.set(vid, nv.id);
  }

  // Count how many selected faces use each canonical edge
  const edgeUseCountInSelection = new Map<string, number>();
  for (const face of selectedFaces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const key = canonicalEdgeKey(a, b);
      edgeUseCountInSelection.set(key, (edgeUseCountInSelection.get(key) ?? 0) + 1);
    }
  }

  // Group selected faces into edge-connected components so each island decides
  // independently whether it is an isolated open sheet (keep base) or connected/closed.
  const selectedFaceById = new Map(selectedFaces.map((f) => [f.id, f]));
  const keyToSelectedFaceIds = new Map<string, string[]>();
  for (const face of selectedFaces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const key = canonicalEdgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      let list = keyToSelectedFaceIds.get(key);
      if (!list) {
        list = [];
        keyToSelectedFaceIds.set(key, list);
      }
      list.push(face.id);
    }
  }

  const visitedComp = new Set<string>();
  const faceToIsolatedInfo = new Map<
    string,
    { isIsolatedOpen: boolean; flipWinding: boolean }
  >();

  for (const seed of selectedFaces) {
    if (visitedComp.has(seed.id)) continue;
    const compFaces: MeshFace[] = [];
    const queue: string[] = [seed.id];
    visitedComp.add(seed.id);

    while (queue.length > 0) {
      const fid = queue.shift()!;
      const f = selectedFaceById.get(fid);
      if (!f) continue;
      compFaces.push(f);
      const n = f.vertexIds.length;
      for (let i = 0; i < n; i++) {
        const key = canonicalEdgeKey(f.vertexIds[i], f.vertexIds[(i + 1) % n]);
        const neighbors = keyToSelectedFaceIds.get(key) ?? [];
        for (const nfid of neighbors) {
          if (!visitedComp.has(nfid)) {
            visitedComp.add(nfid);
            queue.push(nfid);
          }
        }
      }
    }

    // Check boundary edges of this selected island:
    // - Needs >= 1 boundary edge (closed shells have 0 and replace cleanly without double shells)
    // - None of its boundary edges may touch an unselected face in the mesh
    let boundaryEdgeCount = 0;
    let hasUnselectedNeighbor = false;
    let avgNormal: Vec3 = [0, 0, 0];
    let avgOffset: Vec3 = [0, 0, 0];
    const compVerts = new Set<string>();

    for (const f of compFaces) {
      const fn = mesh.computeFaceNormal(f);
      avgNormal = addVec(avgNormal, fn);
      const n = f.vertexIds.length;
      for (let i = 0; i < n; i++) {
        const a = f.vertexIds[i];
        const b = f.vertexIds[(i + 1) % n];
        compVerts.add(a);
        const key = canonicalEdgeKey(a, b);
        if (edgeUseCountInSelection.get(key) === 1) {
          boundaryEdgeCount++;
          const eid = mesh.findEdgeId(a, b);
          if (eid) {
            const allIncident = mesh.getFacesForEdge(eid);
            if (allIncident.some((fid) => !selectedFaceIdSet.has(fid))) {
              hasUnselectedNeighbor = true;
            }
          }
        }
      }
    }

    for (const vid of compVerts) {
      const v = mesh.getVertex(vid);
      const nvId = vertMap.get(vid);
      const nv = nvId ? mesh.getVertex(nvId) : undefined;
      if (v && nv) {
        avgOffset = addVec(avgOffset, subVec(nv.position, v.position));
      }
    }

    const isIsolatedOpen = boundaryEdgeCount > 0 && !hasUnselectedNeighbor;
    const flipWinding = isIsolatedOpen && dotVec(avgOffset, avgNormal) < -1e-7;

    for (const f of compFaces) {
      faceToIsolatedInfo.set(f.id, { isIsolatedOpen, flipWinding });
    }
  }

  // Only delete original faces & internal edges for non-isolated islands
  const faceIdsToDelete = new Set<string>();
  const keptFaceIds = new Set<string>();
  const keptVertIds = new Set<string>();

  for (const face of selectedFaces) {
    const info = faceToIsolatedInfo.get(face.id);
    if (info?.isIsolatedOpen) {
      keptFaceIds.add(face.id);
      for (const vid of face.vertexIds) keptVertIds.add(vid);
      if (!info.flipWinding) {
        reverseFaceWinding(face);
      }
    } else {
      faceIdsToDelete.add(face.id);
    }
  }

  // Find internal edges (shared exclusively by deleted selected faces) to clean up
  const internalEdgeIds = new Set<string>();
  for (const face of selectedFaces) {
    if (!faceIdsToDelete.has(face.id)) continue;
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const eid = mesh.findEdgeId(a, b);
      if (!eid) continue;
      const allIncident = mesh.getFacesForEdge(eid);
      if (allIncident.every((fid) => faceIdsToDelete.has(fid))) {
        const key = canonicalEdgeKey(a, b);
        if ((edgeUseCountInSelection.get(key) ?? 0) >= 2) {
          internalEdgeIds.add(eid);
        }
      }
    }
  }

  // Create boundary wall quads & collect new cap specs BEFORE deleting base faces
  const newCapSpecs: string[][] = [];
  for (const face of selectedFaces) {
    const info = faceToIsolatedInfo.get(face.id);
    const isFlippedOpen = Boolean(info?.flipWinding);
    const n = face.vertexIds.length;
    // Note: if face was kept & reversed in-place above, iterate in original outward order for cap/walls
    const origVerts =
      info?.isIsolatedOpen && !info.flipWinding
        ? [...face.vertexIds].reverse()
        : face.vertexIds;

    const mappedFaceVerts: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = origVerts[i];
      const b = origVerts[(i + 1) % n];
      const ma = vertMap.get(a)!;
      const mb = vertMap.get(b)!;
      mappedFaceVerts.push(ma);

      const key = canonicalEdgeKey(a, b);
      if (edgeUseCountInSelection.get(key) === 1) {
        if (isFlippedOpen) {
          mesh.addFace([b, a, ma, mb]);
        } else {
          mesh.addFace([a, b, mb, ma]);
        }
      }
    }
    newCapSpecs.push(isFlippedOpen ? [...mappedFaceVerts].reverse() : mappedFaceVerts);
  }

  // Delete original faces belonging to non-isolated regions & their internal edges, add new caps
  if (faceIdsToDelete.size > 0) {
    mesh.deleteFaces(faceIdsToDelete);
  }
  if (internalEdgeIds.size > 0) {
    mesh.deleteEdges(internalEdgeIds);
  }
  const pruneCandidates = new Set<string>();
  for (const vid of vertSet) {
    if (!keptVertIds.has(vid)) {
      pruneCandidates.add(vid);
    }
  }
  if (pruneCandidates.size > 0) {
    mesh.pruneOrphanVertices(pruneCandidates);
  }

  for (const verts of newCapSpecs) {
    const cap = mesh.addFace(verts);
    if (cap) nextSelected.add(cap.id);
  }

  mesh.clearCustomNormals();
  return { mesh, nextSelectedIds: nextSelected };
}

/* ============================================================================
 * B. INSET — INSERTAR CARAS
 * ========================================================================== */
export function insetFacesMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  params: InsetParams,
): MeshOperatorResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();
  const thickness = Math.max(0.02, Math.min(0.92, params.thickness));
  const depth = params.depth;

  // Gather target faces (if not in face mode, take faces whose all vertices are selected)
  const targetFaces: MeshFace[] = [];
  if (mode === 'face') {
    for (const fid of selectedIds) {
      const f = mesh.getFace(fid);
      if (f) targetFaces.push(f);
    }
  } else {
    const selVerts = mesh.getVertexIdsFromSelection(mode, selectedIds);
    for (const f of mesh.faces) {
      if (f.vertexIds.every((vid) => selVerts.has(vid))) {
        targetFaces.push(f);
      }
    }
  }

  if (targetFaces.length === 0) {
    return { mesh, nextSelectedIds: nextSelected };
  }

  const doIndividual = () => {
    const toDelete = new Set<string>();
    for (const face of targetFaces) {
      toDelete.add(face.id);
      const center = mesh.computeFaceCenter(face);
      const normal = mesh.computeFaceNormal(face);
      const depthVec = scaleVec(normal, depth);

      const oldIds = [...face.vertexIds];
      const innerIds: string[] = [];

      for (const vid of oldIds) {
        const v = mesh.getVertex(vid);
        if (!v) continue;
        const insetPos = addVec(lerpVec(v.position, center, thickness), depthVec);
        innerIds.push(mesh.addVertex(insetPos[0], insetPos[1], insetPos[2]).id);
      }

      if (innerIds.length !== oldIds.length) continue;
      const k = oldIds.length;
      for (let i = 0; i < k; i++) {
        const nextI = (i + 1) % k;
        mesh.addFace([oldIds[i], oldIds[nextI], innerIds[nextI], innerIds[i]]);
      }

      const innerFace = mesh.addFace(innerIds);
      if (innerFace) nextSelected.add(innerFace.id);
    }
    mesh.deleteFaces(toDelete);
  };

  if (params.individual || targetFaces.length === 1) {
    doIndividual();
    return { mesh, nextSelectedIds: nextSelected };
  }

  // REGION INSET: find boundary edges of targetFaces
  const targetFaceIds = new Set(targetFaces.map((f) => f.id));
  const edgeUseCount = new Map<string, number>();
  const boundaryHalfEdges: { a: string; b: string; face: MeshFace }[] = [];

  for (const face of targetFaces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const key = canonicalEdgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      edgeUseCount.set(key, (edgeUseCount.get(key) ?? 0) + 1);
    }
  }

  for (const face of targetFaces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      if (edgeUseCount.get(canonicalEdgeKey(a, b)) === 1) {
        boundaryHalfEdges.push({ a, b, face });
      }
    }
  }

  // If closed shell (no boundary edges), fall back to individual inset
  if (boundaryHalfEdges.length === 0) {
    doIndividual();
    return { mesh, nextSelectedIds: nextSelected };
  }

  // Compute inward displacement per boundary vertex
  const inwardAccum = new Map<string, Vec3>();
  const normalAccum = new Map<string, Vec3>();
  const edgeLenSum = new Map<string, number>();
  const edgeLenCount = new Map<string, number>();

  for (const { a, b, face } of boundaryHalfEdges) {
    const va = mesh.getVertex(a)?.position;
    const vb = mesh.getVertex(b)?.position;
    if (!va || !vb) continue;
    const fn = mesh.computeFaceNormal(face);
    const edgeVec = subVec(vb, va);
    const elen = lenVec(edgeVec);
    // Outward normal of edge in face plane is edgeVec x fn, so inward is fn x edgeVec
    const inward = normVec(crossVec(fn, edgeVec));

    for (const vid of [a, b]) {
      inwardAccum.set(vid, addVec(inwardAccum.get(vid) ?? [0, 0, 0], inward));
      normalAccum.set(vid, addVec(normalAccum.get(vid) ?? [0, 0, 0], fn));
      edgeLenSum.set(vid, (edgeLenSum.get(vid) ?? 0) + elen);
      edgeLenCount.set(vid, (edgeLenCount.get(vid) ?? 0) + 1);
    }
  }

  // Map vertices inside targetFaces -> inner vertices
  const allVertsInTarget = new Set<string>();
  const interiorNormalAccum = new Map<string, Vec3>();
  for (const face of targetFaces) {
    const fn = mesh.computeFaceNormal(face);
    for (const vid of face.vertexIds) {
      allVertsInTarget.add(vid);
      interiorNormalAccum.set(
        vid,
        addVec(interiorNormalAccum.get(vid) ?? [0, 0, 0], fn),
      );
    }
  }

  const vertMap = new Map<string, string>();
  const internalEdgeIds = new Set<string>();

  for (const vid of allVertsInTarget) {
    const v = mesh.getVertex(vid);
    if (!v) continue;
    if (inwardAccum.has(vid)) {
      const avgInward = normVec(inwardAccum.get(vid)!);
      const avgNormal = normVec(normalAccum.get(vid)!);
      const avgLen =
        (edgeLenSum.get(vid) ?? 1) / Math.max(1, edgeLenCount.get(vid) ?? 1);
      const moveDist = avgLen * 0.5 * thickness;
      const newPos = addVec(
        addVec(v.position, scaleVec(avgInward, moveDist)),
        scaleVec(avgNormal, depth),
      );
      vertMap.set(vid, mesh.addVertex(newPos[0], newPos[1], newPos[2]).id);
    } else {
      const avgNormal = normVec(interiorNormalAccum.get(vid) ?? [0, 0, 1]);
      const newPos = addVec(v.position, scaleVec(avgNormal, depth));
      vertMap.set(vid, mesh.addVertex(newPos[0], newPos[1], newPos[2]).id);
    }
  }

  // Collect internal edges to remove
  for (const face of targetFaces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const eid = mesh.findEdgeId(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      if (!eid) continue;
      if (mesh.getFacesForEdge(eid).every((fid) => targetFaceIds.has(fid))) {
        if ((edgeUseCount.get(canonicalEdgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n])) ?? 0) >= 2) {
          internalEdgeIds.add(eid);
        }
      }
    }
  }

  // Create border quads along boundaryHalfEdges
  for (const { a, b } of boundaryHalfEdges) {
    const ma = vertMap.get(a)!;
    const mb = vertMap.get(b)!;
    mesh.addFace([a, b, mb, ma]);
  }

  const newInnerSpecs = targetFaces.map((f) =>
    f.vertexIds.map((vid) => vertMap.get(vid)!),
  );

  mesh.deleteFaces(targetFaceIds);
  if (internalEdgeIds.size > 0) {
    mesh.deleteEdges(internalEdgeIds);
  }
  mesh.pruneOrphanVertices(allVertsInTarget);

  for (const verts of newInnerSpecs) {
    const nf = mesh.addFace(verts);
    if (nf) nextSelected.add(nf.id);
  }

  return { mesh, nextSelectedIds: nextSelected };
}

/* ============================================================================
 * C. SUBDIVIDE — SUBDIVIDIR (Aristas y Caras)
 * ========================================================================== */
export function subdivideMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  params: SubdivideParams,
): MeshOperatorResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();
  const cuts = Math.max(1, Math.min(6, Math.round(params.cuts)));
  const smoothness = Math.max(0, Math.min(1, params.smoothness));
  const fractal = Math.max(0, Math.min(0.5, params.fractal));

  if (selectedIds.size === 0) {
    return { mesh, nextSelectedIds: nextSelected };
  }

  // 1. Collect edges to subdivide
  const edgeIdsToSubdivide = new Set<string>();
  if (mode === 'edge') {
    for (const eid of selectedIds) {
      if (mesh.getEdge(eid)) edgeIdsToSubdivide.add(eid);
    }
  } else if (mode === 'face') {
    for (const fid of selectedIds) {
      for (const eid of mesh.getEdgesForFace(fid)) {
        edgeIdsToSubdivide.add(eid);
      }
    }
  } else {
    for (const edge of mesh.edges) {
      if (selectedIds.has(edge.v0) && selectedIds.has(edge.v1)) {
        edgeIdsToSubdivide.add(edge.id);
      }
    }
  }

  if (edgeIdsToSubdivide.size === 0) {
    return { mesh, nextSelectedIds: nextSelected };
  }

  // Precompute vertex normals for smoothing/fractal
  const vNormals = new Map<string, Vec3>();
  for (const v of mesh.vertices) {
    vNormals.set(v.id, mesh.computeVertexNormal(v.id));
  }

  // 2. Create split vertices along each subdivided edge (keyed by canonicalEdgeKey)
  // Ordered from minId -> maxId
  const edgeSplits = new Map<string, string[]>();
  const createdVertIds: string[] = [];

  for (const eid of edgeIdsToSubdivide) {
    const edge = mesh.getEdge(eid);
    if (!edge) continue;
    const minId = edge.v0 < edge.v1 ? edge.v0 : edge.v1;
    const maxId = edge.v0 < edge.v1 ? edge.v1 : edge.v0;
    const va = mesh.getVertex(minId)!;
    const vb = mesh.getVertex(maxId)!;
    const na = vNormals.get(minId) ?? [0, 0, 1];
    const nb = vNormals.get(maxId) ?? [0, 0, 1];
    const edgeLen = lenVec(subVec(vb.position, va.position));

    const splitIds: string[] = [];
    for (let k = 1; k <= cuts; k++) {
      const t = k / (cuts + 1);
      let pos = lerpVec(va.position, vb.position, t);

      if (smoothness > 0) {
        const arc = 4 * t * (1 - t); // peaks at 1 at midpoint
        const avgN = normVec(addVec(na, nb));
        const bulged = scaleVec(avgN, smoothness * 0.22 * edgeLen * arc);
        pos = addVec(pos, bulged);
      }
      if (fractal > 0) {
        const avgN = normVec(addVec(na, nb));
        const jitter = deterministicJitter(`${minId}_${maxId}_${k}`);
        pos = addVec(pos, scaleVec(avgN, jitter * fractal * edgeLen * 0.35));
      }

      const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
      splitIds.push(nv.id);
      createdVertIds.push(nv.id);
    }
    edgeSplits.set(canonicalEdgeKey(edge.v0, edge.v1), splitIds);
  }

  // Helper to get ordered chain [vStart, ...splits, vEnd]
  const getEdgeChain = (vStart: string, vEnd: string): string[] => {
    const splits = edgeSplits.get(canonicalEdgeKey(vStart, vEnd));
    if (!splits) return [vStart, vEnd];
    const ordered = vStart < vEnd ? splits : [...splits].reverse();
    return [vStart, ...ordered, vEnd];
  };

  // 3. Rebuild faces
  const oldFaces = [...mesh.faces];
  const facesToDelete = new Set<string>();
  const newFacesSpec: { verts: string[]; select: boolean }[] = [];

  for (const face of oldFaces) {
    const k = face.vertexIds.length;
    const edgeFlags: boolean[] = [];
    let subCount = 0;
    for (let i = 0; i < k; i++) {
      const key = canonicalEdgeKey(
        face.vertexIds[i],
        face.vertexIds[(i + 1) % k],
      );
      const isSub = edgeSplits.has(key);
      edgeFlags.push(isSub);
      if (isSub) subCount++;
    }

    if (subCount === 0) continue;
    facesToDelete.add(face.id);

    const isSelectedFace = mode === 'face' && selectedIds.has(face.id);

    // Case 1: Quad with all 4 edges subdivided -> (cuts+1) x (cuts+1) grid
    if (k === 4 && subCount === 4) {
      const [v0, v1, v2, v3] = face.vertexIds;
      const top = getEdgeChain(v0, v1); // len = cuts + 2
      const right = getEdgeChain(v1, v2);
      const bottom = getEdgeChain(v3, v2); // same direction v0->v1
      const left = getEdgeChain(v0, v3);
      const n = cuts + 2;

      const grid: string[][] = Array.from({ length: n }, () =>
        new Array<string>(n),
      );

      for (let j = 0; j < n; j++) {
        grid[0][j] = top[j];
        grid[n - 1][j] = bottom[j];
      }
      for (let i = 0; i < n; i++) {
        grid[i][0] = left[i];
        grid[i][n - 1] = right[i];
      }

      // Interior grid vertices via Coons bilinear blend
      const p00 = mesh.getVertex(v0)!.position;
      const p01 = mesh.getVertex(v1)!.position;
      const p11 = mesh.getVertex(v2)!.position;
      const p10 = mesh.getVertex(v3)!.position;

      for (let i = 1; i < n - 1; i++) {
        const u = i / (n - 1);
        for (let j = 1; j < n - 1; j++) {
          const v = j / (n - 1);
          const pTop = mesh.getVertex(top[j])!.position;
          const pBot = mesh.getVertex(bottom[j])!.position;
          const pLeft = mesh.getVertex(left[i])!.position;
          const pRight = mesh.getVertex(right[i])!.position;

          const lr = lerpVec(pLeft, pRight, v);
          const tb = lerpVec(pTop, pBot, u);
          const bilin = lerpVec(lerpVec(p00, p01, v), lerpVec(p10, p11, v), u);
          const pos = subVec(addVec(lr, tb), bilin);
          const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
          grid[i][j] = nv.id;
          createdVertIds.push(nv.id);
        }
      }

      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n - 1; j++) {
          newFacesSpec.push({
            verts: [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]],
            select: isSelectedFace || subCount === 4,
          });
        }
      }
      continue;
    }

    // Case 2: Quad with 2 opposite edges subdivided -> cuts+1 quad strips
    if (
      k === 4 &&
      subCount === 2 &&
      ((edgeFlags[0] && edgeFlags[2]) || (edgeFlags[1] && edgeFlags[3]))
    ) {
      const [v0, v1, v2, v3] = face.vertexIds;
      if (edgeFlags[0] && edgeFlags[2]) {
        const top = getEdgeChain(v0, v1);
        const bot = getEdgeChain(v3, v2);
        for (let j = 0; j < top.length - 1; j++) {
          newFacesSpec.push({
            verts: [top[j], top[j + 1], bot[j + 1], bot[j]],
            select: isSelectedFace,
          });
        }
      } else {
        const left = getEdgeChain(v0, v3);
        const right = getEdgeChain(v1, v2);
        for (let i = 0; i < left.length - 1; i++) {
          newFacesSpec.push({
            verts: [left[i], right[i], right[i + 1], left[i + 1]],
            select: isSelectedFace,
          });
        }
      }
      continue;
    }

    // Case 3: Triangle with all 3 edges subdivided
    if (k === 3 && subCount === 3) {
      const [v0, v1, v2] = face.vertexIds;
      const e01 = getEdgeChain(v0, v1);
      const e02 = getEdgeChain(v0, v2);
      const e12 = getEdgeChain(v1, v2);
      const n = cuts + 2; // rows 0..n-1

      const rows: string[][] = [];
      for (let r = 0; r < n; r++) {
        const row: string[] = new Array(r + 1);
        row[0] = e02[r];
        row[r] = e01[r];
        if (r === n - 1) {
          for (let c = 0; c <= r; c++) row[c] = e12[r - c];
          // Ensure row[0] = v2 and row[r] = v1
          row[0] = v2;
          row[r] = v1;
          const e21 = getEdgeChain(v2, v1);
          for (let c = 0; c <= r; c++) row[c] = e21[c];
        } else if (r > 1) {
          const pLeft = mesh.getVertex(row[0])!.position;
          const pRight = mesh.getVertex(row[r])!.position;
          for (let c = 1; c < r; c++) {
            const p = lerpVec(pLeft, pRight, c / r);
            const nv = mesh.addVertex(p[0], p[1], p[2]);
            row[c] = nv.id;
            createdVertIds.push(nv.id);
          }
        }
        rows.push(row);
      }

      for (let r = 0; r < n - 1; r++) {
        for (let c = 0; c <= r; c++) {
          // Downward-pointing in (r,c) -> CCW matches [v0, v1, v2]
          newFacesSpec.push({
            verts: [rows[r][c], rows[r + 1][c + 1], rows[r + 1][c]],
            select: isSelectedFace || subCount === 3,
          });
          if (c < r) {
            newFacesSpec.push({
              verts: [rows[r][c], rows[r][c + 1], rows[r + 1][c + 1]],
              select: isSelectedFace || subCount === 3,
            });
          }
        }
      }
      continue;
    }

    // Case 4: N-gon with all edges subdivided -> center fan
    if (k >= 5 && subCount === k) {
      const centerPos = mesh.computeFaceCenter(face);
      const centerVert = mesh.addVertex(centerPos[0], centerPos[1], centerPos[2]);
      createdVertIds.push(centerVert.id);

      const perimeter: string[] = [];
      for (let i = 0; i < k; i++) {
        const chain = getEdgeChain(
          face.vertexIds[i],
          face.vertexIds[(i + 1) % k],
        );
        for (let j = 0; j < chain.length - 1; j++) {
          perimeter.push(chain[j]);
        }
      }

      const pLen = perimeter.length;
      for (let i = 0; i < pLen; i++) {
        newFacesSpec.push({
          verts: [perimeter[i], perimeter[(i + 1) % pLen], centerVert.id],
          select: isSelectedFace,
        });
      }
      continue;
    }

    // Case 5: Partial edge subdivision -> splice split vertices into polygon (no T-junctions)
    const expanded: string[] = [];
    for (let i = 0; i < k; i++) {
      const chain = getEdgeChain(
        face.vertexIds[i],
        face.vertexIds[(i + 1) % k],
      );
      for (let j = 0; j < chain.length - 1; j++) {
        expanded.push(chain[j]);
      }
    }
    newFacesSpec.push({ verts: expanded, select: isSelectedFace });
  }

  // 4. Delete original faces & subdivided edges, insert sub-edges for loose edges (like Circle) & new faces
  mesh.deleteFaces(facesToDelete);

  const looseEdgesToKeep: [string, string][] = [];
  for (const eid of edgeIdsToSubdivide) {
    const edge = mesh.getEdge(eid);
    if (!edge) continue;
    const chain = getEdgeChain(edge.v0, edge.v1);
    for (let i = 0; i < chain.length - 1; i++) {
      looseEdgesToKeep.push([chain[i], chain[i + 1]]);
    }
  }
  mesh.deleteEdges(edgeIdsToSubdivide);

  for (const [a, b] of looseEdgesToKeep) {
    const ne = mesh.addEdge(a, b);
    if (ne && mode === 'edge') nextSelected.add(ne.id);
  }

  for (const spec of newFacesSpec) {
    const nf = mesh.addFace(spec.verts);
    if (nf && mode === 'face' && spec.select) {
      nextSelected.add(nf.id);
    }
  }

  if (mode === 'vertex') {
    for (const vid of createdVertIds) nextSelected.add(vid);
  }

  return { mesh, nextSelectedIds: nextSelected };
}

/* ============================================================================
 * D. BEVEL — BISELAR (Aristas y Vértices)
 * ========================================================================== */
function evalProfileOffset(t: number, profile: number): number {
  // t in [0, 1] across bevel corner; returns radial bulge weight in [0, 1]
  // profile = 0.5 -> linear chamfer (0 bulge)
  // profile > 0.5 -> convex round
  // profile < 0.5 -> concave
  const arc = 4 * t * (1 - t); // 0 at ends, 1 at center
  return (profile - 0.5) * 0.7 * arc;
}

function sanitizePolygonVerts(
  mesh: EditableMesh,
  vertIds: string[],
): string[] | null {
  const collapsed: string[] = [];
  for (const vid of vertIds) {
    if (!mesh.getVertex(vid)) continue;
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== vid) {
      collapsed.push(vid);
    }
  }
  if (collapsed.length > 1 && collapsed[0] === collapsed[collapsed.length - 1]) {
    collapsed.pop();
  }
  if (collapsed.length < 3 || new Set(collapsed).size < 3) {
    return null;
  }

  // Compute Newell area vector magnitude to reject degenerate zero-area faces
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < collapsed.length; i++) {
    const a = mesh.getVertex(collapsed[i])!.position;
    const b = mesh.getVertex(collapsed[(i + 1) % collapsed.length])!.position;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  if (Math.hypot(nx, ny, nz) < 1e-10) {
    return null;
  }
  return collapsed;
}

function canonicalFaceVertexSetKey(vertIds: string[]): string {
  return [...new Set(vertIds)].sort().join('|');
}

function computePolygonNewellNormal(
  mesh: EditableMesh,
  vertIds: string[],
): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertIds.length; i++) {
    const a = mesh.getVertex(vertIds[i])?.position;
    const b = mesh.getVertex(vertIds[(i + 1) % vertIds.length])?.position;
    if (!a || !b) continue;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normVec([nx, ny, nz], [0, 0, 1]);
}

function repairBevelTopology(
  mesh: EditableMesh,
  bevelScopeVertIds: Set<string>,
  mode: EditSelectionMode,
  nextSelected: Set<string>,
): void {
  const weldEps = 1e-5;
  const vertRemap = new Map<string, string>();
  const scopeList = Array.from(bevelScopeVertIds).filter((id) =>
    Boolean(mesh.getVertex(id)),
  );

  // 1. Tight epsilon weld restricted strictly to bevel-created / touched vertices
  for (let i = 0; i < scopeList.length; i++) {
    const vidA = scopeList[i];
    if (vertRemap.has(vidA)) continue;
    const vA = mesh.getVertex(vidA);
    if (!vA) continue;
    for (let j = i + 1; j < scopeList.length; j++) {
      const vidB = scopeList[j];
      if (vertRemap.has(vidB)) continue;
      const vB = mesh.getVertex(vidB);
      if (!vB) continue;
      if (lenVec(subVec(vA.position, vB.position)) <= weldEps) {
        vertRemap.set(vidB, vidA);
      }
    }
  }

  if (vertRemap.size > 0) {
    for (const edge of mesh.edges) {
      edge.v0 = vertRemap.get(edge.v0) ?? edge.v0;
      edge.v1 = vertRemap.get(edge.v1) ?? edge.v1;
    }
    for (const face of mesh.faces) {
      face.vertexIds = face.vertexIds.map((vid) => vertRemap.get(vid) ?? vid);
    }
    mesh.vertices = mesh.vertices.filter((v) => !vertRemap.has(v.id));
    if (mode === 'vertex') {
      const remappedSel = new Set<string>();
      for (const id of nextSelected) {
        remappedSel.add(vertRemap.get(id) ?? id);
      }
      nextSelected.clear();
      for (const id of remappedSel) nextSelected.add(id);
    }
  }

  // 2. Deduplicate faces and remove any degenerate / invalid polygons
  const seenFaceKeys = new Set<string>();
  const cleanFaces: MeshFace[] = [];
  const faceRemap = new Map<string, string>();
  for (const face of mesh.faces) {
    const cleanVerts = sanitizePolygonVerts(mesh, face.vertexIds);
    if (!cleanVerts) continue;
    const setKey = canonicalFaceVertexSetKey(cleanVerts);
    const existing = seenFaceKeys.has(setKey);
    if (existing) {
      const keeper = cleanFaces.find(
        (cf) => canonicalFaceVertexSetKey(cf.vertexIds) === setKey,
      );
      if (keeper) faceRemap.set(face.id, keeper.id);
      continue;
    }
    seenFaceKeys.add(setKey);
    face.vertexIds = cleanVerts;
    cleanFaces.push(face);
    faceRemap.set(face.id, face.id);
  }
  mesh.faces = cleanFaces;

  if (mode === 'face') {
    const nextFaceSel = new Set<string>();
    for (const id of nextSelected) {
      const mapped = faceRemap.get(id);
      if (mapped) nextFaceSel.add(mapped);
    }
    nextSelected.clear();
    for (const id of nextFaceSel) nextSelected.add(id);
  }

  // 3. Deduplicate edges, drop self-loops / dangling edges, ensure every face edge exists
  const edgeMapByKey = new Map<string, string>();
  const cleanEdges = [];
  const edgeRemap = new Map<string, string>();

  for (const edge of mesh.edges) {
    if (edge.v0 === edge.v1) continue;
    if (!mesh.getVertex(edge.v0) || !mesh.getVertex(edge.v1)) continue;
    const key = canonicalEdgeKey(edge.v0, edge.v1);
    const existingId = edgeMapByKey.get(key);
    if (existingId) {
      edgeRemap.set(edge.id, existingId);
      continue;
    }
    edgeMapByKey.set(key, edge.id);
    edgeRemap.set(edge.id, edge.id);
    cleanEdges.push(edge);
  }
  mesh.edges = cleanEdges;

  if (mode === 'edge') {
    const nextEdgeSel = new Set<string>();
    for (const id of nextSelected) {
      const mapped = edgeRemap.get(id);
      if (mapped) nextEdgeSel.add(mapped);
    }
    nextSelected.clear();
    for (const id of nextEdgeSel) nextSelected.add(id);
  }

  mesh.clearCustomNormals();
  mesh.rebuildIndices();

  // Ensure every face loop edge exists in mesh.edges
  for (const face of mesh.faces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      mesh.addEdge(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
    }
  }

  mesh.pruneOrphanVertices(bevelScopeVertIds);
  mesh.clearCustomNormals();
  mesh.rebuildIndices();

  // Prune any stale IDs from nextSelected
  for (const id of Array.from(nextSelected)) {
    const valid =
      (mode === 'vertex' && Boolean(mesh.getVertex(id))) ||
      (mode === 'edge' && Boolean(mesh.getEdge(id))) ||
      (mode === 'face' && Boolean(mesh.getFace(id)));
    if (!valid) {
      nextSelected.delete(id);
    }
  }
}

export function bevelMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  params: BevelParams,
): MeshOperatorResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();
  const width = Math.max(0.01, Math.min(1.5, params.width));
  const segments = Math.max(1, Math.min(5, Math.round(params.segments)));
  const profile = Math.max(0.1, Math.min(1.0, params.profile));

  if (selectedIds.size === 0) {
    return { mesh, nextSelectedIds: nextSelected };
  }

  // VERTEX BEVEL
  if (mode === 'vertex') {
    const targetVertIds = Array.from(selectedIds).filter((id) =>
      Boolean(mesh.getVertex(id)),
    );
    const bevelScopeVerts = new Set<string>();
    for (const vid of targetVertIds) {
      const centerVert = mesh.getVertex(vid);
      if (!centerVert) continue;
      const origPos = [...centerVert.position] as Vec3;
      const incEdgeIds = mesh.getEdgesForVertex(vid);
      if (incEdgeIds.length < 2) continue;
      bevelScopeVerts.add(vid);

      const incFaceIds = mesh.getFacesForVertex(vid);
      const origNormal = normVec(
        incFaceIds.reduce<Vec3>(
          (acc, fid) => {
            const f = mesh.getFace(fid);
            if (!f) return acc;
            return addVec(acc, mesh.computeFaceNormal(f));
          },
          [0, 0, 0],
        ),
        [0, 0, 1],
      );

      // For each neighbor u along an incident edge, create a beveled rail vertex
      const neighborToNewVert = new Map<string, string>();
      for (const eid of incEdgeIds) {
        const edge = mesh.getEdge(eid);
        if (!edge) continue;
        const neighborId = edge.v0 === vid ? edge.v1 : edge.v0;
        const nv = mesh.getVertex(neighborId);
        if (!nv) continue;
        const diff = subVec(nv.position, origPos);
        const edgeLen = lenVec(diff);
        if (edgeLen < 1e-6) continue;
        const d = params.clampOverlap
          ? Math.min(width, edgeLen * 0.45)
          : Math.min(width, edgeLen * 0.9);
        const pos = addVec(origPos, scaleVec(normVec(diff), d));
        const created = mesh.addVertex(pos[0], pos[1], pos[2]);
        neighborToNewVert.set(neighborId, created.id);
        bevelScopeVerts.add(created.id);
      }

      // Update incident faces by replacing vid with [prevNew, nextNew]
      const cornerLinks = new Map<string, string>(); // nextNew -> prevNew (outward cap direction)
      const facesToReplace: { oldId: string; verts: string[] }[] = [];

      for (const fid of incFaceIds) {
        const face = mesh.getFace(fid);
        if (!face) continue;
        const idx = face.vertexIds.indexOf(vid);
        if (idx === -1) continue;
        const k = face.vertexIds.length;
        const prevId = face.vertexIds[(idx - 1 + k) % k];
        const nextId = face.vertexIds[(idx + 1) % k];
        const pPrev = neighborToNewVert.get(prevId);
        const pNext = neighborToNewVert.get(nextId);
        if (!pPrev || !pNext) continue;

        const updatedVerts = [
          ...face.vertexIds.slice(0, idx),
          pPrev,
          pNext,
          ...face.vertexIds.slice(idx + 1),
        ];
        facesToReplace.push({ oldId: fid, verts: updatedVerts });
        cornerLinks.set(pNext, pPrev);
      }

      const oldFaceSet = new Set(facesToReplace.map((f) => f.oldId));
      mesh.deleteFaces(oldFaceSet);
      for (const f of facesToReplace) {
        const clean = sanitizePolygonVerts(mesh, f.verts);
        if (clean) mesh.addFace(clean);
      }

      // Build cap polygon around vid by walking cornerLinks
      if (cornerLinks.size >= 3) {
        let orderedCap: string[] = [];
        const start = cornerLinks.keys().next().value as string;
        let curr: string | undefined = start;
        const visited = new Set<string>();
        while (curr && !visited.has(curr) && orderedCap.length <= cornerLinks.size) {
          visited.add(curr);
          orderedCap.push(curr);
          curr = cornerLinks.get(curr);
        }

        if (orderedCap.length >= 3) {
          const capNorm = computePolygonNewellNormal(mesh, orderedCap);
          if (dotVec(capNorm, origNormal) < 0) {
            orderedCap = [...orderedCap].reverse();
          }

          if (segments === 1) {
            const cap = mesh.addFace(orderedCap);
            if (cap) {
              for (const cv of orderedCap) nextSelected.add(cv);
            }
          } else {
            // Multi-segment radial bevel dome toward origPos
            const rings: string[][] = [orderedCap];
            for (let s = 1; s < segments; s++) {
              const t = s / segments;
              const ring: string[] = [];
              for (const rv of orderedCap) {
                const p = mesh.getVertex(rv)!.position;
                const bulge = evalProfileOffset(t * 0.5, profile);
                const interp = lerpVec(p, origPos, t * (1 - bulge));
                const nv = mesh.addVertex(interp[0], interp[1], interp[2]);
                ring.push(nv.id);
                bevelScopeVerts.add(nv.id);
              }
              rings.push(ring);
            }
            const centerTop = lerpVec(
              mesh.computeCentroid(orderedCap) ?? origPos,
              origPos,
              Math.max(0, profile - 0.15),
            );
            const apex = mesh.addVertex(centerTop[0], centerTop[1], centerTop[2]).id;
            bevelScopeVerts.add(apex);

            for (let r = 0; r < rings.length - 1; r++) {
              const outer = rings[r];
              const inner = rings[r + 1];
              for (let i = 0; i < outer.length; i++) {
                const ni = (i + 1) % outer.length;
                mesh.addFace([outer[i], outer[ni], inner[ni], inner[i]]);
              }
            }
            const lastRing = rings[rings.length - 1];
            for (let i = 0; i < lastRing.length; i++) {
              const ni = (i + 1) % lastRing.length;
              mesh.addFace([lastRing[i], lastRing[ni], apex]);
            }
            for (const rv of orderedCap) nextSelected.add(rv);
            nextSelected.add(apex);
          }
        }
      }

      mesh.deleteVertices(new Set([vid]));
    }

    repairBevelTopology(mesh, bevelScopeVerts, mode, nextSelected);
    return { mesh, nextSelectedIds: nextSelected };
  }

  // EDGE BEVEL (also supports Face mode by beveling manifold edges of selected faces)
  const bevelEdgeIds = new Set<string>();
  if (mode === 'edge') {
    for (const eid of selectedIds) {
      if (mesh.getEdge(eid) && mesh.getFacesForEdge(eid).length === 2) {
        bevelEdgeIds.add(eid);
      }
    }
  } else if (mode === 'face') {
    for (const fid of selectedIds) {
      for (const eid of mesh.getEdgesForFace(fid)) {
        if (mesh.getFacesForEdge(eid).length === 2) {
          bevelEdgeIds.add(eid);
        }
      }
    }
  }

  if (bevelEdgeIds.size === 0) {
    return { mesh, nextSelectedIds: new Set(selectedIds) };
  }

  const bevelEdgeKeys = new Set<string>();
  const touchedVertices = new Set<string>();
  const bevelScopeVerts = new Set<string>();
  const origVertexNormals = new Map<string, Vec3>();

  for (const eid of bevelEdgeIds) {
    const e = mesh.getEdge(eid);
    if (!e) continue;
    bevelEdgeKeys.add(canonicalEdgeKey(e.v0, e.v1));
    touchedVertices.add(e.v0);
    touchedVertices.add(e.v1);
    bevelScopeVerts.add(e.v0);
    bevelScopeVerts.add(e.v1);
  }

  for (const vid of touchedVertices) {
    const sum = mesh.getFacesForVertex(vid).reduce<Vec3>(
      (acc, fid) => {
        const f = mesh.getFace(fid);
        return f ? addVec(acc, mesh.computeFaceNormal(f)) : acc;
      },
      [0, 0, 0],
    );
    origVertexNormals.set(vid, normVec(sum, [0, 0, 1]));
  }

  // For each touched vertex v, compute corner positions inside each face incident to v
  // Key: `${vid}::${faceId}` -> vertex ID
  const cornerVertexMap = new Map<string, string>();
  // Cache split point on each NON-beveled edge touching v so adjacent non-beveled faces share the same split vertex
  // Key: `${vid}::edge::${nonBevelEdgeId}` -> vertex ID
  const nonBevelEdgeSplitMap = new Map<string, string>();

  const getOrCreateNonBevelSplit = (vid: string, eid: string): string => {
    const mapKey = `${vid}::edge::${eid}`;
    const existing = nonBevelEdgeSplitMap.get(mapKey);
    if (existing) return existing;
    const edge = mesh.getEdge(eid)!;
    const vPos = mesh.getVertex(vid)!.position;
    const otherId = edge.v0 === vid ? edge.v1 : edge.v0;
    const otherPos = mesh.getVertex(otherId)!.position;
    const diff = subVec(otherPos, vPos);
    const elen = lenVec(diff);
    const d = params.clampOverlap
      ? Math.min(width, elen * 0.45)
      : Math.min(width, elen * 0.85);
    const pos = addVec(vPos, scaleVec(normVec(diff), d));
    const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
    nonBevelEdgeSplitMap.set(mapKey, nv.id);
    bevelScopeVerts.add(nv.id);
    return nv.id;
  };

  // Track directed links across non-beveled faces at touched vertices (for closing fans / degree>=4 corners)
  // For vid -> directed edge splitIn -> splitOut created inside faces whose neither incident edge at vid is beveled
  const vertexFanLinks = new Map<string, [string, string][]>();

  // For every face touching a touched vertex, compute its corner replacement vertex sequence
  const faceReplacements = new Map<string, string[]>();
  const facesToDelete = new Set<string>();
  const cornerTrianglesToBuild: {
    vid: string;
    vertIds: string[];
  }[] = [];

  for (const face of mesh.faces) {
    const k = face.vertexIds.length;
    let touchesBevel = false;
    for (const vid of face.vertexIds) {
      if (touchedVertices.has(vid)) {
        touchesBevel = true;
        break;
      }
    }
    if (!touchesBevel) continue;

    facesToDelete.add(face.id);
    const newVerts: string[] = [];

    for (let i = 0; i < k; i++) {
      const vid = face.vertexIds[i];
      if (!touchedVertices.has(vid)) {
        newVerts.push(vid);
        continue;
      }

      const prevId = face.vertexIds[(i - 1 + k) % k];
      const nextId = face.vertexIds[(i + 1) % k];
      const eInId = mesh.findEdgeId(prevId, vid);
      const eOutId = mesh.findEdgeId(vid, nextId);
      const inBeveled = eInId ? bevelEdgeKeys.has(canonicalEdgeKey(prevId, vid)) : false;
      const outBeveled = eOutId ? bevelEdgeKeys.has(canonicalEdgeKey(vid, nextId)) : false;

      if (inBeveled && outBeveled) {
        // Both edges of this face at vid are beveled -> create 1 interior offset corner vertex
        const vPos = mesh.getVertex(vid)!.position;
        const pPrev = mesh.getVertex(prevId)!.position;
        const pNext = mesh.getVertex(nextId)!.position;
        const d1 = normVec(subVec(pPrev, vPos));
        const d2 = normVec(subVec(pNext, vPos));
        const len1 = lenVec(subVec(pPrev, vPos));
        const len2 = lenVec(subVec(pNext, vPos));

        const cosA = Math.max(-0.95, Math.min(0.95, dotVec(d1, d2)));
        const sinHalf = Math.sqrt(Math.max(0.05, (1 - cosA) / 2));
        const bisector = normVec(addVec(d1, d2), d1);
        const maxMove = params.clampOverlap
          ? Math.min(len1, len2) * 0.45
          : Math.min(len1, len2) * 0.85;
        const moveDist = Math.min(maxMove, width / sinHalf);
        const pos = addVec(vPos, scaleVec(bisector, moveDist));
        const cornerV = mesh.addVertex(pos[0], pos[1], pos[2]);
        bevelScopeVerts.add(cornerV.id);
        cornerVertexMap.set(`${vid}::${face.id}`, cornerV.id);
        newVerts.push(cornerV.id);
      } else if (inBeveled && !outBeveled && eOutId) {
        // Slide along outgoing non-beveled edge
        const splitV = getOrCreateNonBevelSplit(vid, eOutId);
        cornerVertexMap.set(`${vid}::${face.id}`, splitV);
        newVerts.push(splitV);
      } else if (!inBeveled && outBeveled && eInId) {
        // Slide along incoming non-beveled edge
        const splitV = getOrCreateNonBevelSplit(vid, eInId);
        cornerVertexMap.set(`${vid}::${face.id}`, splitV);
        newVerts.push(splitV);
      } else if (eInId && eOutId) {
        // Neither eIn nor eOut is beveled, yet vid has a beveled edge elsewhere
        const splitIn = getOrCreateNonBevelSplit(vid, eInId);
        const splitOut = getOrCreateNonBevelSplit(vid, eOutId);
        if (splitIn !== splitOut) {
          newVerts.push(splitIn, splitOut);
          if (!vertexFanLinks.has(vid)) vertexFanLinks.set(vid, []);
          vertexFanLinks.get(vid)!.push([splitIn, splitOut]);
        } else {
          newVerts.push(splitIn);
        }
      } else {
        newVerts.push(vid);
      }
    }

    faceReplacements.set(face.id, newVerts);
  }

  // Track edges touching touchedVertices that had faces before, to prune dead old edges afterward
  const candidateOldEdgesHadFaces = new Set<string>();
  for (const vid of touchedVertices) {
    for (const eid of mesh.getEdgesForVertex(vid)) {
      if (mesh.getFacesForEdge(eid).length > 0) {
        candidateOldEdgesHadFaces.add(eid);
      }
    }
  }

  // Create bevel strips along each beveled edge (with optional segments + profile)
  const bevelFaceSpecs: string[][] = [];
  // Map `${vid}` -> list of directed rail chains [rail0, rail1, ..., railSegments] around beveled edges
  const vertexCornerChains = new Map<string, string[][]>();

  for (const eid of bevelEdgeIds) {
    const edge = mesh.getEdge(eid);
    if (!edge) continue;
    const adjFaces = mesh.getFacesForEdge(eid);
    if (adjFaces.length !== 2) continue;

    // Identify fForward (traverses v0 -> v1) and fBackward (traverses v1 -> v0)
    let fForward: MeshFace | null = null;
    let fBackward: MeshFace | null = null;
    for (const fid of adjFaces) {
      const f = mesh.getFace(fid);
      if (!f) continue;
      const idx = f.vertexIds.indexOf(edge.v0);
      if (idx !== -1) {
        const nextV = f.vertexIds[(idx + 1) % f.vertexIds.length];
        if (nextV === edge.v1) fForward = f;
        else fBackward = f;
      }
    }
    if (!fForward || !fBackward) continue;

    const uF = cornerVertexMap.get(`${edge.v0}::${fForward.id}`);
    const vF = cornerVertexMap.get(`${edge.v1}::${fForward.id}`);
    const uB = cornerVertexMap.get(`${edge.v0}::${fBackward.id}`);
    const vB = cornerVertexMap.get(`${edge.v1}::${fBackward.id}`);
    if (!uF || !vF || !uB || !vB) continue;

    let railsU: string[];
    let railsV: string[];

    if (segments === 1) {
      railsU = [uB, uF];
      railsV = [vB, vF];
      bevelFaceSpecs.push([uB, vB, vF, uF]);
    } else {
      const origU = mesh.getVertex(edge.v0)!.position;
      const origV = mesh.getVertex(edge.v1)!.position;
      const pUF = mesh.getVertex(uF)!.position;
      const pUB = mesh.getVertex(uB)!.position;
      const pVF = mesh.getVertex(vF)!.position;
      const pVB = mesh.getVertex(vB)!.position;

      const uMidPush = subVec(origU, lerpVec(pUB, pUF, 0.5));
      const vMidPush = subVec(origV, lerpVec(pVB, pVF, 0.5));

      railsU = [uB];
      railsV = [vB];

      for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const bulge = evalProfileOffset(t, profile) * 1.4;
        const posU = addVec(lerpVec(pUB, pUF, t), scaleVec(uMidPush, bulge));
        const posV = addVec(lerpVec(pVB, pVF, t), scaleVec(vMidPush, bulge));
        const nu = mesh.addVertex(posU[0], posU[1], posU[2]).id;
        const nv = mesh.addVertex(posV[0], posV[1], posV[2]).id;
        bevelScopeVerts.add(nu);
        bevelScopeVerts.add(nv);
        railsU.push(nu);
        railsV.push(nv);
      }
      railsU.push(uF);
      railsV.push(vF);

      for (let s = 0; s < segments; s++) {
        bevelFaceSpecs.push([railsU[s], railsV[s], railsV[s + 1], railsU[s + 1]]);
      }
    }

    if (uF !== uB) {
      if (!vertexCornerChains.has(edge.v0)) vertexCornerChains.set(edge.v0, []);
      vertexCornerChains.get(edge.v0)!.push([...railsU].reverse());
    }
    if (vF !== vB) {
      if (!vertexCornerChains.has(edge.v1)) vertexCornerChains.set(edge.v1, []);
      vertexCornerChains.get(edge.v1)!.push([...railsV]);
    }
  }

  // Helper: splice multi-segment rail intermediates into an adjacent face replacement containing endpoints (a, b)
  const spliceChainIntoAdjacentFace = (chain: string[]): boolean => {
    if (chain.length <= 2) return false;
    const endA = chain[0];
    const endB = chain[chain.length - 1];
    const mids = chain.slice(1, -1);
    let spliced = false;

    for (const [fid, verts] of faceReplacements.entries()) {
      const m = verts.length;
      for (let i = 0; i < m; i++) {
        const va = verts[i];
        const vb = verts[(i + 1) % m];
        if (va === endA && vb === endB) {
          faceReplacements.set(fid, [
            ...verts.slice(0, i + 1),
            ...mids,
            ...verts.slice(i + 1),
          ]);
          spliced = true;
          break;
        }
        if (va === endB && vb === endA) {
          faceReplacements.set(fid, [
            ...verts.slice(0, i + 1),
            ...[...mids].reverse(),
            ...verts.slice(i + 1),
          ]);
          spliced = true;
          break;
        }
      }
    }
    return spliced;
  };

  // Build closed corner loops / splice end-caps around every vertex reached by bevel rails
  for (const [vid, chains] of vertexCornerChains.entries()) {
    const fanLinks = vertexFanLinks.get(vid) ?? [];

    // Case 1: Only 1 beveled rail meets this vertex (end-cap of single beveled edge / open end)
    if (chains.length === 1) {
      const chain = chains[0];
      const endA = chain[0];
      const endB = chain[chain.length - 1];

      // Check if an adjacent non-beveled face already directly shares edge (endA, endB)
      if (fanLinks.length <= 1) {
        const spliced = spliceChainIntoAdjacentFace(chain);
        if (spliced || chain.length <= 2) {
          continue;
        }
      }

      // Otherwise (degree >= 4 vertex where non-beveled fan spans >= 2 faces), close the cap polygon
      const fullChains: string[][] = [chain, ...fanLinks.map(([a, b]) => [b, a])];
      const unused = new Set<number>(fullChains.map((_, idx) => idx));
      unused.delete(0);
      const loop: string[] = [...chain];
      let curr = endB;
      while (curr !== endA && unused.size > 0) {
        let foundIdx = -1;
        let reverseMatch = false;
        for (const idx of unused) {
          const c = fullChains[idx];
          if (c[0] === curr) {
            foundIdx = idx;
            reverseMatch = false;
            break;
          }
          if (c[c.length - 1] === curr) {
            foundIdx = idx;
            reverseMatch = true;
            break;
          }
        }
        if (foundIdx === -1) break;
        unused.delete(foundIdx);
        const seg = reverseMatch ? [...fullChains[foundIdx]].reverse() : fullChains[foundIdx];
        for (let i = 1; i < seg.length; i++) {
          loop.push(seg[i]);
        }
        curr = loop[loop.length - 1];
      }
      if (loop.length >= 2 && loop[loop.length - 1] === loop[0]) {
        loop.pop();
      }
      if (loop.length >= 3 && new Set(loop).size >= 3) {
        const origN = origVertexNormals.get(vid) ?? [0, 0, 1];
        const polyN = computePolygonNewellNormal(mesh, loop);
        const oriented = dotVec(polyN, origN) < 0 ? [...loop].reverse() : loop;
        cornerTrianglesToBuild.push({ vid, vertIds: oriented });
      }
      continue;
    }

    // Case 2: >= 2 beveled rails meet this vertex
    // Include any non-beveled fan links so open degree>=4 2-edge corners also close properly
    const combinedArcs: string[][] = [
      ...chains,
      ...fanLinks.map(([a, b]) => [b, a]),
    ];

    const unused = new Set<number>(combinedArcs.map((_, idx) => idx));
    unused.delete(0);
    const orderedPerimeter: string[] = [];
    const startVert = combinedArcs[0][0];
    for (let i = 0; i < combinedArcs[0].length - 1; i++) {
      orderedPerimeter.push(combinedArcs[0][i]);
    }
    let currEnd = combinedArcs[0][combinedArcs[0].length - 1];

    while (currEnd !== startVert && unused.size > 0) {
      let foundIdx = -1;
      let reversed = false;
      // Prefer beveled chains first so 2-chain corner lenses close directly
      for (const idx of unused) {
        if (idx >= chains.length) continue;
        const ch = combinedArcs[idx];
        if (ch[0] === currEnd) {
          foundIdx = idx;
          reversed = false;
          break;
        }
        if (ch[ch.length - 1] === currEnd) {
          foundIdx = idx;
          reversed = true;
          break;
        }
      }
      if (foundIdx === -1) {
        for (const idx of unused) {
          const ch = combinedArcs[idx];
          if (ch[0] === currEnd) {
            foundIdx = idx;
            reversed = false;
            break;
          }
          if (ch[ch.length - 1] === currEnd) {
            foundIdx = idx;
            reversed = true;
            break;
          }
        }
      }
      if (foundIdx === -1) break;
      unused.delete(foundIdx);
      const seg = reversed ? [...combinedArcs[foundIdx]].reverse() : combinedArcs[foundIdx];
      for (let i = 0; i < seg.length - 1; i++) {
        orderedPerimeter.push(seg[i]);
      }
      currEnd = seg[seg.length - 1];
    }

    if (
      currEnd === startVert &&
      orderedPerimeter.length >= 3 &&
      new Set(orderedPerimeter).size >= 3
    ) {
      const origN = origVertexNormals.get(vid) ?? [0, 0, 1];
      const rawNorm = computePolygonNewellNormal(mesh, orderedPerimeter);
      const outwardLoop =
        dotVec(rawNorm, origN) < 0
          ? [...orderedPerimeter].reverse()
          : orderedPerimeter;

      if (segments === 1 || chains.length === 2) {
        if (segments > 1 && outwardLoop.length >= 4 && chains.length >= 3) {
          const origVPos = mesh.getVertex(vid)?.position ?? [0, 0, 0];
          const loopCenter = mesh.computeCentroid(outwardLoop) ?? origVPos;
          const centerPos = lerpVec(
            loopCenter,
            origVPos,
            Math.max(0, Math.min(0.95, profile * 0.85)),
          );
          const centerV = mesh.addVertex(centerPos[0], centerPos[1], centerPos[2]);
          bevelScopeVerts.add(centerV.id);
          const plen = outwardLoop.length;
          for (let i = 0; i < plen; i++) {
            cornerTrianglesToBuild.push({
              vid,
              vertIds: [outwardLoop[i], outwardLoop[(i + 1) % plen], centerV.id],
            });
          }
        } else {
          cornerTrianglesToBuild.push({ vid, vertIds: outwardLoop });
        }
      } else {
        const origVPos = mesh.getVertex(vid)?.position ?? [0, 0, 0];
        const loopCenter = mesh.computeCentroid(outwardLoop) ?? origVPos;
        const centerPos = lerpVec(
          loopCenter,
          origVPos,
          Math.max(0, Math.min(0.95, profile * 0.85)),
        );
        const centerV = mesh.addVertex(centerPos[0], centerPos[1], centerPos[2]);
        bevelScopeVerts.add(centerV.id);
        const plen = outwardLoop.length;
        for (let i = 0; i < plen; i++) {
          cornerTrianglesToBuild.push({
            vid,
            vertIds: [outwardLoop[i], outwardLoop[(i + 1) % plen], centerV.id],
          });
        }
      }
    }
  }

  // Apply face deletions and additions
  mesh.deleteFaces(facesToDelete);
  mesh.deleteEdges(bevelEdgeIds);

  const existingFaceKeys = new Set<string>(
    mesh.faces.map((f) => canonicalFaceVertexSetKey(f.vertexIds)),
  );

  for (const verts of faceReplacements.values()) {
    const clean = sanitizePolygonVerts(mesh, verts);
    if (!clean) continue;
    const key = canonicalFaceVertexSetKey(clean);
    if (existingFaceKeys.has(key)) continue;
    existingFaceKeys.add(key);
    mesh.addFace(clean);
  }

  for (const verts of bevelFaceSpecs) {
    const clean = sanitizePolygonVerts(mesh, verts);
    if (!clean) continue;
    const key = canonicalFaceVertexSetKey(clean);
    if (existingFaceKeys.has(key)) continue;
    existingFaceKeys.add(key);
    const nf = mesh.addFace(clean);
    if (nf && mode === 'face') nextSelected.add(nf.id);
    if (nf && mode === 'edge') {
      for (const eid of mesh.getEdgesForFace(nf.id)) nextSelected.add(eid);
    }
  }

  for (const corner of cornerTrianglesToBuild) {
    const clean = sanitizePolygonVerts(mesh, corner.vertIds);
    if (!clean) continue;
    const key = canonicalFaceVertexSetKey(clean);
    if (existingFaceKeys.has(key)) continue;
    existingFaceKeys.add(key);
    const nf = mesh.addFace(clean);
    if (nf && mode === 'face') nextSelected.add(nf.id);
  }

  // Clean up old incident edges that lost all their faces due to vertex splitting
  const deadOldEdges = new Set<string>();
  for (const eid of candidateOldEdgesHadFaces) {
    if (mesh.getEdge(eid) && mesh.getFacesForEdge(eid).length === 0) {
      deadOldEdges.add(eid);
    }
  }
  if (deadOldEdges.size > 0) {
    mesh.deleteEdges(deadOldEdges);
  }
  mesh.pruneOrphanVertices(touchedVertices);

  // Automatic targeted sanitization & repair strictly on bevel-touched/new elements
  repairBevelTopology(mesh, bevelScopeVerts, mode, nextSelected);

  return { mesh, nextSelectedIds: nextSelected };
}

/* ============================================================================
 * E. LOOP CUT — Re-exported from ./loopCut
 * ========================================================================== */

/* ============================================================================
 * F. MERGE — FUSIONAR VÉRTICES
 * ========================================================================== */
export function mergeVerticesMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  params: MergeParams,
): MeshOperatorResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();

  const orderedVertIds: string[] = [];
  if (mode === 'vertex') {
    for (const vid of selectedIds) {
      if (mesh.getVertex(vid)) orderedVertIds.push(vid);
    }
  } else {
    const vertSet = mesh.getVertexIdsFromSelection(mode, selectedIds);
    for (const vid of vertSet) orderedVertIds.push(vid);
  }

  if (orderedVertIds.length < 2) {
    if (orderedVertIds.length === 1) nextSelected.add(orderedVertIds[0]);
    return { mesh, nextSelectedIds: nextSelected };
  }

  const mergeSet = new Set(orderedVertIds);
  let keepId = orderedVertIds[0];
  let targetPos: Vec3 = mesh.computeCentroid(orderedVertIds) ?? [0, 0, 0];

  if (params.mode === 'first') {
    keepId = orderedVertIds[0];
    targetPos = [...mesh.getVertex(keepId)!.position];
  } else if (params.mode === 'last') {
    keepId = orderedVertIds[orderedVertIds.length - 1];
    targetPos = [...mesh.getVertex(keepId)!.position];
  } else if (params.mode === 'cursor' && params.cursorPosition) {
    targetPos = [...params.cursorPosition];
  }

  const keepVert = mesh.getVertex(keepId)!;
  keepVert.position = [targetPos[0], targetPos[1], targetPos[2]];

  // Remap edges
  for (const edge of mesh.edges) {
    if (mergeSet.has(edge.v0)) edge.v0 = keepId;
    if (mergeSet.has(edge.v1)) edge.v1 = keepId;
  }

  // Remap faces and collapse consecutive duplicates
  const nextFaces: MeshFace[] = [];
  for (const face of mesh.faces) {
    const remapped = face.vertexIds.map((vid) =>
      mergeSet.has(vid) ? keepId : vid,
    );
    const collapsed: string[] = [];
    for (const vid of remapped) {
      if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== vid) {
        collapsed.push(vid);
      }
    }
    if (collapsed.length > 1 && collapsed[0] === collapsed[collapsed.length - 1]) {
      collapsed.pop();
    }
    // Also ensure keepId doesn't create a bow-tie pinch inside the same face
    const uniqueCount = new Set(collapsed).size;
    if (collapsed.length >= 3 && uniqueCount >= 3) {
      face.vertexIds = collapsed;
      nextFaces.push(face);
    }
  }
  mesh.faces = nextFaces;

  // Remove merged vertices except keepId
  mesh.vertices = mesh.vertices.filter(
    (v) => v.id === keepId || !mergeSet.has(v.id),
  );
  mesh.rebuildIndices();

  if (mode === 'vertex') {
    nextSelected.add(keepId);
  }
  mesh.clearCustomNormals();
  mesh.rebuildIndices();
  return { mesh, nextSelectedIds: nextSelected };
}

/* ============================================================================
 * F2. MERGE BY DISTANCE — FUSIONAR POR DISTANCIA (Limpieza y soldado espacial)
 * ========================================================================== */
export function mergeByDistanceMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  params: MergeByDistanceParams,
): MergeByDistanceResult {
  const mesh = sourceMesh.clone();
  const dist = Math.max(0, Math.min(2.0, Number(params.distance) || 0));
  const useWholeMesh = params.scope === 'all' || selectedIds.size === 0;

  const candidateVertIds: string[] = [];
  if (useWholeMesh) {
    for (const v of mesh.vertices) candidateVertIds.push(v.id);
  } else {
    const selVerts = mesh.getVertexIdsFromSelection(mode, selectedIds);
    for (const v of mesh.vertices) {
      if (selVerts.has(v.id)) candidateVertIds.push(v.id);
    }
  }

  if (candidateVertIds.length < 2) {
    return {
      mesh,
      nextSelectedIds: new Set(selectedIds),
      mergedCount: 0,
    };
  }

  const cellSize = Math.max(dist, 1e-6);
  const grid = new Map<string, string[]>();
  const cellCoords = (p: Vec3): [number, number, number] => [
    Math.floor(p[0] / cellSize),
    Math.floor(p[1] / cellSize),
    Math.floor(p[2] / cellSize),
  ];
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (const vid of candidateVertIds) {
    const v = mesh.getVertex(vid);
    if (!v) continue;
    const [cx, cy, cz] = cellCoords(v.position);
    const key = cellKey(cx, cy, cz);
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(vid);
  }

  const vertRemap = new Map<string, string>();
  const visited = new Set<string>();
  const distSqLimit = dist * dist + 1e-12;
  let mergedCount = 0;

  for (const anchorId of candidateVertIds) {
    if (visited.has(anchorId)) continue;
    const anchorVert = mesh.getVertex(anchorId);
    if (!anchorVert) continue;

    visited.add(anchorId);
    const [cx, cy, cz] = cellCoords(anchorVert.position);
    const members: string[] = [anchorId];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const otherId of bucket) {
            if (visited.has(otherId)) continue;
            const otherVert = mesh.getVertex(otherId);
            if (!otherVert) continue;
            const ddx = otherVert.position[0] - anchorVert.position[0];
            const ddy = otherVert.position[1] - anchorVert.position[1];
            const ddz = otherVert.position[2] - anchorVert.position[2];
            if (ddx * ddx + ddy * ddy + ddz * ddz <= distSqLimit) {
              visited.add(otherId);
              members.push(otherId);
            }
          }
        }
      }
    }

    if (members.length >= 2) {
      const centroid = mesh.computeCentroid(members) ?? anchorVert.position;
      anchorVert.position = [centroid[0], centroid[1], centroid[2]];
      for (let i = 1; i < members.length; i++) {
        vertRemap.set(members[i], anchorId);
        mergedCount++;
      }
    }
  }

  if (mergedCount === 0) {
    return {
      mesh,
      nextSelectedIds: new Set(selectedIds),
      mergedCount: 0,
    };
  }

  // Remap edges: drop self-loops (v0 === v1) and deduplicate via canonicalEdgeKey
  const edgeMapByKey = new Map<string, string>();
  const edgeRemap = new Map<string, string>();
  const nextEdges = [];
  for (const edge of mesh.edges) {
    const v0 = vertRemap.get(edge.v0) ?? edge.v0;
    const v1 = vertRemap.get(edge.v1) ?? edge.v1;
    if (v0 === v1) continue;
    const key = canonicalEdgeKey(v0, v1);
    const existingId = edgeMapByKey.get(key);
    if (existingId) {
      edgeRemap.set(edge.id, existingId);
      continue;
    }
    edge.v0 = v0;
    edge.v1 = v1;
    edgeMapByKey.set(key, edge.id);
    edgeRemap.set(edge.id, edge.id);
    nextEdges.push(edge);
  }
  mesh.edges = nextEdges;

  // Remap faces: collapse consecutive duplicates, drop <3 unique verts / zero-area / duplicates
  const seenFaceKeys = new Set<string>();
  const faceRemap = new Map<string, string>();
  const nextFaces: MeshFace[] = [];
  for (const face of mesh.faces) {
    const remapped = face.vertexIds.map((vid) => vertRemap.get(vid) ?? vid);
    const clean = sanitizePolygonVerts(mesh, remapped);
    if (!clean) continue;
    const fkey = canonicalFaceVertexSetKey(clean);
    if (seenFaceKeys.has(fkey)) {
      const keeper = nextFaces.find(
        (nf) => canonicalFaceVertexSetKey(nf.vertexIds) === fkey,
      );
      if (keeper) faceRemap.set(face.id, keeper.id);
      continue;
    }
    seenFaceKeys.add(fkey);
    face.vertexIds = clean;
    nextFaces.push(face);
    faceRemap.set(face.id, face.id);
  }
  mesh.faces = nextFaces;

  // Remove only the vertices that were merged into keep anchors
  mesh.vertices = mesh.vertices.filter((v) => !vertRemap.has(v.id));
  mesh.clearCustomNormals();
  mesh.rebuildIndices();

  // Preserve valid remapped selection for the active edit selection mode
  const nextSelected = new Set<string>();
  if (mode === 'vertex') {
    for (const id of selectedIds) {
      const mapped = vertRemap.get(id) ?? id;
      if (mesh.getVertex(mapped)) nextSelected.add(mapped);
    }
  } else if (mode === 'edge') {
    for (const id of selectedIds) {
      const mapped = edgeRemap.get(id);
      if (mapped && mesh.getEdge(mapped)) nextSelected.add(mapped);
    }
  } else if (mode === 'face') {
    for (const id of selectedIds) {
      const mapped = faceRemap.get(id);
      if (mapped && mesh.getFace(mapped)) nextSelected.add(mapped);
    }
  }

  return { mesh, nextSelectedIds: nextSelected, mergedCount };
}

/* ============================================================================
 * G. DELETE & DISSOLVE — MENÚ CONTEXTUAL DE ELIMINACIÓN
 * ========================================================================== */
function dissolveSingleEdgeInPlace(mesh: EditableMesh, edgeId: string): boolean {
  const edge = mesh.getEdge(edgeId);
  if (!edge) return false;
  const adjFaces = mesh.getFacesForEdge(edgeId);

  if (adjFaces.length === 0) {
    mesh.deleteEdges(new Set([edgeId]));
    return true;
  }

  if (adjFaces.length !== 2 || adjFaces[0] === adjFaces[1]) {
    return false;
  }

  const f1 = mesh.getFace(adjFaces[0]);
  const f2 = mesh.getFace(adjFaces[1]);
  if (!f1 || !f2) return false;

  // Find directed edge (u -> v) in f1, and (v -> u) in f2
  const n1 = f1.vertexIds.length;
  let idx1 = -1;
  let u = '';
  let v = '';
  for (let i = 0; i < n1; i++) {
    const a = f1.vertexIds[i];
    const b = f1.vertexIds[(i + 1) % n1];
    if (canonicalEdgeKey(a, b) === canonicalEdgeKey(edge.v0, edge.v1)) {
      idx1 = i;
      u = a;
      v = b;
      break;
    }
  }
  if (idx1 === -1) return false;

  const n2 = f2.vertexIds.length;
  let idx2 = -1;
  let f2Reversed = false;
  for (let i = 0; i < n2; i++) {
    const a = f2.vertexIds[i];
    const b = f2.vertexIds[(i + 1) % n2];
    if (a === v && b === u) {
      idx2 = i;
      f2Reversed = false;
      break;
    }
    if (a === u && b === v) {
      idx2 = i;
      f2Reversed = true;
      break;
    }
  }
  if (idx2 === -1) return false;

  const f2Ordered = f2Reversed ? [...f2.vertexIds].reverse() : f2.vertexIds;
  const startInF2 = f2Ordered.indexOf(v);

  // Build merged polygon: walk f1 from v .. u (n1 vertices), then f2 from after u .. before v (n2 - 2 vertices)
  const merged: string[] = [];
  for (let step = 0; step < n1; step++) {
    merged.push(f1.vertexIds[(idx1 + 1 + step) % n1]);
  }
  for (let step = 2; step < n2; step++) {
    merged.push(f2Ordered[(startInF2 + step) % n2]);
  }

  if (merged.length < 3 || new Set(merged).size < 3) return false;

  mesh.deleteFaces(new Set([f1.id, f2.id]));
  mesh.deleteEdges(new Set([edgeId]));
  mesh.addFace(merged);
  return true;
}

export function applyDeleteAction(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
  action: DeleteActionType,
): MeshOperatorResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();

  if (selectedIds.size === 0) {
    return { mesh, nextSelectedIds: nextSelected };
  }

  switch (action) {
    case 'delete_vertices': {
      mesh.deleteVertices(selectedIds);
      break;
    }
    case 'dissolve_vertices': {
      for (const vid of Array.from(selectedIds)) {
        if (!mesh.getVertex(vid)) continue;
        const incEdges = mesh.getEdgesForVertex(vid);
        const incFaces = mesh.getFacesForVertex(vid);
        if (incEdges.length === 2 && incFaces.length === 0) {
          const eA = mesh.getEdge(incEdges[0]);
          const eB = mesh.getEdge(incEdges[1]);
          if (eA && eB) {
            const nA = eA.v0 === vid ? eA.v1 : eA.v0;
            const nB = eB.v0 === vid ? eB.v1 : eB.v0;
            mesh.deleteVertices(new Set([vid]));
            mesh.addEdge(nA, nB);
          }
        } else if (incFaces.length === 1) {
          const f = mesh.getFace(incFaces[0]);
          if (f) {
            const filtered = f.vertexIds.filter((id) => id !== vid);
            mesh.deleteFaces(new Set([f.id]));
            mesh.deleteVertices(new Set([vid]));
            if (filtered.length >= 3) mesh.addFace(filtered);
          }
        } else if (incFaces.length >= 2) {
          // Merge the star of faces around vid into one polygon by chaining next -> ... -> prev
          const chains: {
            faceId: string;
            start: string;
            end: string;
            verts: string[];
          }[] = [];
          for (const fid of incFaces) {
            const f = mesh.getFace(fid);
            if (!f) continue;
            const idx = f.vertexIds.indexOf(vid);
            if (idx === -1) continue;
            const k = f.vertexIds.length;
            const verts: string[] = [];
            for (let s = 1; s < k; s++) {
              verts.push(f.vertexIds[(idx + s) % k]);
            }
            if (verts.length >= 2) {
              chains.push({
                faceId: fid,
                start: verts[0],
                end: verts[verts.length - 1],
                verts,
              });
            }
          }

          if (chains.length === incFaces.length) {
            const used = new Set<string>([chains[0].faceId]);
            const merged: string[] = [...chains[0].verts];
            let currEnd = chains[0].end;
            let closed = false;

            for (let iter = 0; iter < chains.length; iter++) {
              // Match next chain whose start === currEnd (same winding) or end === currEnd (reversed winding)
              let matched = chains.find(
                (c) => !used.has(c.faceId) && c.start === currEnd,
              );
              let sliceVerts: string[] | null = null;
              if (matched) {
                sliceVerts = matched.verts.slice(1);
              } else {
                matched = chains.find(
                  (c) => !used.has(c.faceId) && c.end === currEnd,
                );
                if (matched) {
                  sliceVerts = [...matched.verts].reverse().slice(1);
                }
              }
              if (!matched || !sliceVerts) break;
              used.add(matched.faceId);
              merged.push(...sliceVerts);
              currEnd = merged[merged.length - 1];
              if (currEnd === merged[0] && used.size === chains.length) {
                merged.pop();
                closed = true;
                break;
              }
            }

            if (closed && merged.length >= 3 && new Set(merged).size >= 3) {
              mesh.deleteFaces(new Set(incFaces));
              mesh.deleteVertices(new Set([vid]));
              mesh.addFace(merged);
            } else {
              // Open boundary fan fallback: strip vid from individual faces
              const toDelete = new Set<string>(incFaces);
              const toAdd: string[][] = [];
              for (const fid of incFaces) {
                const f = mesh.getFace(fid);
                if (!f) continue;
                const filtered = f.vertexIds.filter((id) => id !== vid);
                if (filtered.length >= 3) toAdd.push(filtered);
              }
              mesh.deleteFaces(toDelete);
              mesh.deleteVertices(new Set([vid]));
              for (const verts of toAdd) mesh.addFace(verts);
            }
          }
        } else {
          mesh.deleteVertices(new Set([vid]));
        }
      }
      break;
    }
    case 'delete_edges': {
      mesh.deleteEdges(selectedIds);
      break;
    }
    case 'delete_edges_and_vertices': {
      const candidateVerts = mesh.getVertexIdsFromSelection('edge', selectedIds);
      mesh.deleteEdges(selectedIds);
      mesh.pruneOrphanVertices(candidateVerts);
      break;
    }
    case 'dissolve_edges': {
      for (const eid of Array.from(selectedIds)) {
        dissolveSingleEdgeInPlace(mesh, eid);
      }
      break;
    }
    case 'delete_only_faces': {
      mesh.deleteFaces(selectedIds);
      break;
    }
    case 'delete_faces_and_edges': {
      const candidateEdges = new Set<string>();
      const candidateVerts = mesh.getVertexIdsFromSelection('face', selectedIds);
      for (const fid of selectedIds) {
        for (const eid of mesh.getEdgesForFace(fid)) candidateEdges.add(eid);
      }
      mesh.deleteFaces(selectedIds);
      const orphanEdges = new Set<string>();
      for (const eid of candidateEdges) {
        if (mesh.getFacesForEdge(eid).length === 0) orphanEdges.add(eid);
      }
      mesh.deleteEdges(orphanEdges);
      mesh.pruneOrphanVertices(candidateVerts);
      break;
    }
    case 'dissolve_faces': {
      // Find internal edges shared by 2 selected faces and dissolve them
      const faceSet = new Set(selectedIds);
      const internalEdges: string[] = [];
      for (const edge of mesh.edges) {
        const adj = mesh.getFacesForEdge(edge.id);
        if (adj.length === 2 && faceSet.has(adj[0]) && faceSet.has(adj[1])) {
          internalEdges.push(edge.id);
        }
      }
      for (const eid of internalEdges) {
        dissolveSingleEdgeInPlace(mesh, eid);
      }
      break;
    }
  }

  // Keep mode-clean empty selection after deletion
  if (mode === 'vertex' || mode === 'edge' || mode === 'face') {
    return { mesh, nextSelectedIds: nextSelected };
  }
  return { mesh, nextSelectedIds: nextSelected };
}

/* ============================================================================
 * H. FILL — CREAR CARA / CONECTAR ARISTA (Make Face, tecla F)
 * ========================================================================== */
export interface FillMeshResponse {
  result: MeshOperatorResult;
  nextMode?: EditSelectionMode;
  selectExisting?: boolean;
  createdType?: 'edge' | 'face';
  message?: string;
  error?: string;
}

function signedArea2D(pts: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function orient2D(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment2D(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  eps = 1e-7,
): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
}

function segmentsIntersect2D(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
): boolean {
  const eps = 1e-7;
  const o1 = orient2D(a1, a2, b1);
  const o2 = orient2D(a1, a2, b2);
  const o3 = orient2D(b1, b2, a1);
  const o4 = orient2D(b1, b2, a2);

  if (
    ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
    ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))
  ) {
    return true;
  }

  if (Math.abs(o1) <= eps && onSegment2D(b1, a1, a2, eps)) return true;
  if (Math.abs(o2) <= eps && onSegment2D(b2, a1, a2, eps)) return true;
  if (Math.abs(o3) <= eps && onSegment2D(a1, b1, b2, eps)) return true;
  if (Math.abs(o4) <= eps && onSegment2D(a2, b1, b2, eps)) return true;
  return false;
}

function has2DSelfIntersection(pts: [number, number][]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges sharing a vertex
      if (i === 0 && j === n - 1) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsIntersect2D(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

function buildTopoContourLoop(
  vertIds: string[],
  edgeList: { v0: string; v1: string }[],
): string[] | null {
  if (vertIds.length < 3 || edgeList.length < vertIds.length - 1) {
    return null;
  }
  const vertSet = new Set(vertIds);
  const adj = new Map<string, Set<string>>();
  for (const vid of vertIds) adj.set(vid, new Set());
  for (const e of edgeList) {
    if (vertSet.has(e.v0) && vertSet.has(e.v1) && e.v0 !== e.v1) {
      adj.get(e.v0)!.add(e.v1);
      adj.get(e.v1)!.add(e.v0);
    }
  }

  // Check single connected component
  const visited = new Set<string>();
  const queue = [vertIds[0]];
  visited.add(vertIds[0]);
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nxt of adj.get(curr) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    }
  }
  if (visited.size !== vertIds.length) return null;

  const degreeOne: string[] = [];
  for (const vid of vertIds) {
    const deg = adj.get(vid)!.size;
    if (deg < 1 || deg > 2) return null;
    if (deg === 1) degreeOne.push(vid);
  }

  // Closed cycle (all degree 2) or single open chain (two degree-1 endpoints)
  if (degreeOne.length !== 0 && degreeOne.length !== 2) {
    return null;
  }

  const start = degreeOne.length === 2 ? degreeOne[0] : vertIds[0];
  const walked: string[] = [];
  const walkSeen = new Set<string>();
  let curr: string | undefined = start;
  let prev: string | null = null;
  while (curr && !walkSeen.has(curr)) {
    walkSeen.add(curr);
    walked.push(curr);
    const neighbors: string[] = Array.from(adj.get(curr) ?? []);
    const next: string | undefined = neighbors.find((n: string) => n !== prev);
    prev = curr;
    curr = next;
  }

  return walked.length === vertIds.length ? walked : null;
}

function computeLoopNewellNormal(mesh: EditableMesh, loop: string[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const curr = mesh.getVertex(loop[i])?.position;
    const next = mesh.getVertex(loop[(i + 1) % n])?.position;
    if (!curr || !next) continue;
    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }
  return normVec([nx, ny, nz], [0, 0, 1]);
}

export function fillMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
): FillMeshResponse {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();

  if (selectedIds.size === 0) {
    return {
      result: { mesh, nextSelectedIds: nextSelected },
      error: 'Selecciona al menos 2 vértices o aristas para crear geometría',
    };
  }

  const vertIdsSet = mesh.getVertexIdsFromSelection(mode, selectedIds);
  const vertIds = Array.from(vertIdsSet);

  if (vertIds.length < 2) {
    return {
      result: { mesh, nextSelectedIds: nextSelected },
      error: 'Selecciona al menos 2 vértices para crear una arista o cara',
    };
  }

  // Case 1: Exactly 2 vertices -> connect with an edge
  if (vertIds.length === 2) {
    const v0 = mesh.getVertex(vertIds[0]);
    const v1 = mesh.getVertex(vertIds[1]);
    if (!v0 || !v1 || lenVec(subVec(v1.position, v0.position)) < 1e-7) {
      return {
        result: { mesh, nextSelectedIds: new Set(selectedIds) },
        error: 'Los vértices seleccionados están superpuestos',
      };
    }
    const existing = mesh.findEdgeId(vertIds[0], vertIds[1]);
    if (existing) {
      const sel =
        mode === 'edge' ? new Set<string>([existing]) : new Set<string>(vertIds);
      return {
        result: { mesh, nextSelectedIds: sel },
        nextMode: mode === 'edge' ? 'edge' : undefined,
        selectExisting: true,
        message: 'Ya existe una arista entre los dos vértices',
      };
    }
    const edge = mesh.addEdge(vertIds[0], vertIds[1]);
    if (edge && mode === 'edge') {
      nextSelected.add(edge.id);
    } else {
      nextSelected.add(vertIds[0]);
      nextSelected.add(vertIds[1]);
    }
    return {
      result: { mesh, nextSelectedIds: nextSelected },
      nextMode: mode === 'edge' ? 'edge' : undefined,
      createdType: 'edge',
      message: 'Arista creada',
    };
  }

  // Case 2: 3+ vertices -> prevent exact duplicate face first (select existing face cleanly)
  const existingFace = mesh.faces.find((f) => {
    const uniqueVerts = new Set(f.vertexIds);
    return (
      uniqueVerts.size === vertIds.length &&
      f.vertexIds.every((vid) => vertIdsSet.has(vid))
    );
  });
  if (existingFace) {
    return {
      result: { mesh, nextSelectedIds: new Set([existingFace.id]) },
      nextMode: 'face',
      selectExisting: true,
      message: 'Cara existente seleccionada',
    };
  }

  if (mode === 'face') {
    return {
      result: { mesh, nextSelectedIds: new Set(selectedIds) },
      error: 'Selecciona vértices o aristas para crear una cara nueva',
    };
  }

  // Validate non-coincident vertices and non-collinear 3D span
  const pts = vertIds.map((vid) => mesh.getVertex(vid)!.position);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (lenVec(subVec(pts[j], pts[i])) < 1e-7) {
        return {
          result: { mesh, nextSelectedIds: new Set(selectedIds) },
          error: 'Existen vértices superpuestos en la selección',
        };
      }
    }
  }

  const pA = pts[0];
  let pB = pts[1];
  let maxDist = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = lenVec(subVec(pts[i], pA));
    if (d > maxDist) {
      maxDist = d;
      pB = pts[i];
    }
  }
  const abVec = subVec(pB, pA);
  const abLen = lenVec(abVec);
  if (abLen < 1e-7) {
    return {
      result: { mesh, nextSelectedIds: new Set(selectedIds) },
      error: 'Los vértices seleccionados son colineales o están superpuestos',
    };
  }

  let pC = pts[1];
  let maxCrossLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const cLen = lenVec(crossVec(abVec, subVec(pts[i], pA)));
    if (cLen > maxCrossLen) {
      maxCrossLen = cLen;
      pC = pts[i];
    }
  }
  if (maxCrossLen / abLen < 1e-6) {
    return {
      result: { mesh, nextSelectedIds: new Set(selectedIds) },
      error: 'Los vértices están alineados y no forman una cara válida',
    };
  }

  // Compute robust best-fit plane around centroid
  const centroid = mesh.computeCentroid(vertIds) ?? [0, 0, 0];
  const seedNormal = normVec(
    crossVec(abVec, subVec(pC, pA)),
    [0, 0, 1],
  );
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = subVec(pts[i], centroid);
      const b = subVec(pts[j], centroid);
      const c = crossVec(a, b);
      if (dotVec(c, seedNormal) < 0) {
        nx -= c[0];
        ny -= c[1];
        nz -= c[2];
      } else {
        nx += c[0];
        ny += c[1];
        nz += c[2];
      }
    }
  }
  const bestNormal = normVec([nx, ny, nz], seedNormal);
  const ref: Vec3 = Math.abs(bestNormal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const uAxis = normVec(crossVec(ref, bestNormal), [1, 0, 0]);
  const vAxis = normVec(crossVec(bestNormal, uAxis), [0, 0, 1]);

  const projectById = new Map<string, [number, number]>();
  for (const vid of vertIds) {
    const d = subVec(mesh.getVertex(vid)!.position, centroid);
    projectById.set(vid, [dotVec(d, uAxis), dotVec(d, vAxis)]);
  }
  const toPoly2D = (loop: string[]): [number, number][] =>
    loop.map((id) => projectById.get(id)!);

  // Step 1: Try topological edge loop / open chain first
  let orderedLoop: string[] | null = null;
  if (mode === 'edge') {
    const selEdges: { v0: string; v1: string }[] = [];
    for (const eid of selectedIds) {
      const e = mesh.getEdge(eid);
      if (e) selEdges.push(e);
    }
    orderedLoop = buildTopoContourLoop(vertIds, selEdges);
  } else {
    const subEdges = mesh.edges.filter(
      (e) => vertIdsSet.has(e.v0) && vertIdsSet.has(e.v1),
    );
    orderedLoop = buildTopoContourLoop(vertIds, subEdges);
  }

  if (orderedLoop) {
    const poly2D = toPoly2D(orderedLoop);
    if (
      Math.abs(signedArea2D(poly2D)) <= 1e-7 ||
      has2DSelfIntersection(poly2D)
    ) {
      orderedLoop = null;
    }
  }

  // Step 2: Geometric contour sorting for disconnected or partial vertices
  if (!orderedLoop) {
    const sorted = [...vertIds].sort((idA, idB) => {
      const p2A = projectById.get(idA)!;
      const p2B = projectById.get(idB)!;
      return Math.atan2(p2A[1], p2A[0]) - Math.atan2(p2B[1], p2B[0]);
    });

    const sorted2D = toPoly2D(sorted);
    if (
      Math.abs(signedArea2D(sorted2D)) > 1e-7 &&
      !has2DSelfIntersection(sorted2D)
    ) {
      orderedLoop = sorted;
    } else if (vertIds.length === 4) {
      // Evaluate the 3 cyclic quad permutations to avoid bowtie crossings
      const candidates: string[][] = [
        [sorted[0], sorted[1], sorted[2], sorted[3]],
        [sorted[0], sorted[1], sorted[3], sorted[2]],
        [sorted[0], sorted[2], sorted[1], sorted[3]],
      ];
      let bestCandidate: string[] | null = null;
      let bestArea = 1e-7;
      for (const cand of candidates) {
        const poly = toPoly2D(cand);
        const areaAbs = Math.abs(signedArea2D(poly));
        if (areaAbs > bestArea && !has2DSelfIntersection(poly)) {
          bestArea = areaAbs;
          bestCandidate = cand;
        }
      }
      orderedLoop = bestCandidate;
    } else {
      // 2-opt uncrossing for larger disconnected vertex sets
      const loop = [...sorted];
      const n = loop.length;
      for (let pass = 0; pass < n * n; pass++) {
        let fixedAny = false;
        const poly = toPoly2D(loop);
        for (let i = 0; i < n && !fixedAny; i++) {
          const a1 = poly[i];
          const a2 = poly[(i + 1) % n];
          for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const b1 = poly[j];
            const b2 = poly[(j + 1) % n];
            if (segmentsIntersect2D(a1, a2, b1, b2)) {
              // Reverse sub-array (i+1 .. j) to uncross
              let l = i + 1;
              let r = j;
              while (l < r) {
                const tmp = loop[l];
                loop[l] = loop[r];
                loop[r] = tmp;
                l++;
                r--;
              }
              fixedAny = true;
              break;
            }
          }
        }
        if (!fixedAny) break;
      }
      const poly = toPoly2D(loop);
      if (
        Math.abs(signedArea2D(poly)) > 1e-7 &&
        !has2DSelfIntersection(poly)
      ) {
        orderedLoop = loop;
      }
    }
  }

  if (!orderedLoop) {
    return {
      result: { mesh, nextSelectedIds: new Set(selectedIds) },
      error: 'No se pudo formar una cara válida sin autointersecciones',
    };
  }

  // Step 3: Coherent normal orientation matching adjacent faces (or outward/upward)
  let consistentVotes = 0;
  const loopLen = orderedLoop.length;
  for (let i = 0; i < loopLen; i++) {
    const a = orderedLoop[i];
    const b = orderedLoop[(i + 1) % loopLen];
    const eid = mesh.findEdgeId(a, b);
    if (!eid) continue;
    for (const fid of mesh.getFacesForEdge(eid)) {
      const adj = mesh.getFace(fid);
      if (!adj) continue;
      const m = adj.vertexIds.length;
      for (let k = 0; k < m; k++) {
        const u = adj.vertexIds[k];
        const v = adj.vertexIds[(k + 1) % m];
        if (u === b && v === a) consistentVotes += 1;
        else if (u === a && v === b) consistentVotes -= 1;
      }
    }
  }

  if (consistentVotes < 0) {
    orderedLoop.reverse();
  } else if (consistentVotes === 0) {
    const faceNormal = computeLoopNewellNormal(mesh, orderedLoop);
    const faceCenter = mesh.computeCentroid(orderedLoop) ?? centroid;
    const meshCenter =
      mesh.computeCentroid(mesh.vertices.map((v) => v.id)) ?? faceCenter;
    const outwardVec = subVec(faceCenter, meshCenter);
    const outwardDot = dotVec(faceNormal, outwardVec);
    if (
      mesh.faces.length > 0 &&
      lenVec(outwardVec) > 1e-4 &&
      Math.abs(outwardDot) > 1e-5
    ) {
      if (outwardDot < 0) {
        orderedLoop.reverse();
      }
    } else if (Math.abs(faceNormal[2]) > 0.25) {
      if (faceNormal[2] < 0) orderedLoop.reverse();
    } else if (Math.abs(faceNormal[1]) > 0.25) {
      if (faceNormal[1] > 0) orderedLoop.reverse();
    } else if (faceNormal[0] < 0) {
      orderedLoop.reverse();
    }
  }

  const face = mesh.addFace(orderedLoop);
  if (!face) {
    return {
      result: { mesh, nextSelectedIds: new Set(selectedIds) },
      error: 'No se pudo crear la cara',
    };
  }

  nextSelected.add(face.id);

  return {
    result: { mesh, nextSelectedIds: nextSelected },
    nextMode: 'face',
    createdType: 'face',
    message: 'Cara creada',
  };
}

/* ============================================================================
 * Register operators into extensible MeshOperatorRegistry
 * ========================================================================== */
meshOperatorRegistry.register({
  id: 'extrude',
  label: 'Extruir',
  canExecute: (ctx: MeshOperatorContext) => ctx.selectedIds.size > 0,
  execute: (ctx: MeshOperatorContext, params = {}) =>
    extrudeMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds, {
      distance: Number(params.distance ?? 0.5),
      axis: (params.axis as ExtrudeAxis) ?? 'normal',
      individual: Boolean(params.individual ?? false),
    }),
});

meshOperatorRegistry.register({
  id: 'inset',
  label: 'Insertar Caras',
  canExecute: (ctx: MeshOperatorContext) => ctx.selectedIds.size > 0,
  execute: (ctx: MeshOperatorContext, params = {}) =>
    insetFacesMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds, {
      thickness: Number(params.thickness ?? 0.25),
      depth: Number(params.depth ?? 0),
      individual: Boolean(params.individual ?? false),
    }),
});

meshOperatorRegistry.register({
  id: 'subdivide',
  label: 'Subdividir',
  canExecute: (ctx: MeshOperatorContext) => ctx.selectedIds.size > 0,
  execute: (ctx: MeshOperatorContext, params = {}) =>
    subdivideMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds, {
      cuts: Number(params.cuts ?? 1),
      smoothness: Number(params.smoothness ?? 0),
      fractal: Number(params.fractal ?? 0),
    }),
});

meshOperatorRegistry.register({
  id: 'bevel',
  label: 'Biselar',
  canExecute: (ctx: MeshOperatorContext) => ctx.selectedIds.size > 0,
  execute: (ctx: MeshOperatorContext, params = {}) =>
    bevelMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds, {
      width: Number(params.width ?? 0.2),
      segments: Number(params.segments ?? 1),
      profile: Number(params.profile ?? 0.5),
      clampOverlap: params.clampOverlap !== false,
    }),
});

meshOperatorRegistry.register({
  id: 'merge',
  label: 'Fusionar',
  canExecute: (ctx: MeshOperatorContext) => ctx.selectedIds.size >= 2,
  execute: (ctx: MeshOperatorContext, params = {}) =>
    mergeVerticesMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds, {
      mode: (params.mode as MergeMode) ?? 'center',
      cursorPosition: params.cursorPosition as Vec3 | undefined,
    }),
});

meshOperatorRegistry.register({
  id: 'merge_by_distance',
  label: 'Fusionar por distancia',
  canExecute: (ctx: MeshOperatorContext) => ctx.mesh.vertices.length >= 2,
  execute: (ctx: MeshOperatorContext, params = {}) =>
    mergeByDistanceMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds, {
      distance: Number(params.distance ?? 0.005),
      scope: (params.scope as 'selection' | 'all' | undefined) ?? undefined,
    }),
});

meshOperatorRegistry.register({
  id: 'fill',
  label: 'Rellenar',
  canExecute: (ctx: MeshOperatorContext) => ctx.selectedIds.size >= 2,
  execute: (ctx: MeshOperatorContext) =>
    fillMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds).result,
});

meshOperatorRegistry.register({
  id: 'connect_vertex_path',
  label: 'Connect Vertex Path',
  canExecute: (ctx: MeshOperatorContext) =>
    ctx.selectionMode === 'vertex' && ctx.selectedIds.size >= 2,
  execute: (ctx: MeshOperatorContext) =>
    connectVertexPathMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds).result,
});

meshOperatorRegistry.register({
  id: 'recalculate_normals',
  label: 'Recalculate Outside',
  canExecute: (ctx: MeshOperatorContext) => ctx.mesh.faces.length > 0,
  execute: (ctx: MeshOperatorContext) => {
    const res = recalculateOutsideMesh(
      ctx.mesh,
      ctx.selectionMode,
      ctx.selectedIds,
    );
    return {
      mesh: res.mesh,
      nextSelectedIds: new Set(ctx.selectedIds),
    };
  },
});

meshOperatorRegistry.register({
  id: 'flip_normals',
  label: 'Flip Normals',
  canExecute: (ctx: MeshOperatorContext) => ctx.mesh.faces.length > 0,
  execute: (ctx: MeshOperatorContext) => {
    const res = flipNormalsMesh(ctx.mesh, ctx.selectionMode, ctx.selectedIds);
    return {
      mesh: res.mesh,
      nextSelectedIds: new Set(ctx.selectedIds),
    };
  },
});

meshOperatorRegistry.register({
  id: 'loop_cut',
  label: 'Loop Cut',
  canExecute: (ctx: MeshOperatorContext) =>
    findFirstValidLoopEdge(
      ctx.mesh,
      ctx.selectionMode === 'edge' ? ctx.selectedIds : undefined,
    ) !== null,
  execute: (ctx: MeshOperatorContext, params = {}) => {
    const edgeId =
      typeof params.edgeId === 'string'
        ? params.edgeId
        : findFirstValidLoopEdge(
            ctx.mesh,
            ctx.selectionMode === 'edge' ? ctx.selectedIds : undefined,
          );
    return loopCutMesh(ctx.mesh, {
      edgeId,
      cuts: Number(params.cuts ?? 1),
      slide: Number(params.slide ?? 0),
    }).result;
  },
});

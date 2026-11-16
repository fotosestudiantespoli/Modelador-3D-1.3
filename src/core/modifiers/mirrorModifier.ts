import * as THREE from 'three';
import {
  canonicalEdgeKey,
  EditableMesh,
  SerializedEditableMesh,
  Vec3,
} from '../mesh/EditableMesh';
import {
  MirrorModifierParams,
  ModifierDiagnostic,
  ModifierSlot,
  ModifierTransformRef,
  normalizeMirrorParams,
} from './types';

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normVec(a: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (len < 1e-9) return fallback;
  return [a[0] / len, a[1] / len, a[2] / len];
}

interface LocalSymmetryPlane {
  axis: 'x' | 'y' | 'z';
  origin: Vec3;
  normal: Vec3;
}

const AXIS_NORMALS: Record<'x' | 'y' | 'z', Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function makeTransformMatrix(ref: ModifierTransformRef): THREE.Matrix4 {
  const pos = new THREE.Vector3(...ref.position);
  const euler = new THREE.Euler(ref.rotation[0], ref.rotation[1], ref.rotation[2], 'XYZ');
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(
    Math.abs(ref.scale[0]) < 1e-6 ? 1 : ref.scale[0],
    Math.abs(ref.scale[1]) < 1e-6 ? 1 : ref.scale[1],
    Math.abs(ref.scale[2]) < 1e-6 ? 1 : ref.scale[2],
  );
  return new THREE.Matrix4().compose(pos, quat, scale);
}

export function resolveMirrorPlaneInLocalSpace(
  axis: 'x' | 'y' | 'z',
  mirrorObjectId: string | null,
  ownerTransform?: ModifierTransformRef,
  sceneTransformRefs?: ModifierTransformRef[],
): LocalSymmetryPlane {
  const baseNormal = AXIS_NORMALS[axis];
  if (!mirrorObjectId || !ownerTransform || !sceneTransformRefs) {
    return { axis, origin: [0, 0, 0], normal: baseNormal };
  }
  if (mirrorObjectId === ownerTransform.id) {
    return { axis, origin: [0, 0, 0], normal: baseNormal };
  }
  const targetRef = sceneTransformRefs.find((r) => r.id === mirrorObjectId);
  if (!targetRef) {
    return { axis, origin: [0, 0, 0], normal: baseNormal };
  }

  const mOwner = makeTransformMatrix(ownerTransform);
  const mTarget = makeTransformMatrix(targetRef);
  const mOwnerInv = mOwner.clone().invert();
  const mRel = new THREE.Matrix4().multiplyMatrices(mOwnerInv, mTarget);

  const originVec = new THREE.Vector3(0, 0, 0).applyMatrix4(mRel);
  const axisVec = new THREE.Vector3(...baseNormal)
    .transformDirection(mRel)
    .normalize();

  return {
    axis,
    origin: [originVec.x, originVec.y, originVec.z],
    normal: normVec([axisVec.x, axisVec.y, axisVec.z], baseNormal),
  };
}

/**
 * Cuts a mesh along a local symmetry plane keeping the side where signedDist * keepSign >= -eps.
 */
function bisectMeshByPlane(
  source: EditableMesh,
  plane: LocalSymmetryPlane,
  keepSign: 1 | -1,
): EditableMesh {
  const out = new EditableMesh();
  const eps = 1e-6;
  const distOf = new Map<string, number>();
  const keptVertMap = new Map<string, string>();
  const splitVertCache = new Map<string, string>();

  for (const v of source.vertices) {
    const d = dotVec(subVec(v.position, plane.origin), plane.normal) * keepSign;
    distOf.set(v.id, d);
    if (d >= -eps) {
      // Snap vertices almost on the plane cleanly onto the plane
      const pos: Vec3 =
        Math.abs(d) <= eps
          ? subVec(v.position, scaleVec(plane.normal, d * keepSign))
          : [...v.position];
      const nv = out.addVertex(pos[0], pos[1], pos[2]);
      keptVertMap.set(v.id, nv.id);
    }
  }

  const getSplitVertex = (idA: string, idB: string): string => {
    const key = canonicalEdgeKey(idA, idB);
    const existing = splitVertCache.get(key);
    if (existing) return existing;

    const dA = distOf.get(idA) ?? 0;
    const dB = distOf.get(idB) ?? 0;
    if (Math.abs(dA) <= eps && keptVertMap.has(idA)) {
      const id = keptVertMap.get(idA)!;
      splitVertCache.set(key, id);
      return id;
    }
    if (Math.abs(dB) <= eps && keptVertMap.has(idB)) {
      const id = keptVertMap.get(idB)!;
      splitVertCache.set(key, id);
      return id;
    }

    const pA = source.getVertex(idA)!.position;
    const pB = source.getVertex(idB)!.position;
    const denom = dA - dB;
    const t = Math.abs(denom) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, dA / denom));
    const rawPos: Vec3 = [
      pA[0] + (pB[0] - pA[0]) * t,
      pA[1] + (pB[1] - pA[1]) * t,
      pA[2] + (pB[2] - pA[2]) * t,
    ];
    // Project cleanly onto plane so bisect seam lies strictly at signedDist = 0
    const dErr = dotVec(subVec(rawPos, plane.origin), plane.normal);
    const snapped = subVec(rawPos, scaleVec(plane.normal, dErr));
    const nv = out.addVertex(snapped[0], snapped[1], snapped[2]);
    splitVertCache.set(key, nv.id);
    return nv.id;
  };

  // Clip faces (Sutherland-Hodgman half-space against signedDist >= -eps)
  for (const face of source.faces) {
    const n = face.vertexIds.length;
    if (n < 3) continue;
    const outIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const currId = face.vertexIds[i];
      const nextId = face.vertexIds[(i + 1) % n];
      const dCurr = distOf.get(currId) ?? 0;
      const dNext = distOf.get(nextId) ?? 0;
      const currIn = dCurr >= -eps;
      const nextIn = dNext >= -eps;

      if (currIn && nextIn) {
        outIds.push(keptVertMap.get(nextId)!);
      } else if (currIn && !nextIn) {
        outIds.push(getSplitVertex(currId, nextId));
      } else if (!currIn && nextIn) {
        outIds.push(getSplitVertex(currId, nextId));
        outIds.push(keptVertMap.get(nextId)!);
      }
    }

    // Deduplicate consecutive identical vertex IDs
    const cleaned: string[] = [];
    for (const id of outIds) {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1] !== id) {
        cleaned.push(id);
      }
    }
    if (cleaned.length > 1 && cleaned[0] === cleaned[cleaned.length - 1]) {
      cleaned.pop();
    }
    if (cleaned.length >= 3 && new Set(cleaned).size >= 3) {
      out.addFace(cleaned);
    }
  }

  // Clip loose edges (wireframe edges not attached to faces)
  for (const edge of source.edges) {
    if (source.getFacesForEdge(edge.id).length > 0) continue;
    const d0 = distOf.get(edge.v0) ?? 0;
    const d1 = distOf.get(edge.v1) ?? 0;
    const in0 = d0 >= -eps;
    const in1 = d1 >= -eps;
    if (in0 && in1) {
      const a = keptVertMap.get(edge.v0);
      const b = keptVertMap.get(edge.v1);
      if (a && b && a !== b) out.addEdge(a, b);
    } else if (in0 && !in1) {
      const a = keptVertMap.get(edge.v0);
      const b = getSplitVertex(edge.v0, edge.v1);
      if (a && b && a !== b) out.addEdge(a, b);
    } else if (!in0 && in1) {
      const a = getSplitVertex(edge.v0, edge.v1);
      const b = keptVertMap.get(edge.v1);
      if (a && b && a !== b) out.addEdge(a, b);
    }
  }

  out.pruneOrphanVertices();
  out.rebuildIndices();
  return out;
}

function faceSignature(vertexIds: string[]): string {
  return [...vertexIds].sort().join('|');
}

function mirrorMeshAcrossPlane(
  source: EditableMesh,
  plane: LocalSymmetryPlane,
  merge: boolean,
  mergeDistance: number,
): EditableMesh {
  const out = new EditableMesh();
  const origVertMap = new Map<string, string>();
  const mirrorVertMap = new Map<string, string>();
  const mergeTol = merge ? Math.max(1e-6, mergeDistance) : -1;

  for (const v of source.vertices) {
    const d = dotVec(subVec(v.position, plane.origin), plane.normal);
    if (merge && Math.abs(d) <= mergeTol) {
      // Snap seam vertex onto symmetry plane and share its ID for both halves
      const snapped = subVec(v.position, scaleVec(plane.normal, d));
      const nv = out.addVertex(snapped[0], snapped[1], snapped[2]);
      origVertMap.set(v.id, nv.id);
      mirrorVertMap.set(v.id, nv.id);
    } else {
      const nvOrig = out.addVertex(v.position[0], v.position[1], v.position[2]);
      origVertMap.set(v.id, nvOrig.id);

      const reflected = subVec(v.position, scaleVec(plane.normal, 2 * d));
      const nvMirr = out.addVertex(reflected[0], reflected[1], reflected[2]);
      mirrorVertMap.set(v.id, nvMirr.id);
    }
  }

  const existingFaceSigs = new Set<string>();

  // Copy original faces
  for (const face of source.faces) {
    const mapped: string[] = [];
    for (const vid of face.vertexIds) {
      const nid = origVertMap.get(vid);
      if (nid && (mapped.length === 0 || mapped[mapped.length - 1] !== nid)) {
        mapped.push(nid);
      }
    }
    if (mapped.length > 1 && mapped[0] === mapped[mapped.length - 1]) {
      mapped.pop();
    }
    if (mapped.length >= 3 && new Set(mapped).size >= 3) {
      const sig = faceSignature(mapped);
      if (!existingFaceSigs.has(sig)) {
        existingFaceSigs.add(sig);
        out.addFace(mapped);
      }
    }
  }

  // Add mirrored faces with REVERSED winding to preserve outward normals
  for (const face of source.faces) {
    const mapped: string[] = [];
    for (const vid of face.vertexIds) {
      const nid = mirrorVertMap.get(vid);
      if (nid && (mapped.length === 0 || mapped[mapped.length - 1] !== nid)) {
        mapped.push(nid);
      }
    }
    if (mapped.length > 1 && mapped[0] === mapped[mapped.length - 1]) {
      mapped.pop();
    }
    if (mapped.length >= 3 && new Set(mapped).size >= 3) {
      const sig = faceSignature(mapped);
      if (!existingFaceSigs.has(sig)) {
        existingFaceSigs.add(sig);
        out.addFace(mapped.reverse());
      }
    }
  }

  // Copy & mirror loose edges (e.g. Circle / wireframe)
  for (const edge of source.edges) {
    if (source.getFacesForEdge(edge.id).length > 0) continue;
    const ov0 = origVertMap.get(edge.v0);
    const ov1 = origVertMap.get(edge.v1);
    if (ov0 && ov1 && ov0 !== ov1) {
      out.addEdge(ov0, ov1);
    }
    const mv0 = mirrorVertMap.get(edge.v0);
    const mv1 = mirrorVertMap.get(edge.v1);
    if (mv0 && mv1 && mv0 !== mv1) {
      out.addEdge(mv0, mv1);
    }
  }

  out.pruneOrphanVertices();
  out.clearCustomNormals();
  out.rebuildIndices();
  return out;
}

/**
 * Removes any degenerate faces (<3 unique verts or zero area) and duplicate faces.
 */
export function cleanupMirroredMesh(mesh: EditableMesh): EditableMesh {
  const out = mesh.clone();
  const seenSigs = new Set<string>();
  const toDelete = new Set<string>();

  for (const f of out.faces) {
    if (f.vertexIds.length < 3 || new Set(f.vertexIds).size < 3) {
      toDelete.add(f.id);
      continue;
    }
    const sig = faceSignature(f.vertexIds);
    if (seenSigs.has(sig)) {
      toDelete.add(f.id);
      continue;
    }
    seenSigs.add(sig);

    // Check non-zero polygon area using Newell vector
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = out.getVertex(f.vertexIds[i])?.position;
      const b = out.getVertex(f.vertexIds[(i + 1) % n])?.position;
      if (!a || !b) continue;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    if (Math.hypot(nx, ny, nz) < 1e-10) {
      toDelete.add(f.id);
    }
  }

  if (toDelete.size > 0) {
    out.deleteFaces(toDelete);
  }
  out.pruneOrphanVertices();
  out.clearCustomNormals();
  out.rebuildIndices();
  return out;
}

export function evaluateMirrorModifier(
  sourceSerialized: SerializedEditableMesh,
  rawParams: unknown,
  modifierId: string,
  options: {
    ownerTransform?: ModifierTransformRef;
    sceneTransformRefs?: ModifierTransformRef[];
    isApplying?: boolean;
  } = {},
): { mesh: SerializedEditableMesh; diagnostic: ModifierDiagnostic } {
  const params = normalizeMirrorParams(rawParams);
  let working = EditableMesh.fromJSON(sourceSerialized);
  const axesOrder: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

  for (const axis of axesOrder) {
    if (!params.axes[axis]) continue;
    const plane = resolveMirrorPlaneInLocalSpace(
      axis,
      params.mirrorObjectId,
      options.ownerTransform,
      options.sceneTransformRefs,
    );
    if (params.bisect[axis]) {
      const keepSign: 1 | -1 = params.flipBisect?.[axis] ? -1 : 1;
      working = bisectMeshByPlane(working, plane, keepSign);
    }
    working = mirrorMeshAcrossPlane(
      working,
      plane,
      params.merge,
      params.mergeDistance,
    );
  }

  if (options.isApplying) {
    working = cleanupMirroredMesh(working);
  }

  const ngonCount = working.faces.filter((f) => f.vertexIds.length > 4).length;
  const triangleCount = working.faces.filter((f) => f.vertexIds.length === 3).length;

  return {
    mesh: working.toJSON(),
    diagnostic: {
      modifierId,
      type: 'mirror',
      status: 'ok',
      vertexCount: working.vertices.length,
      edgeCount: working.edges.length,
      faceCount: working.faces.length,
      ngonCount,
      triangleCount,
      nonManifoldEdges: 0,
    },
  };
}

/**
 * Enforces Mirror Clipping during Edit Mode vertex dragging or numeric edits:
 * - Vertices starting on the mirror symmetry plane remain locked on the plane.
 * - Vertices crossing the mirror symmetry plane are clamped cleanly onto the plane.
 */
export function clampVerticesForMirrorClipping(
  mesh: EditableMesh,
  movedVertexIds: Iterable<string>,
  startPositions: Map<string, Vec3>,
  modifiers: ModifierSlot[],
  ownerTransform?: ModifierTransformRef,
  sceneTransformRefs?: ModifierTransformRef[],
): void {
  const activeClipPlanes: LocalSymmetryPlane[] = [];
  for (const mod of modifiers) {
    if (!mod.enabled || mod.type !== 'mirror') continue;
    const params = normalizeMirrorParams(mod.params);
    if (!params.clipping) continue;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!params.axes[axis]) continue;
      activeClipPlanes.push(
        resolveMirrorPlaneInLocalSpace(
          axis,
          params.mirrorObjectId,
          ownerTransform,
          sceneTransformRefs,
        ),
      );
    }
  }

  if (activeClipPlanes.length === 0) return;

  const seamLockTol = 1e-4;
  for (const vid of movedVertexIds) {
    const v = mesh.getVertex(vid);
    const startPos = startPositions.get(vid);
    if (!v || !startPos) continue;

    for (const plane of activeClipPlanes) {
      const dStart = dotVec(subVec(startPos, plane.origin), plane.normal);
      const dCurr = dotVec(subVec(v.position, plane.origin), plane.normal);

      const startedOnPlane = Math.abs(dStart) <= seamLockTol;
      const crossedPlane =
        (dStart > seamLockTol && dCurr < 0) ||
        (dStart < -seamLockTol && dCurr > 0);

      if (startedOnPlane || crossedPlane) {
        const clamped = subVec(v.position, scaleVec(plane.normal, dCurr));
        v.position[0] = clamped[0];
        v.position[1] = clamped[1];
        v.position[2] = clamped[2];
      }
    }
  }
}

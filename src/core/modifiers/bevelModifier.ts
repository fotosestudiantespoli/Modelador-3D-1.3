import {
  canonicalEdgeKey,
  EditableMesh,
  MeshFace,
  SerializedEditableMesh,
  Vec3,
} from '../mesh/EditableMesh';
import { isFaceDegenerate } from '../mesh/normals';
import {
  BevelModifierParams,
  ModifierDiagnostic,
  normalizeBevelParams,
  TABLET_BEVEL_FACE_BUDGET,
} from './types';

export interface BevelEvaluationResult {
  mesh: SerializedEditableMesh;
  diagnostic: ModifierDiagnostic;
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
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

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lenVec(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normVec(a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const l = lenVec(a);
  if (l < 1e-8) return fallback;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function computePolygonNewellNormal(
  mesh: EditableMesh,
  vertexIds: string[],
): Vec3 {
  const n = vertexIds.length;
  if (n < 3) return [0, 0, 1];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const a = mesh.getVertex(vertexIds[i])?.position;
    const b = mesh.getVertex(vertexIds[(i + 1) % n])?.position;
    if (!a || !b) continue;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normVec([nx, ny, nz], [0, 0, 1]);
}

function computePolygonRawArea2(
  mesh: EditableMesh,
  vertexIds: string[],
): number {
  const n = vertexIds.length;
  if (n < 3) return 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const a = mesh.getVertex(vertexIds[i])?.position;
    const b = mesh.getVertex(vertexIds[(i + 1) % n])?.position;
    if (!a || !b) return 0;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(nx, ny, nz);
}

/**
 * Rational quadratic Bezier profile evaluator mapped cleanly to Blender's profile [0.05..1.0]:
 * - profile = 0.5  => w = 1/sqrt(2) (exact circular arc on 90° edges)
 * - profile = 0.25 => straight flat chamfer
 * - profile < 0.25 => concave arc
 * - profile = 1.0  => sharp corner hugging origPos
 */
function evalProfilePoint(
  pA: Vec3,
  pB: Vec3,
  pOrig: Vec3,
  t: number,
  profile: number,
): Vec3 {
  if (Math.abs(profile - 0.25) < 1e-4) {
    return lerpVec(pA, pB, t);
  }
  if (profile < 0.25) {
    const mid = lerpVec(pA, pB, 0.5);
    const alpha = (profile - 0.25) / 0.25; // in [-0.8, 0)
    const offset = subVec(pOrig, mid);
    const bulge = 2 * t * (1 - t) * alpha;
    return addVec(lerpVec(pA, pB, t), scaleVec(offset, bulge));
  }
  // Convex rational quadratic Bezier with c = 0.55 / (0.25 * sqrt(2)) = 1.555635
  const w = ((profile - 0.25) / Math.max(0.05, 1.05 - profile)) * 1.555635;
  const u = 1 - t;
  const w0 = u * u;
  const w1 = 2 * w * u * t;
  const w2 = t * t;
  const denom = Math.max(1e-8, w0 + w1 + w2);
  return [
    (w0 * pA[0] + w1 * pOrig[0] + w2 * pB[0]) / denom,
    (w0 * pA[1] + w1 * pOrig[1] + w2 * pB[1]) / denom,
    (w0 * pA[2] + w1 * pOrig[2] + w2 * pB[2]) / denom,
  ];
}

function sanitizePolygonVerts(
  mesh: EditableMesh,
  vertIds: string[],
): string[] | null {
  const deduped: string[] = [];
  for (const vid of vertIds) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== vid) {
      deduped.push(vid);
    }
  }
  while (deduped.length > 1 && deduped[0] === deduped[deduped.length - 1]) {
    deduped.pop();
  }
  if (deduped.length < 3 || new Set(deduped).size < 3) return null;

  // Reject zero-length edges or zero-area sliver faces
  const k = deduped.length;
  for (let i = 0; i < k; i++) {
    const a = mesh.getVertex(deduped[i])?.position;
    const b = mesh.getVertex(deduped[(i + 1) % k])?.position;
    if (!a || !b) return null;
    if (lenVec(subVec(b, a)) <= 1e-6) {
      return null;
    }
  }
  if (computePolygonRawArea2(mesh, deduped) <= 1e-10) {
    return null;
  }
  return deduped;
}

function canonicalFaceVertexSetKey(vertIds: string[]): string {
  return [...vertIds].sort().join('|');
}

function inspectTopologyStats(mesh: EditableMesh): {
  ngonCount: number;
  triangleCount: number;
  nonManifoldEdges: number;
} {
  let ngonCount = 0;
  let triangleCount = 0;
  for (const f of mesh.faces) {
    if (f.vertexIds.length === 3) triangleCount++;
    else if (f.vertexIds.length > 4) ngonCount++;
  }
  let nonManifoldEdges = 0;
  for (const e of mesh.edges) {
    if (mesh.getFacesForEdge(e.id).length > 2) nonManifoldEdges++;
  }
  return { ngonCount, triangleCount, nonManifoldEdges };
}

/**
 * Evaluates the non-destructive Bevel modifier across a mesh.
 * Supports Angle, All Edges, and Edge Bevel Weight limit methods, multi-segment
 * rounded/profiled strips, concentric quad-grid corner patches, overlap clamping,
 * Harden Normals shading, and tablet face-budget protection.
 */
export function evaluateBevelModifier(
  sourceSerialized: SerializedEditableMesh,
  rawParams: unknown,
  modifierId: string,
  options: { isApplying?: boolean } = {},
): BevelEvaluationResult {
  const params: BevelModifierParams = normalizeBevelParams(rawParams);
  const mesh = EditableMesh.fromJSON(sourceSerialized);
  const srcStats = inspectTopologyStats(mesh);

  if (mesh.faces.length === 0 || mesh.edges.length === 0) {
    return {
      mesh: mesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'bevel',
        status: 'warning',
        code: 'empty_mesh',
        message: 'La malla no contiene aristas o caras válidas para biselar.',
        vertexCount: mesh.vertices.length,
        edgeCount: mesh.edges.length,
        faceCount: mesh.faces.length,
        ...srcStats,
      },
    };
  }

  // Precompute valid face normals
  const faceNormals = new Map<string, Vec3>();
  const validFaceIds = new Set<string>();
  for (const face of mesh.faces) {
    if (!isFaceDegenerate(mesh, face)) {
      validFaceIds.add(face.id);
      faceNormals.set(face.id, mesh.computeFaceNormal(face));
    }
  }

  // Filter target edges based on limitMethod
  const bevelEdgeIds = new Set<string>();
  const edgeTargetWidth = new Map<string, number>();

  for (const edge of mesh.edges) {
    const adjFaces = mesh
      .getFacesForEdge(edge.id)
      .filter((fid) => validFaceIds.has(fid));
    if (adjFaces.length !== 2) continue;

    if (params.limitMethod === 'all') {
      bevelEdgeIds.add(edge.id);
      edgeTargetWidth.set(edge.id, params.amount);
    } else if (params.limitMethod === 'angle') {
      const n0 = faceNormals.get(adjFaces[0])!;
      const n1 = faceNormals.get(adjFaces[1])!;
      const dot = Math.max(-1, Math.min(1, dotVec(n0, n1)));
      const angleDeg = (Math.acos(dot) * 180) / Math.PI;
      if (angleDeg >= params.angleLimit - 1e-3) {
        bevelEdgeIds.add(edge.id);
        edgeTargetWidth.set(edge.id, params.amount);
      }
    } else if (params.limitMethod === 'weight') {
      const w = typeof edge.bevelWeight === 'number' ? edge.bevelWeight : 0;
      if (w > 1e-4) {
        bevelEdgeIds.add(edge.id);
        edgeTargetWidth.set(
          edge.id,
          params.amount * Math.max(0.05, Math.min(2, w)),
        );
      }
    }
  }

  if (bevelEdgeIds.size === 0) {
    const isWeight = params.limitMethod === 'weight';
    return {
      mesh: mesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'bevel',
        status: 'warning',
        code: isWeight ? 'no_edge_weights' : 'no_bevel_edges',
        message: isWeight
          ? 'Ninguna arista tiene peso de bisel (> 0). Usa Angle o All Edges para biselar esta malla.'
          : 'Ninguna arista cumple el umbral de biselado actual.',
        vertexCount: mesh.vertices.length,
        edgeCount: mesh.edges.length,
        faceCount: mesh.faces.length,
        ...srcStats,
      },
    };
  }

  if (params.amount < 1e-5) {
    return {
      mesh: mesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'bevel',
        status: 'ok',
        vertexCount: mesh.vertices.length,
        edgeCount: mesh.edges.length,
        faceCount: mesh.faces.length,
        ...srcStats,
      },
    };
  }

  // Estimate polygon budget prior to generating geometry
  const touchedVertices = new Set<string>();
  for (const eid of bevelEdgeIds) {
    const e = mesh.getEdge(eid)!;
    touchedVertices.add(e.v0);
    touchedVertices.add(e.v1);
  }

  const estimatedFaces =
    mesh.faces.length +
    bevelEdgeIds.size * params.segments +
    touchedVertices.size * Math.max(1, params.segments * 2);

  if (estimatedFaces > TABLET_BEVEL_FACE_BUDGET) {
    const msg = `Bevel excede el presupuesto de tablet (~${estimatedFaces.toLocaleString()} > ${TABLET_BEVEL_FACE_BUDGET.toLocaleString()} caras). Reduce segmentos o usa Limit Method: Angle.`;
    return {
      mesh: mesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'bevel',
        status: options.isApplying ? 'error' : 'warning',
        code: 'budget_exceeded',
        message: msg,
        vertexCount: mesh.vertices.length,
        edgeCount: mesh.edges.length,
        faceCount: mesh.faces.length,
        ...srcStats,
        budgetExceeded: true,
      },
    };
  }

  const origVertexNormals = new Map<string, Vec3>();
  for (const vid of touchedVertices) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const fid of mesh.getFacesForVertex(vid)) {
      const fn = faceNormals.get(fid);
      if (fn) {
        sx += fn[0];
        sy += fn[1];
        sz += fn[2];
      }
    }
    origVertexNormals.set(vid, normVec([sx, sy, sz], [0, 0, 1]));
  }

  // Determine which non-beveled edges at touched vertices actually border a beveled face at that vertex
  // Map: `${vid}::${eid}` -> offset vector from origPos along that edge
  const nonBevelEdgeSplitOffset = new Map<string, Vec3>();
  const nonBevelEdgeHasBevelNeighbor = new Set<string>();

  for (const face of mesh.faces) {
    if (!validFaceIds.has(face.id)) continue;
    const k = face.vertexIds.length;
    for (let i = 0; i < k; i++) {
      const vid = face.vertexIds[i];
      if (!touchedVertices.has(vid)) continue;
      const prevId = face.vertexIds[(i - 1 + k) % k];
      const nextId = face.vertexIds[(i + 1) % k];
      const eInId = mesh.findEdgeId(prevId, vid);
      const eOutId = mesh.findEdgeId(vid, nextId);
      const inBev = Boolean(eInId && bevelEdgeIds.has(eInId));
      const outBev = Boolean(eOutId && bevelEdgeIds.has(eOutId));
      if (inBev && !outBev && eOutId) {
        nonBevelEdgeHasBevelNeighbor.add(`${vid}::${eOutId}`);
      } else if (!inBev && outBev && eInId) {
        nonBevelEdgeHasBevelNeighbor.add(`${vid}::${eInId}`);
      }
    }
  }

  // Compute exact corner offsets Δp (relative to origPos) for every (vid, fid) and every split (vid, nonBevelEdge)
  const cornerDeltaMap = new Map<string, Vec3>(); // `${vid}::${fid}` -> Δp
  const nonBevelSplitAccum = new Map<
    string,
    { sumDist: number; count: number; dir: Vec3; edgeLen: number }
  >();

  for (const face of mesh.faces) {
    if (!validFaceIds.has(face.id)) continue;
    const fn = faceNormals.get(face.id)!;
    const k = face.vertexIds.length;

    for (let i = 0; i < k; i++) {
      const vid = face.vertexIds[i];
      if (!touchedVertices.has(vid)) continue;

      const vPos = mesh.getVertex(vid)!.position;
      const prevId = face.vertexIds[(i - 1 + k) % k];
      const nextId = face.vertexIds[(i + 1) % k];
      const pPrev = mesh.getVertex(prevId)!.position;
      const pNext = mesh.getVertex(nextId)!.position;

      const vToPrev = subVec(pPrev, vPos);
      const vToNext = subVec(pNext, vPos);
      const lenPrev = lenVec(vToPrev);
      const lenNext = lenVec(vToNext);
      if (lenPrev < 1e-6 || lenNext < 1e-6) continue;

      const dPrev = scaleVec(vToPrev, 1 / lenPrev);
      const dNext = scaleVec(vToNext, 1 / lenNext);

      const eInId = mesh.findEdgeId(prevId, vid);
      const eOutId = mesh.findEdgeId(vid, nextId);
      const wIn = eInId && bevelEdgeIds.has(eInId) ? edgeTargetWidth.get(eInId)! : 0;
      const wOut = eOutId && bevelEdgeIds.has(eOutId) ? edgeTargetWidth.get(eOutId)! : 0;

      if (wIn > 0 && wOut > 0) {
        // Exact tangent-plane intersection of the two inward offset lines
        const uIn = normVec(crossVec(dPrev, fn), dNext);
        const uOut = normVec(crossVec(fn, dNext), dPrev);
        const c = Math.max(-0.9999, Math.min(0.9999, dotVec(uIn, uOut)));
        const det = 1 - c * c;

        let delta: Vec3;
        if (det > 1e-4) {
          const a = (wIn - c * wOut) / det;
          const b = (wOut - c * wIn) / det;
          delta = addVec(scaleVec(uIn, a), scaleVec(uOut, b));
        } else if (c >= 0) {
          // ~180° collinear edges along face perimeter
          delta = scaleVec(uIn, 0.5 * (wIn + wOut));
        } else {
          // ~0° sharp spike fallback
          const bis = normVec(addVec(dPrev, dNext), uIn);
          delta = scaleVec(bis, 0.5 * (wIn + wOut));
        }

        // Prevent sharp-angle spike explosion before global overlap check
        const maxLocal = Math.min(lenPrev, lenNext) * 0.85;
        const dLen = lenVec(delta);
        if (dLen > maxLocal && dLen > 1e-6) {
          delta = scaleVec(delta, maxLocal / dLen);
        }
        cornerDeltaMap.set(`${vid}::${face.id}`, delta);
      } else if (wIn > 0 && !wOut && eOutId) {
        const sinA = lenVec(crossVec(dPrev, dNext));
        const slideDist = wIn / Math.max(0.25, sinA);
        const key = `${vid}::${eOutId}`;
        const acc = nonBevelSplitAccum.get(key) ?? {
          sumDist: 0,
          count: 0,
          dir: dNext,
          edgeLen: lenNext,
        };
        acc.sumDist += slideDist;
        acc.count += 1;
        nonBevelSplitAccum.set(key, acc);
      } else if (!wIn && wOut > 0 && eInId) {
        const sinA = lenVec(crossVec(dPrev, dNext));
        const slideDist = wOut / Math.max(0.25, sinA);
        const key = `${vid}::${eInId}`;
        const acc = nonBevelSplitAccum.get(key) ?? {
          sumDist: 0,
          count: 0,
          dir: dPrev,
          edgeLen: lenPrev,
        };
        acc.sumDist += slideDist;
        acc.count += 1;
        nonBevelSplitAccum.set(key, acc);
      }
    }
  }

  for (const [key, acc] of nonBevelSplitAccum.entries()) {
    const avgDist = acc.sumDist / Math.max(1, acc.count);
    const cappedDist = Math.min(avgDist, acc.edgeLen * 0.85);
    nonBevelEdgeSplitOffset.set(key, scaleVec(acc.dir, cappedDist));
  }

  // Helper to query the delta offset of vertex vid as seen at corner i of face
  const getCornerDelta = (face: MeshFace, cornerIdx: number): Vec3 => {
    const k = face.vertexIds.length;
    const vid = face.vertexIds[cornerIdx];
    if (!touchedVertices.has(vid)) return [0, 0, 0];

    const cKey = `${vid}::${face.id}`;
    const exactCorner = cornerDeltaMap.get(cKey);
    if (exactCorner) return exactCorner;

    const prevId = face.vertexIds[(cornerIdx - 1 + k) % k];
    const nextId = face.vertexIds[(cornerIdx + 1) % k];
    const eInId = mesh.findEdgeId(prevId, vid);
    const eOutId = mesh.findEdgeId(vid, nextId);
    const inBev = Boolean(eInId && bevelEdgeIds.has(eInId));
    const outBev = Boolean(eOutId && bevelEdgeIds.has(eOutId));

    if (inBev && !outBev && eOutId) {
      return nonBevelEdgeSplitOffset.get(`${vid}::${eOutId}`) ?? [0, 0, 0];
    }
    if (!inBev && outBev && eInId) {
      return nonBevelEdgeSplitOffset.get(`${vid}::${eInId}`) ?? [0, 0, 0];
    }
    return [0, 0, 0];
  };

  // Clamp Overlap: ensure corner offsets along any edge never cross past each other
  let globalClampScale = 1.0;
  if (params.clampOverlap) {
    for (const face of mesh.faces) {
      if (!validFaceIds.has(face.id)) continue;
      const k = face.vertexIds.length;
      for (let i = 0; i < k; i++) {
        const nextIdx = (i + 1) % k;
        const vidA = face.vertexIds[i];
        const vidB = face.vertexIds[nextIdx];
        if (!touchedVertices.has(vidA) && !touchedVertices.has(vidB)) continue;

        const pA = mesh.getVertex(vidA)!.position;
        const pB = mesh.getVertex(vidB)!.position;
        const ab = subVec(pB, pA);
        const edgeLen = lenVec(ab);
        if (edgeLen < 1e-6) continue;
        const edgeDir = scaleVec(ab, 1 / edgeLen);

        const dA = getCornerDelta(face, i);
        const dB = getCornerDelta(face, nextIdx);
        // Positive advance means A moves toward B and/or B moves toward A
        const advance = dotVec(subVec(dA, dB), edgeDir);
        const safeSpan = edgeLen * 0.92;
        if (advance > safeSpan && advance > 1e-6) {
          globalClampScale = Math.min(globalClampScale, safeSpan / advance);
        }
      }
    }

    // Also clamp non-beveled shared edges against opposing splits at both ends
    for (const edge of mesh.edges) {
      if (bevelEdgeIds.has(edge.id)) continue;
      const d0 = nonBevelEdgeSplitOffset.get(`${edge.v0}::${edge.id}`);
      const d1 = nonBevelEdgeSplitOffset.get(`${edge.v1}::${edge.id}`);
      if (!d0 && !d1) continue;
      const p0 = mesh.getVertex(edge.v0)!.position;
      const p1 = mesh.getVertex(edge.v1)!.position;
      const edgeLen = lenVec(subVec(p1, p0));
      if (edgeLen < 1e-6) continue;
      const totalSlide = (d0 ? lenVec(d0) : 0) + (d1 ? lenVec(d1) : 0);
      const safeSpan = edgeLen * 0.92;
      if (totalSlide > safeSpan && totalSlide > 1e-6) {
        globalClampScale = Math.min(globalClampScale, safeSpan / totalSlide);
      }
    }
  }

  // Instantiate actual corner & split vertices in the mesh
  const cornerVertexMap = new Map<string, string>(); // `${vid}::${fid}` -> vertex id
  const nonBevelEdgeSplitMap = new Map<string, string>(); // `${vid}::${eid}` -> vertex id

  for (const [key, delta] of cornerDeltaMap.entries()) {
    const sepIdx = key.indexOf('::');
    const vid = key.slice(0, sepIdx);
    const orig = mesh.getVertex(vid)!;
    const pos = addVec(orig.position, scaleVec(delta, globalClampScale));
    const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
    if (orig.uv) nv.uv = [orig.uv[0], orig.uv[1]];
    cornerVertexMap.set(key, nv.id);
  }

  for (const [key, delta] of nonBevelEdgeSplitOffset.entries()) {
    if (!nonBevelEdgeHasBevelNeighbor.has(key)) continue;
    const sepIdx = key.indexOf('::');
    const vid = key.slice(0, sepIdx);
    const orig = mesh.getVertex(vid)!;
    const pos = addVec(orig.position, scaleVec(delta, globalClampScale));
    const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
    if (orig.uv) nv.uv = [orig.uv[0], orig.uv[1]];
    nonBevelEdgeSplitMap.set(key, nv.id);
  }

  // Replace corner indices inside every face touching touchedVertices
  const faceReplacements = new Map<
    string,
    { verts: string[]; origNormal: Vec3 }
  >();
  const facesToDelete = new Set<string>();
  const vertexFanLinks = new Map<string, [string, string][]>();

  for (const face of mesh.faces) {
    if (!validFaceIds.has(face.id)) continue;
    if (!face.vertexIds.some((vid) => touchedVertices.has(vid))) continue;

    facesToDelete.add(face.id);
    const k = face.vertexIds.length;
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
      const inBev = Boolean(eInId && bevelEdgeIds.has(eInId));
      const outBev = Boolean(eOutId && bevelEdgeIds.has(eOutId));

      if (inBev && outBev) {
        const cv = cornerVertexMap.get(`${vid}::${face.id}`);
        newVerts.push(cv ?? vid);
      } else if (inBev && !outBev && eOutId) {
        const sv = nonBevelEdgeSplitMap.get(`${vid}::${eOutId}`);
        if (sv) {
          cornerVertexMap.set(`${vid}::${face.id}`, sv);
          newVerts.push(sv);
        } else {
          cornerVertexMap.set(`${vid}::${face.id}`, vid);
          newVerts.push(vid);
        }
      } else if (!inBev && outBev && eInId) {
        const sv = nonBevelEdgeSplitMap.get(`${vid}::${eInId}`);
        if (sv) {
          cornerVertexMap.set(`${vid}::${face.id}`, sv);
          newVerts.push(sv);
        } else {
          cornerVertexMap.set(`${vid}::${face.id}`, vid);
          newVerts.push(vid);
        }
      } else {
        const sIn = eInId ? nonBevelEdgeSplitMap.get(`${vid}::${eInId}`) : undefined;
        const sOut = eOutId
          ? nonBevelEdgeSplitMap.get(`${vid}::${eOutId}`)
          : undefined;

        if (sIn && sOut && sIn !== sOut) {
          newVerts.push(sIn, sOut);
          let links = vertexFanLinks.get(vid);
          if (!links) {
            links = [];
            vertexFanLinks.set(vid, links);
          }
          links.push([sIn, sOut]);
        } else if (sIn) {
          newVerts.push(sIn, vid);
          let links = vertexFanLinks.get(vid);
          if (!links) {
            links = [];
            vertexFanLinks.set(vid, links);
          }
          links.push([sIn, vid]);
        } else if (sOut) {
          newVerts.push(vid, sOut);
          let links = vertexFanLinks.get(vid);
          if (!links) {
            links = [];
            vertexFanLinks.set(vid, links);
          }
          links.push([vid, sOut]);
        } else {
          newVerts.push(vid);
        }
      }
    }

    faceReplacements.set(face.id, {
      verts: newVerts,
      origNormal: faceNormals.get(face.id)!,
    });
  }

  // Track candidate old edges to prune dangling unreferenced edges after splitting
  const candidateOldEdgesHadFaces = new Set<string>();
  for (const vid of touchedVertices) {
    for (const eid of mesh.getEdgesForVertex(vid)) {
      if (mesh.getFacesForEdge(eid).length > 0) {
        candidateOldEdgesHadFaces.add(eid);
      }
    }
  }

  // Build bevel strips along each beveled edge, caching cross-rails by canonical endpoint pair
  // so 2-edge vertices (e.g., cylinder rim, L-bevel) share identical midpoint vertices cleanly!
  const segments = params.segments;
  const profile = params.profile;
  const bevelFaceSpecs: string[][] = [];
  const vertexCornerChains = new Map<string, string[][]>();
  // `${vid}::${canonicalEdgeKey(endA, endB)}` -> ordered array [endA, mid1, ..., endB]
  const sharedCrossRailCache = new Map<string, string[]>();

  const getOrBuildCrossRail = (
    vid: string,
    endStart: string,
    endFinish: string,
  ): string[] => {
    if (segments === 1 || endStart === endFinish) {
      return endStart === endFinish ? [endStart] : [endStart, endFinish];
    }
    const cacheKey = `${vid}::${canonicalEdgeKey(endStart, endFinish)}`;
    const cached = sharedCrossRailCache.get(cacheKey);
    if (cached) {
      return cached[0] === endStart ? cached : [...cached].reverse();
    }

    const pOrig = mesh.getVertex(vid)!.position;
    const pA = mesh.getVertex(endStart)!.position;
    const pB = mesh.getVertex(endFinish)!.position;
    const rail: string[] = [endStart];

    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const pos = evalProfilePoint(pA, pB, pOrig, t, profile);
      const nv = mesh.addVertex(pos[0], pos[1], pos[2]);
      rail.push(nv.id);
    }
    rail.push(endFinish);
    sharedCrossRailCache.set(cacheKey, rail);
    return rail;
  };

  for (const eid of bevelEdgeIds) {
    const edge = mesh.getEdge(eid);
    if (!edge) continue;
    const adjFaces = mesh
      .getFacesForEdge(eid)
      .filter((fid) => validFaceIds.has(fid));
    if (adjFaces.length !== 2) continue;

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

    const railsU = getOrBuildCrossRail(edge.v0, uB, uF);
    const railsV = getOrBuildCrossRail(edge.v1, vB, vF);

    if (railsU.length === segments + 1 && railsV.length === segments + 1) {
      for (let s = 0; s < segments; s++) {
        bevelFaceSpecs.push([railsU[s], railsV[s], railsV[s + 1], railsU[s + 1]]);
      }
    } else {
      // Degenerate single-point end fallback
      const a0 = railsU[0];
      const a1 = railsU[railsU.length - 1];
      const b0 = railsV[0];
      const b1 = railsV[railsV.length - 1];
      bevelFaceSpecs.push([a0, b0, b1, a1]);
    }

    if (uF !== uB) {
      let arr = vertexCornerChains.get(edge.v0);
      if (!arr) {
        arr = [];
        vertexCornerChains.set(edge.v0, arr);
      }
      arr.push([...railsU].reverse());
    }
    if (vF !== vB) {
      let arr = vertexCornerChains.get(edge.v1);
      if (!arr) {
        arr = [];
        vertexCornerChains.set(edge.v1, arr);
      }
      arr.push([...railsV]);
    }
  }

  // Helper: splice multi-segment rail intermediates into bridging faces containing (endA, endB)
  const spliceChainIntoAdjacentFace = (chain: string[]): boolean => {
    if (chain.length <= 2) return false;
    const endA = chain[0];
    const endB = chain[chain.length - 1];
    const mids = chain.slice(1, -1);
    let spliced = false;

    for (const [fid, entry] of faceReplacements.entries()) {
      const verts = entry.verts;
      const m = verts.length;
      for (let i = 0; i < m; i++) {
        const va = verts[i];
        const vb = verts[(i + 1) % m];
        if (va === endA && vb === endB) {
          faceReplacements.set(fid, {
            ...entry,
            verts: [...verts.slice(0, i + 1), ...mids, ...verts.slice(i + 1)],
          });
          spliced = true;
          break;
        }
        if (va === endB && vb === endA) {
          faceReplacements.set(fid, {
            ...entry,
            verts: [
              ...verts.slice(0, i + 1),
              ...[...mids].reverse(),
              ...verts.slice(i + 1),
            ],
          });
          spliced = true;
          break;
        }
      }
    }
    return spliced;
  };

  // Recursive quad-grid peeling corner builder for k-way corners (k >= 3) with equal segment chains
  const cornerFaceSpecs: string[][] = [];

  const emitUniformCornerPatch = (
    chains: string[][],
    pOrig: Vec3,
    outwardHint: Vec3,
  ) => {
    const k = chains.length;
    const segLen = chains[0].length - 1;
    if (k < 3 || segLen < 1) return;

    // Base case S = 1: single k-gon
    if (segLen === 1) {
      const poly = chains.map((c) => c[0]);
      const pn = computePolygonNewellNormal(mesh, poly);
      cornerFaceSpecs.push(
        dotVec(pn, outwardHint) < 0 ? [...poly].reverse() : poly,
      );
      return;
    }

    // Base case S = 2: 1 domed center vertex + k quads (all quads!)
    if (segLen === 2) {
      const mids = chains.map((c) => mesh.getVertex(c[1])!.position);
      const midCentroid: Vec3 = [
        mids.reduce((s, p) => s + p[0], 0) / k,
        mids.reduce((s, p) => s + p[1], 0) / k,
        mids.reduce((s, p) => s + p[2], 0) / k,
      ];
      // Spherical bulge matching profile [0.05..1.0]
      let centerPos: Vec3;
      if (profile <= 0.25) {
        const alpha = (profile - 0.25) / 0.25;
        centerPos = addVec(
          midCentroid,
          scaleVec(subVec(pOrig, midCentroid), Math.max(-0.5, alpha * 0.35)),
        );
      } else {
        const bulgeT = Math.min(
          0.92,
          ((profile - 0.25) / 0.75) * 0.65,
        );
        centerPos = lerpVec(midCentroid, pOrig, bulgeT);
      }
      const centerV = mesh.addVertex(centerPos[0], centerPos[1], centerPos[2]);

      for (let i = 0; i < k; i++) {
        const prevChain = chains[(i - 1 + k) % k];
        const currChain = chains[i];
        let quad = [prevChain[1], currChain[0], currChain[1], centerV.id];
        const qn = computePolygonNewellNormal(mesh, quad);
        if (dotVec(qn, outwardHint) < 0) quad = [...quad].reverse();
        cornerFaceSpecs.push(quad);
      }
      return;
    }

    // S >= 3: peel 1 concentric ring of quads inward, reducing S -> S - 2
    const innerStep = segLen - 2;
    const innerCorners: string[] = [];

    for (let i = 0; i < k; i++) {
      const prevChain = chains[(i - 1 + k) % k];
      const currChain = chains[i];
      const pPrev = mesh.getVertex(prevChain[segLen - 1])!.position;
      const pNext = mesh.getVertex(currChain[1])!.position;
      const pCorner = mesh.getVertex(currChain[0])!.position;
      const chordMid = lerpVec(pPrev, pNext, 0.5);
      // Smooth inward position gently arched toward pOrig/pCorner according to profile
      const basePos = lerpVec(chordMid, pCorner, 0.2);
      const bulge =
        profile > 0.25
          ? Math.min(0.45, ((profile - 0.25) / 0.75) * 0.35)
          : 0;
      const qPos = lerpVec(basePos, pOrig, bulge);
      innerCorners.push(mesh.addVertex(qPos[0], qPos[1], qPos[2]).id);
    }

    const innerChains: string[][] = [];
    for (let i = 0; i < k; i++) {
      const qStart = innerCorners[i];
      const qEnd = innerCorners[(i + 1) % k];
      const innerSide: string[] = [qStart];
      if (innerStep > 1) {
        const pQ0 = mesh.getVertex(qStart)!.position;
        const pQ1 = mesh.getVertex(qEnd)!.position;
        for (let j = 1; j < innerStep; j++) {
          const t = j / innerStep;
          const pOuter = mesh.getVertex(chains[i][j + 1])!.position;
          const lin = lerpVec(pQ0, pQ1, t);
          const pos = lerpVec(lin, pOuter, 0.15);
          innerSide.push(mesh.addVertex(pos[0], pos[1], pos[2]).id);
        }
      }
      innerSide.push(qEnd);
      innerChains.push(innerSide);
    }

    // Emit k corner quads
    for (let i = 0; i < k; i++) {
      const prevChain = chains[(i - 1 + k) % k];
      const currChain = chains[i];
      let quad = [
        prevChain[segLen - 1],
        currChain[0],
        currChain[1],
        innerCorners[i],
      ];
      const qn = computePolygonNewellNormal(mesh, quad);
      if (dotVec(qn, outwardHint) < 0) quad = [...quad].reverse();
      cornerFaceSpecs.push(quad);
    }

    // Emit k * innerStep side quads
    for (let i = 0; i < k; i++) {
      const outer = chains[i];
      const inner = innerChains[i];
      for (let j = 0; j < innerStep; j++) {
        let quad = [outer[j + 1], outer[j + 2], inner[j + 1], inner[j]];
        const qn = computePolygonNewellNormal(mesh, quad);
        if (dotVec(qn, outwardHint) < 0) quad = [...quad].reverse();
        cornerFaceSpecs.push(quad);
      }
    }

    emitUniformCornerPatch(innerChains, pOrig, outwardHint);
  };

  // Assemble corner caps / end-splices around every reached vertex
  for (const [vid, rawChains] of vertexCornerChains.entries()) {
    const fanLinks = vertexFanLinks.get(vid) ?? [];

    // Deduplicate identical undirected endpoint chains when 2 beveled strips meet along 1 seam
    if (rawChains.length === 2 && fanLinks.length === 0) {
      const k0 = canonicalEdgeKey(
        rawChains[0][0],
        rawChains[0][rawChains[0].length - 1],
      );
      const k1 = canonicalEdgeKey(
        rawChains[1][0],
        rawChains[1][rawChains[1].length - 1],
      );
      if (k0 === k1) {
        // Two bevel strips share this single seam edge cleanly; no corner cap needed
        continue;
      }
    }

    if (rawChains.length === 1) {
      const chain = rawChains[0];
      const endA = chain[0];
      const endB = chain[chain.length - 1];

      if (fanLinks.length <= 1) {
        const spliced = spliceChainIntoAdjacentFace(chain);
        if (spliced || chain.length <= 2) {
          continue;
        }
      }

      // Open vertex fan across >= 2 bridging faces: build closed perimeter polygon/fan
      const fullArcs: string[][] = [chain, ...fanLinks.map(([a, b]) => [b, a])];
      const unused = new Set<number>(fullArcs.map((_, idx) => idx));
      unused.delete(0);
      const loop: string[] = [...chain];
      let curr = endB;
      while (curr !== endA && unused.size > 0) {
        let foundIdx = -1;
        let rev = false;
        for (const idx of unused) {
          const arc = fullArcs[idx];
          if (arc[0] === curr) {
            foundIdx = idx;
            rev = false;
            break;
          }
          if (arc[arc.length - 1] === curr) {
            foundIdx = idx;
            rev = true;
            break;
          }
        }
        if (foundIdx === -1) break;
        unused.delete(foundIdx);
        const seg = rev ? [...fullArcs[foundIdx]].reverse() : fullArcs[foundIdx];
        for (let i = 1; i < seg.length; i++) loop.push(seg[i]);
        curr = loop[loop.length - 1];
      }
      if (loop.length >= 2 && loop[loop.length - 1] === loop[0]) loop.pop();

      if (loop.length >= 3 && new Set(loop).size >= 3) {
        const origN = origVertexNormals.get(vid) ?? [0, 0, 1];
        const polyN = computePolygonNewellNormal(mesh, loop);
        const oriented = dotVec(polyN, origN) < 0 ? [...loop].reverse() : loop;
        cornerFaceSpecs.push(oriented);
      }
      continue;
    }

    // Order rawChains + any fanLinks into a closed perimeter loop around vid
    const combinedArcs: string[][] = [
      ...rawChains,
      ...fanLinks.map(([a, b]) => [b, a]),
    ];
    const unused = new Set<number>(combinedArcs.map((_, idx) => idx));
    unused.delete(0);
    const orderedChains: string[][] = [combinedArcs[0]];
    const startVert = combinedArcs[0][0];
    let currEnd = combinedArcs[0][combinedArcs[0].length - 1];

    while (currEnd !== startVert && unused.size > 0) {
      let foundIdx = -1;
      let reversed = false;
      for (const idx of unused) {
        if (idx >= rawChains.length) continue;
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
      const seg = reversed
        ? [...combinedArcs[foundIdx]].reverse()
        : combinedArcs[foundIdx];
      orderedChains.push(seg);
      currEnd = seg[seg.length - 1];
    }

    if (currEnd !== startVert) continue;

    const origN = origVertexNormals.get(vid) ?? [0, 0, 1];
    const pOrig = mesh.getVertex(vid)!.position;

    // Check if all arcs are beveled chains of uniform length >= 3 chains (e.g. cube/octahedron/pole corner)
    const isUniformMultiCorner =
      orderedChains.length >= 3 &&
      orderedChains.every((c) => c.length === segments + 1);

    if (isUniformMultiCorner) {
      // Orient chains consistently around origN
      const cornerVerts = orderedChains.map((c) => c[0]);
      const loopN = computePolygonNewellNormal(mesh, cornerVerts);
      const alignedChains =
        dotVec(loopN, origN) < 0
          ? orderedChains.map((c) => [...c].reverse()).reverse()
          : orderedChains;
      emitUniformCornerPatch(alignedChains, pOrig, origN);
    } else {
      const orderedPerimeter: string[] = [];
      for (const ch of orderedChains) {
        for (let i = 0; i < ch.length - 1; i++) {
          orderedPerimeter.push(ch[i]);
        }
      }
      if (orderedPerimeter.length >= 3 && new Set(orderedPerimeter).size >= 3) {
        const polyN = computePolygonNewellNormal(mesh, orderedPerimeter);
        const oriented =
          dotVec(polyN, origN) < 0
            ? [...orderedPerimeter].reverse()
            : orderedPerimeter;

        if (segments > 1 && oriented.length >= 5) {
          const loopCenter = mesh.computeCentroid(oriented) ?? pOrig;
          const centerPos = lerpVec(
            loopCenter,
            pOrig,
            Math.max(0, Math.min(0.8, ((profile - 0.25) / 0.75) * 0.65)),
          );
          const centerV = mesh.addVertex(
            centerPos[0],
            centerPos[1],
            centerPos[2],
          );
          const m = oriented.length;
          for (let i = 0; i < m; i++) {
            cornerFaceSpecs.push([
              oriented[i],
              oriented[(i + 1) % m],
              centerV.id,
            ]);
          }
        } else {
          cornerFaceSpecs.push(oriented);
        }
      }
    }
  }

  // Apply face replacements, bevel strips, and corner patches
  mesh.deleteFaces(facesToDelete);
  mesh.deleteEdges(bevelEdgeIds);

  const existingFaceKeys = new Set<string>(
    mesh.faces.map((f) => canonicalFaceVertexSetKey(f.vertexIds)),
  );
  const hardFaceNormals = new Map<string, Vec3>();

  for (const entry of faceReplacements.values()) {
    const clean = sanitizePolygonVerts(mesh, entry.verts);
    if (!clean) continue;
    const key = canonicalFaceVertexSetKey(clean);
    if (existingFaceKeys.has(key)) continue;
    existingFaceKeys.add(key);
    const nf = mesh.addFace(clean);
    if (nf) {
      hardFaceNormals.set(nf.id, entry.origNormal);
    }
  }

  for (const verts of bevelFaceSpecs) {
    const clean = sanitizePolygonVerts(mesh, verts);
    if (!clean) continue;
    const key = canonicalFaceVertexSetKey(clean);
    if (existingFaceKeys.has(key)) continue;
    existingFaceKeys.add(key);
    mesh.addFace(clean);
  }

  for (const verts of cornerFaceSpecs) {
    const clean = sanitizePolygonVerts(mesh, verts);
    if (!clean) continue;
    const key = canonicalFaceVertexSetKey(clean);
    if (existingFaceKeys.has(key)) continue;
    existingFaceKeys.add(key);
    mesh.addFace(clean);
  }

  // Clean up unreferenced old edges and orphan vertices
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
  mesh.clearCustomNormals();
  mesh.rebuildIndices();

  // Optional Harden Normals: keep surviving planar faces flat and blend bevel strip boundary normals
  if (params.hardenNormals) {
    for (const face of mesh.faces) {
      const hardN = hardFaceNormals.get(face.id);
      if (hardN) {
        face.normals = face.vertexIds.map(() => [hardN[0], hardN[1], hardN[2]]);
      } else if (!faceReplacements.has(face.id)) {
        // Untouched original faces (e.g. from selective angle bevel) also stay flat
        const isOrigUntouched = !face.vertexIds.some((vid) =>
          !sourceSerialized.vertices.some((sv) => sv.id === vid),
        );
        if (isOrigUntouched) {
          const fn = mesh.computeFaceNormal(face);
          face.normals = face.vertexIds.map(() => [fn[0], fn[1], fn[2]]);
        }
      }
    }

    // Set smooth vertex normals on bevel & corner vertices, matching adjacent flat face normal at boundary rails
    for (const v of mesh.vertices) {
      const incFaces = mesh.getFacesForVertex(v.id);
      if (incFaces.length === 0) continue;

      const adjacentHardNormals: Vec3[] = [];
      for (const fid of incFaces) {
        const f = mesh.getFace(fid);
        if (f && f.normals && f.normals.length > 0) {
          adjacentHardNormals.push(f.normals[0]);
        }
      }

      if (adjacentHardNormals.length === 1) {
        // Boundary rail vertex touching 1 flat face: match its normal for razor-clean bevel transition
        v.normal = [...adjacentHardNormals[0]];
      } else {
        // Interior bevel / corner dome vertex: area-weighted average of incident face normals
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const fid of incFaces) {
          const f = mesh.getFace(fid);
          if (!f) continue;
          const area2 = computePolygonRawArea2(mesh, f.vertexIds);
          const fn = mesh.computeFaceNormal(f);
          sx += fn[0] * Math.max(1e-6, area2);
          sy += fn[1] * Math.max(1e-6, area2);
          sz += fn[2] * Math.max(1e-6, area2);
        }
        v.normal = normVec([sx, sy, sz], [0, 0, 1]);
      }
    }
  }

  const outStats = inspectTopologyStats(mesh);
  return {
    mesh: mesh.toJSON(),
    diagnostic: {
      modifierId,
      type: 'bevel',
      status: 'ok',
      vertexCount: mesh.vertices.length,
      edgeCount: mesh.edges.length,
      faceCount: mesh.faces.length,
      ...outStats,
    },
  };
}

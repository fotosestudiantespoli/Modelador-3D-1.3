import {
  canonicalEdgeKey,
  EditableMesh,
  MeshFace,
  Vec2,
  Vec3,
} from './EditableMesh';
import { EditSelectionMode, MeshOperatorResult } from './operations';

export interface ConnectVertexPathResponse {
  success: boolean;
  result: MeshOperatorResult;
  createdEdgeIds: string[];
  pathEdgeIds: string[];
  pathVertexIds: string[];
  facesSplitCount: number;
  alreadyConnected?: boolean;
  message?: string;
  error?: string;
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

function computePolygonNewellVector(mesh: EditableMesh, vertexIds: string[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = vertexIds.length;
  for (let i = 0; i < n; i++) {
    const a = mesh.getVertex(vertexIds[i])?.position;
    const b = mesh.getVertex(vertexIds[(i + 1) % n])?.position;
    if (!a || !b) continue;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function hasValidPolygonArea(mesh: EditableMesh, vertexIds: string[]): boolean {
  if (vertexIds.length < 3 || new Set(vertexIds).size !== vertexIds.length) {
    return false;
  }
  const nVec = computePolygonNewellVector(mesh, vertexIds);
  return lenVec(nVec) > 1e-9;
}

function canonicalFaceVertexKey(vertexIds: string[]): string {
  return [...vertexIds].sort().join('|');
}

function buildFaceBasis(mesh: EditableMesh, face: MeshFace): {
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
} | null {
  if (face.vertexIds.length < 3) return null;
  const v0 = mesh.getVertex(face.vertexIds[0]);
  if (!v0) return null;
  const normal = mesh.computeFaceNormal(face);
  const ref: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normVec(crossVec(ref, normal), [1, 0, 0]);
  const v = normVec(crossVec(normal, u), [0, 0, 1]);
  return { origin: v0.position, normal, u, v };
}

function projectToBasis2D(
  pos: Vec3,
  origin: Vec3,
  u: Vec3,
  v: Vec3,
): [number, number] {
  const d = subVec(pos, origin);
  return [dotVec(d, u), dotVec(d, v)];
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
  eps = 1e-6,
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
  eps = 1e-6,
): boolean {
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

function distPointToSegment2D(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function pointInPolygon2D(
  pt: [number, number],
  poly: [number, number][],
): boolean {
  // Accept points cleanly on boundary within tolerance as fallback,
  // though interior chords have strictly interior midpoints
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (distPointToSegment2D(pt, [xi, yi], [xj, yj]) < 1e-6) {
      return true;
    }
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Checks if a segment between two points on the boundary of `face`
 * lies cleanly inside the face without crossing non-incident edges or passing
 * through other vertices of the face.
 */
function isSegmentInsideFace(
  mesh: EditableMesh,
  face: MeshFace,
  posA: Vec3,
  posB: Vec3,
  ignoredVertIds: Set<string>,
  ignoredEdgeIds: Set<string>,
): boolean {
  const basis = buildFaceBasis(mesh, face);
  if (!basis) return false;

  const poly2D: [number, number][] = [];
  for (const vid of face.vertexIds) {
    const v = mesh.getVertex(vid);
    if (!v) return false;
    poly2D.push(projectToBasis2D(v.position, basis.origin, basis.u, basis.v));
  }

  const pA = projectToBasis2D(posA, basis.origin, basis.u, basis.v);
  const pB = projectToBasis2D(posB, basis.origin, basis.u, basis.v);
  if (Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) < 1e-7) {
    return false;
  }

  const n = face.vertexIds.length;
  // Check that segment doesn't pass directly over another vertex of the face
  for (let i = 0; i < n; i++) {
    const vid = face.vertexIds[i];
    if (ignoredVertIds.has(vid)) continue;
    if (distPointToSegment2D(poly2D[i], pA, pB) < 1e-5) {
      return false;
    }
  }

  // Check against all non-incident edges of the face
  for (let i = 0; i < n; i++) {
    const u = face.vertexIds[i];
    const v = face.vertexIds[(i + 1) % n];
    if (ignoredVertIds.has(u) || ignoredVertIds.has(v)) continue;
    const eid = mesh.findEdgeId(u, v);
    if (eid && ignoredEdgeIds.has(eid)) continue;
    if (segmentsIntersect2D(pA, pB, poly2D[i], poly2D[(i + 1) % n], 1e-6)) {
      return false;
    }
  }

  const mid: [number, number] = [(pA[0] + pB[0]) * 0.5, (pA[1] + pB[1]) * 0.5];
  return pointInPolygon2D(mid, poly2D);
}

function canSplitFaceBetweenVertices(
  mesh: EditableMesh,
  face: MeshFace,
  vA: string,
  vB: string,
): boolean {
  const n = face.vertexIds.length;
  if (n < 4) return false;
  const iA = face.vertexIds.indexOf(vA);
  const iB = face.vertexIds.indexOf(vB);
  if (iA === -1 || iB === -1 || iA === iB) return false;

  const lo = Math.min(iA, iB);
  const hi = Math.max(iA, iB);
  // Adjacent along face perimeter?
  if (hi - lo === 1 || (lo === 0 && hi === n - 1)) return false;

  const vertA = mesh.getVertex(vA);
  const vertB = mesh.getVertex(vB);
  if (!vertA || !vertB) return false;

  const loop1 = face.vertexIds.slice(lo, hi + 1);
  const loop2 = [...face.vertexIds.slice(hi), ...face.vertexIds.slice(0, lo + 1)];
  if (!hasValidPolygonArea(mesh, loop1) || !hasValidPolygonArea(mesh, loop2)) {
    return false;
  }

  // Reject creating an exact duplicate face
  const existingKeys = new Set(
    mesh.faces
      .filter((f) => f.id !== face.id)
      .map((f) => canonicalFaceVertexKey(f.vertexIds)),
  );
  if (
    existingKeys.has(canonicalFaceVertexKey(loop1)) ||
    existingKeys.has(canonicalFaceVertexKey(loop2))
  ) {
    return false;
  }

  return isSegmentInsideFace(
    mesh,
    face,
    vertA.position,
    vertB.position,
    new Set([vA, vB]),
    new Set(),
  );
}

/**
 * Splits `face` along chord `(vA, vB)` (both must already be non-adjacent vertices in `face`).
 * Preserves winding order, UVs, and normal orientation, and creates no duplicate vertices or edges.
 */
function splitFaceAlongVertices(
  mesh: EditableMesh,
  face: MeshFace,
  vA: string,
  vB: string,
): { edgeId: string; faceIds: [string, string] } | null {
  if (!canSplitFaceBetweenVertices(mesh, face, vA, vB)) return null;

  const n = face.vertexIds.length;
  const iA = face.vertexIds.indexOf(vA);
  const iB = face.vertexIds.indexOf(vB);
  const lo = Math.min(iA, iB);
  const hi = Math.max(iA, iB);

  const origNormal = mesh.computeFaceNormal(face);
  const loop1 = face.vertexIds.slice(lo, hi + 1);
  const loop2 = [...face.vertexIds.slice(hi), ...face.vertexIds.slice(0, lo + 1)];

  const hasUvs = Array.isArray(face.uvs) && face.uvs.length === n;
  let uvs1: Vec2[] | undefined = hasUvs ? face.uvs!.slice(lo, hi + 1) : undefined;
  let uvs2: Vec2[] | undefined = hasUvs
    ? [...face.uvs!.slice(hi), ...face.uvs!.slice(0, lo + 1)]
    : undefined;

  const n1 = normVec(computePolygonNewellVector(mesh, loop1), origNormal);
  if (dotVec(n1, origNormal) < -1e-5) {
    loop1.reverse();
    if (uvs1) uvs1 = [...uvs1].reverse();
  }

  const n2 = normVec(computePolygonNewellVector(mesh, loop2), origNormal);
  if (dotVec(n2, origNormal) < -1e-5) {
    loop2.reverse();
    if (uvs2) uvs2 = [...uvs2].reverse();
  }

  const savedId = face.id;
  mesh.deleteFaces(new Set([savedId]));

  const f1 = mesh.addFace(loop1);
  const f2 = mesh.addFace(loop2);
  if (!f1 || !f2) {
    return null;
  }

  if (uvs1) f1.uvs = uvs1;
  if (uvs2) f2.uvs = uvs2;

  const edgeId = mesh.findEdgeId(vA, vB);
  if (!edgeId) return null;

  return { edgeId, faceIds: [f1.id, f2.id] };
}

/**
 * Finds t in [0, 1] along edge (a, b) minimizing ||Q(t) - P|| + ||Q(t) - G||
 * using golden-section search on the strictly convex distance sum.
 */
function findOptimalEdgeCrossingT(a: Vec3, b: Vec3, p: Vec3, g: Vec3): number {
  const evalDist = (t: number) => {
    const q = lerpVec(a, b, t);
    return lenVec(subVec(q, p)) + lenVec(subVec(q, g));
  };

  let lo = 0;
  let hi = 1;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = evalDist(c);
  let fd = evalDist(d);

  for (let iter = 0; iter < 24; iter++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = evalDist(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = evalDist(d);
    }
  }
  return (lo + hi) * 0.5;
}

type PathStep =
  | {
      kind: 'vertex';
      vertexId: string;
      pos: Vec3;
      viaFaceId: string | null;
      parentIndex: number;
      gCost: number;
      fCost: number;
    }
  | {
      kind: 'edge';
      edgeId: string;
      t: number;
      pos: Vec3;
      viaFaceId: string;
      parentIndex: number;
      gCost: number;
      fCost: number;
    };

class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}
  get size(): number {
    return this.items.length;
  }
  push(item: T): void {
    this.items.push(item);
    let idx = this.items.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.compare(this.items[idx], this.items[parent]) >= 0) break;
      const tmp = this.items[idx];
      this.items[idx] = this.items[parent];
      this.items[parent] = tmp;
      idx = parent;
    }
  }
  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let idx = 0;
      const len = this.items.length;
      while (true) {
        const l = idx * 2 + 1;
        const r = idx * 2 + 2;
        let smallest = idx;
        if (l < len && this.compare(this.items[l], this.items[smallest]) < 0) {
          smallest = l;
        }
        if (r < len && this.compare(this.items[r], this.items[smallest]) < 0) {
          smallest = r;
        }
        if (smallest === idx) break;
        const tmp = this.items[idx];
        this.items[idx] = this.items[smallest];
        this.items[smallest] = tmp;
        idx = smallest;
      }
    }
    return top;
  }
}

type MaterializedPathNode =
  | { kind: 'vertex'; vertexId: string }
  | { kind: 'edge'; edgeId: string; t: number; pos: Vec3 };

interface SurfacePathResult {
  nodes: MaterializedPathNode[];
  cost: number;
}

/**
 * Searches for the shortest valid topological surface path from `vStart` to `vEnd`
 * across connected faces (preferring direct face chords / existing edges, and crossing
 * intermediate shared edges when needed—just like Blender's Connect Vertex Path).
 */
function findSurfacePath(
  mesh: EditableMesh,
  vStart: string,
  vEnd: string,
): SurfacePathResult | null {
  const startVert = mesh.getVertex(vStart);
  const endVert = mesh.getVertex(vEnd);
  if (!startVert || !endVert || vStart === vEnd) return null;

  // Fast path 1: direct existing edge
  const directEdge = mesh.findEdgeId(vStart, vEnd);
  if (directEdge) {
    return {
      nodes: [
        { kind: 'vertex', vertexId: vStart },
        { kind: 'vertex', vertexId: vEnd },
      ],
      cost: lenVec(subVec(endVert.position, startVert.position)),
    };
  }

  // Fast path 2: same face with valid interior chord (0 new vertices!)
  const startFaces = mesh.getFacesForVertex(vStart);
  for (const fid of startFaces) {
    const face = mesh.getFace(fid);
    if (!face) continue;
    if (canSplitFaceBetweenVertices(mesh, face, vStart, vEnd)) {
      return {
        nodes: [
          { kind: 'vertex', vertexId: vStart },
          { kind: 'vertex', vertexId: vEnd },
        ],
        cost: lenVec(subVec(endVert.position, startVert.position)),
      };
    }
  }

  // If either vertex has no incident faces at all, no surface path exists
  const endFaces = mesh.getFacesForVertex(vEnd);
  if (startFaces.length === 0 || endFaces.length === 0) {
    return null;
  }

  const goalPos = endVert.position;
  const steps: PathStep[] = [];
  const open = new MinHeap<number>((a, b) => steps[a].fCost - steps[b].fCost);
  const bestCost = new Map<string, number>();

  const rootStep: PathStep = {
    kind: 'vertex',
    vertexId: vStart,
    pos: startVert.position,
    viaFaceId: null,
    parentIndex: -1,
    gCost: 0,
    fCost: lenVec(subVec(goalPos, startVert.position)),
  };
  steps.push(rootStep);
  bestCost.set(`v:${vStart}`, 0);
  open.push(0);

  const hasVisitedFaceOrEdgeInChain = (
    stepIdx: number,
    faceId: string,
    edgeId?: string,
  ): boolean => {
    let cur = stepIdx;
    while (cur !== -1) {
      const s = steps[cur];
      if (s.viaFaceId === faceId) return true;
      if (edgeId && s.kind === 'edge' && s.edgeId === edgeId) return true;
      cur = s.parentIndex;
    }
    return false;
  };

  let expansions = 0;
  const MAX_EXPANSIONS = 8000;
  const SNAP_T_EPS = 0.025;
  const SNAP_DIST_EPS = 1e-4;

  while (open.size > 0 && expansions < MAX_EXPANSIONS) {
    const currIdx = open.pop()!;
    const curr = steps[currIdx];
    expansions++;

    if (curr.kind === 'vertex' && curr.vertexId === vEnd) {
      // Reconstruct nodes
      const nodes: MaterializedPathNode[] = [];
      let walk = currIdx;
      while (walk !== -1) {
        const s = steps[walk];
        if (s.kind === 'vertex') {
          nodes.push({ kind: 'vertex', vertexId: s.vertexId });
        } else {
          nodes.push({
            kind: 'edge',
            edgeId: s.edgeId,
            t: s.t,
            pos: s.pos,
          });
        }
        walk = s.parentIndex;
      }
      nodes.reverse();
      return { nodes, cost: curr.gCost };
    }

    const stateKey =
      curr.kind === 'vertex'
        ? `v:${curr.vertexId}`
        : `e:${curr.edgeId}:f:${curr.viaFaceId}`;
    if (curr.gCost > (bestCost.get(stateKey) ?? Infinity) + 1e-9) {
      continue;
    }

    const candidateFaceIds =
      curr.kind === 'vertex'
        ? mesh.getFacesForVertex(curr.vertexId)
        : mesh
            .getFacesForEdge(curr.edgeId)
            .filter((fid) => fid !== curr.viaFaceId);

    for (const fid of candidateFaceIds) {
      if (hasVisitedFaceOrEdgeInChain(currIdx, fid)) continue;
      const face = mesh.getFace(fid);
      if (!face || face.vertexIds.length < 3) continue;

      const k = face.vertexIds.length;

      // 1. Transitions to vertices of `face`
      for (let i = 0; i < k; i++) {
        const targetVid = face.vertexIds[i];
        if (curr.kind === 'vertex' && targetVid === curr.vertexId) continue;

        // If crossing from an edge, avoid jumping back to an endpoint of that same edge
        // unless that endpoint IS vEnd (though even then it wouldn't split the edge meaningfully)
        if (curr.kind === 'edge') {
          const inEdge = mesh.getEdge(curr.edgeId);
          if (inEdge && (targetVid === inEdge.v0 || targetVid === inEdge.v1)) {
            continue;
          }
        }

        const targetVert = mesh.getVertex(targetVid);
        if (!targetVert) continue;

        let validHop = false;
        if (curr.kind === 'vertex') {
          const isAdjEdge = Boolean(mesh.findEdgeId(curr.vertexId, targetVid));
          if (isAdjEdge) {
            // Allow walking along perimeter edge of a face
            const idxC = face.vertexIds.indexOf(curr.vertexId);
            const idxT = i;
            if (
              (idxC + 1) % k === idxT ||
              (idxT + 1) % k === idxC
            ) {
              validHop = true;
            }
          }
          if (!validHop) {
            validHop = canSplitFaceBetweenVertices(
              mesh,
              face,
              curr.vertexId,
              targetVid,
            );
          }
        } else {
          // From EdgeCrossing -> Vertex of face
          validHop = isSegmentInsideFace(
            mesh,
            face,
            curr.pos,
            targetVert.position,
            new Set([targetVid]),
            new Set([curr.edgeId]),
          );
        }

        if (!validHop) continue;

        const stepDist = lenVec(subVec(targetVert.position, curr.pos));
        // Tiny tie-breaker favoring existing vertices over edge splits
        const nextG = curr.gCost + stepDist;
        const vKey = `v:${targetVid}`;
        if (nextG + 1e-9 < (bestCost.get(vKey) ?? Infinity)) {
          bestCost.set(vKey, nextG);
          const nextIdx = steps.length;
          steps.push({
            kind: 'vertex',
            vertexId: targetVid,
            pos: targetVert.position,
            viaFaceId: fid,
            parentIndex: currIdx,
            gCost: nextG,
            fCost: nextG + lenVec(subVec(goalPos, targetVert.position)),
          });
          open.push(nextIdx);
        }
      }

      // 2. Transitions to crossing another edge of `face` (if face has >= 2 incident faces on that edge)
      for (let i = 0; i < k; i++) {
        const aId = face.vertexIds[i];
        const bId = face.vertexIds[(i + 1) % k];
        const eid = mesh.findEdgeId(aId, bId);
        if (!eid) continue;
        if (curr.kind === 'edge' && eid === curr.edgeId) continue;
        if (curr.kind === 'vertex' && (aId === curr.vertexId || bId === curr.vertexId)) {
          continue;
        }
        // Only cross edges that lead to another face
        const adjFaces = mesh.getFacesForEdge(eid);
        if (adjFaces.length < 2) continue;
        if (hasVisitedFaceOrEdgeInChain(currIdx, fid, eid)) continue;

        const edgeObj = mesh.getEdge(eid);
        if (!edgeObj) continue;
        const va = mesh.getVertex(edgeObj.v0);
        const vb = mesh.getVertex(edgeObj.v1);
        if (!va || !vb) continue;

        const t = findOptimalEdgeCrossingT(
          va.position,
          vb.position,
          curr.pos,
          goalPos,
        );
        const crossPos = lerpVec(va.position, vb.position, t);

        // Snap to existing vertex if crossing right near endpoint
        if (
          t <= SNAP_T_EPS ||
          t >= 1 - SNAP_T_EPS ||
          lenVec(subVec(crossPos, va.position)) < SNAP_DIST_EPS ||
          lenVec(subVec(crossPos, vb.position)) < SNAP_DIST_EPS
        ) {
          continue; // Vertex transitions above already evaluate va and vb
        }

        const ignoredVerts = new Set<string>(
          curr.kind === 'vertex' ? [curr.vertexId] : [],
        );
        const ignoredEdges = new Set<string>(
          curr.kind === 'edge' ? [curr.edgeId, eid] : [eid],
        );

        if (
          !isSegmentInsideFace(
            mesh,
            face,
            curr.pos,
            crossPos,
            ignoredVerts,
            ignoredEdges,
          )
        ) {
          continue;
        }

        const stepDist = lenVec(subVec(crossPos, curr.pos));
        // Slight +1e-5 preference so exact vertex intersections win ties
        const nextG = curr.gCost + stepDist + 1e-5;
        const eKey = `e:${eid}:f:${fid}`;
        if (nextG + 1e-9 < (bestCost.get(eKey) ?? Infinity)) {
          bestCost.set(eKey, nextG);
          const nextIdx = steps.length;
          steps.push({
            kind: 'edge',
            edgeId: eid,
            t,
            pos: crossPos,
            viaFaceId: fid,
            parentIndex: currIdx,
            gCost: nextG,
            fCost: nextG + lenVec(subVec(goalPos, crossPos)),
          });
          open.push(nextIdx);
        }
      }
    }
  }

  return null;
}

/**
 * Splits an existing edge in place at `pos` (`0 < t < 1`), splicing the new vertex
 * into all incident faces so no T-junctions are produced.
 */
function splitEdgeInPlace(
  mesh: EditableMesh,
  edgeId: string,
  t: number,
  pos: Vec3,
): string | null {
  const edge = mesh.getEdge(edgeId);
  if (!edge) return null;
  const v0 = edge.v0;
  const v1 = edge.v1;
  const vert0 = mesh.getVertex(v0);
  const vert1 = mesh.getVertex(v1);
  if (!vert0 || !vert1) return null;

  // Guard against near-duplicate vertex creation
  if (lenVec(subVec(pos, vert0.position)) < 1e-5) return v0;
  if (lenVec(subVec(pos, vert1.position)) < 1e-5) return v1;

  const newVert = mesh.addVertex(pos[0], pos[1], pos[2]);
  const incidentFaceIds = mesh.getFacesForEdge(edgeId);

  for (const fid of incidentFaceIds) {
    const face = mesh.getFace(fid);
    if (!face) continue;
    const n = face.vertexIds.length;
    const hasUvs = Array.isArray(face.uvs) && face.uvs.length === n;

    const nextVerts: string[] = [];
    const nextUvs: Vec2[] = [];

    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      nextVerts.push(a);
      if (hasUvs) nextUvs.push(face.uvs![i]);

      if ((a === v0 && b === v1) || (a === v1 && b === v0)) {
        nextVerts.push(newVert.id);
        if (hasUvs) {
          const uvA = face.uvs![i];
          const uvB = face.uvs![(i + 1) % n];
          const ratio = a === v0 ? t : 1 - t;
          nextUvs.push([
            uvA[0] + (uvB[0] - uvA[0]) * ratio,
            uvA[1] + (uvB[1] - uvA[1]) * ratio,
          ]);
        }
      }
    }

    face.vertexIds = nextVerts;
    if (hasUvs) face.uvs = nextUvs;
  }

  mesh.edges = mesh.edges.filter((e) => e.id !== edgeId);
  mesh.rebuildIndices();
  mesh.addEdge(v0, newVert.id);
  mesh.addEdge(newVert.id, v1);
  return newVert.id;
}

/**
 * Materializes a surface path on `mesh`, splitting any crossed edges and splitting
 * all traversed faces along each consecutive vertex pair.
 */
function applySurfacePath(
  mesh: EditableMesh,
  path: SurfacePathResult,
): {
  ok: boolean;
  vertexChain: string[];
  createdEdgeKeys: string[];
  facesSplitCount: number;
} {
  const vertexChain: string[] = [];
  const createdEdgeKeys: string[] = [];
  let facesSplitCount = 0;

  // Step 1: Materialize all intermediate edge crossings into real vertices
  for (const node of path.nodes) {
    if (node.kind === 'vertex') {
      if (vertexChain[vertexChain.length - 1] !== node.vertexId) {
        vertexChain.push(node.vertexId);
      }
    } else {
      const splitVid = splitEdgeInPlace(mesh, node.edgeId, node.t, node.pos);
      if (!splitVid) {
        return { ok: false, vertexChain: [], createdEdgeKeys: [], facesSplitCount: 0 };
      }
      if (vertexChain[vertexChain.length - 1] !== splitVid) {
        vertexChain.push(splitVid);
      }
    }
  }

  if (vertexChain.length < 2) {
    return { ok: false, vertexChain: [], createdEdgeKeys: [], facesSplitCount: 0 };
  }

  // Step 2: Connect every consecutive pair (u, v) in vertexChain
  for (let i = 0; i < vertexChain.length - 1; i++) {
    const u = vertexChain[i];
    const v = vertexChain[i + 1];
    if (u === v) continue;

    const existingId = mesh.findEdgeId(u, v);
    if (existingId) {
      continue;
    }

    // Find shared face containing u and v non-adjacently with a valid chord
    const uFaces = mesh.getFacesForVertex(u);
    let splitSuccess = false;
    for (const fid of uFaces) {
      const face = mesh.getFace(fid);
      if (!face) continue;
      if (canSplitFaceBetweenVertices(mesh, face, u, v)) {
        const res = splitFaceAlongVertices(mesh, face, u, v);
        if (res) {
          splitSuccess = true;
          facesSplitCount++;
          createdEdgeKeys.push(canonicalEdgeKey(u, v));
          break;
        }
      }
    }

    if (!splitSuccess) {
      return {
        ok: false,
        vertexChain: [],
        createdEdgeKeys: [],
        facesSplitCount: 0,
      };
    }
  }

  return {
    ok: true,
    vertexChain,
    createdEdgeKeys,
    facesSplitCount,
  };
}

function attemptSequenceConnection(
  sourceMesh: EditableMesh,
  orderedVertIds: string[],
): {
  ok: boolean;
  mesh: EditableMesh;
  pathVertexIds: string[];
  createdEdgeKeys: Set<string>;
  facesSplitCount: number;
} {
  const workMesh = sourceMesh.clone();
  const pathVertexIds: string[] = [];
  const createdEdgeKeys = new Set<string>();
  let facesSplitCount = 0;

  for (let i = 0; i < orderedVertIds.length - 1; i++) {
    const a = orderedVertIds[i];
    const b = orderedVertIds[i + 1];
    if (a === b) continue;

    const path = findSurfacePath(workMesh, a, b);
    if (!path) {
      return {
        ok: false,
        mesh: sourceMesh,
        pathVertexIds: [],
        createdEdgeKeys: new Set(),
        facesSplitCount: 0,
      };
    }

    const applied = applySurfacePath(workMesh, path);
    if (!applied.ok) {
      return {
        ok: false,
        mesh: sourceMesh,
        pathVertexIds: [],
        createdEdgeKeys: new Set(),
        facesSplitCount: 0,
      };
    }

    for (const vid of applied.vertexChain) {
      if (pathVertexIds[pathVertexIds.length - 1] !== vid) {
        pathVertexIds.push(vid);
      }
    }
    for (const k of applied.createdEdgeKeys) {
      createdEdgeKeys.add(k);
    }
    facesSplitCount += applied.facesSplitCount;
  }

  return {
    ok: true,
    mesh: workMesh,
    pathVertexIds,
    createdEdgeKeys,
    facesSplitCount,
  };
}

/**
 * Fallback ordering when the user's multi-vertex selection order (e.g. from Box Select)
 * cannot be connected directly in insertion order, finding a valid nearest-surface chain.
 */
function findFallbackTopologicalOrder(
  sourceMesh: EditableMesh,
  orderedVertIds: string[],
): string[] | null {
  if (orderedVertIds.length <= 2) return null;

  for (let startIdx = 0; startIdx < orderedVertIds.length; startIdx++) {
    const remaining = new Set(orderedVertIds);
    const start = orderedVertIds[startIdx];
    remaining.delete(start);
    const chain = [start];
    let curr = start;
    let valid = true;

    while (remaining.size > 0) {
      let bestNext: string | null = null;
      let bestCost = Infinity;
      let bestIsNew = false;

      for (const cand of remaining) {
        const path = findSurfacePath(sourceMesh, curr, cand);
        if (!path) continue;
        const isExistingEdge = Boolean(sourceMesh.findEdgeId(curr, cand));
        // Prefer paths that connect new geometry with shortest surface cost
        const adjustedCost = path.cost + (isExistingEdge ? 0.0001 : 0);
        if (
          adjustedCost < bestCost ||
          (!bestIsNew && !isExistingEdge && Math.abs(adjustedCost - bestCost) < 1e-6)
        ) {
          bestCost = adjustedCost;
          bestNext = cand;
          bestIsNew = !isExistingEdge;
        }
      }

      if (!bestNext) {
        valid = false;
        break;
      }

      chain.push(bestNext);
      remaining.delete(bestNext);
      curr = bestNext;
    }

    if (valid && chain.length === orderedVertIds.length) {
      return chain;
    }
  }

  return null;
}

/**
 * Validates that every original vertex still exists without duplication,
 * all edges are unique non-self-loops, and all faces have >= 3 valid vertices & non-zero area.
 */
function verifyMeshIntegrity(
  originalMesh: EditableMesh,
  resultMesh: EditableMesh,
): boolean {
  const seenVertIds = new Set<string>();
  for (const v of resultMesh.vertices) {
    if (seenVertIds.has(v.id)) return false;
    seenVertIds.add(v.id);
  }
  for (const origV of originalMesh.vertices) {
    if (!seenVertIds.has(origV.id)) return false;
  }

  const seenEdgeKeys = new Set<string>();
  for (const e of resultMesh.edges) {
    if (e.v0 === e.v1) return false;
    if (!seenVertIds.has(e.v0) || !seenVertIds.has(e.v1)) return false;
    const key = canonicalEdgeKey(e.v0, e.v1);
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
  }

  for (const f of resultMesh.faces) {
    if (!hasValidPolygonArea(resultMesh, f.vertexIds)) return false;
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      if (!resultMesh.findEdgeId(f.vertexIds[i], f.vertexIds[(i + 1) % n])) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Blender-inspired Connect Vertex Path (J):
 * Connects selected vertices by creating edges across traversed faces and splitting
 * those faces cleanly without creating duplicate vertices or invalid geometry.
 * Strictly transactional: on failure, returns the untouched source mesh.
 */
export function connectVertexPathMesh(
  sourceMesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
): ConnectVertexPathResponse {
  if (mode !== 'vertex') {
    return {
      success: false,
      result: { mesh: sourceMesh.clone(), nextSelectedIds: new Set(selectedIds) },
      createdEdgeIds: [],
      pathEdgeIds: [],
      pathVertexIds: [],
      facesSplitCount: 0,
      error: 'Cambia al submodo Vértices para usar Connect Vertex Path (J)',
    };
  }

  const orderedVertIds = Array.from(selectedIds).filter((id) =>
    Boolean(sourceMesh.getVertex(id)),
  );

  if (orderedVertIds.length < 2) {
    return {
      success: false,
      result: { mesh: sourceMesh.clone(), nextSelectedIds: new Set(selectedIds) },
      createdEdgeIds: [],
      pathEdgeIds: [],
      pathVertexIds: [],
      facesSplitCount: 0,
      error: 'Selecciona al menos 2 vértices para conectar',
    };
  }

  // 1. Try connecting in exact selection order first
  let attempt = attemptSequenceConnection(sourceMesh, orderedVertIds);

  // 2. If selection order failed (e.g. box-selected 3+ vertices), try topological fallback order
  if (!attempt.ok && orderedVertIds.length >= 3) {
    const fallbackOrder = findFallbackTopologicalOrder(sourceMesh, orderedVertIds);
    if (fallbackOrder) {
      attempt = attemptSequenceConnection(sourceMesh, fallbackOrder);
    }
  }

  if (!attempt.ok) {
    return {
      success: false,
      result: { mesh: sourceMesh.clone(), nextSelectedIds: new Set(selectedIds) },
      createdEdgeIds: [],
      pathEdgeIds: [],
      pathVertexIds: [],
      facesSplitCount: 0,
      error:
        'No existe un recorrido topológicamente válido entre los vértices seleccionados',
    };
  }

  // Check if any new edges/splits were actually created
  const originalEdgeKeys = new Set(
    sourceMesh.edges.map((e) => canonicalEdgeKey(e.v0, e.v1)),
  );
  const finalCreatedEdgeIds: string[] = [];
  for (const edge of attempt.mesh.edges) {
    const key = canonicalEdgeKey(edge.v0, edge.v1);
    if (!originalEdgeKeys.has(key)) {
      finalCreatedEdgeIds.push(edge.id);
    }
  }

  if (finalCreatedEdgeIds.length === 0 && attempt.facesSplitCount === 0) {
    return {
      success: false,
      alreadyConnected: true,
      result: { mesh: sourceMesh.clone(), nextSelectedIds: new Set(selectedIds) },
      createdEdgeIds: [],
      pathEdgeIds: [],
      pathVertexIds: orderedVertIds,
      facesSplitCount: 0,
      message: 'Los vértices seleccionados ya están conectados por aristas existentes',
    };
  }

  attempt.mesh.clearCustomNormals();
  attempt.mesh.rebuildIndices();

  if (!verifyMeshIntegrity(sourceMesh, attempt.mesh)) {
    return {
      success: false,
      result: { mesh: sourceMesh.clone(), nextSelectedIds: new Set(selectedIds) },
      createdEdgeIds: [],
      pathEdgeIds: [],
      pathVertexIds: [],
      facesSplitCount: 0,
      error:
        'La operación no pudo mantener la integridad de la malla y fue cancelada',
    };
  }

  // Compute all valid edges along the resulting path
  const pathEdgeIds: string[] = [];
  const seenEdgeIds = new Set<string>();
  for (let i = 0; i < attempt.pathVertexIds.length - 1; i++) {
    const eid = attempt.mesh.findEdgeId(
      attempt.pathVertexIds[i],
      attempt.pathVertexIds[i + 1],
    );
    if (eid && !seenEdgeIds.has(eid)) {
      seenEdgeIds.add(eid);
      pathEdgeIds.push(eid);
    }
  }

  // Keep Vertex mode active with path vertices selected so derived selection
  // highlights all newly created edges and allows immediate subsequent J connections.
  const nextSelectedVertexIds = new Set(
    attempt.pathVertexIds.filter((vid) => Boolean(attempt.mesh.getVertex(vid))),
  );

  const edgeCount = finalCreatedEdgeIds.length;
  const faceCount = attempt.facesSplitCount;
  const message =
    edgeCount === 1 && faceCount === 1
      ? 'Arista conectada · Cara dividida en 2'
      : `${edgeCount} arista${edgeCount === 1 ? '' : 's'} conectada${edgeCount === 1 ? '' : 's'} · ${faceCount} cara${faceCount === 1 ? '' : 's'} dividida${faceCount === 1 ? '' : 's'}`;

  return {
    success: true,
    result: {
      mesh: attempt.mesh,
      nextSelectedIds: nextSelectedVertexIds,
    },
    createdEdgeIds: finalCreatedEdgeIds,
    pathEdgeIds,
    pathVertexIds: attempt.pathVertexIds,
    facesSplitCount: attempt.facesSplitCount,
    message,
  };
}

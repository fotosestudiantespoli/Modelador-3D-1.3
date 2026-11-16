export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface MeshVertex {
  id: string;
  position: Vec3;
  uv?: Vec2;
  normal?: Vec3;
}

export interface MeshEdge {
  id: string;
  v0: string;
  v1: string;
  bevelWeight?: number;
}

export interface MeshFace {
  id: string;
  vertexIds: string[];
  uvs?: Vec2[];
  normals?: Vec3[];
}

export interface SerializedEditableMesh {
  vertices: MeshVertex[];
  edges: MeshEdge[];
  faces: MeshFace[];
  nextVertexNum: number;
  nextEdgeNum: number;
  nextFaceNum: number;
}

export interface TriangulatedMeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  triangleToFaceId: string[];
  faceToTriangleRange: Map<string, { start: number; count: number }>;
}

export function canonicalEdgeKey(v0: string, v1: string): string {
  return v0 < v1 ? `${v0}::${v1}` : `${v1}::${v0}`;
}

export class EditableMesh {
  public vertices: MeshVertex[] = [];
  public edges: MeshEdge[] = [];
  public faces: MeshFace[] = [];

  private nextVertexNum = 1;
  private nextEdgeNum = 1;
  private nextFaceNum = 1;

  private vertexMap = new Map<string, MeshVertex>();
  private edgeMap = new Map<string, MeshEdge>();
  private faceMap = new Map<string, MeshFace>();
  private edgeKeyMap = new Map<string, string>();
  private vertexToEdges = new Map<string, Set<string>>();
  private vertexToFaces = new Map<string, Set<string>>();
  private edgeToFaces = new Map<string, Set<string>>();

  constructor(initial?: SerializedEditableMesh) {
    if (initial) {
      this.vertices = initial.vertices.map((v) => ({
        id: v.id,
        position: [v.position[0], v.position[1], v.position[2]],
        ...(v.uv ? { uv: [v.uv[0], v.uv[1]] as Vec2 } : {}),
        ...(v.normal
          ? { normal: [v.normal[0], v.normal[1], v.normal[2]] as Vec3 }
          : {}),
      }));
      this.edges = initial.edges.map((e) => ({ ...e }));
      this.faces = initial.faces.map((f) => ({
        id: f.id,
        vertexIds: [...f.vertexIds],
        ...(f.uvs
          ? { uvs: f.uvs.map((uv) => [uv[0], uv[1]] as Vec2) }
          : {}),
        ...(f.normals
          ? { normals: f.normals.map((n) => [n[0], n[1], n[2]] as Vec3) }
          : {}),
      }));
      this.nextVertexNum = initial.nextVertexNum || this.vertices.length + 1;
      this.nextEdgeNum = initial.nextEdgeNum || this.edges.length + 1;
      this.nextFaceNum = initial.nextFaceNum || this.faces.length + 1;
    }
    this.rebuildIndices();
  }

  public clone(): EditableMesh {
    return new EditableMesh(this.toJSON());
  }

  public toJSON(): SerializedEditableMesh {
    return {
      vertices: this.vertices.map((v) => ({
        id: v.id,
        position: [v.position[0], v.position[1], v.position[2]],
        ...(v.uv ? { uv: [v.uv[0], v.uv[1]] as Vec2 } : {}),
        ...(v.normal
          ? { normal: [v.normal[0], v.normal[1], v.normal[2]] as Vec3 }
          : {}),
      })),
      edges: this.edges.map((e) => ({
        id: e.id,
        v0: e.v0,
        v1: e.v1,
        ...(typeof e.bevelWeight === 'number'
          ? { bevelWeight: e.bevelWeight }
          : {}),
      })),
      faces: this.faces.map((f) => ({
        id: f.id,
        vertexIds: [...f.vertexIds],
        ...(f.uvs
          ? { uvs: f.uvs.map((uv) => [uv[0], uv[1]] as Vec2) }
          : {}),
        ...(f.normals
          ? { normals: f.normals.map((n) => [n[0], n[1], n[2]] as Vec3) }
          : {}),
      })),
      nextVertexNum: this.nextVertexNum,
      nextEdgeNum: this.nextEdgeNum,
      nextFaceNum: this.nextFaceNum,
    };
  }

  public static fromJSON(data: SerializedEditableMesh): EditableMesh {
    return new EditableMesh(data);
  }

  public rebuildIndices(): void {
    this.vertexMap.clear();
    this.edgeMap.clear();
    this.faceMap.clear();
    this.edgeKeyMap.clear();
    this.vertexToEdges.clear();
    this.vertexToFaces.clear();
    this.edgeToFaces.clear();

    for (const v of this.vertices) {
      this.vertexMap.set(v.id, v);
      this.vertexToEdges.set(v.id, new Set());
      this.vertexToFaces.set(v.id, new Set());
    }

    // Filter out invalid edges referencing missing vertices and deduplicate
    const validEdges: MeshEdge[] = [];
    for (const e of this.edges) {
      if (e.v0 === e.v1 || !this.vertexMap.has(e.v0) || !this.vertexMap.has(e.v1)) {
        continue;
      }
      const key = canonicalEdgeKey(e.v0, e.v1);
      if (this.edgeKeyMap.has(key)) continue;
      this.edgeKeyMap.set(key, e.id);
      this.edgeMap.set(e.id, e);
      this.edgeToFaces.set(e.id, new Set());
      this.vertexToEdges.get(e.v0)!.add(e.id);
      this.vertexToEdges.get(e.v1)!.add(e.id);
      validEdges.push(e);
    }
    this.edges = validEdges;

    // Filter out invalid faces (<3 valid vertices)
    const validFaces: MeshFace[] = [];
    for (const f of this.faces) {
      if (f.vertexIds.length < 3) continue;
      if (!f.vertexIds.every((vid) => this.vertexMap.has(vid))) continue;
      this.faceMap.set(f.id, f);
      validFaces.push(f);
      const n = f.vertexIds.length;
      for (let i = 0; i < n; i++) {
        const a = f.vertexIds[i];
        const b = f.vertexIds[(i + 1) % n];
        this.vertexToFaces.get(a)!.add(f.id);
        const edgeId = this.findEdgeId(a, b);
        if (edgeId) {
          this.edgeToFaces.get(edgeId)!.add(f.id);
        }
      }
    }
    this.faces = validFaces;
  }

  public addVertex(x: number, y: number, z: number): MeshVertex {
    const id = `v_${this.nextVertexNum++}`;
    const v: MeshVertex = { id, position: [x, y, z] };
    this.vertices.push(v);
    this.vertexMap.set(id, v);
    this.vertexToEdges.set(id, new Set());
    this.vertexToFaces.set(id, new Set());
    return v;
  }

  public addEdge(v0: string, v1: string): MeshEdge | null {
    if (v0 === v1 || !this.vertexMap.has(v0) || !this.vertexMap.has(v1)) {
      return null;
    }
    const key = canonicalEdgeKey(v0, v1);
    const existingId = this.edgeKeyMap.get(key);
    if (existingId) {
      return this.edgeMap.get(existingId) ?? null;
    }
    const id = `e_${this.nextEdgeNum++}`;
    const edge: MeshEdge = { id, v0, v1 };
    this.edges.push(edge);
    this.edgeMap.set(id, edge);
    this.edgeKeyMap.set(key, id);
    this.edgeToFaces.set(id, new Set());
    this.vertexToEdges.get(v0)!.add(id);
    this.vertexToEdges.get(v1)!.add(id);
    return edge;
  }

  public addFace(vertexIds: string[]): MeshFace | null {
    if (vertexIds.length < 3) return null;
    if (!vertexIds.every((vid) => this.vertexMap.has(vid))) return null;

    const id = `f_${this.nextFaceNum++}`;
    const face: MeshFace = { id, vertexIds: [...vertexIds] };
    this.faces.push(face);
    this.faceMap.set(id, face);

    const n = vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = vertexIds[i];
      const b = vertexIds[(i + 1) % n];
      const edge = this.addEdge(a, b);
      this.vertexToFaces.get(a)!.add(id);
      if (edge) {
        this.edgeToFaces.get(edge.id)!.add(id);
      }
    }
    return face;
  }

  public getVertex(id: string): MeshVertex | undefined {
    return this.vertexMap.get(id);
  }

  public getEdge(id: string): MeshEdge | undefined {
    return this.edgeMap.get(id);
  }

  public getFace(id: string): MeshFace | undefined {
    return this.faceMap.get(id);
  }

  public findEdgeId(v0: string, v1: string): string | undefined {
    return this.edgeKeyMap.get(canonicalEdgeKey(v0, v1));
  }

  public getEdgesForVertex(vertexId: string): string[] {
    return Array.from(this.vertexToEdges.get(vertexId) ?? []);
  }

  public getFacesForVertex(vertexId: string): string[] {
    return Array.from(this.vertexToFaces.get(vertexId) ?? []);
  }

  public getFacesForEdge(edgeId: string): string[] {
    return Array.from(this.edgeToFaces.get(edgeId) ?? []);
  }

  public getEdgesForFace(faceId: string): string[] {
    const face = this.faceMap.get(faceId);
    if (!face) return [];
    const result: string[] = [];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const eId = this.findEdgeId(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      if (eId) result.push(eId);
    }
    return result;
  }

  public getVertexIdsFromSelection(
    mode: 'vertex' | 'edge' | 'face',
    selectedIds: Set<string>,
  ): Set<string> {
    const out = new Set<string>();
    if (mode === 'vertex') {
      for (const id of selectedIds) {
        if (this.vertexMap.has(id)) out.add(id);
      }
    } else if (mode === 'edge') {
      for (const eid of selectedIds) {
        const edge = this.edgeMap.get(eid);
        if (edge) {
          out.add(edge.v0);
          out.add(edge.v1);
        }
      }
    } else if (mode === 'face') {
      for (const fid of selectedIds) {
        const face = this.faceMap.get(fid);
        if (face) {
          for (const vid of face.vertexIds) out.add(vid);
        }
      }
    }
    return out;
  }

  public computeCentroid(vertexIds: Iterable<string>): Vec3 | null {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (const vid of vertexIds) {
      const v = this.vertexMap.get(vid);
      if (v) {
        sx += v.position[0];
        sy += v.position[1];
        sz += v.position[2];
        count++;
      }
    }
    if (count === 0) return null;
    return [sx / count, sy / count, sz / count];
  }

  public computeFaceNormal(face: MeshFace): Vec3 {
    const n = face.vertexIds.length;
    if (n < 3) return [0, 0, 1];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const curr = this.vertexMap.get(face.vertexIds[i])?.position;
      const next = this.vertexMap.get(face.vertexIds[(i + 1) % n])?.position;
      if (!curr || !next) continue;
      nx += (curr[1] - next[1]) * (curr[2] + next[2]);
      ny += (curr[2] - next[2]) * (curr[0] + next[0]);
      nz += (curr[0] - next[0]) * (curr[1] + next[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) return [0, 0, 1];
    return [nx / len, ny / len, nz / len];
  }

  /**
   * Triangulates a face using planar ear-clipping projected along the face normal,
   * falling back to fan triangulation if degenerate.
   * Returns local vertex index triples into face.vertexIds.
   */
  public triangulateFaceLocalIndices(face: MeshFace): [number, number, number][] {
    const n = face.vertexIds.length;
    if (n < 3) return [];
    if (n === 3) return [[0, 1, 2]];
    if (n === 4) {
      const p0 = this.vertexMap.get(face.vertexIds[0])?.position;
      const p1 = this.vertexMap.get(face.vertexIds[1])?.position;
      const p2 = this.vertexMap.get(face.vertexIds[2])?.position;
      const p3 = this.vertexMap.get(face.vertexIds[3])?.position;
      if (!p0 || !p1 || !p2 || !p3) return [];

      // Check convexity along Newell face normal to handle concave or twisted quads cleanly
      const fn = this.computeFaceNormal(face);
      const pts4 = [p0, p1, p2, p3];
      const turns: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = pts4[(i + 3) % 4];
        const b = pts4[i];
        const c = pts4[(i + 1) % 4];
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const abz = b[2] - a[2];
        const bcx = c[0] - b[0];
        const bcy = c[1] - b[1];
        const bcz = c[2] - b[2];
        const cx = aby * bcz - abz * bcy;
        const cy = abz * bcx - abx * bcz;
        const cz = abx * bcy - aby * bcx;
        turns.push(cx * fn[0] + cy * fn[1] + cz * fn[2]);
      }

      // If corner 1 or 3 is reflex (negative turn while majority positive), split [1, 3]
      if ((turns[1] < -1e-6 || turns[3] < -1e-6) && turns[0] > 1e-6 && turns[2] > 1e-6) {
        return [
          [1, 2, 3],
          [1, 3, 0],
        ];
      }
      if ((turns[0] < -1e-6 || turns[2] < -1e-6) && turns[1] > 1e-6 && turns[3] > 1e-6) {
        return [
          [0, 1, 2],
          [0, 2, 3],
        ];
      }

      // For non-coplanar quads, pick the shorter diagonal when significantly warped
      const d02 = Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
      const d13 = Math.hypot(p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]);
      const nA = [
        (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]),
        (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]),
        (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]),
      ];
      const nALen = Math.hypot(nA[0], nA[1], nA[2]) || 1;
      const dist3 =
        Math.abs(
          ((p3[0] - p0[0]) * nA[0] +
            (p3[1] - p0[1]) * nA[1] +
            (p3[2] - p0[2]) * nA[2]) /
            nALen,
        );
      if (dist3 > 1e-4 && d13 < d02 * 0.99) {
        return [
          [1, 2, 3],
          [1, 3, 0],
        ];
      }

      return [
        [0, 1, 2],
        [0, 2, 3],
      ];
    }

    const pts: Vec3[] = [];
    for (const vid of face.vertexIds) {
      const v = this.vertexMap.get(vid);
      if (!v) return [];
      pts.push(v.position);
    }

    const normal = this.computeFaceNormal(face);
    // Build orthonormal basis (u, v) perpendicular to normal
    const ref: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ux = ref[1] * normal[2] - ref[2] * normal[1];
    const uy = ref[2] * normal[0] - ref[0] * normal[2];
    const uz = ref[0] * normal[1] - ref[1] * normal[0];
    const uLen = Math.hypot(ux, uy, uz) || 1;
    const u: Vec3 = [ux / uLen, uy / uLen, uz / uLen];
    const v: Vec3 = [
      normal[1] * u[2] - normal[2] * u[1],
      normal[2] * u[0] - normal[0] * u[2],
      normal[0] * u[1] - normal[1] * u[0],
    ];

    const proj = pts.map((p) => [
      p[0] * u[0] + p[1] * u[1] + p[2] * u[2],
      p[0] * v[0] + p[1] * v[1] + p[2] * v[2],
    ]);

    // Ensure CCW orientation in 2D
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += proj[i][0] * proj[j][1] - proj[j][0] * proj[i][1];
    }
    const indices = Array.from({ length: n }, (_, i) => i);
    if (area < 0) indices.reverse();

    const triangles: [number, number, number][] = [];
    const remaining = [...indices];
    let guard = 0;
    const maxGuard = n * n;

    const cross2D = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

    const pointInTri = (p: number[], a: number[], b: number[], c: number[]) => {
      const c1 = cross2D(a, b, p);
      const c2 = cross2D(b, c, p);
      const c3 = cross2D(c, a, p);
      return c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7;
    };

    while (remaining.length > 3 && guard < maxGuard) {
      let clipped = false;
      const len = remaining.length;
      for (let i = 0; i < len; i++) {
        const iPrev = remaining[(i - 1 + len) % len];
        const iCurr = remaining[i];
        const iNext = remaining[(i + 1) % len];
        const a = proj[iPrev];
        const b = proj[iCurr];
        const c = proj[iNext];

        if (cross2D(a, b, c) <= 1e-7) continue;

        let containsOther = false;
        for (let k = 0; k < len; k++) {
          const idx = remaining[k];
          if (idx === iPrev || idx === iCurr || idx === iNext) continue;
          if (pointInTri(proj[idx], a, b, c)) {
            containsOther = true;
            break;
          }
        }
        if (containsOther) continue;

        if (area < 0) {
          triangles.push([iNext, iCurr, iPrev]);
        } else {
          triangles.push([iPrev, iCurr, iNext]);
        }
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
      guard++;
    }

    if (remaining.length === 3) {
      if (area < 0) {
        triangles.push([remaining[2], remaining[1], remaining[0]]);
      } else {
        triangles.push([remaining[0], remaining[1], remaining[2]]);
      }
    }

    if (triangles.length === 0) {
      // Fan fallback
      const fan: [number, number, number][] = [];
      for (let i = 1; i < n - 1; i++) {
        fan.push([0, i, i + 1]);
      }
      return fan;
    }

    return triangles;
  }

  public hasUVs(): boolean {
    return (
      this.faces.some(
        (f) => Array.isArray(f.uvs) && f.uvs.length === f.vertexIds.length,
      ) || this.vertices.some((v) => Boolean(v.uv))
    );
  }

  public buildTriangulatedData(): TriangulatedMeshData {
    const posArr: number[] = [];
    const normArr: number[] = [];
    const includeUvs = this.hasUVs();
    const uvArr: number[] = [];
    const triangleToFaceId: string[] = [];
    const faceToTriangleRange = new Map<string, { start: number; count: number }>();

    for (const face of this.faces) {
      const tris = this.triangulateFaceLocalIndices(face);
      if (tris.length === 0) continue;
      const faceNormal = this.computeFaceNormal(face);
      const hasFaceUvs =
        Array.isArray(face.uvs) && face.uvs.length === face.vertexIds.length;
      const hasFaceNormals =
        Array.isArray(face.normals) &&
        face.normals.length === face.vertexIds.length;
      const startTri = triangleToFaceId.length;

      for (const [i0, i1, i2] of tris) {
        const v0 = this.vertexMap.get(face.vertexIds[i0]);
        const v1 = this.vertexMap.get(face.vertexIds[i1]);
        const v2 = this.vertexMap.get(face.vertexIds[i2]);
        if (!v0 || !v1 || !v2) continue;

        posArr.push(
          v0.position[0],
          v0.position[1],
          v0.position[2],
          v1.position[0],
          v1.position[1],
          v1.position[2],
          v2.position[0],
          v2.position[1],
          v2.position[2],
        );

        const n0 = hasFaceNormals ? face.normals![i0] : v0.normal ?? faceNormal;
        const n1 = hasFaceNormals ? face.normals![i1] : v1.normal ?? faceNormal;
        const n2 = hasFaceNormals ? face.normals![i2] : v2.normal ?? faceNormal;

        normArr.push(
          n0[0],
          n0[1],
          n0[2],
          n1[0],
          n1[1],
          n1[2],
          n2[0],
          n2[1],
          n2[2],
        );

        if (includeUvs) {
          const uv0 = hasFaceUvs ? face.uvs![i0] : v0.uv ?? [0, 0];
          const uv1 = hasFaceUvs ? face.uvs![i1] : v1.uv ?? [0, 0];
          const uv2 = hasFaceUvs ? face.uvs![i2] : v2.uv ?? [0, 0];
          uvArr.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
        }

        triangleToFaceId.push(face.id);
      }

      faceToTriangleRange.set(face.id, {
        start: startTri,
        count: triangleToFaceId.length - startTri,
      });
    }

    return {
      positions: new Float32Array(posArr),
      normals: new Float32Array(normArr),
      uvs: includeUvs ? new Float32Array(uvArr) : null,
      triangleToFaceId,
      faceToTriangleRange,
    };
  }

  public deleteVertices(vertexIds: Set<string>): void {
    if (vertexIds.size === 0) return;
    this.vertices = this.vertices.filter((v) => !vertexIds.has(v.id));
    this.edges = this.edges.filter(
      (e) => !vertexIds.has(e.v0) && !vertexIds.has(e.v1),
    );
    this.faces = this.faces.filter(
      (f) => !f.vertexIds.some((vid) => vertexIds.has(vid)),
    );
    this.rebuildIndices();
  }

  public deleteEdges(edgeIds: Set<string>): void {
    if (edgeIds.size === 0) return;
    const removedKeys = new Set<string>();
    for (const eid of edgeIds) {
      const edge = this.edgeMap.get(eid);
      if (edge) removedKeys.add(canonicalEdgeKey(edge.v0, edge.v1));
    }
    this.edges = this.edges.filter((e) => !edgeIds.has(e.id));
    this.faces = this.faces.filter((f) => {
      const n = f.vertexIds.length;
      for (let i = 0; i < n; i++) {
        const key = canonicalEdgeKey(f.vertexIds[i], f.vertexIds[(i + 1) % n]);
        if (removedKeys.has(key)) return false;
      }
      return true;
    });
    this.rebuildIndices();
  }

  public deleteFaces(faceIds: Set<string>): void {
    if (faceIds.size === 0) return;
    this.faces = this.faces.filter((f) => !faceIds.has(f.id));
    this.rebuildIndices();
  }

  public computeFaceCenter(face: MeshFace): Vec3 {
    const c = this.computeCentroid(face.vertexIds);
    return c ?? [0, 0, 0];
  }

  public computeVertexNormal(vertexId: string): Vec3 {
    const faceIds = this.getFacesForVertex(vertexId);
    if (faceIds.length === 0) return [0, 0, 1];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const fid of faceIds) {
      const face = this.faceMap.get(fid);
      if (!face) continue;
      const fn = this.computeFaceNormal(face);
      nx += fn[0];
      ny += fn[1];
      nz += fn[2];
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) return [0, 0, 1];
    return [nx / len, ny / len, nz / len];
  }

  public getConnectedVertices(vertexId: string): string[] {
    const edgeIds = this.getEdgesForVertex(vertexId);
    const out: string[] = [];
    for (const eid of edgeIds) {
      const edge = this.edgeMap.get(eid);
      if (!edge) continue;
      out.push(edge.v0 === vertexId ? edge.v1 : edge.v0);
    }
    return out;
  }

  public pruneOrphanVertices(candidateIds?: Set<string>): void {
    this.vertices = this.vertices.filter((v) => {
      if (candidateIds && !candidateIds.has(v.id)) return true;
      const hasEdge = (this.vertexToEdges.get(v.id)?.size ?? 0) > 0;
      const hasFace = (this.vertexToFaces.get(v.id)?.size ?? 0) > 0;
      return hasEdge || hasFace;
    });
    this.rebuildIndices();
  }

  public clearCustomNormals(): void {
    for (const v of this.vertices) {
      if (v.normal) delete v.normal;
    }
    for (const f of this.faces) {
      if (f.normals) delete f.normals;
    }
  }

  public getStats(): { vertices: number; edges: number; faces: number } {
    return {
      vertices: this.vertices.length,
      edges: this.edges.length,
      faces: this.faces.length,
    };
  }
}

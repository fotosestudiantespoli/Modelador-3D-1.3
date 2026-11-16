import {
  canonicalEdgeKey,
  EditableMesh,
  SerializedEditableMesh,
  Vec3,
} from '../mesh/EditableMesh';
import {
  ModifierDiagnostic,
  SubdivisionLevel,
  SubdivisionModifierParams,
  TABLET_SUBDIV_FACE_BUDGET,
  normalizeSubdivisionParams,
} from './types';

export interface SubdivisionTopologyReport {
  valid: boolean;
  ngonCount: number;
  triangleCount: number;
  quadCount: number;
  degenerateFaces: number;
  nonManifoldEdges: number;
  inconsistentWindingEdges: number;
  status: 'ok' | 'warning' | 'error';
  code?: ModifierDiagnostic['code'];
  message?: string;
}

export function validateTopologyForSubdivision(
  mesh: EditableMesh,
): SubdivisionTopologyReport {
  if (mesh.faces.length === 0 || mesh.vertices.length < 3) {
    return {
      valid: false,
      ngonCount: 0,
      triangleCount: 0,
      quadCount: 0,
      degenerateFaces: 0,
      nonManifoldEdges: 0,
      inconsistentWindingEdges: 0,
      status: 'error',
      code: 'empty_mesh',
      message: 'La malla no contiene caras válidas para subdividir.',
    };
  }

  let ngonCount = 0;
  let triangleCount = 0;
  let quadCount = 0;
  let degenerateFaces = 0;
  const edgeUses = new Map<string, string[]>();

  for (const face of mesh.faces) {
    const len = face.vertexIds.length;
    if (len < 3 || new Set(face.vertexIds).size < len) {
      degenerateFaces++;
      continue;
    }

    if (len > 4) {
      ngonCount++;
    } else if (len === 3) {
      triangleCount++;
    } else {
      quadCount++;
    }

    // Area check (Newell)
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < len; i++) {
      const a = mesh.getVertex(face.vertexIds[i])?.position;
      const b = mesh.getVertex(face.vertexIds[(i + 1) % len])?.position;
      if (!a || !b) {
        degenerateFaces++;
        nx = 0;
        ny = 0;
        nz = 0;
        break;
      }
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);

      const key = canonicalEdgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % len]);
      const arr = edgeUses.get(key) ?? [];
      arr.push(`${face.vertexIds[i]}->${face.vertexIds[(i + 1) % len]}`);
      edgeUses.set(key, arr);
    }

    if (Math.hypot(nx, ny, nz) < 1e-10) {
      degenerateFaces++;
    }
  }

  let nonManifoldEdges = 0;
  let inconsistentWindingEdges = 0;
  for (const uses of edgeUses.values()) {
    if (uses.length > 2) {
      nonManifoldEdges++;
    } else if (uses.length === 2 && uses[0] === uses[1]) {
      inconsistentWindingEdges++;
    }
  }

  if (ngonCount > 0) {
    return {
      valid: false,
      ngonCount,
      triangleCount,
      quadCount,
      degenerateFaces,
      nonManifoldEdges,
      inconsistentWindingEdges,
      status: 'error',
      code: 'ngons_detected',
      message: `La malla contiene ${ngonCount} N-gon(s) (caras con más de 4 vértices). Corrige la topología antes de aplicar Subdivision Surface.`,
    };
  }

  if (degenerateFaces > 0) {
    return {
      valid: false,
      ngonCount,
      triangleCount,
      quadCount,
      degenerateFaces,
      nonManifoldEdges,
      inconsistentWindingEdges,
      status: 'error',
      code: 'degenerate_faces',
      message: `Se detectaron ${degenerateFaces} cara(s) degenerada(s). Corrige la geometría antes de subdividir.`,
    };
  }

  if (nonManifoldEdges > 0) {
    return {
      valid: false,
      ngonCount,
      triangleCount,
      quadCount,
      degenerateFaces,
      nonManifoldEdges,
      inconsistentWindingEdges,
      status: 'error',
      code: 'non_manifold',
      message: `Topología no múltiple (non-manifold) detectada en ${nonManifoldEdges} arista(s). No se puede subdividir de forma segura.`,
    };
  }

  if (inconsistentWindingEdges > 0) {
    return {
      valid: false,
      ngonCount,
      triangleCount,
      quadCount,
      degenerateFaces,
      nonManifoldEdges,
      inconsistentWindingEdges,
      status: 'error',
      code: 'inconsistent_winding',
      message: `Orientación de normales inconsistente en ${inconsistentWindingEdges} arista(s) compartidas. Unifica las normales antes de subdividir.`,
    };
  }

  if (triangleCount > 0) {
    return {
      valid: true,
      ngonCount,
      triangleCount,
      quadCount,
      degenerateFaces,
      nonManifoldEdges,
      inconsistentWindingEdges,
      status: 'warning',
      code: 'triangles_present',
      message: `Contiene ${triangleCount} triángulo(s): Subdivision Surface está optimizado para quads y puede suavizar de forma irregular en esas zonas.`,
    };
  }

  return {
    valid: true,
    ngonCount,
    triangleCount,
    quadCount,
    degenerateFaces,
    nonManifoldEdges,
    inconsistentWindingEdges,
    status: 'ok',
  };
}

interface IndexedSubdivMesh {
  positions: Vec3[];
  faces: number[][];
}

function numericEdgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function runCatmullClarkIteration(input: IndexedSubdivMesh): IndexedSubdivMesh {
  const numVerts = input.positions.length;
  const numFaces = input.faces.length;

  // 1. Face Points (average of each face's vertices)
  const facePoints: Vec3[] = new Array(numFaces);
  for (let f = 0; f < numFaces; f++) {
    const fVerts = input.faces[f];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const n = fVerts.length;
    for (let i = 0; i < n; i++) {
      const p = input.positions[fVerts[i]];
      sx += p[0];
      sy += p[1];
      sz += p[2];
    }
    facePoints[f] = [sx / n, sy / n, sz / n];
  }

  // 2. Build unique edge structures & vertex-to-face / vertex-to-edge adjacency
  interface EdgeInfo {
    a: number;
    b: number;
    adjFaces: number[];
    midpoint: Vec3;
    edgePointIndex: number;
  }

  const edgeMap = new Map<string, number>();
  const edges: EdgeInfo[] = [];
  const vertFaces: number[][] = Array.from({ length: numVerts }, () => []);
  const vertEdges: number[][] = Array.from({ length: numVerts }, () => []);

  for (let f = 0; f < numFaces; f++) {
    const fVerts = input.faces[f];
    const n = fVerts.length;
    for (let i = 0; i < n; i++) {
      const v0 = fVerts[i];
      const v1 = fVerts[(i + 1) % n];
      vertFaces[v0].push(f);

      const key = numericEdgeKey(v0, v1);
      let eIdx = edgeMap.get(key);
      if (eIdx === undefined) {
        const p0 = input.positions[v0];
        const p1 = input.positions[v1];
        eIdx = edges.length;
        edges.push({
          a: Math.min(v0, v1),
          b: Math.max(v0, v1),
          adjFaces: [f],
          midpoint: [
            (p0[0] + p1[0]) * 0.5,
            (p0[1] + p1[1]) * 0.5,
            (p0[2] + p1[2]) * 0.5,
          ],
          edgePointIndex: -1,
        });
        edgeMap.set(key, eIdx);
        vertEdges[v0].push(eIdx);
        vertEdges[v1].push(eIdx);
      } else {
        edges[eIdx].adjFaces.push(f);
      }
    }
  }

  // 3. Allocate output positions:
  // [0 .. numVerts-1]: updated original vertices (V_i)
  // [numVerts .. numVerts + numFaces - 1]: face points (F_f)
  // [numVerts + numFaces .. ]: edge points (E_e)
  const outPositions: Vec3[] = new Array(
    numVerts + numFaces + edges.length,
  );

  // Vertex points (supports arbitrary valence poles n >= 3 and smooth boundaries)
  for (let i = 0; i < numVerts; i++) {
    const p = input.positions[i];
    const incEdges = vertEdges[i];
    const incFaces = vertFaces[i];

    const boundaryNeighbors: number[] = [];
    for (const eIdx of incEdges) {
      const e = edges[eIdx];
      if (e.adjFaces.length < 2) {
        boundaryNeighbors.push(e.a === i ? e.b : e.a);
      }
    }

    if (boundaryNeighbors.length > 0) {
      if (boundaryNeighbors.length === 2) {
        const b0 = input.positions[boundaryNeighbors[0]];
        const b1 = input.positions[boundaryNeighbors[1]];
        outPositions[i] = [
          (6 * p[0] + b0[0] + b1[0]) / 8,
          (6 * p[1] + b0[1] + b1[1]) / 8,
          (6 * p[2] + b0[2] + b1[2]) / 8,
        ];
      } else {
        outPositions[i] = [p[0], p[1], p[2]];
      }
    } else if (incFaces.length >= 3 && incEdges.length === incFaces.length) {
      const n = incFaces.length;
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (const fIdx of incFaces) {
        const fp = facePoints[fIdx];
        fx += fp[0];
        fy += fp[1];
        fz += fp[2];
      }
      fx /= n;
      fy /= n;
      fz /= n;

      let rx = 0;
      let ry = 0;
      let rz = 0;
      for (const eIdx of incEdges) {
        const mp = edges[eIdx].midpoint;
        rx += mp[0];
        ry += mp[1];
        rz += mp[2];
      }
      rx /= n;
      ry /= n;
      rz /= n;

      outPositions[i] = [
        (fx + 2 * rx + (n - 3) * p[0]) / n,
        (fy + 2 * ry + (n - 3) * p[1]) / n,
        (fz + 2 * rz + (n - 3) * p[2]) / n,
      ];
    } else {
      // Fallback for non-standard isolated or valence-2 interior vertices
      outPositions[i] = [p[0], p[1], p[2]];
    }
  }

  for (let f = 0; f < numFaces; f++) {
    outPositions[numVerts + f] = facePoints[f];
  }

  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    const pA = input.positions[e.a];
    const pB = input.positions[e.b];
    const outIdx = numVerts + numFaces + eIdx;
    e.edgePointIndex = outIdx;

    if (e.adjFaces.length === 2) {
      const f0 = facePoints[e.adjFaces[0]];
      const f1 = facePoints[e.adjFaces[1]];
      outPositions[outIdx] = [
        (pA[0] + pB[0] + f0[0] + f1[0]) * 0.25,
        (pA[1] + pB[1] + f0[1] + f1[1]) * 0.25,
        (pA[2] + pB[2] + f0[2] + f1[2]) * 0.25,
      ];
    } else {
      outPositions[outIdx] = [
        (pA[0] + pB[0]) * 0.5,
        (pA[1] + pB[1]) * 0.5,
        (pA[2] + pB[2]) * 0.5,
      ];
    }
  }

  // 4. Build subdivided quad faces
  const outFaces: number[][] = [];
  for (let f = 0; f < numFaces; f++) {
    const fVerts = input.faces[f];
    const n = fVerts.length;
    const facePointIdx = numVerts + f;

    for (let i = 0; i < n; i++) {
      const vPrev = fVerts[(i - 1 + n) % n];
      const vCurr = fVerts[i];
      const vNext = fVerts[(i + 1) % n];

      const ePrevIdx = edgeMap.get(numericEdgeKey(vPrev, vCurr))!;
      const eNextIdx = edgeMap.get(numericEdgeKey(vCurr, vNext))!;

      outFaces.push([
        vCurr,
        edges[eNextIdx].edgePointIndex,
        facePointIdx,
        edges[ePrevIdx].edgePointIndex,
      ]);
    }
  }

  return { positions: outPositions, faces: outFaces };
}

function editableToIndexed(mesh: EditableMesh): IndexedSubdivMesh {
  const vertIndexById = new Map<string, number>();
  const positions: Vec3[] = mesh.vertices.map((v, idx) => {
    vertIndexById.set(v.id, idx);
    return [v.position[0], v.position[1], v.position[2]];
  });

  const faces: number[][] = [];
  for (const f of mesh.faces) {
    const indices = f.vertexIds.map((vid) => vertIndexById.get(vid) ?? -1);
    if (indices.every((i) => i >= 0)) {
      faces.push(indices);
    }
  }
  return { positions, faces };
}

function indexedToEditable(indexed: IndexedSubdivMesh): EditableMesh {
  const out = new EditableMesh();
  const vertIds = indexed.positions.map((p) => out.addVertex(p[0], p[1], p[2]).id);
  for (const f of indexed.faces) {
    out.addFace(f.map((idx) => vertIds[idx]));
  }
  out.clearCustomNormals();
  return out;
}

export function evaluateSubdivisionModifier(
  sourceSerialized: SerializedEditableMesh,
  rawParams: unknown,
  modifierId: string,
  options: { isApplying?: boolean } = {},
): { mesh: SerializedEditableMesh; diagnostic: ModifierDiagnostic } {
  const params = normalizeSubdivisionParams(rawParams);
  const sourceMesh = EditableMesh.fromJSON(sourceSerialized);
  const topo = validateTopologyForSubdivision(sourceMesh);

  if (!topo.valid) {
    return {
      mesh: sourceSerialized,
      diagnostic: {
        modifierId,
        type: 'subdivision',
        status: 'error',
        code: topo.code,
        message: topo.message,
        vertexCount: sourceMesh.vertices.length,
        edgeCount: sourceMesh.edges.length,
        faceCount: sourceMesh.faces.length,
        ngonCount: topo.ngonCount,
        triangleCount: topo.triangleCount,
        nonManifoldEdges: topo.nonManifoldEdges,
      },
    };
  }

  const targetLevel: SubdivisionLevel = params.levels;
  if (targetLevel === 0) {
    return {
      mesh: sourceSerialized,
      diagnostic: {
        modifierId,
        type: 'subdivision',
        status: topo.status,
        code: topo.code,
        message: topo.message,
        vertexCount: sourceMesh.vertices.length,
        edgeCount: sourceMesh.edges.length,
        faceCount: sourceMesh.faces.length,
        ngonCount: topo.ngonCount,
        triangleCount: topo.triangleCount,
        nonManifoldEdges: topo.nonManifoldEdges,
      },
    };
  }

  let indexed = editableToIndexed(sourceMesh);
  let completedLevels = 0;
  let budgetExceeded = false;

  for (let lvl = 1; lvl <= targetLevel; lvl++) {
    let estimatedFaces = 0;
    for (const f of indexed.faces) {
      estimatedFaces += f.length;
    }

    if (estimatedFaces > TABLET_SUBDIV_FACE_BUDGET) {
      budgetExceeded = true;
      if (options.isApplying) {
        return {
          mesh: sourceSerialized,
          diagnostic: {
            modifierId,
            type: 'subdivision',
            status: 'error',
            code: 'budget_exceeded',
            message: `La subdivisión generaría ${estimatedFaces.toLocaleString()} caras y supera el límite seguro para tablet (${TABLET_SUBDIV_FACE_BUDGET.toLocaleString()}). Reduce el nivel antes de aplicar.`,
            vertexCount: sourceMesh.vertices.length,
            edgeCount: sourceMesh.edges.length,
            faceCount: sourceMesh.faces.length,
            ngonCount: topo.ngonCount,
            triangleCount: topo.triangleCount,
            nonManifoldEdges: topo.nonManifoldEdges,
            budgetExceeded: true,
          },
        };
      }
      break;
    }

    indexed = runCatmullClarkIteration(indexed);
    completedLevels = lvl;
  }

  const outMesh = indexedToEditable(indexed);
  const outSerialized = outMesh.toJSON();

  let status: ModifierDiagnostic['status'] = topo.status;
  let code = topo.code;
  let message = topo.message;

  if (budgetExceeded) {
    status = 'warning';
    code = 'budget_exceeded';
    message = `Vista previa limitada al nivel ${completedLevels} para proteger el rendimiento en tablet (máx. ${TABLET_SUBDIV_FACE_BUDGET.toLocaleString()} caras).`;
  } else if (targetLevel === 3 && status === 'ok') {
    status = 'warning';
    code = 'level_3_warning';
    message = `Nivel 3 activo (${outMesh.faces.length.toLocaleString()} caras): densidad alta en tablet.`;
  }

  return {
    mesh: outSerialized,
    diagnostic: {
      modifierId,
      type: 'subdivision',
      status,
      code,
      message,
      vertexCount: outMesh.vertices.length,
      edgeCount: outMesh.edges.length,
      faceCount: outMesh.faces.length,
      ngonCount: 0,
      triangleCount: outMesh.faces.filter((f) => f.vertexIds.length === 3).length,
      nonManifoldEdges: 0,
      budgetExceeded,
    },
  };
}

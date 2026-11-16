import {
  canonicalEdgeKey,
  EditableMesh,
  MeshFace,
  Vec2,
  Vec3,
} from './EditableMesh';
import { MeshOperatorResult } from './operations';

export interface EdgeLoopQuadStep {
  faceId: string;
  /** Entry edge endpoints along Rail A -> Rail B */
  a0: string;
  b0: string;
  /** Exit (opposite) edge endpoints along Rail A -> Rail B */
  a1: string;
  b1: string;
  /**
   * True when [a0, b0, b1, a1] matches the original cyclic winding of faceId.
   * False when [a0, a1, b1, b0] matches the original cyclic winding.
   */
  windingAligned: boolean;
}

export interface EdgeLoopRing {
  edgeIds: string[]; // Ordered crossed edges along the ring
  faceIds: string[]; // Ordered quad faces crossed by the ring
  quadSteps: EdgeLoopQuadStep[];
  isClosed: boolean;
}

export interface LoopCutParams {
  edgeId: string | null;
  cuts: number; // 1 .. 24
  slide: number; // -1.0 .. 1.0
}

export type LoopCutBlockReason =
  | 'missing_edge'
  | 'loose_edge'
  | 'non_manifold'
  | 'triangle'
  | 'ngon'
  | 'pole'
  | 'twist'
  | 'degenerate';

export interface LoopCutAnalysis {
  valid: boolean;
  ring: EdgeLoopRing | null;
  reason?: string;
  blockedBy?: LoopCutBlockReason;
}

export interface LoopCutExecutionResult {
  result: MeshOperatorResult;
  analysis?: LoopCutAnalysis;
  error?: string;
  stats?: {
    splitEdges: number;
    splitFaces: number;
    createdVertices: number;
    createdEdges: number;
    createdFaces: number;
    isClosed: boolean;
  };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function distSq3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Given a quad face and directed entry endpoints (entryA -> entryB) on one edge,
 * locates the unique opposite edge preserving the two side rails:
 * Rail A: entryA -> exitA
 * Rail B: entryB -> exitB
 */
function stepQuadAcrossEdge(
  mesh: EditableMesh,
  face: MeshFace,
  entryA: string,
  entryB: string,
): {
  valid: boolean;
  exitA?: string;
  exitB?: string;
  oppositeEdgeId?: string;
  windingAligned?: boolean;
  reason?: string;
  blockedBy?: LoopCutBlockReason;
} {
  if (face.vertexIds.length === 3) {
    return {
      valid: false,
      blockedBy: 'triangle',
      reason:
        'El recorrido encontró un triángulo: no existe una arista opuesta paralela para continuar.',
    };
  }
  if (face.vertexIds.length > 4) {
    return {
      valid: false,
      blockedBy: 'ngon',
      reason: `El recorrido encontró un polígono de ${face.vertexIds.length} lados (N-gon): no existe una arista opuesta inequívoca.`,
    };
  }
  if (face.vertexIds.length < 3 || new Set(face.vertexIds).size !== 4) {
    return {
      valid: false,
      blockedBy: 'degenerate',
      reason:
        'Cara cuadrilateral degenerada (vértices repetidos o insuficientes) detectada en el recorrido.',
    };
  }

  const [v0, v1, v2, v3] = face.vertexIds;
  const verts = [v0, v1, v2, v3];

  let exitA = '';
  let exitB = '';
  let windingAligned = true;
  let found = false;

  for (let i = 0; i < 4; i++) {
    const p0 = verts[i];
    const p1 = verts[(i + 1) % 4];
    const p2 = verts[(i + 2) % 4];
    const p3 = verts[(i + 3) % 4];
    if (p0 === entryA && p1 === entryB) {
      // Entry matches cyclic edge p0 -> p1:
      // Rail A is p0 -> p3, Rail B is p1 -> p2
      exitA = p3;
      exitB = p2;
      windingAligned = true;
      found = true;
      break;
    }
    if (p1 === entryA && p0 === entryB) {
      // Entry is opposite to cyclic edge (p1 -> p0):
      // Rail A is p1 -> p2, Rail B is p0 -> p3
      exitA = p2;
      exitB = p3;
      windingAligned = false;
      found = true;
      break;
    }
  }

  if (!found) {
    return {
      valid: false,
      blockedBy: 'degenerate',
      reason: 'No se pudo localizar la arista de entrada dentro de la cara cuadrangular.',
    };
  }

  if (new Set([entryA, entryB, exitA, exitB]).size !== 4) {
    return {
      valid: false,
      blockedBy: 'pole',
      reason:
        'Polo o vértice colapsado detectado en la cara cuadrangular: el recorrido no es inequívoco.',
    };
  }

  const oppEdgeId = mesh.findEdgeId(exitA, exitB);
  const railAEdgeId = mesh.findEdgeId(entryA, exitA);
  const railBEdgeId = mesh.findEdgeId(entryB, exitB);
  if (!oppEdgeId || !railAEdgeId || !railBEdgeId) {
    return {
      valid: false,
      blockedBy: 'degenerate',
      reason:
        'Topología de aristas incompleta en la cara cuadrangular atravesada.',
    };
  }

  // Ensure non-zero entry/exit edges so cuts never collapse onto an identical point
  const pEntryA = mesh.getVertex(entryA)?.position;
  const pEntryB = mesh.getVertex(entryB)?.position;
  const pExitA = mesh.getVertex(exitA)?.position;
  const pExitB = mesh.getVertex(exitB)?.position;
  if (!pEntryA || !pEntryB || !pExitA || !pExitB) {
    return {
      valid: false,
      blockedBy: 'degenerate',
      reason: 'Faltan coordenadas de vértice en la cara cuadrangular.',
    };
  }
  if (distSq3(pEntryA, pEntryB) < 1e-12 || distSq3(pExitA, pExitB) < 1e-12) {
    return {
      valid: false,
      blockedBy: 'degenerate',
      reason: 'Arista de longitud nula detectada en el recorrido.',
    };
  }

  return {
    valid: true,
    exitA,
    exitB,
    oppositeEdgeId: oppEdgeId,
    windingAligned,
  };
}

function describeNonQuadFace(face: MeshFace): {
  blockedBy: LoopCutBlockReason;
  reason: string;
} {
  const n = face.vertexIds.length;
  if (n === 3) {
    return {
      blockedBy: 'triangle',
      reason:
        'El recorrido encontró un triángulo: Loop Cut requiere caras cuadrilaterales continuas.',
    };
  }
  if (n > 4) {
    return {
      blockedBy: 'ngon',
      reason: `El recorrido encontró un N-gon (${n} vértices): no se puede cruzar de forma inequívoca.`,
    };
  }
  return {
    blockedBy: 'degenerate',
    reason: 'Se encontró una cara degenerada que bloquea el recorrido.',
  };
}

/**
 * Analyzes an edge ring starting from startEdgeId using topological quad-strip traversal.
 * - Allows clean termination at genuine open mesh boundaries (edges with 1 adjacent face).
 * - Rejects triangles, N-gons, non-manifold edges, Mobius twists, self-intersections, and poles
 *   with an explicit human-readable explanation (never performs silent partial cuts).
 */
export function analyzeEdgeLoopRing(
  mesh: EditableMesh,
  startEdgeId: string,
): LoopCutAnalysis {
  const startEdge = mesh.getEdge(startEdgeId);
  if (!startEdge) {
    return {
      valid: false,
      ring: null,
      blockedBy: 'missing_edge',
      reason: 'La arista seleccionada no existe en la malla.',
    };
  }

  const adjFaces = mesh.getFacesForEdge(startEdgeId);
  if (adjFaces.length === 0) {
    return {
      valid: false,
      ring: null,
      blockedBy: 'loose_edge',
      reason:
        'La arista seleccionada es libre y no pertenece a ninguna cara cuadrangular.',
    };
  }
  if (adjFaces.length > 2) {
    return {
      valid: false,
      ring: null,
      blockedBy: 'non_manifold',
      reason:
        'La arista es no múltiple (compartida por más de 2 caras): el recorrido es ambiguo.',
    };
  }

  // Validate all faces directly touching startEdge first
  for (const fid of adjFaces) {
    const f = mesh.getFace(fid);
    if (!f) {
      return {
        valid: false,
        ring: null,
        blockedBy: 'degenerate',
        reason: 'Cara adyacente inválida en la arista inicial.',
      };
    }
    if (f.vertexIds.length !== 4) {
      const desc = describeNonQuadFace(f);
      return {
        valid: false,
        ring: null,
        blockedBy: desc.blockedBy,
        reason: desc.reason,
      };
    }
  }

  const startA = startEdge.v0;
  const startB = startEdge.v1;

  // Shared traversal sets prevent infinite cycles and crossing/pole collisions across directions
  const visitedFaces = new Set<string>();
  const usedCrossEdges = new Set<string>([startEdgeId]);
  const maxSteps = mesh.faces.length + 1;

  const walkDirection = (
    initialFaceId: string,
  ): {
    ok: boolean;
    closed: boolean;
    steps: EdgeLoopQuadStep[];
    exitEdges: string[];
    errorReason?: string;
    blockedBy?: LoopCutBlockReason;
  } => {
    const steps: EdgeLoopQuadStep[] = [];
    const exitEdges: string[] = [];

    let currFaceId: string | undefined = initialFaceId;
    let currEdgeId = startEdgeId;
    let currA = startA;
    let currB = startB;

    while (currFaceId && steps.length < maxSteps) {
      if (visitedFaces.has(currFaceId)) {
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: 'pole',
          errorReason:
            'Polo o cruce topológico detectado: el bucle volvería a cruzar una cara ya recorrida.',
        };
      }

      const face = mesh.getFace(currFaceId);
      if (!face) {
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: 'degenerate',
          errorReason: 'Cara inexistente encontrada durante el recorrido.',
        };
      }
      if (face.vertexIds.length !== 4) {
        const desc = describeNonQuadFace(face);
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: desc.blockedBy,
          errorReason: desc.reason,
        };
      }

      const stepRes = stepQuadAcrossEdge(mesh, face, currA, currB);
      if (
        !stepRes.valid ||
        !stepRes.exitA ||
        !stepRes.exitB ||
        !stepRes.oppositeEdgeId ||
        stepRes.windingAligned === undefined
      ) {
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: stepRes.blockedBy ?? 'degenerate',
          errorReason:
            stepRes.reason ?? 'No se pudo determinar la arista opuesta.',
        };
      }

      visitedFaces.add(currFaceId);
      steps.push({
        faceId: currFaceId,
        a0: currA,
        b0: currB,
        a1: stepRes.exitA,
        b1: stepRes.exitB,
        windingAligned: stepRes.windingAligned,
      });
      exitEdges.push(stepRes.oppositeEdgeId);

      // Check loop closure back onto startEdgeId
      if (stepRes.oppositeEdgeId === startEdgeId) {
        if (stepRes.exitA === startB && stepRes.exitB === startA) {
          return {
            ok: false,
            closed: false,
            steps,
            exitEdges,
            blockedBy: 'twist',
            errorReason:
              'Recorrido cerrado no orientable (torsión tipo cinta de Möbius): el corte no puede cerrarse de forma coherente.',
          };
        }
        return { ok: true, closed: true, steps, exitEdges };
      }

      // If another interior edge was already crossed in this ring, topology is pinched/pole/self-intersecting
      if (usedCrossEdges.has(stepRes.oppositeEdgeId)) {
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: 'pole',
          errorReason:
            'Cruce o polo topológico: el recorrido vuelve sobre una arista distinta a la inicial.',
        };
      }
      usedCrossEdges.add(stepRes.oppositeEdgeId);

      const oppAdj = mesh.getFacesForEdge(stepRes.oppositeEdgeId);
      if (oppAdj.length === 1) {
        // Reached a genuine open mesh boundary -> valid open loop termination!
        return { ok: true, closed: false, steps, exitEdges };
      }
      if (oppAdj.length > 2) {
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: 'non_manifold',
          errorReason:
            'El recorrido alcanza una arista no múltiple (más de 2 caras): el bucle es ambiguo.',
        };
      }

      const nextFaceId = oppAdj.find((fid) => fid !== currFaceId);
      if (!nextFaceId) {
        return { ok: true, closed: false, steps, exitEdges };
      }

      const nextFace = mesh.getFace(nextFaceId);
      if (!nextFace) {
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: 'degenerate',
          errorReason: 'Cara vecina inválida durante el recorrido.',
        };
      }
      if (nextFace.vertexIds.length !== 4) {
        const desc = describeNonQuadFace(nextFace);
        return {
          ok: false,
          closed: false,
          steps,
          exitEdges,
          blockedBy: desc.blockedBy,
          errorReason: desc.reason,
        };
      }

      // Advance keeping transverse rail orientation (exitA -> exitB becomes next entryA -> entryB)
      currFaceId = nextFaceId;
      currEdgeId = stepRes.oppositeEdgeId;
      currA = stepRes.exitA;
      currB = stepRes.exitB;
    }

    return {
      ok: false,
      closed: false,
      steps,
      exitEdges,
      blockedBy: 'degenerate',
      errorReason:
        'Se superó el límite de iteraciones sin cerrar ni alcanzar una frontera válida.',
    };
  };

  // Walk Direction 1 from adjFaces[0]
  const dir1 = walkDirection(adjFaces[0]);
  if (!dir1.ok) {
    return {
      valid: false,
      ring: null,
      blockedBy: dir1.blockedBy,
      reason: dir1.errorReason,
    };
  }

  if (dir1.closed && dir1.steps.length > 0) {
    return {
      valid: true,
      ring: {
        edgeIds: [startEdgeId, ...dir1.exitEdges.slice(0, -1)],
        faceIds: dir1.steps.map((s) => s.faceId),
        quadSteps: dir1.steps,
        isClosed: true,
      },
    };
  }

  // Open loop: walk opposite direction from adjFaces[1] if startEdge is interior
  let dir2Steps: EdgeLoopQuadStep[] = [];
  let dir2Edges: string[] = [];

  if (adjFaces.length === 2) {
    const dir2 = walkDirection(adjFaces[1]);
    if (!dir2.ok) {
      return {
        valid: false,
        ring: null,
        blockedBy: dir2.blockedBy,
        reason: dir2.errorReason,
      };
    }
    dir2Steps = dir2.steps;
    dir2Edges = dir2.exitEdges;
  }

  // Reverse dir2 steps so each step flows forward INTO startEdge(startA, startB) -> dir1:
  // Swapping (a0 <-> a1) AND (b0 <-> b1) preserves Rail A and Rail B alignment across the entire strip,
  // while negating windingAligned preserves the exact original polygon winding/normal of each face.
  const backwardSteps: EdgeLoopQuadStep[] = [...dir2Steps]
    .reverse()
    .map((s) => ({
      faceId: s.faceId,
      a0: s.a1,
      b0: s.b1,
      a1: s.a0,
      b1: s.b0,
      windingAligned: !s.windingAligned,
    }));
  const backwardEdges = [...dir2Edges].reverse();

  const allSteps = [...backwardSteps, ...dir1.steps];
  const allEdges = [...backwardEdges, startEdgeId, ...dir1.exitEdges];

  if (allSteps.length === 0) {
    return {
      valid: false,
      ring: null,
      blockedBy: 'degenerate',
      reason: 'No se encontraron caras cuadrangulares válidas para cortar.',
    };
  }

  return {
    valid: true,
    ring: {
      edgeIds: allEdges,
      faceIds: allSteps.map((s) => s.faceId),
      quadSteps: allSteps,
      isClosed: false,
    },
  };
}

export function findEdgeLoopRing(
  mesh: EditableMesh,
  startEdgeId: string,
): EdgeLoopRing | null {
  const analysis = analyzeEdgeLoopRing(mesh, startEdgeId);
  return analysis.valid ? analysis.ring : null;
}

export function findFirstValidLoopEdge(
  mesh: EditableMesh,
  preferredEdgeIds?: Iterable<string>,
): string | null {
  if (!mesh.faces.some((f) => f.vertexIds.length === 4)) {
    return null;
  }
  if (preferredEdgeIds) {
    for (const eid of preferredEdgeIds) {
      if (analyzeEdgeLoopRing(mesh, eid).valid) return eid;
    }
  }
  for (const edge of mesh.edges) {
    if (analyzeEdgeLoopRing(mesh, edge.id).valid) return edge.id;
  }
  return null;
}

/**
 * Computes strictly monotonic split fractions in (0, 1) for 1..N loop cuts.
 * - slide = 0 distributes all cuts uniformly at k / (cuts + 1).
 * - slide in [-1, 1] shifts all cuts uniformly while keeping every vertex strictly inside [0.03, 0.97]
 *   so cuts never exit their faces or compress unevenly against adjacent cuts.
 */
export function computeLoopCutFractions(cuts: number, slide: number): number[] {
  const count = Math.max(1, Math.min(24, Math.round(cuts)));
  const clampedSlide = Number.isFinite(slide)
    ? Math.max(-1, Math.min(1, slide))
    : 0;

  const spacing = 1 / (count + 1);
  const maxShift = Math.max(0, Math.min(0.45, spacing - 0.03));
  const offset = clampedSlide * maxShift;

  const fractions: number[] = [];
  for (let c = 1; c <= count; c++) {
    const t = Math.max(0.03, Math.min(0.97, c * spacing + offset));
    fractions.push(t);
  }
  return fractions;
}

export function computeLoopCutPreviewSegments(
  mesh: EditableMesh,
  ring: EdgeLoopRing,
  cuts: number,
  slide: number,
): [Vec3, Vec3][] {
  const segments: [Vec3, Vec3][] = [];
  const fractions = computeLoopCutFractions(cuts, slide);

  for (const t of fractions) {
    for (const step of ring.quadSteps) {
      const pa0 = mesh.getVertex(step.a0)?.position;
      const pb0 = mesh.getVertex(step.b0)?.position;
      const pa1 = mesh.getVertex(step.a1)?.position;
      const pb1 = mesh.getVertex(step.b1)?.position;
      if (!pa0 || !pb0 || !pa1 || !pb1) continue;

      const pStart = lerpVec3(pa0, pb0, t);
      const pEnd = lerpVec3(pa1, pb1, t);
      segments.push([pStart, pEnd]);
    }
  }
  return segments;
}

function findCornerUv(
  mesh: EditableMesh,
  face: MeshFace | undefined,
  vertexId: string,
): Vec2 | undefined {
  if (face?.uvs && face.uvs.length === face.vertexIds.length) {
    const idx = face.vertexIds.indexOf(vertexId);
    if (idx >= 0) return face.uvs[idx];
  }
  return mesh.getVertex(vertexId)?.uv;
}

/**
 * Executes a real topological Loop Cut across the validated quad ring:
 * - Creates split vertices once per unique crossed edge (zero duplicates at shared boundaries).
 * - Preserves original winding & surface normal orientation of every divided quad.
 * - Cleans up replaced faces/edges and rebuilds mesh indices cleanly.
 * - Selects the newly created transverse loop edges.
 */
export function loopCutMesh(
  sourceMesh: EditableMesh,
  params: LoopCutParams,
): LoopCutExecutionResult {
  const mesh = sourceMesh.clone();
  const nextSelected = new Set<string>();

  if (!params.edgeId) {
    return {
      result: { mesh, nextSelectedIds: nextSelected },
      error: 'Selecciona una arista cuadrangular válida para aplicar Loop Cut.',
    };
  }

  const analysis = analyzeEdgeLoopRing(mesh, params.edgeId);
  if (!analysis.valid || !analysis.ring || analysis.ring.quadSteps.length === 0) {
    return {
      result: { mesh, nextSelectedIds: nextSelected },
      analysis,
      error:
        analysis.reason ??
        'La arista seleccionada no pertenece a un bucle cuadrangular compatible.',
    };
  }

  const ring = analysis.ring;
  const fractions = computeLoopCutFractions(params.cuts, params.slide);
  const verticesBefore = mesh.vertices.length;
  const edgesBefore = mesh.edges.length;
  const facesBefore = mesh.faces.length;

  // Map canonical edge key -> directed split vertex IDs aligned with (from -> to).
  // Reverses automatically if queried in the opposite vertex direction so shared boundaries never cross.
  const splitMap = new Map<string, { from: string; to: string; ids: string[] }>();

  const ensureDirectedSplit = (u: string, v: string): string[] => {
    const key = canonicalEdgeKey(u, v);
    const existing = splitMap.get(key);
    if (existing) {
      return existing.from === u ? existing.ids : [...existing.ids].reverse();
    }
    const vu = mesh.getVertex(u);
    const vv = mesh.getVertex(v);
    if (!vu || !vv) return [];

    const ids: string[] = [];
    for (const t of fractions) {
      const pos = lerpVec3(vu.position, vv.position, t);
      const newVert = mesh.addVertex(pos[0], pos[1], pos[2]);
      if (vu.uv && vv.uv) {
        newVert.uv = lerpVec2(vu.uv, vv.uv, t);
      }
      ids.push(newVert.id);
    }
    splitMap.set(key, { from: u, to: v, ids });
    return ids;
  };

  interface StepSplitPlan {
    startChain: string[];
    endChain: string[];
    windingAligned: boolean;
    uvStartA?: Vec2;
    uvStartB?: Vec2;
    uvEndA?: Vec2;
    uvEndB?: Vec2;
    hasFaceUvs: boolean;
  }

  const stepPlans: StepSplitPlan[] = [];

  for (const step of ring.quadSteps) {
    const origFace = mesh.getFace(step.faceId);
    const startSplits = ensureDirectedSplit(step.a0, step.b0);
    const endSplits = ensureDirectedSplit(step.a1, step.b1);

    const uvStartA = findCornerUv(mesh, origFace, step.a0);
    const uvStartB = findCornerUv(mesh, origFace, step.b0);
    const uvEndA = findCornerUv(mesh, origFace, step.a1);
    const uvEndB = findCornerUv(mesh, origFace, step.b1);

    stepPlans.push({
      startChain: [step.a0, ...startSplits, step.b0],
      endChain: [step.a1, ...endSplits, step.b1],
      windingAligned: step.windingAligned,
      uvStartA,
      uvStartB,
      uvEndA,
      uvEndB,
      hasFaceUvs: Boolean(origFace?.uvs && origFace.uvs.length === 4),
    });
  }

  const facesToDelete = new Set(ring.faceIds);
  const edgesToDelete = new Set(ring.edgeIds);

  mesh.deleteFaces(facesToDelete);
  mesh.deleteEdges(edgesToDelete);

  let createdFaceCount = 0;
  for (const plan of stepPlans) {
    const m = plan.startChain.length;
    for (let j = 0; j < m - 1; j++) {
      const t0 = j === 0 ? 0 : fractions[j - 1];
      const t1 = j === m - 2 ? 1 : fractions[j];

      const vIds = plan.windingAligned
        ? [
            plan.startChain[j],
            plan.startChain[j + 1],
            plan.endChain[j + 1],
            plan.endChain[j],
          ]
        : [
            plan.startChain[j],
            plan.endChain[j],
            plan.endChain[j + 1],
            plan.startChain[j + 1],
          ];

      const newFace = mesh.addFace(vIds);
      if (newFace) {
        createdFaceCount++;
        if (
          plan.hasFaceUvs &&
          plan.uvStartA &&
          plan.uvStartB &&
          plan.uvEndA &&
          plan.uvEndB
        ) {
          const uvS0 = lerpVec2(plan.uvStartA, plan.uvStartB, t0);
          const uvS1 = lerpVec2(plan.uvStartA, plan.uvStartB, t1);
          const uvE1 = lerpVec2(plan.uvEndA, plan.uvEndB, t1);
          const uvE0 = lerpVec2(plan.uvEndA, plan.uvEndB, t0);
          newFace.uvs = plan.windingAligned
            ? [uvS0, uvS1, uvE1, uvE0]
            : [uvS0, uvE0, uvE1, uvS1];
        }
      }

      if (j > 0) {
        const cutEdgeId = mesh.findEdgeId(plan.startChain[j], plan.endChain[j]);
        if (cutEdgeId) nextSelected.add(cutEdgeId);
      }
    }
  }

  mesh.clearCustomNormals();
  mesh.rebuildIndices();

  return {
    result: { mesh, nextSelectedIds: nextSelected },
    analysis,
    stats: {
      splitEdges: ring.edgeIds.length,
      splitFaces: ring.faceIds.length,
      createdVertices: mesh.vertices.length - verticesBefore,
      createdEdges: mesh.edges.length - (edgesBefore - edgesToDelete.size),
      createdFaces: mesh.faces.length - (facesBefore - facesToDelete.size) || createdFaceCount,
      isClosed: ring.isClosed,
    },
  };
}

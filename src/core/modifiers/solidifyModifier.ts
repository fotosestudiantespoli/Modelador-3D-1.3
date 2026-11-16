import {
  canonicalEdgeKey,
  EditableMesh,
  MeshFace,
  SerializedEditableMesh,
  Vec2,
  Vec3,
} from '../mesh/EditableMesh';
import { analyzeMeshNormals, isFaceDegenerate } from '../mesh/normals';
import {
  ModifierDiagnostic,
  normalizeSolidifyParams,
  SolidifyModifierParams,
  TABLET_SOLIDIFY_FACE_BUDGET,
} from './types';

export interface SolidifyEvaluationResult {
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
 * Evaluates the non-destructive Solidify modifier cleanly on open or closed meshes.
 * Preserves winding consistency, generates rim walls for boundary edges, checks
 * source normal health, and respects tablet polygon budgets.
 */
export function evaluateSolidifyModifier(
  sourceSerialized: SerializedEditableMesh,
  rawParams: unknown,
  modifierId: string,
  options: { isApplying?: boolean } = {},
): SolidifyEvaluationResult {
  const params: SolidifyModifierParams = normalizeSolidifyParams(rawParams);
  const sourceMesh = EditableMesh.fromJSON(sourceSerialized);
  const srcStats = inspectTopologyStats(sourceMesh);

  if (sourceMesh.faces.length === 0 || sourceMesh.vertices.length === 0) {
    return {
      mesh: sourceMesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'solidify',
        status: 'warning',
        code: 'empty_mesh',
        message: 'La malla base no contiene caras para solidificar.',
        vertexCount: sourceMesh.vertices.length,
        edgeCount: sourceMesh.edges.length,
        faceCount: sourceMesh.faces.length,
        ...srcStats,
      },
    };
  }

  const normalsReport = analyzeMeshNormals(sourceMesh);
  const hasNormalIssues =
    normalsReport.degenerateFaceIds.length > 0 ||
    normalsReport.invertedFaceIds.length > 0 ||
    normalsReport.inconsistentFaceIds.length > 0;

  let normalsWarningMsg: string | undefined;
  if (hasNormalIssues) {
    const details: string[] = [];
    if (normalsReport.invertedFaceIds.length > 0) {
      details.push(`${normalsReport.invertedFaceIds.length} invertida(s)`);
    }
    if (normalsReport.inconsistentFaceIds.length > 0) {
      details.push(
        `${normalsReport.inconsistentFaceIds.length} inconsistente(s)`,
      );
    }
    if (normalsReport.degenerateFaceIds.length > 0) {
      details.push(
        `${normalsReport.degenerateFaceIds.length} degenerada(s)`,
      );
    }
    normalsWarningMsg = `Normales de origen con problemas (${details.join(', ')}). Corrígelas en Modo Edición (Recalcular hacia afuera / Invertir normales) para evitar caras invertidas.`;
  }

  // Zero thickness -> preserve original mesh cleanly without coincident duplicate faces
  if (Math.abs(params.thickness) < 1e-5) {
    return {
      mesh: sourceMesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'solidify',
        status: 'warning',
        code: 'degenerate_thickness',
        message:
          normalsWarningMsg ??
          'El grosor (Thickness) es 0; ajusta el valor para generar volumen.',
        vertexCount: sourceMesh.vertices.length,
        edgeCount: sourceMesh.edges.length,
        faceCount: sourceMesh.faces.length,
        ...srcStats,
      },
    };
  }

  const degenerateSet = new Set(normalsReport.degenerateFaceIds);
  const validFaces: MeshFace[] = sourceMesh.faces.filter(
    (f) => !degenerateSet.has(f.id) && !isFaceDegenerate(sourceMesh, f),
  );

  if (validFaces.length === 0) {
    return {
      mesh: sourceMesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'solidify',
        status: 'error',
        code: 'degenerate_faces',
        message: 'Todas las caras de la malla son degeneradas o inválidas.',
        vertexCount: sourceMesh.vertices.length,
        edgeCount: sourceMesh.edges.length,
        faceCount: sourceMesh.faces.length,
        ...srcStats,
      },
    };
  }

  // Compute valid face normals & directed half-edges to detect exact open boundary edges
  const faceNormalMap = new Map<string, Vec3>();
  const edgeFaceCounts = new Map<string, number>();
  const boundaryHalfEdges: {
    a: string;
    b: string;
    edgeKey: string;
    face: MeshFace;
    idxA: number;
    idxB: number;
  }[] = [];

  for (const face of validFaces) {
    faceNormalMap.set(face.id, sourceMesh.computeFaceNormal(face));
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const key = canonicalEdgeKey(a, b);
      edgeFaceCounts.set(key, (edgeFaceCounts.get(key) ?? 0) + 1);
    }
  }

  for (const face of validFaces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const key = canonicalEdgeKey(a, b);
      if (edgeFaceCounts.get(key) === 1) {
        boundaryHalfEdges.push({
          a,
          b,
          edgeKey: key,
          face,
          idxA: i,
          idxB: (i + 1) % n,
        });
      }
    }
  }

  const hasBoundaryRim = boundaryHalfEdges.length > 0;
  const effectiveOnlyRim = params.onlyRim && hasBoundaryRim;
  const noRimFallbackWarning =
    params.onlyRim && !hasBoundaryRim
      ? 'Only Rim requiere bordes abiertos; al ser una malla cerrada se muestra la solidificación completa.'
      : undefined;

  const projectedFaceCount = effectiveOnlyRim
    ? boundaryHalfEdges.length
    : validFaces.length * 2 +
      (params.fillRim ? boundaryHalfEdges.length : 0);

  if (projectedFaceCount > TABLET_SOLIDIFY_FACE_BUDGET) {
    const msg = `Solidify excede el presupuesto de tablet (${projectedFaceCount.toLocaleString()} > ${TABLET_SOLIDIFY_FACE_BUDGET.toLocaleString()} caras).`;
    return {
      mesh: sourceMesh.toJSON(),
      diagnostic: {
        modifierId,
        type: 'solidify',
        status: options.isApplying ? 'error' : 'warning',
        code: 'budget_exceeded',
        message: msg,
        vertexCount: sourceMesh.vertices.length,
        edgeCount: sourceMesh.edges.length,
        faceCount: sourceMesh.faces.length,
        ...srcStats,
        budgetExceeded: true,
      },
    };
  }

  // Angle-weighted smooth vertex normals & even-thickness compensation per vertex
  const vertNormalAccum = new Map<string, Vec3>();
  const vertCornerRecords = new Map<string, { fn: Vec3; angle: number }[]>();
  const vertMinEdgeLen = new Map<string, number>();

  for (const edge of sourceMesh.edges) {
    const p0 = sourceMesh.getVertex(edge.v0)?.position;
    const p1 = sourceMesh.getVertex(edge.v1)?.position;
    if (!p0 || !p1) continue;
    const len = lenVec(subVec(p1, p0));
    if (len < 1e-6) continue;
    const prev0 = vertMinEdgeLen.get(edge.v0);
    if (prev0 === undefined || len < prev0) vertMinEdgeLen.set(edge.v0, len);
    const prev1 = vertMinEdgeLen.get(edge.v1);
    if (prev1 === undefined || len < prev1) vertMinEdgeLen.set(edge.v1, len);
  }

  for (const face of validFaces) {
    const fn = faceNormalMap.get(face.id)!;
    const k = face.vertexIds.length;
    for (let i = 0; i < k; i++) {
      const vid = face.vertexIds[i];
      const prevId = face.vertexIds[(i - 1 + k) % k];
      const nextId = face.vertexIds[(i + 1) % k];
      const pCurr = sourceMesh.getVertex(vid)?.position;
      const pPrev = sourceMesh.getVertex(prevId)?.position;
      const pNext = sourceMesh.getVertex(nextId)?.position;
      if (!pCurr || !pPrev || !pNext) continue;

      const d1 = normVec(subVec(pPrev, pCurr), [1, 0, 0]);
      const d2 = normVec(subVec(pNext, pCurr), [0, 1, 0]);
      const cosA = Math.max(-1, Math.min(1, dotVec(d1, d2)));
      const angle = Math.max(1e-3, Math.acos(cosA));

      const acc = vertNormalAccum.get(vid) ?? [0, 0, 0];
      vertNormalAccum.set(vid, [
        acc[0] + fn[0] * angle,
        acc[1] + fn[1] * angle,
        acc[2] + fn[2] * angle,
      ]);

      let recs = vertCornerRecords.get(vid);
      if (!recs) {
        recs = [];
        vertCornerRecords.set(vid, recs);
      }
      recs.push({ fn, angle });
    }
  }

  // Raw outer/inner displacement along +normal before evenThickness/clamp
  // When thickness > 0: outerDist >= innerDist (top = outer, bottom = inner).
  // When thickness < 0: outerDist <= innerDist (swap top/bottom roles so outward winding always holds).
  const rawOuterDist = params.thickness * (1 + params.offset) * 0.5;
  const rawInnerDist = -params.thickness * (1 - params.offset) * 0.5;
  const isFlippedThickness = params.thickness < 0;

  const outMesh = new EditableMesh();
  const topVertMap = new Map<string, string>();
  const botVertMap = new Map<string, string>();

  const ensureShellVertices = (vid: string): { topId: string; botId: string } => {
    const existingTop = topVertMap.get(vid);
    const existingBot = botVertMap.get(vid);
    if (existingTop && existingBot) {
      return { topId: existingTop, botId: existingBot };
    }

    const srcV = sourceMesh.getVertex(vid)!;
    const rawN = vertNormalAccum.get(vid) ?? [0, 0, 1];
    const unitN = normVec(rawN, [0, 0, 1]);

    let evenScale = 1;
    if (params.evenThickness) {
      const recs = vertCornerRecords.get(vid);
      if (recs && recs.length > 0) {
        let weightedDot = 0;
        let totalAngle = 0;
        for (const r of recs) {
          weightedDot += r.angle * Math.max(0.25, dotVec(unitN, r.fn));
          totalAngle += r.angle;
        }
        const avgCos = totalAngle > 1e-6 ? weightedDot / totalAngle : 1;
        evenScale = Math.min(3.0, Math.max(1.0, 1 / Math.max(0.25, avgCos)));
      }
    }

    let dOuter = rawOuterDist * evenScale;
    let dInner = rawInnerDist * evenScale;

    if (params.clamp > 0) {
      const minLen = vertMinEdgeLen.get(vid);
      if (minLen !== undefined && minLen > 1e-6) {
        const maxSingleSide = minLen * 0.5 * params.clamp;
        if (Math.abs(dOuter) > maxSingleSide) {
          dOuter = Math.sign(dOuter) * maxSingleSide;
        }
        if (Math.abs(dInner) > maxSingleSide) {
          dInner = Math.sign(dInner) * maxSingleSide;
        }
      }
    }

    const topDisp = isFlippedThickness ? dInner : dOuter;
    const botDisp = isFlippedThickness ? dOuter : dInner;

    const pTop = addVec(srcV.position, scaleVec(unitN, topDisp));
    const pBot = addVec(srcV.position, scaleVec(unitN, botDisp));

    const vTop = outMesh.addVertex(pTop[0], pTop[1], pTop[2]);
    const vBot = outMesh.addVertex(pBot[0], pBot[1], pBot[2]);
    if (srcV.uv) {
      vTop.uv = [srcV.uv[0], srcV.uv[1]];
      vBot.uv = [srcV.uv[0], srcV.uv[1]];
    }

    topVertMap.set(vid, vTop.id);
    botVertMap.set(vid, vBot.id);
    return { topId: vTop.id, botId: vBot.id };
  };

  // Pre-create shell vertices ONLY for vertices actually emitted
  if (!effectiveOnlyRim) {
    for (const face of validFaces) {
      const topIds: string[] = [];
      const botIds: string[] = [];
      for (const vid of face.vertexIds) {
        const pair = ensureShellVertices(vid);
        topIds.push(pair.topId);
        botIds.push(pair.botId);
      }

      const topFace = outMesh.addFace(topIds);
      const botFaceVerts = [...botIds].reverse();
      const botFace = outMesh.addFace(botFaceVerts);

      if (
        Array.isArray(face.uvs) &&
        face.uvs.length === face.vertexIds.length
      ) {
        if (topFace) {
          topFace.uvs = face.uvs.map((uv) => [uv[0], uv[1]] as Vec2);
        }
        if (botFace) {
          botFace.uvs = [...face.uvs]
            .reverse()
            .map((uv) => [uv[0], uv[1]] as Vec2);
        }
      }
    }

    // Preserve any edge bevelWeight on top & bottom shell edges for downstream Bevel modifiers
    for (const edge of sourceMesh.edges) {
      if (typeof edge.bevelWeight !== 'number' || edge.bevelWeight <= 0) continue;
      const topA = topVertMap.get(edge.v0);
      const topB = topVertMap.get(edge.v1);
      if (topA && topB) {
        const eid = outMesh.findEdgeId(topA, topB);
        const eObj = eid ? outMesh.getEdge(eid) : undefined;
        if (eObj) eObj.bevelWeight = edge.bevelWeight;
      }
      const botA = botVertMap.get(edge.v0);
      const botB = botVertMap.get(edge.v1);
      if (botA && botB) {
        const eid = outMesh.findEdgeId(botA, botB);
        const eObj = eid ? outMesh.getEdge(eid) : undefined;
        if (eObj) eObj.bevelWeight = edge.bevelWeight;
      }
    }
  }

  // Emit boundary rim quads when Fill Rim or Only Rim is active
  if (params.fillRim || effectiveOnlyRim) {
    const hasSrcUvs = sourceMesh.hasUVs();
    for (const bhe of boundaryHalfEdges) {
      const pairA = ensureShellVertices(bhe.a);
      const pairB = ensureShellVertices(bhe.b);
      // Skip degenerate zero-offset boundary if top and bot coincide at both ends
      const pTopA = outMesh.getVertex(pairA.topId)!.position;
      const pBotA = outMesh.getVertex(pairA.botId)!.position;
      const pTopB = outMesh.getVertex(pairB.topId)!.position;
      const pBotB = outMesh.getVertex(pairB.botId)!.position;
      if (
        lenVec(subVec(pTopA, pBotA)) < 1e-6 &&
        lenVec(subVec(pTopB, pBotB)) < 1e-6
      ) {
        continue;
      }

      // Outward winding: [a_bot, b_bot, b_top, a_top]
      const rimFace = outMesh.addFace([
        pairA.botId,
        pairB.botId,
        pairB.topId,
        pairA.topId,
      ]);
      if (rimFace && hasSrcUvs) {
        const uvA: Vec2 =
          bhe.face.uvs?.[bhe.idxA] ?? sourceMesh.getVertex(bhe.a)?.uv ?? [0, 0];
        const uvB: Vec2 =
          bhe.face.uvs?.[bhe.idxB] ?? sourceMesh.getVertex(bhe.b)?.uv ?? [1, 0];
        rimFace.uvs = [
          [uvA[0], uvA[1]],
          [uvB[0], uvB[1]],
          [uvB[0], uvB[1]],
          [uvA[0], uvA[1]],
        ];
      }
    }
  }

  outMesh.rebuildIndices();
  const outStats = inspectTopologyStats(outMesh);

  let status: ModifierDiagnostic['status'] = 'ok';
  let code: ModifierDiagnostic['code'] | undefined;
  let message: string | undefined;

  if (normalsWarningMsg) {
    status = 'warning';
    code = 'normals_warning';
    message = normalsWarningMsg;
  } else if (noRimFallbackWarning) {
    status = 'warning';
    code = 'no_rim_edges';
    message = noRimFallbackWarning;
  }

  return {
    mesh: outMesh.toJSON(),
    diagnostic: {
      modifierId,
      type: 'solidify',
      status,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
      vertexCount: outMesh.vertices.length,
      edgeCount: outMesh.edges.length,
      faceCount: outMesh.faces.length,
      ...outStats,
    },
  };
}

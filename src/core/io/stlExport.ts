import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { canonicalEdgeKey, EditableMesh } from '../mesh/EditableMesh';
import { SceneObjectData } from '../project/types';
import {
  buildThreeMeshForExport,
  ProgressCallback,
  yieldToMainThread,
} from './meshUtils';
import { analyzeExportTargets } from './objExport';

export interface StlMeshDiagnostic {
  objectId: string;
  objectName: string;
  triangleCount: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentWindingEdges: number;
  degenerateTriangles: number;
  invalidIndexCount: number;
  warnings: string[];
  errors: string[];
}

export interface StlValidationSummary {
  validMeshes: SceneObjectData[];
  skippedObjects: Array<{ id: string; name: string; reason: string }>;
  diagnostics: StlMeshDiagnostic[];
  blockingErrors: string[];
  warnings: string[];
  totalTriangles: number;
}

export interface StlExportResult {
  data: ArrayBuffer | string;
  binary: boolean;
  exportedCount: number;
  totalTriangles: number;
  validation: StlValidationSummary;
}

/**
 * Validates EditableMesh topology & geometry prior to STL export:
 * - Faces exist
 * - Vertex references & coordinates are valid
 * - Triangle normals are valid (non-zero area)
 * - Detects open boundary edges (holes), non-manifold edges, and inconsistent winding
 */
export function validateMeshForStl(obj: SceneObjectData): StlMeshDiagnostic {
  const editable = EditableMesh.fromJSON(obj.mesh);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (editable.faces.length === 0 || editable.vertices.length < 3) {
    errors.push(`"${obj.name}" no tiene caras suficientes para exportar a STL.`);
    return {
      objectId: obj.id,
      objectName: obj.name,
      triangleCount: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      inconsistentWindingEdges: 0,
      degenerateTriangles: 0,
      invalidIndexCount: 0,
      warnings,
      errors,
    };
  }

  let invalidIndexCount = 0;
  let degenerateTriangles = 0;
  let triangleCount = 0;

  // Map canonical edge -> list of directed half-edges (from->to)
  const edgeHalfUses = new Map<string, string[]>();

  for (const face of editable.faces) {
    if (face.vertexIds.length < 3) {
      invalidIndexCount++;
      continue;
    }

    let faceValid = true;
    for (const vid of face.vertexIds) {
      const v = editable.getVertex(vid);
      if (
        !v ||
        !Number.isFinite(v.position[0]) ||
        !Number.isFinite(v.position[1]) ||
        !Number.isFinite(v.position[2])
      ) {
        invalidIndexCount++;
        faceValid = false;
        break;
      }
    }
    if (!faceValid) continue;

    // Record polygon boundary half-edges for manifold / open-mesh diagnostics
    const fn = face.vertexIds.length;
    for (let i = 0; i < fn; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % fn];
      const key = canonicalEdgeKey(a, b);
      const list = edgeHalfUses.get(key) ?? [];
      list.push(`${a}->${b}`);
      edgeHalfUses.set(key, list);
    }

    const tris = editable.triangulateFaceLocalIndices(face);
    for (const [i0, i1, i2] of tris) {
      const p0 = editable.getVertex(face.vertexIds[i0])?.position;
      const p1 = editable.getVertex(face.vertexIds[i1])?.position;
      const p2 = editable.getVertex(face.vertexIds[i2])?.position;
      if (!p0 || !p1 || !p2) {
        invalidIndexCount++;
        continue;
      }

      const ux = p1[0] - p0[0];
      const uy = p1[1] - p0[1];
      const uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0];
      const vy = p2[1] - p0[1];
      const vz = p2[2] - p0[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const areaDouble = Math.hypot(cx, cy, cz);

      if (!Number.isFinite(areaDouble) || areaDouble < 1e-9) {
        degenerateTriangles++;
      } else {
        triangleCount++;
      }
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentWindingEdges = 0;

  for (const uses of edgeHalfUses.values()) {
    if (uses.length === 1) {
      boundaryEdges++;
    } else if (uses.length > 2) {
      nonManifoldEdges++;
    } else if (uses.length === 2 && uses[0] === uses[1]) {
      inconsistentWindingEdges++;
    }
  }

  if (triangleCount === 0) {
    errors.push(
      `"${obj.name}" no produjo triángulos con normal válida (geometría degenerada).`,
    );
  }
  if (invalidIndexCount > 0) {
    errors.push(
      `"${obj.name}" tiene ${invalidIndexCount} referencias de vértices inválidas.`,
    );
  }
  if (boundaryEdges > 0) {
    warnings.push(
      `"${obj.name}": malla abierta con ${boundaryEdges} arista(s) de borde (posibles agujeros o caras abiertas).`,
    );
  }
  if (nonManifoldEdges > 0) {
    warnings.push(
      `"${obj.name}": geometría no múltiple (non-manifold) en ${nonManifoldEdges} arista(s).`,
    );
  }
  if (inconsistentWindingEdges > 0) {
    warnings.push(
      `"${obj.name}": orientación de normales inconsistente en ${inconsistentWindingEdges} arista(s).`,
    );
  }
  if (degenerateTriangles > 0) {
    warnings.push(
      `"${obj.name}": se detectaron ${degenerateTriangles} triángulo(s) de área nula.`,
    );
  }

  return {
    objectId: obj.id,
    objectName: obj.name,
    triangleCount,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentWindingEdges,
    degenerateTriangles,
    invalidIndexCount,
    warnings,
    errors,
  };
}

export function validateCandidatesForStlExport(
  candidates: SceneObjectData[],
): StlValidationSummary {
  const report = analyzeExportTargets(candidates);
  const diagnostics = report.validMeshes.map((m) => validateMeshForStl(m));
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  let totalTriangles = 0;

  for (const d of diagnostics) {
    totalTriangles += d.triangleCount;
    blockingErrors.push(...d.errors);
    warnings.push(...d.warnings);
  }

  if (report.validMeshes.length === 0) {
    blockingErrors.push(
      'No hay mallas 3D válidas en el alcance seleccionado para exportar a STL.',
    );
  }

  return {
    validMeshes: report.validMeshes,
    skippedObjects: report.skippedObjects,
    diagnostics,
    blockingErrors,
    warnings,
    totalTriangles,
  };
}

export async function exportObjectsToStl(
  candidates: SceneObjectData[],
  options: {
    binary?: boolean;
    applyTransform?: boolean;
    exportScale?: number;
    onProgress?: ProgressCallback;
  } = {},
): Promise<StlExportResult> {
  const binary = options.binary ?? true;
  const applyTransform = options.applyTransform ?? true;
  const exportScale = options.exportScale ?? 1;

  if (!Number.isFinite(exportScale) || exportScale <= 0) {
    throw new Error('La escala de exportación debe ser un número positivo.');
  }

  options.onProgress?.(0.1, 'Validando geometría para exportación STL...');
  const validation = validateCandidatesForStlExport(candidates);
  if (validation.blockingErrors.length > 0) {
    throw new Error(validation.blockingErrors[0]);
  }

  const exportGroup = new THREE.Group();
  const createdMeshes: THREE.Mesh[] = [];

  for (let i = 0; i < validation.validMeshes.length; i++) {
    const obj = validation.validMeshes[i];
    const threeMesh = buildThreeMeshForExport(obj, {
      applyTransform,
      exportScale,
    });
    if (threeMesh) {
      exportGroup.add(threeMesh);
      createdMeshes.push(threeMesh);
    }
    if (i > 0 && i % 5 === 0) {
      options.onProgress?.(
        0.25 + (i / validation.validMeshes.length) * 0.4,
        `Triangulando "${obj.name}"...`,
      );
      await yieldToMainThread();
    }
  }

  exportGroup.updateMatrixWorld(true);
  options.onProgress?.(0.75, 'Generando archivo STL...');
  await yieldToMainThread();

  const exporter = new STLExporter();
  const raw = exporter.parse(exportGroup, { binary });

  for (const m of createdMeshes) {
    m.geometry.dispose();
    if (Array.isArray(m.material)) {
      m.material.forEach((mat) => mat.dispose());
    } else {
      m.material.dispose();
    }
  }

  let data: ArrayBuffer | string;
  if (typeof raw === 'string') {
    data = raw;
  } else if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    data = copy.buffer;
  } else {
    data = raw as ArrayBuffer;
  }

  options.onProgress?.(1, 'STL generado');

  return {
    data,
    binary,
    exportedCount: createdMeshes.length,
    totalTriangles: validation.totalTriangles,
    validation,
  };
}

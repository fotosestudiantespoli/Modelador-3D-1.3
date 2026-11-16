import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { SceneObjectData } from '../project/types';
import {
  buildThreeMeshForExport,
  ProgressCallback,
  yieldToMainThread,
} from './meshUtils';

export interface ExportCompatibilityReport {
  validMeshes: SceneObjectData[];
  skippedObjects: Array<{ id: string; name: string; reason: string }>;
}

export interface ObjExportResult {
  objText: string;
  exportedCount: number;
  skippedObjects: Array<{ id: string; name: string; reason: string }>;
}

export function analyzeExportTargets(
  candidates: SceneObjectData[],
): ExportCompatibilityReport {
  const validMeshes: SceneObjectData[] = [];
  const skippedObjects: Array<{ id: string; name: string; reason: string }> = [];

  for (const obj of candidates) {
    if (obj.objectType === 'reference_image') {
      skippedObjects.push({
        id: obj.id,
        name: obj.name,
        reason: 'Referencia de imagen (no es geometría 3D)',
      });
      continue;
    }
    if (obj.objectType !== 'mesh') {
      skippedObjects.push({
        id: obj.id,
        name: obj.name,
        reason: 'Tipo de objeto no compatible con exportación de malla',
      });
      continue;
    }
    if (!obj.mesh || obj.mesh.faces.length === 0 || obj.mesh.vertices.length < 3) {
      skippedObjects.push({
        id: obj.id,
        name: obj.name,
        reason: 'La malla no contiene caras válidas',
      });
      continue;
    }
    validMeshes.push(obj);
  }

  return { validMeshes, skippedObjects };
}

export async function exportObjectsToObj(
  candidates: SceneObjectData[],
  options: {
    applyTransform?: boolean;
    exportScale?: number;
    onProgress?: ProgressCallback;
  } = {},
): Promise<ObjExportResult> {
  const applyTransform = options.applyTransform ?? true;
  const exportScale = options.exportScale ?? 1;

  options.onProgress?.(0.1, 'Validando objetos para exportación OBJ...');
  const report = analyzeExportTargets(candidates);
  if (report.validMeshes.length === 0) {
    throw new Error(
      'No hay mallas 3D válidas para exportar (las referencias de imagen y objetos vacíos no se exportan como geometría).',
    );
  }

  const exportGroup = new THREE.Group();
  const createdMeshes: THREE.Mesh[] = [];

  for (let i = 0; i < report.validMeshes.length; i++) {
    const obj = report.validMeshes[i];
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
        0.2 + (i / report.validMeshes.length) * 0.4,
        `Preparando "${obj.name}"...`,
      );
      await yieldToMainThread();
    }
  }

  if (createdMeshes.length === 0) {
    throw new Error('Ninguno de los objetos seleccionados generó geometría exportable.');
  }

  exportGroup.updateMatrixWorld(true);
  options.onProgress?.(0.75, 'Generando archivo OBJ...');
  await yieldToMainThread();

  const exporter = new OBJExporter();
  const objBody = exporter.parse(exportGroup);

  for (const m of createdMeshes) {
    m.geometry.dispose();
    if (Array.isArray(m.material)) {
      m.material.forEach((mat) => mat.dispose());
    } else {
      m.material.dispose();
    }
  }

  const header = `# Exportado desde Modeler 3D\n# Objetos: ${createdMeshes.length}\n`;
  options.onProgress?.(1, 'OBJ generado');

  return {
    objText: `${header}${objBody}`,
    exportedCount: createdMeshes.length,
    skippedObjects: report.skippedObjects,
  };
}

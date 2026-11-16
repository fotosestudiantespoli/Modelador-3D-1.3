import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { EditableMesh } from '../mesh/EditableMesh';
import { MaterialSlot } from '../project/types';
import {
  buildEditableMeshFromBufferGeometry,
  MAX_IMPORT_TRIANGLES,
  ProgressCallback,
  stripFileExtension,
} from './meshUtils';

export interface StlInspectionResult {
  format: 'binary' | 'ascii';
  triangleCount: number;
}

export interface StlImportResult {
  name: string;
  mesh: EditableMesh;
  material: MaterialSlot;
  format: 'binary' | 'ascii';
  triangleCount: number;
  weldedVertices: number;
  warnings: string[];
}

export function inspectStlBuffer(buffer: ArrayBuffer): StlInspectionResult {
  if (buffer.byteLength < 15) {
    throw new Error('El archivo STL está vacío o dañado.');
  }

  const view = new DataView(buffer);
  if (buffer.byteLength >= 84) {
    const faceCount = view.getUint32(80, true);
    const expectedSize = 84 + faceCount * 50;
    if (expectedSize === buffer.byteLength) {
      return { format: 'binary', triangleCount: faceCount };
    }
  }

  // Check for ASCII "solid" near start (handling optional UTF-8 BOM)
  const headerBytes = new Uint8Array(
    buffer,
    0,
    Math.min(buffer.byteLength, 256),
  );
  const headerText = new TextDecoder('utf-8', { fatal: false }).decode(
    headerBytes,
  );
  const cleanedHeader = headerText.replace(/^\uFEFF/, '').trimStart();
  if (cleanedHeader.startsWith('solid')) {
    const fullText = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const matches = fullText.match(/\bfacet\s+normal\b/gi);
    return {
      format: 'ascii',
      triangleCount: matches ? matches.length : 0,
    };
  }

  // Fallback check if binary STL had trailing bytes
  if (buffer.byteLength >= 84) {
    const faceCount = view.getUint32(80, true);
    if (faceCount > 0 && 84 + faceCount * 50 <= buffer.byteLength) {
      return { format: 'binary', triangleCount: faceCount };
    }
  }

  throw new Error(
    'El archivo no corresponde a un formato STL ASCII ni binario válido.',
  );
}

export async function parseStlBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options: {
    scale?: number;
    onProgress?: ProgressCallback;
  } = {},
): Promise<StlImportResult> {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('La escala de importación debe ser un número positivo.');
  }

  options.onProgress?.(0.1, 'Validando archivo STL...');
  const inspection = inspectStlBuffer(buffer);
  if (inspection.triangleCount > MAX_IMPORT_TRIANGLES) {
    throw new Error(
      `El modelo STL contiene ${inspection.triangleCount.toLocaleString()} triángulos y supera el límite seguro (${MAX_IMPORT_TRIANGLES.toLocaleString()}).`,
    );
  }

  options.onProgress?.(0.25, 'Decodificando geometría STL...');
  const loader = new STLLoader();
  let geometry: THREE.BufferGeometry;
  try {
    geometry = loader.parse(buffer);
  } catch {
    throw new Error('No se pudo leer la geometría del archivo STL (posible archivo dañado).');
  }

  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    geometry.dispose();
    throw new Error('El archivo STL no contiene triángulos válidos.');
  }

  // Recompute normals if missing or degenerate
  const normAttr = geometry.getAttribute('normal');
  let needsNormalRecompute = !normAttr || normAttr.count !== posAttr.count;
  if (!needsNormalRecompute && normAttr) {
    for (let i = 0; i < Math.min(normAttr.count, 30); i++) {
      const len = Math.hypot(
        normAttr.getX(i),
        normAttr.getY(i),
        normAttr.getZ(i),
      );
      if (!Number.isFinite(len) || len < 1e-5) {
        needsNormalRecompute = true;
        break;
      }
    }
  }
  if (needsNormalRecompute) {
    geometry.computeVertexNormals();
  }

  const warnings: string[] = [];
  if (needsNormalRecompute) {
    warnings.push('Se recalcularon las normales de superficie durante la importación.');
  }

  const { mesh, weldedCount, skippedDegenerate } =
    await buildEditableMeshFromBufferGeometry(geometry, {
      scale,
      weldTolerance: 1e-5,
      onProgress: options.onProgress,
      progressStart: 0.35,
      progressSpan: 0.62,
    });

  geometry.dispose();

  if (skippedDegenerate > 0) {
    warnings.push(
      `Se omitieron ${skippedDegenerate} triángulos degenerados sin área.`,
    );
  }

  options.onProgress?.(1, 'STL importado correctamente');

  return {
    name: stripFileExtension(fileName),
    mesh,
    material: {
      color: '#9aa0a6',
      roughness: 0.55,
      metalness: 0.08,
    },
    format: inspection.format,
    triangleCount: mesh.faces.length,
    weldedVertices: weldedCount,
    warnings,
  };
}

import * as THREE from 'three';
import { EditableMesh, Vec2, Vec3 } from '../mesh/EditableMesh';
import { SceneObjectData } from '../project/types';

export const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024; // 64 MB safety cap
export const MAX_IMPORT_TRIANGLES = 350_000;

export type ProgressCallback = (progress: number, label: string) => void;

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function stripFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0) return fileName || 'Modelo';
  return fileName.slice(0, idx) || 'Modelo';
}

export function sanitizeObjIdentifier(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'Objeto';
}

/**
 * Welds a Three.js BufferGeometry (indexed or non-indexed triangle soup) into a
 * connected EditableMesh topology with vertices, deduplicated edges, faces,
 * optional UVs, and computed normals where missing.
 */
export async function buildEditableMeshFromBufferGeometry(
  geometry: THREE.BufferGeometry,
  options: {
    scale?: number;
    weldTolerance?: number;
    onProgress?: ProgressCallback;
    progressStart?: number;
    progressSpan?: number;
  } = {},
): Promise<{ mesh: EditableMesh; weldedCount: number; skippedDegenerate: number }> {
  const scale = options.scale ?? 1;
  const tol = options.weldTolerance ?? 1e-5;
  const invTol = 1 / tol;
  const pStart = options.progressStart ?? 0;
  const pSpan = options.progressSpan ?? 1;

  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    throw new Error('La geometría no contiene suficientes vértices válidos.');
  }

  const normAttr = geometry.getAttribute('normal');
  const uvAttr = geometry.getAttribute('uv');
  const indexAttr = geometry.getIndex();

  const triCount = indexAttr
    ? Math.floor(indexAttr.count / 3)
    : Math.floor(posAttr.count / 3);

  if (triCount <= 0) {
    throw new Error('El modelo no contiene caras triangulares válidas.');
  }
  if (triCount > MAX_IMPORT_TRIANGLES) {
    throw new Error(
      `El archivo contiene ${triCount.toLocaleString()} triángulos y supera el límite seguro de memoria (${MAX_IMPORT_TRIANGLES.toLocaleString()}).`,
    );
  }

  const mesh = new EditableMesh();
  const vertexWeldMap = new Map<string, string>();
  let weldedCount = 0;
  let skippedDegenerate = 0;

  const getOrCreateVertex = (rawIdx: number): string => {
    const x = posAttr.getX(rawIdx) * scale;
    const y = posAttr.getY(rawIdx) * scale;
    const z = posAttr.getZ(rawIdx) * scale;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('Se encontraron coordenadas numéricas inválidas (NaN/Infinity).');
    }

    const qx = Math.round(x * invTol);
    const qy = Math.round(y * invTol);
    const qz = Math.round(z * invTol);
    const key = `${qx}:${qy}:${qz}`;
    const existing = vertexWeldMap.get(key);
    if (existing) {
      weldedCount++;
      return existing;
    }

    const v = mesh.addVertex(x, y, z);
    if (uvAttr && rawIdx < uvAttr.count) {
      const u = uvAttr.getX(rawIdx);
      const vCoord = uvAttr.getY(rawIdx);
      if (Number.isFinite(u) && Number.isFinite(vCoord)) {
        v.uv = [u, vCoord];
      }
    }
    if (normAttr && rawIdx < normAttr.count) {
      const nx = normAttr.getX(rawIdx);
      const ny = normAttr.getY(rawIdx);
      const nz = normAttr.getZ(rawIdx);
      const nLen = Math.hypot(nx, ny, nz);
      if (Number.isFinite(nLen) && nLen > 1e-6) {
        v.normal = [nx / nLen, ny / nLen, nz / nLen];
      }
    }
    vertexWeldMap.set(key, v.id);
    return v.id;
  };

  const readCornerUv = (rawIdx: number): Vec2 | null => {
    if (!uvAttr || rawIdx >= uvAttr.count) return null;
    const u = uvAttr.getX(rawIdx);
    const v = uvAttr.getY(rawIdx);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    return [u, v];
  };

  const readCornerNormal = (rawIdx: number): Vec3 | null => {
    if (!normAttr || rawIdx >= normAttr.count) return null;
    const nx = normAttr.getX(rawIdx);
    const ny = normAttr.getY(rawIdx);
    const nz = normAttr.getZ(rawIdx);
    const len = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(len) || len < 1e-6) return null;
    return [nx / len, ny / len, nz / len];
  };

  const chunk = 4000;
  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

    const v0 = getOrCreateVertex(i0);
    const v1 = getOrCreateVertex(i1);
    const v2 = getOrCreateVertex(i2);

    if (v0 === v1 || v1 === v2 || v2 === v0) {
      skippedDegenerate++;
      continue;
    }

    // Check triangle area to ensure non-degenerate normal
    const p0 = mesh.getVertex(v0)!.position;
    const p1 = mesh.getVertex(v1)!.position;
    const p2 = mesh.getVertex(v2)!.position;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const areaLen = Math.hypot(cx, cy, cz);

    const face = mesh.addFace([v0, v1, v2]);
    if (!face) continue;

    const uv0 = readCornerUv(i0);
    const uv1 = readCornerUv(i1);
    const uv2 = readCornerUv(i2);
    if (uv0 && uv1 && uv2) {
      face.uvs = [uv0, uv1, uv2];
    }

    const n0 = readCornerNormal(i0);
    const n1 = readCornerNormal(i1);
    const n2 = readCornerNormal(i2);
    if (n0 && n1 && n2) {
      face.normals = [n0, n1, n2];
    } else if (areaLen > 1e-8) {
      const fn: Vec3 = [cx / areaLen, cy / areaLen, cz / areaLen];
      face.normals = [fn, fn, fn];
    }

    if (t > 0 && t % chunk === 0) {
      options.onProgress?.(
        pStart + (t / triCount) * pSpan,
        `Reconstruyendo topología (${Math.round((t / triCount) * 100)}%)...`,
      );
      await yieldToMainThread();
    }
  }

  if (mesh.faces.length === 0) {
    throw new Error('No se pudieron construir caras válidas a partir de la geometría.');
  }

  return { mesh, weldedCount, skippedDegenerate };
}

/**
 * Builds a Three.js Mesh from a SceneObjectData suitable for OBJExporter / STLExporter.
 */
export function buildThreeMeshForExport(
  obj: SceneObjectData,
  options: {
    applyTransform: boolean;
    exportScale?: number;
  },
): THREE.Mesh | null {
  if (obj.objectType !== 'mesh') return null;

  const editable = EditableMesh.fromJSON(obj.mesh);
  const triData = editable.buildTriangulatedData();
  if (triData.positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(triData.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(triData.normals, 3));
  if (triData.uvs) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(triData.uvs, 2));
  }

  const material = new THREE.MeshStandardMaterial({
    color: obj.material.color,
    roughness: obj.material.roughness,
    metalness: obj.material.metalness,
  });
  material.name = sanitizeObjIdentifier(`${obj.name}_mat`);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = sanitizeObjIdentifier(obj.name);

  const scaleFactor = options.exportScale ?? 1;
  if (options.applyTransform) {
    mesh.position.set(
      obj.transform.position[0] * scaleFactor,
      obj.transform.position[1] * scaleFactor,
      obj.transform.position[2] * scaleFactor,
    );
    mesh.rotation.set(...obj.transform.rotation);
    mesh.scale.set(
      obj.transform.scale[0] * scaleFactor,
      obj.transform.scale[1] * scaleFactor,
      obj.transform.scale[2] * scaleFactor,
    );
  } else {
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
  }

  mesh.updateMatrixWorld(true);
  return mesh;
}

export function triggerFileDownload(
  data: BlobPart,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1500);
}

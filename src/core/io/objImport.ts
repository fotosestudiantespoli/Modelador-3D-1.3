import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { EditableMesh, Vec2, Vec3 } from '../mesh/EditableMesh';
import { MaterialSlot } from '../project/types';
import {
  buildEditableMeshFromBufferGeometry,
  MAX_IMPORT_TRIANGLES,
  ProgressCallback,
  stripFileExtension,
  yieldToMainThread,
} from './meshUtils';

export interface ImportedMeshPart {
  name: string;
  mesh: EditableMesh;
  material: MaterialSlot;
  groupName?: string;
}

export interface ObjImportResult {
  baseName: string;
  parts: ImportedMeshPart[];
  warnings: string[];
  hadNormals: boolean;
  hadUvs: boolean;
  usedMtl: boolean;
}

interface RawGroup {
  name: string;
  materialName: string;
  faces: Array<{
    vIdx: number[];
    vtIdx: (number | null)[];
    vnIdx: (number | null)[];
  }>;
}

function resolveObjIndex(raw: number, length: number): number | null {
  if (!Number.isInteger(raw) || raw === 0) return null;
  const idx = raw > 0 ? raw - 1 : length + raw;
  return idx >= 0 && idx < length ? idx : null;
}

function extractMaterialSlotFromMtl(
  materialsMap: Map<string, THREE.Material>,
  matName: string,
): MaterialSlot {
  const mat = matName ? materialsMap.get(matName) : undefined;
  if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
    return {
      color: `#${mat.color.getHexString()}`,
      roughness: 0.55,
      metalness: 0.08,
    };
  }
  return {
    color: '#9aa0a6',
    roughness: 0.55,
    metalness: 0.08,
  };
}

export async function parseObjContent(
  objText: string,
  fileName: string,
  options: {
    mtlText?: string;
    scale?: number;
    onProgress?: ProgressCallback;
  } = {},
): Promise<ObjImportResult> {
  const scale = options.scale ?? 1;
  const baseName = stripFileExtension(fileName);
  const warnings: string[] = [];

  options.onProgress?.(0.08, 'Analizando archivo OBJ...');

  // Validate basic text sanity (detect binary/corrupted non-OBJ input)
  if (!objText || !objText.trim()) {
    throw new Error('El archivo OBJ está vacío.');
  }
  if (objText.includes('\u0000')) {
    throw new Error('El archivo no parece ser un OBJ de texto válido.');
  }

  // Optional MTL material parsing using Three.js MTLLoader
  const materialsMap = new Map<string, THREE.Material>();
  let usedMtl = false;
  let mtlCreator: ReturnType<MTLLoader['parse']> | null = null;
  if (options.mtlText && options.mtlText.trim()) {
    try {
      const mtlLoader = new MTLLoader();
      mtlCreator = mtlLoader.parse(options.mtlText, '');
      mtlCreator.preload();
      for (const [k, m] of Object.entries(mtlCreator.materials)) {
        materialsMap.set(k, m);
      }
      usedMtl = materialsMap.size > 0;
    } catch {
      warnings.push(
        'No se pudo interpretar el archivo MTL adjunto; se usará el material predeterminado.',
      );
    }
  }

  // Also pass through Three.js OBJLoader to resolve embedded groups/materials & validate structure
  try {
    const objLoader = new OBJLoader();
    if (mtlCreator) {
      objLoader.setMaterials(mtlCreator);
    }
    const threeGroup = objLoader.parse(objText);
    threeGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) {
          if (m && m.name && !materialsMap.has(m.name)) {
            materialsMap.set(m.name, m);
          }
        }
      }
    });
  } catch {
    // Continue with direct polygon parser; if that also yields 0 faces, we throw clearly.
  }

  const lines = objText.split(/\r?\n/);
  const globalVertices: Vec3[] = [];
  const globalUvs: Vec2[] = [];
  const globalNormals: Vec3[] = [];

  const groups: RawGroup[] = [];
  let currentGroup: RawGroup = {
    name: baseName,
    materialName: '',
    faces: [],
  };
  let activeMaterialName = '';
  let hadMtlLibRef = false;
  let totalFaceCount = 0;

  const commitCurrentGroupIfNonEmpty = () => {
    if (currentGroup.faces.length > 0) {
      groups.push(currentGroup);
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li].trim();
    if (!rawLine || rawLine.startsWith('#')) continue;

    // Handle line continuations "\" in OBJ
    let line = rawLine;
    while (line.endsWith('\\') && li + 1 < lines.length) {
      line = `${line.slice(0, -1)} ${lines[++li].trim()}`;
    }

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v' && parts.length >= 4) {
      const x = Number(parts[1]) * scale;
      const y = Number(parts[2]) * scale;
      const z = Number(parts[3]) * scale;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`Vértice OBJ inválido en la línea ${li + 1}.`);
      }
      globalVertices.push([x, y, z]);
    } else if (cmd === 'vt' && parts.length >= 3) {
      const u = Number(parts[1]);
      const v = Number(parts[2]);
      if (Number.isFinite(u) && Number.isFinite(v)) {
        globalUvs.push([u, v]);
      } else {
        globalUvs.push([0, 0]);
      }
    } else if (cmd === 'vn' && parts.length >= 4) {
      const nx = Number(parts[1]);
      const ny = Number(parts[2]);
      const nz = Number(parts[3]);
      const len = Math.hypot(nx, ny, nz);
      if (Number.isFinite(len) && len > 1e-8) {
        globalNormals.push([nx / len, ny / len, nz / len]);
      } else {
        globalNormals.push([0, 0, 1]);
      }
    } else if ((cmd === 'o' || cmd === 'g') && parts.length >= 1) {
      const nextName = parts.slice(1).join(' ').trim() || baseName;
      if (currentGroup.faces.length > 0) {
        commitCurrentGroupIfNonEmpty();
        currentGroup = {
          name: nextName,
          materialName: activeMaterialName,
          faces: [],
        };
      } else {
        currentGroup.name = nextName;
      }
    } else if (cmd === 'mtllib') {
      hadMtlLibRef = true;
    } else if (cmd === 'usemtl') {
      activeMaterialName = parts.slice(1).join(' ').trim();
      if (!currentGroup.materialName) {
        currentGroup.materialName = activeMaterialName;
      }
    } else if (cmd === 'f' && parts.length >= 4) {
      const vIdx: number[] = [];
      const vtIdx: (number | null)[] = [];
      const vnIdx: (number | null)[] = [];

      for (let pi = 1; pi < parts.length; pi++) {
        const token = parts[pi];
        if (!token) continue;
        const comps = token.split('/');
        const rawV = Number(comps[0]);
        const resolvedV = resolveObjIndex(rawV, globalVertices.length);
        if (resolvedV === null) continue;

        const rawVt = comps.length > 1 && comps[1] !== '' ? Number(comps[1]) : 0;
        const rawVn = comps.length > 2 && comps[2] !== '' ? Number(comps[2]) : 0;

        vIdx.push(resolvedV);
        vtIdx.push(rawVt !== 0 ? resolveObjIndex(rawVt, globalUvs.length) : null);
        vnIdx.push(
          rawVn !== 0 ? resolveObjIndex(rawVn, globalNormals.length) : null,
        );
      }

      if (vIdx.length >= 3) {
        totalFaceCount++;
        if (totalFaceCount > MAX_IMPORT_TRIANGLES) {
          throw new Error(
            `El modelo OBJ supera el límite seguro de ${MAX_IMPORT_TRIANGLES.toLocaleString()} caras.`,
          );
        }
        currentGroup.faces.push({ vIdx, vtIdx, vnIdx });
      }
    }

    if (li > 0 && li % 15000 === 0) {
      options.onProgress?.(
        0.1 + (li / lines.length) * 0.4,
        `Leyendo geometría OBJ (${Math.round((li / lines.length) * 100)}%)...`,
      );
      await yieldToMainThread();
    }
  }

  commitCurrentGroupIfNonEmpty();

  if (globalVertices.length === 0 || groups.length === 0) {
    // Final fallback via OBJLoader in case geometry used non-standard formatting
    const objLoader = new OBJLoader();
    const parsedGroup = objLoader.parse(objText);
    const fallbackParts: ImportedMeshPart[] = [];
    let partIdx = 0;

    parsedGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        partIdx++;
        const name = child.name?.trim() || `${baseName}_${partIdx}`;
        const matSlot: MaterialSlot = {
          color: '#9aa0a6',
          roughness: 0.55,
          metalness: 0.08,
        };
        fallbackParts.push({
          name,
          mesh: new EditableMesh(), // filled below
          material: matSlot,
          groupName: child.name || undefined,
        });
        // Store geometry temporarily on userData for async weld
        child.userData.__tmpGeo = child.geometry;
      }
    });

    if (fallbackParts.length === 0) {
      throw new Error('El archivo OBJ no contiene vértices ni caras importables.');
    }

    let idx = 0;
    for (const child of parsedGroup.children) {
      if (child instanceof THREE.Mesh && child.userData.__tmpGeo) {
        const res = await buildEditableMeshFromBufferGeometry(
          child.userData.__tmpGeo as THREE.BufferGeometry,
          { scale },
        );
        fallbackParts[idx].mesh = res.mesh;
        idx++;
      }
    }

    if (fallbackParts.length === 1) {
      fallbackParts[0].name = baseName;
    }

    return {
      baseName,
      parts: fallbackParts,
      warnings,
      hadNormals: globalNormals.length > 0,
      hadUvs: globalUvs.length > 0,
      usedMtl,
    };
  }

  if (hadMtlLibRef && !usedMtl) {
    warnings.push(
      'El archivo OBJ referencia un material (.mtl) externo; se aplicó el material predeterminado.',
    );
  }

  // Reconstruct EditableMesh per group while preserving original polygon connectivity (quads / n-gons / triangles)
  const importedParts: ImportedMeshPart[] = [];
  const usedNames = new Set<string>();

  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const editable = new EditableMesh();
    const localVertMap = new Map<number, string>();

    for (let fi = 0; fi < grp.faces.length; fi++) {
      const f = grp.faces[fi];
      const faceVertIds: string[] = [];
      const faceUvs: Vec2[] = [];
      const faceNormals: Vec3[] = [];
      let allHaveUvs = true;
      let allHaveNormals = true;

      for (let k = 0; k < f.vIdx.length; k++) {
        const gIdx = f.vIdx[k];
        let localVid = localVertMap.get(gIdx);
        if (!localVid) {
          const p = globalVertices[gIdx];
          const v = editable.addVertex(p[0], p[1], p[2]);
          const vt = f.vtIdx[k];
          if (vt !== null && globalUvs[vt]) {
            v.uv = [...globalUvs[vt]] as Vec2;
          }
          const vn = f.vnIdx[k];
          if (vn !== null && globalNormals[vn]) {
            v.normal = [...globalNormals[vn]] as Vec3;
          }
          localVertMap.set(gIdx, v.id);
          localVid = v.id;
        }
        faceVertIds.push(localVid);

        const vt = f.vtIdx[k];
        if (vt !== null && globalUvs[vt]) {
          faceUvs.push([...globalUvs[vt]] as Vec2);
        } else {
          allHaveUvs = false;
        }

        const vn = f.vnIdx[k];
        if (vn !== null && globalNormals[vn]) {
          faceNormals.push([...globalNormals[vn]] as Vec3);
        } else {
          allHaveNormals = false;
        }
      }

      // Deduplicate consecutive identical vertices inside degenerate face
      const cleanIds: string[] = [];
      const cleanUvs: Vec2[] = [];
      const cleanNormals: Vec3[] = [];
      for (let k = 0; k < faceVertIds.length; k++) {
        const id = faceVertIds[k];
        if (cleanIds.length === 0 || cleanIds[cleanIds.length - 1] !== id) {
          cleanIds.push(id);
          if (allHaveUvs) cleanUvs.push(faceUvs[k]);
          if (allHaveNormals) cleanNormals.push(faceNormals[k]);
        }
      }
      if (cleanIds.length >= 3 && cleanIds[0] === cleanIds[cleanIds.length - 1]) {
        cleanIds.pop();
        if (allHaveUvs) cleanUvs.pop();
        if (allHaveNormals) cleanNormals.pop();
      }

      if (cleanIds.length >= 3) {
        const addedFace = editable.addFace(cleanIds);
        if (addedFace) {
          if (allHaveUvs && cleanUvs.length === cleanIds.length) {
            addedFace.uvs = cleanUvs;
          }
          if (allHaveNormals && cleanNormals.length === cleanIds.length) {
            addedFace.normals = cleanNormals;
          }
        }
      }

      if (fi > 0 && fi % 5000 === 0) {
        options.onProgress?.(
          0.55 + ((gi + fi / grp.faces.length) / groups.length) * 0.4,
          `Construyendo malla "${grp.name}"...`,
        );
        await yieldToMainThread();
      }
    }

    if (editable.faces.length === 0) continue;

    // Name logic: single part uses filename, multi-part keeps group names uniquely
    let candidateName =
      groups.length === 1 ? baseName : grp.name || `${baseName}_${gi + 1}`;
    if (usedNames.has(candidateName)) {
      let suffix = 2;
      while (usedNames.has(`${candidateName}.${suffix}`)) suffix++;
      candidateName = `${candidateName}.${suffix}`;
    }
    usedNames.add(candidateName);

    importedParts.push({
      name: candidateName,
      mesh: editable,
      material: extractMaterialSlotFromMtl(materialsMap, grp.materialName),
      groupName: grp.name,
    });
  }

  if (importedParts.length === 0) {
    throw new Error('No se encontraron caras válidas en el archivo OBJ.');
  }

  options.onProgress?.(1, 'OBJ importado correctamente');

  return {
    baseName,
    parts: importedParts,
    warnings,
    hadNormals: globalNormals.length > 0,
    hadUvs: globalUvs.length > 0,
    usedMtl,
  };
}

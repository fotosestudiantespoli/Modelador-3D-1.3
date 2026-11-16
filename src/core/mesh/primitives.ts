import { EditableMesh, Vec3 } from './EditableMesh';
import { extrudeMesh, insetFacesMesh, subdivideMesh } from './advancedOperations';

export type PrimitiveType =
  | 'plane'
  | 'cube'
  | 'circle'
  | 'uv_sphere'
  | 'cylinder'
  | 'pyramid'
  | 'suzanne';

export interface PrimitiveOptions {
  size?: number;
  radius?: number;
  height?: number;
  segments?: number;
  rings?: number;
}

export const PRIMITIVE_LABELS: Record<PrimitiveType, string> = {
  plane: 'Plano',
  cube: 'Cubo',
  circle: 'Círculo',
  uv_sphere: 'Esfera UV',
  cylinder: 'Cilindro',
  pyramid: 'Pirámide',
  suzanne: 'Suzanne',
};

/**
 * Plano: 4 vértices, 4 aristas y 1 cara quad sobre XY (Z = 0), normal hacia +Z.
 */
export function createPlaneMesh(size = 2): EditableMesh {
  const mesh = new EditableMesh();
  const h = size / 2;

  const v0 = mesh.addVertex(-h, -h, 0).id;
  const v1 = mesh.addVertex(h, -h, 0).id;
  const v2 = mesh.addVertex(h, h, 0).id;
  const v3 = mesh.addVertex(-h, h, 0).id;

  mesh.addFace([v0, v1, v2, v3]);
  return mesh;
}

/**
 * Cubo: 8 vértices, 12 aristas y 6 caras (quads).
 */
export function createCubeMesh(size = 2): EditableMesh {
  const mesh = new EditableMesh();
  const h = size / 2;

  const v0 = mesh.addVertex(-h, -h, h).id;  // 0: front-bottom-left
  const v1 = mesh.addVertex(h, -h, h).id;   // 1: front-bottom-right
  const v2 = mesh.addVertex(h, h, h).id;    // 2: front-top-right
  const v3 = mesh.addVertex(-h, h, h).id;   // 3: front-top-left
  const v4 = mesh.addVertex(-h, -h, -h).id; // 4: back-bottom-left
  const v5 = mesh.addVertex(h, -h, -h).id;  // 5: back-bottom-right
  const v6 = mesh.addVertex(h, h, -h).id;   // 6: back-top-right
  const v7 = mesh.addVertex(-h, h, -h).id;  // 7: back-top-left

  // Outward CCW winding
  mesh.addFace([v0, v1, v2, v3]); // Top (+Z)
  mesh.addFace([v5, v4, v7, v6]); // Bottom (-Z)
  mesh.addFace([v3, v2, v6, v7]); // Back (+Y)
  mesh.addFace([v4, v5, v1, v0]); // Front (-Y)
  mesh.addFace([v1, v5, v6, v2]); // Right (+X)
  mesh.addFace([v4, v0, v3, v7]); // Left (-X)

  return mesh;
}

/**
 * Círculo: 32 vértices sobre el plano horizontal XY (Z = 0), conectados mediante 32 aristas.
 */
export function createCircleMesh(radius = 1, segments = 32): EditableMesh {
  const mesh = new EditableMesh();
  const count = Math.max(3, Math.min(128, Math.round(segments)));
  const vertIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    vertIds.push(mesh.addVertex(x, y, 0).id);
  }

  for (let i = 0; i < count; i++) {
    mesh.addEdge(vertIds[i], vertIds[(i + 1) % count]);
  }

  return mesh;
}

/**
 * Esfera UV: eje polar vertical en Z, anillos paralelos al plano XY.
 */
export function createUVSphereMesh(
  radius = 1,
  segments = 16,
  rings = 12,
): EditableMesh {
  const mesh = new EditableMesh();
  const segs = Math.max(3, Math.min(64, Math.round(segments)));
  const rngs = Math.max(3, Math.min(48, Math.round(rings)));

  const topPole = mesh.addVertex(0, 0, radius).id;
  const ringVerts: string[][] = [];

  for (let r = 1; r < rngs; r++) {
    const phi = (r / rngs) * Math.PI;
    const z = Math.cos(phi) * radius;
    const ringRadius = Math.sin(phi) * radius;
    const row: string[] = [];
    for (let s = 0; s < segs; s++) {
      const theta = (s / segs) * Math.PI * 2;
      const x = Math.cos(theta) * ringRadius;
      const y = Math.sin(theta) * ringRadius;
      row.push(mesh.addVertex(x, y, z).id);
    }
    ringVerts.push(row);
  }

  const bottomPole = mesh.addVertex(0, 0, -radius).id;

  // Top cap triangles (CCW outward)
  const firstRing = ringVerts[0];
  for (let s = 0; s < segs; s++) {
    const nextS = (s + 1) % segs;
    mesh.addFace([topPole, firstRing[s], firstRing[nextS]]);
  }

  // Middle quad rings
  for (let r = 0; r < ringVerts.length - 1; r++) {
    const upper = ringVerts[r];
    const lower = ringVerts[r + 1];
    for (let s = 0; s < segs; s++) {
      const nextS = (s + 1) % segs;
      mesh.addFace([upper[s], lower[s], lower[nextS], upper[nextS]]);
    }
  }

  // Bottom cap triangles
  const lastRing = ringVerts[ringVerts.length - 1];
  for (let s = 0; s < segs; s++) {
    const nextS = (s + 1) % segs;
    mesh.addFace([bottomPole, lastRing[nextS], lastRing[s]]);
  }

  return mesh;
}

/**
 * Cilindro: eje de altura vertical en Z, tapas circulares paralelas al plano XY.
 */
export function createCylinderMesh(
  radius = 1,
  height = 2,
  segments = 16,
): EditableMesh {
  const mesh = new EditableMesh();
  const segs = Math.max(3, Math.min(64, Math.round(segments)));
  const halfH = height / 2;

  const topRing: string[] = [];
  const bottomRing: string[] = [];

  for (let s = 0; s < segs; s++) {
    const theta = (s / segs) * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const y = Math.sin(theta) * radius;
    topRing.push(mesh.addVertex(x, y, halfH).id);
  }

  for (let s = 0; s < segs; s++) {
    const theta = (s / segs) * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const y = Math.sin(theta) * radius;
    bottomRing.push(mesh.addVertex(x, y, -halfH).id);
  }

  // Side quads
  for (let s = 0; s < segs; s++) {
    const nextS = (s + 1) % segs;
    mesh.addFace([topRing[s], bottomRing[s], bottomRing[nextS], topRing[nextS]]);
  }

  // Top cap (+Z normal)
  mesh.addFace([...topRing]);

  // Bottom cap (-Z normal)
  mesh.addFace([...bottomRing].reverse());

  return mesh;
}

/**
 * Pirámide de base cuadrada: base paralela al plano XY y vértice superior en +Z.
 */
export function createPyramidMesh(baseSize = 2, height = 2): EditableMesh {
  const mesh = new EditableMesh();
  const hBase = baseSize / 2;
  const hHeight = height / 2;

  const v0 = mesh.addVertex(-hBase, -hBase, -hHeight).id; // front-left
  const v1 = mesh.addVertex(hBase, -hBase, -hHeight).id;  // front-right
  const v2 = mesh.addVertex(hBase, hBase, -hHeight).id;   // back-right
  const v3 = mesh.addVertex(-hBase, hBase, -hHeight).id;  // back-left
  const apex = mesh.addVertex(0, 0, hHeight).id;

  // Base face (CCW looking from -Z)
  mesh.addFace([v0, v3, v2, v1]);

  // 4 triangular side faces
  mesh.addFace([v0, v1, apex]); // Front (-Y)
  mesh.addFace([v1, v2, apex]); // Right (+X)
  mesh.addFace([v2, v3, apex]); // Back (+Y)
  mesh.addFace([v3, v0, apex]); // Left (-X)

  return mesh;
}

/**
 * Cabeza estilizada tipo Suzanne: malla poligonal simétrica (eje Z arriba, frente -Y)
 * con cráneo, arco superciliar, cuencas oculares con ojos, hocico y orejas laterales.
 */
export function createSuzanneMesh(scale = 1): EditableMesh {
  // Base 4x4 subdivided cube (96 quads, 98 vertices, 100% manifold & symmetric)
  const baseCube = createCubeMesh(2);
  const allFaces = new Set(baseCube.faces.map((f) => f.id));
  let mesh = subdivideMesh(baseCube, 'face', allFaces, {
    cuts: 3,
    smoothness: 0.72,
    fractal: 0,
  }).mesh;

  // Spherify and proportion cranium (Z-up, front = -Y)
  for (const v of mesh.vertices) {
    const [x, y, z] = v.position;
    const len = Math.hypot(x, y, z) || 1;
    let sx = (x / len) * 0.74;
    let sy = (y / len) * 0.74;
    let sz = (z / len) * 0.7;

    // Slight cranial taper at top and fuller cheekbones
    if (sz > 0.2) {
      const t = (sz - 0.2) / 0.5;
      sx *= 1 - t * 0.14;
      sy += t * 0.04;
    }
    if (sz < -0.25) {
      const t = Math.min(1, (-0.25 - sz) / 0.45);
      sx *= 1 - t * 0.16;
    }
    // Slight brow shelf forward on front upper hemisphere
    if (sy < -0.35 && sz > 0.02 && sz < 0.42) {
      sy -= 0.08 * (1 - Math.abs(sx) * 0.75);
    }

    v.position = [sx, sy, sz];
  }

  // Helper to collect faces whose centroid satisfies predicate
  const findFaces = (pred: (c: Vec3, n: Vec3) => boolean): Set<string> => {
    const out = new Set<string>();
    for (const f of mesh.faces) {
      const c = mesh.computeFaceCenter(f);
      const n = mesh.computeFaceNormal(f);
      if (pred(c, n)) out.add(f.id);
    }
    return out;
  };

  // 1. Extrude Snout / Muzzle (front-lower central 4 faces: X in [-0.45, 0.45], Y < -0.45, Z in [-0.42, 0.02])
  const muzzleFaces = findFaces(
    (c, n) =>
      n[1] < -0.45 &&
      Math.abs(c[0]) < 0.34 &&
      c[1] < -0.35 &&
      c[2] < 0.02 &&
      c[2] > -0.46,
  );
  if (muzzleFaces.size > 0) {
    // 'y' axis extrudes along +Y, front is -Y so use negative distance
    const extFront = extrudeMesh(mesh, 'face', muzzleFaces, {
      distance: -0.22,
      axis: 'y',
      individual: false,
    });
    mesh = extFront.mesh;
    const capVerts = mesh.getVertexIdsFromSelection('face', extFront.nextSelectedIds);
    // Broaden muzzle slightly & round front
    for (const vid of capVerts) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      v.position[0] *= 1.32;
      if (v.position[2] < -0.18) {
        v.position[2] -= 0.05;
        v.position[1] += 0.04;
      } else {
        v.position[2] -= 0.02;
      }
      if (Math.abs(v.position[0]) < 0.06) {
        v.position[1] -= 0.06;
      }
    }

    // Second snout step for rounded nose/mouth tip
    const extTip = extrudeMesh(mesh, 'face', extFront.nextSelectedIds, {
      distance: -0.14,
      axis: 'y',
      individual: false,
    });
    mesh = extTip.mesh;
    const tipVerts = mesh.getVertexIdsFromSelection('face', extTip.nextSelectedIds);
    for (const vid of tipVerts) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      v.position[0] *= 0.84;
      if (v.position[2] > -0.12) {
        // Nose bridge slope
        v.position[1] += 0.04;
        v.position[2] -= 0.03;
      } else if (v.position[2] < -0.32) {
        // Lower chin tuck
        v.position[1] += 0.06;
        v.position[2] += 0.03;
      }
      if (Math.abs(v.position[0]) < 0.05 && v.position[2] > -0.26) {
        v.position[1] -= 0.03;
      }
    }
  }

  // 2. Eye Sockets + Eyeballs (front-upper symmetric faces left & right of center)
  const eyeSocketFaces = findFaces(
    (c, n) =>
      n[1] < -0.55 &&
      Math.abs(c[0]) > 0.06 &&
      Math.abs(c[0]) < 0.28 &&
      c[1] < -0.55 &&
      c[2] > 0.04 &&
      c[2] < 0.27,
  );
  if (eyeSocketFaces.size > 0) {
    // Inset for crisp brow/cheek socket rim
    const ins = insetFacesMesh(mesh, 'face', eyeSocketFaces, {
      thickness: 0.22,
      depth: -0.06,
      individual: true,
    });
    mesh = ins.mesh;

    // Extrude subtle convex eyeball domes inside sockets
    const eyeBulge = extrudeMesh(mesh, 'face', ins.nextSelectedIds, {
      distance: -0.09,
      axis: 'y',
      individual: true,
    });
    mesh = eyeBulge.mesh;
    const eyeVerts = mesh.getVertexIdsFromSelection('face', eyeBulge.nextSelectedIds);
    for (const vid of eyeVerts) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      // Taper eyeball front slightly inward toward center of each eye
      const sign = v.position[0] >= 0 ? 1 : -1;
      v.position[0] = v.position[0] * 0.92 + sign * 0.015;
    }
  }

  // 3. Large Stylized Monkey Ears (+X and -X sides — clean 2x2 quad patches)
  const rightEarFaces = findFaces(
    (c, n) =>
      n[0] > 0.85 &&
      c[0] > 0.62 &&
      Math.abs(c[1]) < 0.26 &&
      Math.abs(c[2]) < 0.26,
  );
  const leftEarFaces = findFaces(
    (c, n) =>
      n[0] < -0.85 &&
      c[0] < -0.62 &&
      Math.abs(c[1]) < 0.26 &&
      Math.abs(c[2]) < 0.26,
  );

  const buildEar = (earFaces: Set<string>, signX: 1 | -1) => {
    if (earFaces.size === 0) return;
    // Ear root inset
    const root = insetFacesMesh(mesh, 'face', earFaces, {
      thickness: 0.14,
      depth: 0,
      individual: false,
    });
    mesh = root.mesh;

    // Stem extrude outward in X
    const stem = extrudeMesh(mesh, 'face', root.nextSelectedIds, {
      distance: 0.18 * signX,
      axis: 'x',
      individual: false,
    });
    mesh = stem.mesh;
    for (const vid of mesh.getVertexIdsFromSelection('face', stem.nextSelectedIds)) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      v.position[1] += 0.08;
      v.position[2] += 0.03;
    }

    // Flared outer ear rim extrude
    const flare = extrudeMesh(mesh, 'face', stem.nextSelectedIds, {
      distance: 0.2 * signX,
      axis: 'x',
      individual: false,
    });
    mesh = flare.mesh;
    const flareVerts = mesh.getVertexIdsFromSelection('face', flare.nextSelectedIds);
    const flareCenter = mesh.computeCentroid(flareVerts) ?? [signX, 0.1, 0.05];
    for (const vid of flareVerts) {
      const v = mesh.getVertex(vid);
      if (!v) continue;
      v.position[1] = flareCenter[1] + (v.position[1] - flareCenter[1]) * 1.48 + 0.08;
      v.position[2] = flareCenter[2] + (v.position[2] - flareCenter[2]) * 1.55 + 0.05;
      // Cup forward slightly on front edge
      if (v.position[1] < flareCenter[1]) {
        v.position[0] -= signX * 0.05;
      }
    }

    // Inner ear bowl indent on outer ear faces
    const innerEar = insetFacesMesh(mesh, 'face', flare.nextSelectedIds, {
      thickness: 0.32,
      depth: -0.07,
      individual: false,
    });
    mesh = innerEar.mesh;
  };

  buildEar(rightEarFaces, 1);
  buildEar(leftEarFaces, -1);

  // Center at origin [0, 0, 0] and apply uniform scale
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of mesh.vertices) {
    minX = Math.min(minX, v.position[0]);
    maxX = Math.max(maxX, v.position[0]);
    minY = Math.min(minY, v.position[1]);
    maxY = Math.max(maxY, v.position[1]);
    minZ = Math.min(minZ, v.position[2]);
    maxZ = Math.max(maxZ, v.position[2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  for (const v of mesh.vertices) {
    v.position = [
      (v.position[0] - cx) * scale,
      (v.position[1] - cy) * scale,
      (v.position[2] - cz) * scale,
    ];
  }

  mesh.clearCustomNormals();
  mesh.rebuildIndices();
  return mesh;
}

export function createPrimitiveMesh(
  type: PrimitiveType,
  options: PrimitiveOptions = {},
): EditableMesh {
  switch (type) {
    case 'plane':
      return createPlaneMesh(options.size ?? 2);
    case 'cube':
      return createCubeMesh(options.size ?? 2);
    case 'circle':
      return createCircleMesh(options.radius ?? 1, options.segments ?? 32);
    case 'uv_sphere':
      return createUVSphereMesh(
        options.radius ?? 1,
        options.segments ?? 16,
        options.rings ?? 12,
      );
    case 'cylinder':
      return createCylinderMesh(
        options.radius ?? 1,
        options.height ?? 2,
        options.segments ?? 16,
      );
    case 'pyramid':
      return createPyramidMesh(options.size ?? 2, options.height ?? 2);
    case 'suzanne':
      return createSuzanneMesh(options.size ?? 1);
  }
}

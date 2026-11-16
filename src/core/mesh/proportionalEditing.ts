import * as THREE from 'three';
import { EditableMesh, Vec3 } from './EditableMesh';
import { EditSelectionMode } from './operations';
import { ModifierSlot } from '../modifiers/types';

export type ProportionalFalloff =
  | 'smooth'
  | 'sphere'
  | 'root'
  | 'sharp'
  | 'linear'
  | 'constant';

export interface ProportionalEditingSettings {
  enabled: boolean;
  radius: number;
  falloff: ProportionalFalloff;
  connectedOnly: boolean;
}

export const DEFAULT_PROPORTIONAL_EDITING_SETTINGS: ProportionalEditingSettings = {
  enabled: false,
  radius: 1.5,
  falloff: 'smooth',
  connectedOnly: false,
};

export interface ProportionalFalloffDefinition {
  id: ProportionalFalloff;
  label: string;
  shortLabel: string;
  description: string;
}

export const PROPORTIONAL_FALLOFF_LIST: ProportionalFalloffDefinition[] = [
  {
    id: 'smooth',
    label: 'Smooth (Suave)',
    shortLabel: 'Suave',
    description: 'Curva suave tipo campana (3t² - 2t³)',
  },
  {
    id: 'sphere',
    label: 'Sphere (Esfera)',
    shortLabel: 'Esfera',
    description: 'Caída circular convexa tipo cúpula',
  },
  {
    id: 'root',
    label: 'Root (Raíz)',
    shortLabel: 'Raíz',
    description: 'Transición amplia que decae rápido al borde',
  },
  {
    id: 'sharp',
    label: 'Sharp (Agudo)',
    shortLabel: 'Agudo',
    description: 'Pico pronunciado cerca de la selección',
  },
  {
    id: 'linear',
    label: 'Linear (Lineal)',
    shortLabel: 'Lineal',
    description: 'Decaimiento proporcional uniforme',
  },
  {
    id: 'constant',
    label: 'Constant (Constante)',
    shortLabel: 'Const.',
    description: 'Influencia al 100 % dentro del radio',
  },
];

export const PROPORTIONAL_FALLOFF_ORDER: ProportionalFalloff[] =
  PROPORTIONAL_FALLOFF_LIST.map((f) => f.id);

export function clampProportionalRadius(radius: number): number {
  if (!Number.isFinite(radius)) {
    return DEFAULT_PROPORTIONAL_EDITING_SETTINGS.radius;
  }
  return Math.max(0.05, Math.min(200, Math.round(radius * 1000) / 1000));
}

export function normalizeProportionalSettings(
  raw?: Partial<ProportionalEditingSettings> | null,
): ProportionalEditingSettings {
  const base = DEFAULT_PROPORTIONAL_EDITING_SETTINGS;
  if (!raw) return { ...base };
  const validFalloff = PROPORTIONAL_FALLOFF_ORDER.includes(
    raw.falloff as ProportionalFalloff,
  )
    ? (raw.falloff as ProportionalFalloff)
    : base.falloff;
  return {
    enabled: Boolean(raw.enabled),
    radius:
      typeof raw.radius === 'number'
        ? clampProportionalRadius(raw.radius)
        : base.radius,
    falloff: validFalloff,
    connectedOnly: Boolean(raw.connectedOnly),
  };
}

/**
 * Evaluates Blender-compatible proportional editing falloff in [0, 1].
 * - Seed vertices (distance <= 1e-8) always receive weight 1.
 * - Vertices at or outside radius (distance >= radius) receive weight 0.
 */
export function evaluateProportionalFalloff(
  distance: number,
  radius: number,
  falloff: ProportionalFalloff,
): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= 1e-8) return 1;
  if (!Number.isFinite(radius) || radius <= 1e-8) return 0;
  if (distance >= radius) return 0;

  const t = Math.max(0, Math.min(1, 1 - distance / radius));
  switch (falloff) {
    case 'smooth':
      return t * t * (3 - 2 * t);
    case 'sphere':
      return Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    case 'root':
      return Math.sqrt(t);
    case 'sharp':
      return t * t;
    case 'linear':
      return t;
    case 'constant':
      return 1;
  }
}

export interface ProportionalDistanceField {
  seedVertexIds: Set<string>;
  connectedOnly: boolean;
  /**
   * Shortest distance (Euclidean or topological edge-length Dijkstra) from
   * each reachable vertex to the seed vertex set.
   * Unreachable disconnected components are omitted when connectedOnly=true.
   */
  distances: Map<string, number>;
}

interface HeapItem {
  idx: number;
  dist: number;
}

class MinDistHeap {
  private data: HeapItem[] = [];

  public get size(): number {
    return this.data.length;
  }

  public push(idx: number, dist: number): void {
    this.data.push({ idx, dist });
    this.bubbleUp(this.data.length - 1);
  }

  public pop(): HeapItem | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    const item = this.data[i];
    while (i > 0) {
      const parentIdx = (i - 1) >> 1;
      const parent = this.data[parentIdx];
      if (item.dist >= parent.dist) break;
      this.data[i] = parent;
      i = parentIdx;
    }
    this.data[i] = item;
  }

  private sinkDown(i: number): void {
    const len = this.data.length;
    const item = this.data[i];
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      if (left < len && this.data[left].dist < this.data[smallest].dist) {
        smallest = left;
      }
      if (right < len && this.data[right].dist < this.data[smallest].dist) {
        smallest = right;
      }
      if (smallest === i) break;
      this.data[i] = this.data[smallest];
      i = smallest;
    }
    this.data[i] = item;
  }
}

function sanitizeScale(scale?: Vec3): [number, number, number] {
  if (!scale) return [1, 1, 1];
  return [
    Math.abs(scale[0]) > 1e-6 ? Math.abs(scale[0]) : 1,
    Math.abs(scale[1]) > 1e-6 ? Math.abs(scale[1]) : 1,
    Math.abs(scale[2]) > 1e-6 ? Math.abs(scale[2]) : 1,
  ];
}

/**
 * Precomputes geodesic/topological (Connected Only) or Euclidean vertex distances
 * from the active selection. Designed to be cached once per selection/drag start
 * so radius & falloff adjustments during interaction stay O(V) with zero graph traversal.
 */
export function buildProportionalDistanceField(
  mesh: EditableMesh,
  selectionMode: EditSelectionMode,
  selectedIds: Set<string>,
  options: {
    connectedOnly: boolean;
    objectScale?: Vec3;
  },
): ProportionalDistanceField {
  const seedVertexIds = mesh.getVertexIdsFromSelection(
    selectionMode,
    selectedIds,
  );
  const distances = new Map<string, number>();

  if (seedVertexIds.size === 0 || mesh.vertices.length === 0) {
    return {
      seedVertexIds,
      connectedOnly: options.connectedOnly,
      distances,
    };
  }

  const [sx, sy, sz] = sanitizeScale(options.objectScale);

  if (!options.connectedOnly) {
    const seedCoords: number[] = [];
    for (const sid of seedVertexIds) {
      const sv = mesh.getVertex(sid);
      if (!sv) continue;
      seedCoords.push(sv.position[0] * sx, sv.position[1] * sy, sv.position[2] * sz);
      distances.set(sid, 0);
    }

    const seedFloatCount = seedCoords.length;
    if (seedFloatCount === 0) {
      return {
        seedVertexIds,
        connectedOnly: false,
        distances,
      };
    }

    for (const v of mesh.vertices) {
      if (seedVertexIds.has(v.id)) continue;
      const vx = v.position[0] * sx;
      const vy = v.position[1] * sy;
      const vz = v.position[2] * sz;
      let minDistSq = Infinity;
      for (let i = 0; i < seedFloatCount; i += 3) {
        const dx = vx - seedCoords[i];
        const dy = vy - seedCoords[i + 1];
        const dz = vz - seedCoords[i + 2];
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
        }
      }
      distances.set(v.id, Math.sqrt(minDistSq));
    }

    return {
      seedVertexIds,
      connectedOnly: false,
      distances,
    };
  }

  // Connected Only: multi-source Dijkstra over topological edges weighted by scaled length
  const n = mesh.vertices.length;
  const idToIdx = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    idToIdx.set(mesh.vertices[i].id, i);
  }

  const adj: Array<Array<{ to: number; len: number }>> = Array.from(
    { length: n },
    () => [],
  );

  for (const edge of mesh.edges) {
    const i0 = idToIdx.get(edge.v0);
    const i1 = idToIdx.get(edge.v1);
    if (i0 === undefined || i1 === undefined || i0 === i1) continue;
    const p0 = mesh.vertices[i0].position;
    const p1 = mesh.vertices[i1].position;
    const dx = (p1[0] - p0[0]) * sx;
    const dy = (p1[1] - p0[1]) * sy;
    const dz = (p1[2] - p0[2]) * sz;
    const len = Math.hypot(dx, dy, dz);
    adj[i0].push({ to: i1, len });
    adj[i1].push({ to: i0, len });
  }

  const distArr = new Float64Array(n);
  distArr.fill(Infinity);
  const visited = new Uint8Array(n);
  const heap = new MinDistHeap();

  for (const sid of seedVertexIds) {
    const idx = idToIdx.get(sid);
    if (idx === undefined) continue;
    distArr[idx] = 0;
    heap.push(idx, 0);
  }

  while (heap.size > 0) {
    const curr = heap.pop()!;
    if (visited[curr.idx]) continue;
    visited[curr.idx] = 1;
    const neighbors = adj[curr.idx];
    for (let k = 0; k < neighbors.length; k++) {
      const nb = neighbors[k];
      if (visited[nb.to]) continue;
      const nextDist = curr.dist + nb.len;
      if (nextDist < distArr[nb.to]) {
        distArr[nb.to] = nextDist;
        heap.push(nb.to, nextDist);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const d = distArr[i];
    if (Number.isFinite(d)) {
      distances.set(mesh.vertices[i].id, d);
    }
  }

  return {
    seedVertexIds,
    connectedOnly: true,
    distances,
  };
}

/**
 * Computes per-vertex proportional weights (> 0 only) from a precomputed distance field.
 */
export function computeProportionalWeights(
  field: ProportionalDistanceField,
  radius: number,
  falloff: ProportionalFalloff,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (field.seedVertexIds.size === 0) return weights;

  for (const [vid, dist] of field.distances.entries()) {
    const w = field.seedVertexIds.has(vid)
      ? 1
      : evaluateProportionalFalloff(dist, radius, falloff);
    if (w > 1e-6) {
      weights.set(vid, w);
    }
  }
  return weights;
}

const _tmpV = new THREE.Vector3();
const _tmpPivot = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _identQuat = new THREE.Quaternion();

/**
 * Applies weighted translation in local mesh space.
 */
export function applyProportionalMove(
  mesh: EditableMesh,
  weights: ReadonlyMap<string, number>,
  delta: Vec3,
): void {
  for (const [vid, w] of weights.entries()) {
    const v = mesh.getVertex(vid);
    if (!v) continue;
    v.position[0] += delta[0] * w;
    v.position[1] += delta[1] * w;
    v.position[2] += delta[2] * w;
  }
}

/**
 * Applies weighted spherical-interpolated rotation around a local pivot.
 */
export function applyProportionalRotate(
  mesh: EditableMesh,
  weights: ReadonlyMap<string, number>,
  rotationQuat: THREE.Quaternion,
  pivotLocal: Vec3,
): void {
  _tmpPivot.set(pivotLocal[0], pivotLocal[1], pivotLocal[2]);
  for (const [vid, w] of weights.entries()) {
    const v = mesh.getVertex(vid);
    if (!v) continue;
    if (w >= 1 - 1e-6) {
      _tmpQuat.copy(rotationQuat);
    } else {
      _tmpQuat.slerpQuaternions(_identQuat, rotationQuat, w);
    }
    _tmpV.set(v.position[0], v.position[1], v.position[2]);
    _tmpV.sub(_tmpPivot);
    _tmpV.applyQuaternion(_tmpQuat);
    _tmpV.add(_tmpPivot);
    v.position[0] = _tmpV.x;
    v.position[1] = _tmpV.y;
    v.position[2] = _tmpV.z;
  }
}

/**
 * Applies weighted scale around a local pivot.
 */
export function applyProportionalScale(
  mesh: EditableMesh,
  weights: ReadonlyMap<string, number>,
  scale: Vec3,
  pivotLocal: Vec3,
): void {
  for (const [vid, w] of weights.entries()) {
    const v = mesh.getVertex(vid);
    if (!v) continue;
    const sx = 1 + w * (scale[0] - 1);
    const sy = 1 + w * (scale[1] - 1);
    const sz = 1 + w * (scale[2] - 1);
    v.position[0] = pivotLocal[0] + (v.position[0] - pivotLocal[0]) * sx;
    v.position[1] = pivotLocal[1] + (v.position[1] - pivotLocal[1]) * sy;
    v.position[2] = pivotLocal[2] + (v.position[2] - pivotLocal[2]) * sz;
  }
}

/**
 * Applies a world-space gizmo anchor delta (position delta, quaternion rotation,
 * and scale around startAnchorWorld) with per-vertex weights, preserving exact
 * arc rotation and uniform world-space falloff even under non-uniform object scale.
 */
export function applyProportionalWorldAnchorTransform(
  targetMesh: EditableMesh,
  sourceMesh: EditableMesh,
  weights: ReadonlyMap<string, number>,
  params: {
    startAnchorWorld: THREE.Vector3;
    deltaPosWorld: THREE.Vector3;
    deltaQuatWorld: THREE.Quaternion;
    deltaScaleWorld: THREE.Vector3;
    objectMatrixWorld: THREE.Matrix4;
    objectMatrixWorldInv: THREE.Matrix4;
  },
): Set<string> {
  const affectedIds = new Set<string>();
  const {
    startAnchorWorld,
    deltaPosWorld,
    deltaQuatWorld,
    deltaScaleWorld,
    objectMatrixWorld,
    objectMatrixWorldInv,
  } = params;

  const hasPos =
    Math.abs(deltaPosWorld.x) > 1e-8 ||
    Math.abs(deltaPosWorld.y) > 1e-8 ||
    Math.abs(deltaPosWorld.z) > 1e-8;
  const hasRot = Math.abs(deltaQuatWorld.w) < 1 - 1e-8;
  const hasScale =
    Math.abs(deltaScaleWorld.x - 1) > 1e-8 ||
    Math.abs(deltaScaleWorld.y - 1) > 1e-8 ||
    Math.abs(deltaScaleWorld.z - 1) > 1e-8;

  for (const [vid, w] of weights.entries()) {
    const srcV = sourceMesh.getVertex(vid);
    const dstV = targetMesh.getVertex(vid);
    if (!srcV || !dstV) continue;

    affectedIds.add(vid);
    if (!hasPos && !hasRot && !hasScale) continue;

    _tmpV
      .set(srcV.position[0], srcV.position[1], srcV.position[2])
      .applyMatrix4(objectMatrixWorld);

    // Offset relative to start pivot in world space
    _tmpV.sub(startAnchorWorld);

    if (hasScale) {
      _tmpV.x *= 1 + w * (deltaScaleWorld.x - 1);
      _tmpV.y *= 1 + w * (deltaScaleWorld.y - 1);
      _tmpV.z *= 1 + w * (deltaScaleWorld.z - 1);
    }

    if (hasRot) {
      if (w >= 1 - 1e-6) {
        _tmpQuat.copy(deltaQuatWorld);
      } else {
        _tmpQuat.slerpQuaternions(_identQuat, deltaQuatWorld, w);
      }
      _tmpV.applyQuaternion(_tmpQuat);
    }

    _tmpV.add(startAnchorWorld);

    if (hasPos) {
      _tmpV.x += deltaPosWorld.x * w;
      _tmpV.y += deltaPosWorld.y * w;
      _tmpV.z += deltaPosWorld.z * w;
    }

    _tmpV.applyMatrix4(objectMatrixWorldInv);
    dstV.position[0] = _tmpV.x;
    dstV.position[1] = _tmpV.y;
    dstV.position[2] = _tmpV.z;
  }

  return affectedIds;
}

/**
 * Evaluates a falloff preview color gradient for a normalized influence weight in (0, 1].
 * Returns [r, g, b] in linear/sRGB 0..1 suitable for THREE.BufferAttribute('color', 3).
 */
export function sampleProportionalWeightColor(weight: number): [number, number, number] {
  const w = Math.max(0, Math.min(1, weight));
  if (w < 0.5) {
    // Cyan (#38bdf8) -> Yellow (#facc15)
    const k = w * 2;
    return [
      0.22 + (0.98 - 0.22) * k,
      0.74 + (0.8 - 0.74) * k,
      0.97 + (0.08 - 0.97) * k,
    ];
  }
  // Yellow (#facc15) -> Bright Red/Coral (#ef4444)
  const k = (w - 0.5) * 2;
  return [
    0.98 + (0.94 - 0.98) * k,
    0.8 + (0.27 - 0.8) * k,
    0.08 + (0.27 - 0.08) * k,
  ];
}

/**
 * Checks whether active viewport modifiers might add latency or produce warnings
 * during live proportional deformation without altering the base mesh.
 */
export function inspectProportionalModifierCompatibility(
  modifiers: ModifierSlot[] | undefined,
  vertexCount: number,
): string | null {
  if (!modifiers || modifiers.length === 0) return null;
  const active = modifiers.filter(
    (m) => m.enabled && m.showInViewport !== false,
  );
  if (active.length === 0) return null;

  const hasSubdiv = active.some((m) => m.type === 'subdivision');
  const hasBevel = active.some((m) => m.type === 'bevel');
  const hasSolidify = active.some((m) => m.type === 'solidify');

  if (vertexCount > 600 && (hasSubdiv || (hasBevel && hasSolidify))) {
    return 'Edición proporcional activa con modificadores complejos: la vista previa en tiempo real puede simplificarse ligeramente en mallas densas.';
  }
  return null;
}

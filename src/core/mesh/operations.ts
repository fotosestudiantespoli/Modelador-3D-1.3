import * as THREE from 'three';
import { EditableMesh, Vec3 } from './EditableMesh';

export type EditSelectionMode = 'vertex' | 'edge' | 'face';

/**
 * Extension point interface for future modeling tools:
 * Extrude, Subdivide, Loop Cut, Bevel, Inset, Merge, Bridge, Proportional Editing, etc.
 */
export interface MeshOperatorContext {
  mesh: EditableMesh;
  selectionMode: EditSelectionMode;
  selectedIds: Set<string>;
}

export interface MeshOperatorResult {
  mesh: EditableMesh;
  nextSelectedIds: Set<string>;
}

export interface MeshOperator {
  readonly id: string;
  readonly label: string;
  canExecute(ctx: MeshOperatorContext): boolean;
  execute(ctx: MeshOperatorContext, params?: Record<string, unknown>): MeshOperatorResult;
}

/**
 * Registry allowing future operators (extrude, subdivide, bevel, inset, etc.)
 * to be plugged in without rewriting the core engine.
 */
export class MeshOperatorRegistry {
  private operators = new Map<string, MeshOperator>();

  public register(op: MeshOperator): void {
    this.operators.set(op.id, op);
  }

  public get(id: string): MeshOperator | undefined {
    return this.operators.get(id);
  }

  public list(): MeshOperator[] {
    return Array.from(this.operators.values());
  }
}

export const meshOperatorRegistry = new MeshOperatorRegistry();

const _v = new THREE.Vector3();
const _pivot = new THREE.Vector3();

/**
 * Applies a local-space transformation matrix around a local pivot to a set of vertices.
 */
export function applyTransformToVertices(
  mesh: EditableMesh,
  vertexIds: Set<string>,
  deltaMatrix: THREE.Matrix4,
  pivotLocal: Vec3,
): void {
  _pivot.set(pivotLocal[0], pivotLocal[1], pivotLocal[2]);
  for (const vid of vertexIds) {
    const vert = mesh.getVertex(vid);
    if (!vert) continue;
    _v.set(vert.position[0], vert.position[1], vert.position[2]);
    _v.sub(_pivot);
    _v.applyMatrix4(deltaMatrix);
    _v.add(_pivot);
    vert.position[0] = _v.x;
    vert.position[1] = _v.y;
    vert.position[2] = _v.z;
  }
}

/**
 * Deletes currently selected vertices, edges, or faces while maintaining
 * topological consistency across the entire mesh.
 */
export function deleteSelectedComponents(
  mesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: Set<string>,
): void {
  if (selectedIds.size === 0) return;
  if (mode === 'vertex') {
    mesh.deleteVertices(selectedIds);
  } else if (mode === 'edge') {
    mesh.deleteEdges(selectedIds);
  } else if (mode === 'face') {
    mesh.deleteFaces(selectedIds);
  }
}

export function selectAllComponents(
  mesh: EditableMesh,
  mode: EditSelectionMode,
): Set<string> {
  if (mode === 'vertex') return new Set(mesh.vertices.map((v) => v.id));
  if (mode === 'edge') return new Set(mesh.edges.map((e) => e.id));
  return new Set(mesh.faces.map((f) => f.id));
}

export interface DerivedEditSelection {
  vertexIds: Set<string>;
  edgeIds: Set<string>;
  faceIds: Set<string>;
}

/**
 * Derives coherent topological selection highlights (without mutating geometry or
 * inferring non-existent edges) from the user's primary selection in the active sub-mode.
 */
export function computeDerivedEditSelection(
  mesh: EditableMesh,
  mode: EditSelectionMode,
  selectedIds: ReadonlySet<string>,
): DerivedEditSelection {
  const vertexIds = new Set<string>();
  const edgeIds = new Set<string>();
  const faceIds = new Set<string>();

  if (selectedIds.size === 0) {
    return { vertexIds, edgeIds, faceIds };
  }

  if (mode === 'vertex') {
    for (const id of selectedIds) {
      if (mesh.getVertex(id)) {
        vertexIds.add(id);
      }
    }
    if (vertexIds.size >= 2) {
      for (const edge of mesh.edges) {
        if (vertexIds.has(edge.v0) && vertexIds.has(edge.v1)) {
          edgeIds.add(edge.id);
        }
      }
    }
    if (vertexIds.size >= 3) {
      for (const face of mesh.faces) {
        if (
          face.vertexIds.length >= 3 &&
          face.vertexIds.every((vid) => vertexIds.has(vid))
        ) {
          faceIds.add(face.id);
        }
      }
    }
    return { vertexIds, edgeIds, faceIds };
  }

  if (mode === 'edge') {
    for (const id of selectedIds) {
      const edge = mesh.getEdge(id);
      if (edge) {
        edgeIds.add(edge.id);
        vertexIds.add(edge.v0);
        vertexIds.add(edge.v1);
      }
    }
    if (edgeIds.size >= 3) {
      for (const face of mesh.faces) {
        const n = face.vertexIds.length;
        if (n < 3) continue;
        let allEdgesSelected = true;
        for (let i = 0; i < n; i++) {
          const eid = mesh.findEdgeId(
            face.vertexIds[i],
            face.vertexIds[(i + 1) % n],
          );
          if (!eid || !edgeIds.has(eid)) {
            allEdgesSelected = false;
            break;
          }
        }
        if (allEdgesSelected) {
          faceIds.add(face.id);
        }
      }
    }
    return { vertexIds, edgeIds, faceIds };
  }

  // mode === 'face'
  for (const id of selectedIds) {
    const face = mesh.getFace(id);
    if (!face) continue;
    faceIds.add(face.id);
    for (const vid of face.vertexIds) {
      if (mesh.getVertex(vid)) {
        vertexIds.add(vid);
      }
    }
    for (const eid of mesh.getEdgesForFace(face.id)) {
      edgeIds.add(eid);
    }
  }

  return { vertexIds, edgeIds, faceIds };
}


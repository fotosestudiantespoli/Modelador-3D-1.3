import { EditableMesh, canonicalEdgeKey } from './src/core/mesh/EditableMesh';
import {
  analyzeEdgeLoopRing,
  computeLoopCutFractions,
  computeLoopCutPreviewSegments,
  findEdgeLoopRing,
  loopCutMesh,
} from './src/core/mesh/loopCut';
import { analyzeMeshNormals } from './src/core/mesh/normals';
import {
  createCubeMesh,
  createCylinderMesh,
  createPlaneMesh,
  createPyramidMesh,
  createUVSphereMesh,
} from './src/core/mesh/primitives';
import { subdivideMesh } from './src/core/mesh/advancedOperations';
import { evaluateObjectModifiers } from './src/core/modifiers/evaluateModifiers';
import {
  createDefaultBevelParams,
  createDefaultMirrorParams,
  createDefaultSolidifyParams,
  createDefaultSubdivisionParams,
} from './src/core/modifiers/types';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function makeGridMesh(rows: number, cols: number, width = 4, height = 4): EditableMesh {
  const mesh = new EditableMesh();
  const grid: string[][] = [];
  for (let r = 0; r <= rows; r++) {
    const rowIds: string[] = [];
    const y = -height / 2 + (r / rows) * height;
    for (let c = 0; c <= cols; c++) {
      const x = -width / 2 + (c / cols) * width;
      rowIds.push(mesh.addVertex(x, y, 0).id);
    }
    grid.push(rowIds);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      mesh.addFace([
        grid[r][c],
        grid[r][c + 1],
        grid[r + 1][c + 1],
        grid[r + 1][c],
      ]);
    }
  }
  return mesh;
}

function makeOpenCurvedStrip(segments = 4): EditableMesh {
  const mesh = new EditableMesh();
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * Math.PI * 0.75;
    const x = Math.cos(angle) * 2;
    const z = Math.sin(angle) * 2;
    left.push(mesh.addVertex(x, -1, z).id);
    right.push(mesh.addVertex(x, 1, z).id);
  }
  for (let i = 0; i < segments; i++) {
    mesh.addFace([left[i], right[i], right[i + 1], left[i + 1]]);
  }
  return mesh;
}

function assertCleanMeshIntegrity(mesh: EditableMesh, label: string, expectClosed: boolean): void {
  // 1. No duplicate edge keys
  const eKeys = new Set<string>();
  for (const e of mesh.edges) {
    assert(e.v0 !== e.v1, `${label}: zero-length self-edge`);
    const k = canonicalEdgeKey(e.v0, e.v1);
    assert(!eKeys.has(k), `${label}: duplicate edge key ${k}`);
    eKeys.add(k);
  }
  // 2. No duplicate coordinates at identical positions (duplicate split verts check)
  const posKeys = new Set<string>();
  for (const v of mesh.vertices) {
    const pk = `${v.position[0].toFixed(5)},${v.position[1].toFixed(5)},${v.position[2].toFixed(5)}`;
    assert(!posKeys.has(pk), `${label}: duplicate vertex coordinates at ${pk}`);
    posKeys.add(pk);
  }
  // 3. Every face has unique valid vertices & valid edges & clean normals
  for (const f of mesh.faces) {
    assert(f.vertexIds.length >= 3, `${label}: face < 3 verts`);
    assert(new Set(f.vertexIds).size === f.vertexIds.length, `${label}: face repeated vertices`);
    for (let i = 0; i < f.vertexIds.length; i++) {
      const a = f.vertexIds[i];
      const b = f.vertexIds[(i + 1) % f.vertexIds.length];
      assert(Boolean(mesh.findEdgeId(a, b)), `${label}: missing edge for face corner ${a}-${b}`);
    }
  }
  // 4. Normals analysis clean
  const na = analyzeMeshNormals(mesh);
  assert(na.degenerateFaceIds.length === 0, `${label}: found degenerate faces`);
  assert(na.inconsistentFaceIds.length === 0, `${label}: found inconsistent faces`);
  assert(na.nonManifoldEdgeIds.length === 0, `${label}: found non-manifold edges`);
  if (expectClosed) {
    assert(na.invertedFaceIds.length === 0, `${label}: found inverted faces on closed mesh`);
    assert(na.boundaryEdgeIds.length === 0, `${label}: expected closed mesh, found boundary edges`);
  }
}

function findEdgeSpanningAxis(mesh: EditableMesh, axis: 0 | 1 | 2): string {
  for (const e of mesh.edges) {
    const a = mesh.getVertex(e.v0)!.position;
    const b = mesh.getVertex(e.v1)!.position;
    const da = Math.abs(a[axis] - b[axis]);
    const other1 = (axis + 1) % 3;
    const other2 = (axis + 2) % 3;
    if (
      da > 0.5 &&
      Math.abs(a[other1] - b[other1]) < 1e-4 &&
      Math.abs(a[other2] - b[other2]) < 1e-4
    ) {
      return e.id;
    }
  }
  throw new Error(`No edge spanning axis ${axis}`);
}

console.log('--- TEST 1: Cubo básico -> corte horizontal (sobre eje vertical Z) ---');
{
  const cube = createCubeMesh(2);
  // Crossing vertical edges (spanning Z) creates a horizontal XY loop cut at z = 0
  const verticalEdgeId = findEdgeSpanningAxis(cube, 2);
  const analysis = analyzeEdgeLoopRing(cube, verticalEdgeId);
  assert(analysis.valid && analysis.ring?.isClosed === true, 'Horizontal cube ring must be closed');
  assert(analysis.ring!.faceIds.length === 4, 'Cube ring crosses 4 side quads');

  const exec = loopCutMesh(cube, { edgeId: verticalEdgeId, cuts: 1, slide: 0 });
  assert(!exec.error, `Unexpected error: ${exec.error}`);
  const out = exec.result.mesh;
  assert(out.vertices.length === 12, `Expected 12 vertices, got ${out.vertices.length}`);
  assert(out.edges.length === 20, `Expected 20 edges, got ${out.edges.length}`);
  assert(out.faces.length === 10, `Expected 10 faces, got ${out.faces.length}`);
  assert(exec.result.nextSelectedIds.size === 4, '4 new horizontal loop edges selected');
  assert(out.faces.every((f) => f.vertexIds.length === 4), 'All faces remain quads');
  // All 4 newly created vertices sit on Z = 0
  for (const eid of exec.result.nextSelectedIds) {
    const e = out.getEdge(eid)!;
    assert(Math.abs(out.getVertex(e.v0)!.position[2]) < 1e-6, 'Cut edge v0 on Z=0');
    assert(Math.abs(out.getVertex(e.v1)!.position[2]) < 1e-6, 'Cut edge v1 on Z=0');
  }
  assertCleanMeshIntegrity(out, 'Test 1 Cube Horizontal', true);
  console.log('PASS Test 1');
}

console.log('--- TEST 2: Cubo básico -> corte vertical (sobre eje horizontal X) ---');
{
  const cube = createCubeMesh(2);
  // Crossing X-axis edges creates a vertical YZ loop cut at x = 0
  const horizXEdgeId = findEdgeSpanningAxis(cube, 0);
  const exec = loopCutMesh(cube, { edgeId: horizXEdgeId, cuts: 1, slide: 0 });
  assert(!exec.error, `Unexpected error: ${exec.error}`);
  const out = exec.result.mesh;
  assert(out.vertices.length === 12 && out.faces.length === 10 && out.edges.length === 20, 'Cube vertical cut topology counts');
  for (const eid of exec.result.nextSelectedIds) {
    const e = out.getEdge(eid)!;
    assert(Math.abs(out.getVertex(e.v0)!.position[0]) < 1e-6, 'Cut edge v0 on X=0');
    assert(Math.abs(out.getVertex(e.v1)!.position[0]) < 1e-6, 'Cut edge v1 on X=0');
  }
  assertCleanMeshIntegrity(out, 'Test 2 Cube Vertical', true);
  console.log('PASS Test 2');
}

console.log('--- TEST 3: Cubo con cortes consecutivos (múltiples + cruzados ortogonales) ---');
{
  let mesh = createCubeMesh(2);
  const edgeZ = findEdgeSpanningAxis(mesh, 2);
  // Multi-cut 2 cortes en anillo horizontal
  const res1 = loopCutMesh(mesh, { edgeId: edgeZ, cuts: 2, slide: 0 });
  assert(!res1.error, 'First multi-cut should succeed');
  mesh = res1.result.mesh;
  assert(mesh.faces.length === 14 && mesh.vertices.length === 16, `Expected 14 faces & 16 verts, got ${mesh.faces.length}/${mesh.vertices.length}`);
  assertCleanMeshIntegrity(mesh, 'Test 3 after multi-cut 2', true);

  // Segundo corte ortogonal (cruzando aristas a lo largo de X) -> 2 anillos paralelos? Una sola arista X corta la banda superior/central/inferior?
  // En un cubo con Z dividido en 3 bandas, una arista X del borde superior solo tiene las 2 caras top & bottom conectadas por X... espera:
  // Top face (+Z) es un quad; front (+Y/-Y) se dividió en 3 bandas! Al cruzar X en top face, top face -> front top strip -> bottom face -> back top strip -> cerrado!
  const edgeX = findEdgeSpanningAxis(mesh, 0);
  const res2 = loopCutMesh(mesh, { edgeId: edgeX, cuts: 1, slide: 0.3 });
  assert(!res2.error, `Crossing loop cut failed: ${res2.error}`);
  mesh = res2.result.mesh;
  assert(mesh.faces.every((f) => f.vertexIds.length === 4), 'All faces remain pure quads after orthogonal crossing cut');
  assertCleanMeshIntegrity(mesh, 'Test 3 after orthogonal cut', true);

  // Tercer corte sobre otra banda vertical Z
  const edgeZ2 = findEdgeSpanningAxis(mesh, 2);
  const res3 = loopCutMesh(mesh, { edgeId: edgeZ2, cuts: 3, slide: 0 });
  assert(!res3.error, `3rd consecutive cut failed: ${res3.error}`);
  mesh = res3.result.mesh;
  assert(mesh.faces.every((f) => f.vertexIds.length === 4), 'All faces remain quads after 3 consecutive cuts');
  assertCleanMeshIntegrity(mesh, 'Test 3 after 3rd cut', true);
  console.log('PASS Test 3');
}

console.log('--- TEST 4: Cilindro con topología compatible (caras laterales quads + rechazo de tapas N-gon) ---');
{
  const cyl = createCylinderMesh(1, 2, 16);
  // Side vertical edge (runs along Z between topRing and bottomRing)
  const sideVertEdge = findEdgeSpanningAxis(cyl, 2);
  const sideAnalysis = analyzeEdgeLoopRing(cyl, sideVertEdge);
  assert(sideAnalysis.valid && sideAnalysis.ring?.isClosed === true, 'Cylinder side ring must be valid closed 16-quad loop');
  assert(sideAnalysis.ring!.faceIds.length === 16, 'Cylinder has 16 side quads');

  const exec = loopCutMesh(cyl, { edgeId: sideVertEdge, cuts: 2, slide: 0 });
  assert(!exec.error, `Cylinder loop cut failed: ${exec.error}`);
  const out = exec.result.mesh;
  // 16 side quads * 3 = 48 quads + 2 caps (16-gons) = 50 faces; verts: 32 + 2*16 = 64
  assert(out.faces.length === 50, `Expected 50 faces on cut cylinder, got ${out.faces.length}`);
  assert(out.vertices.length === 64, `Expected 64 vertices on cut cylinder, got ${out.vertices.length}`);
  assertCleanMeshIntegrity(out, 'Test 4 Cylinder', true);

  // Now test tapping top cap rim edge (touches 1 side quad AND 16-gon cap!)
  const topRimEdge = cyl.edges.find((e) => {
    const va = cyl.getVertex(e.v0)!.position;
    const vb = cyl.getVertex(e.v1)!.position;
    return Math.abs(va[2] - 1) < 1e-4 && Math.abs(vb[2] - 1) < 1e-4;
  })!;
  const capAnalysis = analyzeEdgeLoopRing(cyl, topRimEdge.id);
  assert(!capAnalysis.valid && capAnalysis.blockedBy === 'ngon', 'Cap rim edge must be cleanly rejected as ngon');
  const blockedExec = loopCutMesh(cyl, { edgeId: topRimEdge.id, cuts: 1, slide: 0 });
  assert(Boolean(blockedExec.error), 'Cap rim execution must report error');
  assert(blockedExec.result.mesh.faces.length === cyl.faces.length, 'Blocked execution must never partially mutate cylinder');
  console.log('PASS Test 4');
}

console.log('--- TEST 5: Plano subdividido (corte en frontera abierta + consistencia del slide) ---');
{
  const grid = makeGridMesh(3, 4, 4, 3); // 12 quads
  const beforeCount = grid.faces.length;
  // Pick an interior horizontal edge (runs along X at y != boundary) -> loop runs vertically across 3 rows
  const interiorHorizEdge = grid.edges.find((e) => {
    const a = grid.getVertex(e.v0)!.position;
    const b = grid.getVertex(e.v1)!.position;
    return Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[1]) < 0.8 && grid.getFacesForEdge(e.id).length === 2;
  })!;

  const ring = findEdgeLoopRing(grid, interiorHorizEdge.id)!;
  assert(ring && !ring.isClosed && ring.faceIds.length === 3, 'Grid ring crosses 3 open quads');

  // CRITICAL: Verify open-loop Rail A -> Rail B consistency when slide != 0 (the bug that previously caused zigzags!)
  const previewSegs = computeLoopCutPreviewSegments(grid, ring, 1, 0.7);
  assert(previewSegs.length === 3, 'Preview has 3 continuous segments');
  for (let i = 0; i < previewSegs.length - 1; i++) {
    const endCurr = previewSegs[i][1];
    const startNext = previewSegs[i + 1][0];
    const gap = Math.hypot(
      endCurr[0] - startNext[0],
      endCurr[1] - startNext[1],
      endCurr[2] - startNext[2],
    );
    assert(gap < 1e-6, `Open loop preview segment ${i} must connect seamlessly with ${i + 1}, gap=${gap}`);
  }
  // Also verify every segment shares constant X!
  const xs = previewSegs.flatMap((s) => [s[0][0], s[1][0]]);
  const maxXDiff = Math.max(...xs) - Math.min(...xs);
  assert(maxXDiff < 1e-6, `Slide along open plane strip must keep straight collinear X cut, diff=${maxXDiff}`);

  const exec = loopCutMesh(grid, { edgeId: interiorHorizEdge.id, cuts: 1, slide: 0.7 });
  assert(!exec.error, `Plane cut failed: ${exec.error}`);
  const out = exec.result.mesh;
  assert(out.faces.length === beforeCount + 3, `Expected 15 faces on plane, got ${out.faces.length}`);
  assert(out.faces.every((f) => f.vertexIds.length === 4), 'All plane faces remain quads');
  assertCleanMeshIntegrity(out, 'Test 5 Subdivided Plane', false);

  // Also test boundary edge directly on Single Plane (createPlaneMesh)
  const singlePlane = createPlaneMesh(2);
  const planeExec = loopCutMesh(singlePlane, { edgeId: singlePlane.edges[0].id, cuts: 3, slide: 0 });
  assert(!planeExec.error && planeExec.result.mesh.faces.length === 4, 'Single plane cut with 3 cuts -> 4 quads');
  assertCleanMeshIntegrity(planeExec.result.mesh, 'Test 5 Single Plane 3 cuts', false);
  console.log('PASS Test 5');
}

console.log('--- TEST 6: Malla abierta (tira curva abierta + distribución uniforme multi-corte) ---');
{
  const strip = makeOpenCurvedStrip(5); // 5 curved quads along open surface
  const midCrossEdge = strip.edges.find((e) => {
    const va = strip.getVertex(e.v0)!.position;
    const vb = strip.getVertex(e.v1)!.position;
    return Math.abs(va[1] - vb[1]) > 1.5 && strip.getFacesForEdge(e.id).length === 2;
  })!;
  const exec = loopCutMesh(strip, { edgeId: midCrossEdge.id, cuts: 3, slide: 0 });
  assert(!exec.error, `Open curved strip failed: ${exec.error}`);
  const out = exec.result.mesh;
  assert(out.faces.length === 5 * 4, `Expected 20 quads on 3-cut strip, got ${out.faces.length}`);
  assertCleanMeshIntegrity(out, 'Test 6 Open Curved Strip', false);

  const fractions = computeLoopCutFractions(3, 0);
  assert(
    Math.abs(fractions[0] - 0.25) < 1e-6 &&
      Math.abs(fractions[1] - 0.5) < 1e-6 &&
      Math.abs(fractions[2] - 0.75) < 1e-6,
    '3 centered cuts must sit at exact 0.25, 0.50, 0.75',
  );
  // Clamping check: extreme slides with high cut count must never overlap or escape [0.03, 0.97]
  const frPos = computeLoopCutFractions(6, 1);
  const frNeg = computeLoopCutFractions(6, -1);
  for (let i = 0; i < frPos.length; i++) {
    assert(frPos[i] >= 0.03 && frPos[i] <= 0.97, 'Clamped fraction upper');
    assert(frNeg[i] >= 0.03 && frNeg[i] <= 0.97, 'Clamped fraction lower');
    if (i > 0) {
      assert(frPos[i] > frPos[i - 1], 'Strictly monotonic fractions (+slide)');
      assert(frNeg[i] > frNeg[i - 1], 'Strictly monotonic fractions (-slide)');
    }
  }
  console.log('PASS Test 6');
}

console.log('--- TEST 7: Malla con topología irregular (triángulos, N-gons, polos, no-manifold, torsión) ---');
{
  // 7A: Pyramid (base quad surrounded by 4 triangles)
  const pyr = createPyramidMesh(2, 2);
  for (const e of pyr.edges) {
    const a = analyzeEdgeLoopRing(pyr, e.id);
    assert(!a.valid && a.blockedBy === 'triangle', `Pyramid edge ${e.id} must be blocked by triangle, got ${a.blockedBy}`);
  }
  const pyrBefore = JSON.stringify(pyr.toJSON());
  const pyrRes = loopCutMesh(pyr, { edgeId: pyr.edges[0].id, cuts: 1, slide: 0 });
  assert(Boolean(pyrRes.error), 'Pyramid loop cut must return error');
  assert(JSON.stringify(pyrRes.result.mesh.toJSON()) === pyrBefore, 'Pyramid must stay completely unmodified');

  // 7B: Mixed Quad + Triangle grid (3 quads then 1 triangle at end — must reject cleanly with NO silent partial cut / T-vertex!)
  const mixed = makeGridMesh(1, 3, 3, 1); // 3 quads in a row along X
  // Split last quad diagonally by replacing it with two triangles? Wait: let's replace right-most quad edge so one face is a triangle.
  const rightFace = mixed.faces[2];
  const [rv0, rv1, rv2, rv3] = rightFace.vertexIds;
  mixed.deleteFaces(new Set([rightFace.id]));
  mixed.addFace([rv0, rv1, rv2]);
  mixed.addFace([rv0, rv2, rv3]);
  const startVertEdge = mixed.findEdgeId(mixed.faces[0].vertexIds[3], mixed.faces[0].vertexIds[0])!;
  const mixedAnalysis = analyzeEdgeLoopRing(mixed, startVertEdge);
  assert(!mixedAnalysis.valid && mixedAnalysis.blockedBy === 'triangle', 'Strip ending in triangle must be rejected cleanly (no T-junction)');
  const mixedFacesBefore = mixed.faces.length;
  const mixedExec = loopCutMesh(mixed, { edgeId: startVertEdge, cuts: 1, slide: 0 });
  assert(Boolean(mixedExec.error) && mixedExec.result.mesh.faces.length === mixedFacesBefore, 'Zero partial cuts allowed');

  // 7B-2: Mobius twist (3 quads closed loop with half-twist) -> blocked cleanly as 'twist'
  const mobius = new EditableMesh();
  const m0 = mobius.addVertex(-1, -0.5, 0).id;
  const m1 = mobius.addVertex(-1, 0.5, 0).id;
  const m2 = mobius.addVertex(0, -0.5, 1).id;
  const m3 = mobius.addVertex(0, 0.5, 1).id;
  const m4 = mobius.addVertex(1, -0.5, 0).id;
  const m5 = mobius.addVertex(1, 0.5, 0).id;
  mobius.addFace([m0, m1, m3, m2]);
  mobius.addFace([m2, m3, m5, m4]);
  mobius.addFace([m4, m5, m0, m1]); // Half-twist back to m0-m1 reversed!
  const twistEdge = mobius.findEdgeId(m0, m1)!;
  const twistAnalysis = analyzeEdgeLoopRing(mobius, twistEdge);
  assert(!twistAnalysis.valid && twistAnalysis.blockedBy === 'twist', `Expected twist block, got ${twistAnalysis.blockedBy}`);

  // 7C: Non-manifold T-edge (3 quads sharing same central edge)
  const nonManifold = new EditableMesh();
  const a = nonManifold.addVertex(0, 0, 0).id;
  const b = nonManifold.addVertex(0, 1, 0).id;
  const c1 = nonManifold.addVertex(-1, 0, 0).id;
  const d1 = nonManifold.addVertex(-1, 1, 0).id;
  const c2 = nonManifold.addVertex(1, 0, 0).id;
  const d2 = nonManifold.addVertex(1, 1, 0).id;
  const c3 = nonManifold.addVertex(0, 0, 1).id;
  const d3 = nonManifold.addVertex(0, 1, 1).id;
  nonManifold.addFace([a, b, d1, c1]);
  nonManifold.addFace([b, a, c2, d2]);
  nonManifold.addFace([a, b, d3, c3]);
  const sharedId = nonManifold.findEdgeId(a, b)!;
  const nmAnalysis = analyzeEdgeLoopRing(nonManifold, sharedId);
  assert(!nmAnalysis.valid && nmAnalysis.blockedBy === 'non_manifold', `Expected non_manifold block, got ${nmAnalysis.blockedBy}`);

  // 7D: UV Sphere polar cap triangles cleanly rejected; equatorial quad rings succeed!
  const sphere = createUVSphereMesh(1, 12, 8);
  const eqEdge = sphere.edges.find((e) => {
    const faces = sphere.getFacesForEdge(e.id);
    if (faces.length !== 2) return false;
    const f0 = sphere.getFace(faces[0])!;
    const f1 = sphere.getFace(faces[1])!;
    if (f0.vertexIds.length !== 4 || f1.vertexIds.length !== 4) return false;
    const p0 = sphere.getVertex(e.v0)!.position;
    const p1 = sphere.getVertex(e.v1)!.position;
    // Horizontal ring edge (same Z) -> walks meridionally toward poles and hits polar triangles -> blocked!
    return Math.abs(p0[2] - p1[2]) < 1e-4 && Math.abs(p0[2]) < 0.3;
  })!;
  const merAnalysis = analyzeEdgeLoopRing(sphere, eqEdge.id);
  assert(!merAnalysis.valid && merAnalysis.blockedBy === 'triangle', 'Sphere meridional cut hitting polar cap triangles must be blocked cleanly');

  const vertMeridianEdge = sphere.edges.find((e) => {
    const faces = sphere.getFacesForEdge(e.id);
    if (faces.length !== 2) return false;
    const f0 = sphere.getFace(faces[0])!;
    const f1 = sphere.getFace(faces[1])!;
    if (f0.vertexIds.length !== 4 || f1.vertexIds.length !== 4) return false;
    const p0 = sphere.getVertex(e.v0)!.position;
    const p1 = sphere.getVertex(e.v1)!.position;
    // Vertical meridian edge -> walks latitudinally around equator!
    return Math.abs(p0[2] - p1[2]) > 0.1 && Math.abs(p0[2]) < 0.5 && Math.abs(p1[2]) < 0.5;
  })!;
  const latAnalysis = analyzeEdgeLoopRing(sphere, vertMeridianEdge.id);
  assert(latAnalysis.valid && latAnalysis.ring?.isClosed === true && latAnalysis.ring.faceIds.length === 12, 'Sphere latitude quad ring works cleanly');

  console.log('PASS Test 7');
}

console.log('--- TEST 8: Undo/Redo & Modifiers Integration (Mirror + Subdivision + Solidify + Bevel) ---');
{
  // Undo/Redo snapshot round-trip
  const cube = createCubeMesh(2);
  const beforeJson = cube.toJSON();
  const edgeZ = findEdgeSpanningAxis(cube, 2);
  const afterRes = loopCutMesh(cube, { edgeId: edgeZ, cuts: 2, slide: 0.25 });
  const afterJson = afterRes.result.mesh.toJSON();
  const restored = EditableMesh.fromJSON(beforeJson);
  assert(restored.faces.length === 6 && restored.vertices.length === 8, 'Undo restores exact 6 faces / 8 vertices');
  const redone = EditableMesh.fromJSON(afterJson);
  assert(redone.faces.length === 14 && redone.vertices.length === 16, 'Redo restores exact 14 faces / 16 vertices');

  // Modifier stack evaluation on Loop-Cut geometry
  const mods = [
    { id: 'm1', type: 'mirror' as const, enabled: true, showInViewport: true, params: createDefaultMirrorParams() },
    { id: 'm2', type: 'bevel' as const, enabled: true, showInViewport: true, params: createDefaultBevelParams() },
    { id: 'm3', type: 'solidify' as const, enabled: true, showInViewport: true, params: createDefaultSolidifyParams() },
    { id: 'm4', type: 'subdivision' as const, enabled: true, showInViewport: true, params: { ...createDefaultSubdivisionParams(), levels: 1 } },
  ];

  const evalResult = evaluateObjectModifiers(afterJson, mods);
  assert(evalResult.mesh.faces.length > 0, 'Modifier stack produces valid geometry after Loop Cut');
  assert(Object.values(evalResult.diagnostics).every((d) => d.status !== 'error'), `Unexpected modifier errors: ${JSON.stringify(evalResult.diagnostics)}`);

  // Subdivision smoothness after Loop Cut
  const subAfterCut = subdivideMesh(redone, 'face', new Set(redone.faces.map((f) => f.id)), {
    cuts: 1,
    smoothness: 0.5,
    fractal: 0,
  });
  assert(subAfterCut.mesh.faces.length === 14 * 4, 'Subdivide works cleanly after Loop Cut');
  console.log('PASS Test 8');
}

console.log('\nALL LOOP CUT VERIFICATION TESTS PASSED (8/8 suites)');

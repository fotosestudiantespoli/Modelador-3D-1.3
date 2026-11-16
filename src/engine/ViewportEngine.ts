import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  EditableMesh,
  SerializedEditableMesh,
  Vec3,
} from '../core/mesh/EditableMesh';
import {
  EditSelectionMode,
  applyTransformToVertices,
  computeDerivedEditSelection,
} from '../core/mesh/operations';
import {
  DEFAULT_PROPORTIONAL_EDITING_SETTINGS,
  ProportionalDistanceField,
  ProportionalEditingSettings,
  applyProportionalWorldAnchorTransform,
  buildProportionalDistanceField,
  clampProportionalRadius,
  computeProportionalWeights,
  normalizeProportionalSettings,
  sampleProportionalWeightColor,
} from '../core/mesh/proportionalEditing';
import {
  AxisConstraint,
  CameraProjection,
  ModelerSettings,
  ObjectTransform,
  SceneObjectData,
  TouchModifierState,
  TransformTool,
  ViewportDisplayMode,
  WorkMode,
} from '../core/project/types';
import { DEFAULT_TOUCH_SETTINGS } from '../core/project/storage';
import {
  buildTransformRefsFromObjects,
  evaluateObjectModifiers,
  hasActiveViewportModifiers,
} from '../core/modifiers/evaluateModifiers';
import { clampVerticesForMirrorClipping } from '../core/modifiers/mirrorModifier';
import {
  ModifierSlot,
  ModifierTransformRef,
  normalizeMirrorParams,
} from '../core/modifiers/types';
import {
  BoxSelectRect,
  EMPTY_MODIFIER_STATE,
  TouchGestureManager,
  TrackedPointer,
} from './TouchGestureManager';
import {
  isPointInRect2D,
  Rect2D,
  segmentIntersectsRect2D,
  triangleIntersectsRect2D,
} from './boxSelectMath';

export type CameraPreset =
  | 'front'
  | 'back'
  | 'top'
  | 'bottom'
  | 'right'
  | 'left'
  | 'iso'
  | 'focus';

export type CameraQuaternionTuple = [number, number, number, number];

export function computeCameraPresetOffset(
  preset: CameraPreset,
  distance: number,
): Vec3 {
  const d = Math.max(0.1, distance);
  const topEps = Math.max(1e-4, d * 1e-4);
  switch (preset) {
    case 'front':
      return [0, -d, 0];
    case 'back':
      return [0, d, 0];
    case 'right':
      return [d, 0, 0];
    case 'left':
      return [-d, 0, 0];
    case 'top':
      return [0, -topEps, d];
    case 'bottom':
      return [0, -topEps, -d];
    case 'iso':
    case 'focus':
      return [d * 0.62, -d * 0.68, d * 0.48];
  }
}

export interface ViewportContextInfo {
  clientX: number;
  clientY: number;
  hitObjectId: string | null;
  hitComponentId: string | null;
}

export interface BoxSelectOverlayState {
  left: number;
  top: number;
  width: number;
  height: number;
  matchCount: number;
  additive: boolean;
}

export interface ViewportCallbacks {
  onSelectObject: (id: string | null, additive?: boolean) => void;
  onBoxSelectObjects?: (ids: string[], additive: boolean) => void;
  onSelectComponent: (
    id: string | null,
    additive: boolean,
    addOnly?: boolean,
  ) => void;
  onBoxSelectComponents?: (ids: string[], additive: boolean) => void;
  onBoxSelectOverlayChange?: (overlay: BoxSelectOverlayState | null) => void;
  onPickLoopCutEdge: (edgeId: string | null) => void;
  onTwoFingerUndo: () => void;
  onThreeFingerRedo: () => void;
  onOpenContextMenu: (info: ViewportContextInfo) => void;
  onModifierStateChange?: (modifiers: TouchModifierState) => void;
  onCameraPoseChange?: (quaternion: CameraQuaternionTuple) => void;
  onLiveObjectTransform: (id: string, transform: ObjectTransform) => void;
  onCommitObjectTransform: (
    id: string,
    before: ObjectTransform,
    after: ObjectTransform,
  ) => void;
  onCommitMeshEdit: (
    id: string,
    before: EditableMesh,
    after: EditableMesh,
  ) => void;
  onChangeProportionalRadius?: (radius: number) => void;
  onLoopCutSlideDelta?: (delta: number) => void;
}

interface ObjectVisual {
  id: string;
  objectType: SceneObjectData['objectType'];
  group: THREE.Group;
  solidMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  faceOrientationFrontMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  faceOrientationBackMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  wireEdges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  baseSolidCollider: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  refPlaneMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  refTexture: THREE.Texture | null;
  refImageSrc: string | null;
  triangleToFaceId: string[];
  faceToTriangleRange: Map<string, { start: number; count: number }>;
  baseTriangleToFaceId: string[];
  baseFaceToTriangleRange: Map<string, { start: number; count: number }>;
  baseEditableMesh: EditableMesh;
  editableMesh: EditableMesh;
  lastMeshData: SerializedEditableMesh | null;
  modifiers: ModifierSlot[];
  modifiersSignature: string;
  hasActiveModifiers: boolean;
  hasFaces: boolean;
  locked: boolean;
}

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mat4A = new THREE.Matrix4();
const _mat4B = new THREE.Matrix4();
const _mat4C = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createVertexDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function distToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { dist: Math.hypot(px - ax, py - ay), t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

export class ViewportEngine {
  private container: HTMLElement;
  private callbacks: ViewportCallbacks;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private perspectiveCamera: THREE.PerspectiveCamera;
  private orthographicCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private projection: CameraProjection = 'perspective';

  private orbitControls: OrbitControls;
  private transformControls: TransformControls;
  private editGizmoAnchor: THREE.Object3D;

  private gridHelper: THREE.GridHelper;
  private axesGroup: THREE.Group;
  private shadowPlane: THREE.Mesh;

  private objectsGroup = new THREE.Group();
  private visuals = new Map<string, ObjectVisual>();

  // Edit mode overlays
  private editOverlayGroup = new THREE.Group();
  private editAllEdgesLine: THREE.LineSegments;
  private editSelectedEdgesLine: THREE.LineSegments;
  private editSelectedEdgeBars: THREE.InstancedMesh;
  private loopCutPreviewBars: THREE.InstancedMesh;
  private loopCutPreviewPoints: THREE.Points;
  private editSelectedFacesMesh: THREE.Mesh;
  private editUnselectedVerticesPoints: THREE.Points;
  private editSelectedVerticesPoints: THREE.Points;
  private proportionalRing: THREE.LineLoop;
  private proportionalRingVisible = false;
  private vertexDotTexture: THREE.CanvasTexture;

  // State mirrors
  private selectedObjectId: string | null = null;
  private selectedObjectIds = new Set<string>();
  private currentObjectsData = new Map<string, SceneObjectData>();
  private workMode: WorkMode = 'object';
  private editSelectionMode: EditSelectionMode = 'vertex';
  private selectedComponentIds = new Set<string>();
  private boxSelectPreviewObjectIds = new Set<string>();
  private boxSelectPreviewComponentIds = new Set<string>();
  private isBoxSelectBlocking = false;
  private virtualModifiers: TouchModifierState = { ...EMPTY_MODIFIER_STATE };
  private activeTool: TransformTool = 'move';
  private axisConstraint: AxisConstraint = 'free';
  private settings: ModelerSettings | null = null;
  private proportionalSettings: ProportionalEditingSettings = {
    ...DEFAULT_PROPORTIONAL_EDITING_SETTINGS,
  };
  private proportionalPreviewField: ProportionalDistanceField | null = null;
  private proportionalPreviewSourceMesh: EditableMesh | null = null;
  private proportionalPreviewKey = '';
  private proportionalPreviewWeights = new Map<string, number>();
  private proportionalPreviewRadiusUsed = -1;
  private proportionalPreviewFalloffUsed = '';
  private displayMode: ViewportDisplayMode = 'solid';
  private xrayTransparency = 50;
  private showFaceOrientation = false;
  private editOverlaySourceMesh: EditableMesh | null = null;
  private suppressGizmo = false;
  private loopCutPreviewMode = false;
  private loopCutPreviewSegments: [Vec3, Vec3][] = [];
  private loopCutPreviewRingEdgeIds = new Set<string>();
  private loopCutPreviewFaceIds = new Set<string>();
  private loopCutSlideActive = false;
  private loopCutSlidePointerId: number | null = null;
  private loopCutSlideLastX = 0;

  // Drag tracking
  private isGizmoDragging = false;
  private objectDragStartTransform: ObjectTransform | null = null;
  private editDragStartMesh: EditableMesh | null = null;
  private editDragStartVertexIds = new Set<string>();
  private editDragStartVertexPositions = new Map<string, Vec3>();
  private editDragStartAnchorInv = new THREE.Matrix4();
  private editDragStartAnchorPos = new THREE.Vector3();
  private proportionalDragField: ProportionalDistanceField | null = null;
  private proportionalDragWeights = new Map<string, number>();
  private proportionalDragRadiusUsed = -1;
  private proportionalDragFalloffUsed = '';
  private proportionalDragConnectedUsed = false;
  private sceneTransformRefs: ModifierTransformRef[] = [];

  // Centralized Touch & Pointer Gesture Manager
  private gestureManager: TouchGestureManager;
  private suppressOrbitForContextPress = false;

  // Render loop / transition
  private frameId = 0;
  private renderBusy = false;
  private renderDirty = false;
  private cameraAnimTargetPos: THREE.Vector3 | null = null;
  private cameraAnimTargetLook: THREE.Vector3 | null = null;
  private lastAnimTime = 0;
  private disposed = false;

  private resizeObserver: ResizeObserver;
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, callbacks: ViewportCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d1f24);
    this.scene.fog = new THREE.FogExp2(0x1d1f24, 0.011);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Cameras (Blender Z-up convention: X horizontal, Y depth, Z vertical)
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.05, 500);
    this.perspectiveCamera.up.set(0, 0, 1);
    this.perspectiveCamera.position.set(5.6, -6.2, 4.2);
    this.perspectiveCamera.lookAt(0, 0, 0);

    const frustum = 7;
    this.orthographicCamera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      -100,
      500,
    );
    this.orthographicCamera.up.set(0, 0, 1);
    this.orthographicCamera.position.copy(this.perspectiveCamera.position);
    this.orthographicCamera.lookAt(0, 0, 0);
    this.activeCamera = this.perspectiveCamera;

    // 3-Point Studio Lighting (Z-up)
    const hemi = new THREE.HemisphereLight(0xa6bddb, 0x262930, 0.8);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff5e8, 1.45);
    keyLight.position.set(7, -8, 12);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -10;
    keyLight.shadow.camera.right = 10;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 40;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xc2d4ff, 0.55);
    rimLight.position.set(-8, 7, 6);
    this.scene.add(rimLight);

    // Subtle ground shadow receiver on XY plane (Z-up floor)
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.22 });
    shadowMat.depthTest = true;
    shadowMat.depthWrite = false;
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      shadowMat,
    );
    this.shadowPlane.position.set(0, 0, -0.004);
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.renderOrder = -3;
    this.scene.add(this.shadowPlane);

    // Reference Grid rotated onto XY plane (Z = 0) — visual guide only, never writes depth
    this.gridHelper = new THREE.GridHelper(32, 32, 0x3f444f, 0x2a2d35);
    const gridMaterials = Array.isArray(this.gridHelper.material)
      ? this.gridHelper.material
      : [this.gridHelper.material];
    for (const mat of gridMaterials) {
      mat.transparent = true;
      mat.opacity = 0.85;
      mat.depthTest = true;
      mat.depthWrite = false;
      mat.needsUpdate = true;
    }
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.position.set(0, 0, -0.001);
    this.gridHelper.renderOrder = -2;
    this.scene.add(this.gridHelper);

    // Colored X, Y, Z Axes
    this.axesGroup = this.createAxesGroup();
    this.scene.add(this.axesGroup);

    this.scene.add(this.objectsGroup);

    // Edit Mode Overlay Setup
    this.vertexDotTexture = createVertexDotTexture();

    this.editAllEdgesLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x111317,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.editAllEdgesLine.renderOrder = 4;

    this.editSelectedEdgesLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xff9900,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.editSelectedEdgesLine.renderOrder = 5;

    const barGeo = new THREE.BoxGeometry(1, 1, 1);
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xff9900,
      depthTest: false,
      depthWrite: false,
    });
    this.editSelectedEdgeBars = new THREE.InstancedMesh(barGeo, barMat, 1);
    this.editSelectedEdgeBars.count = 0;
    this.editSelectedEdgeBars.frustumCulled = false;
    this.editSelectedEdgeBars.renderOrder = 5;

    this.editSelectedFacesMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xff9900,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.editSelectedFacesMesh.renderOrder = 3;

    this.editUnselectedVerticesPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0xffffff,
        vertexColors: true,
        size: 10,
        sizeAttenuation: false,
        map: this.vertexDotTexture,
        alphaTest: 0.45,
        depthTest: true,
        depthWrite: false,
      }),
    );
    this.editUnselectedVerticesPoints.renderOrder = 6;

    this.editSelectedVerticesPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0xff9900,
        size: 14,
        sizeAttenuation: false,
        map: this.vertexDotTexture,
        alphaTest: 0.45,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.editSelectedVerticesPoints.renderOrder = 7;

    const loopBarMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      depthTest: false,
      depthWrite: false,
    });
    this.loopCutPreviewBars = new THREE.InstancedMesh(barGeo, loopBarMat, 1);
    this.loopCutPreviewBars.count = 0;
    this.loopCutPreviewBars.frustumCulled = false;
    this.loopCutPreviewBars.renderOrder = 8;

    this.loopCutPreviewPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0xe0f2fe,
        size: 10,
        sizeAttenuation: false,
        map: this.vertexDotTexture,
        alphaTest: 0.45,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.loopCutPreviewPoints.visible = false;
    this.loopCutPreviewPoints.frustumCulled = false;
    this.loopCutPreviewPoints.renderOrder = 9;

    this.editOverlayGroup.add(
      this.editSelectedFacesMesh,
      this.editAllEdgesLine,
      this.editSelectedEdgesLine,
      this.editSelectedEdgeBars,
      this.loopCutPreviewBars,
      this.loopCutPreviewPoints,
      this.editUnselectedVerticesPoints,
      this.editSelectedVerticesPoints,
    );
    this.editOverlayGroup.visible = false;
    this.scene.add(this.editOverlayGroup);

    // Proportional Editing visual radius indicator ring (world-space camera-facing)
    const ringPts: THREE.Vector3[] = [];
    const ringSegs = 64;
    for (let i = 0; i < ringSegs; i++) {
      const a = (i / ringSegs) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    this.proportionalRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.proportionalRing.renderOrder = 9;
    this.proportionalRing.visible = false;
    this.proportionalRing.frustumCulled = false;
    this.scene.add(this.proportionalRing);

    // Gizmo Anchor for Edit Mode
    this.editGizmoAnchor = new THREE.Object3D();
    this.scene.add(this.editGizmoAnchor);

    // 1. TransformControls Gizmo (handles gizmo pointerdown before gesture & orbit)
    this.transformControls = new TransformControls(
      this.activeCamera,
      this.renderer.domElement,
    );
    this.transformControls.setSize(1.25);
    this.transformControls.setColors(0xe05252, 0x52b852, 0x48bce8, 0xffff00);
    this.transformControls.getRaycaster().params.Line.threshold = 0.25;
    this.scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.isGizmoDragging = dragging;
      if (dragging) {
        this.gestureManager.invalidateCurrentGesture();
      }
      this.orbitControls.enabled =
        !dragging && !this.suppressOrbitForContextPress && !this.isBoxSelectBlocking;
      if (dragging) {
        this.handleGizmoDragStart();
      } else {
        this.handleGizmoDragEnd();
      }
      this.requestRender();
    });

    this.transformControls.addEventListener('objectChange', () => {
      this.handleGizmoObjectChange();
      this.requestRender();
    });

    this.transformControls.addEventListener('change', () => {
      this.requestRender();
    });

    // 2. Centralized Multi-Touch Pointer Gesture Manager (must bind BEFORE OrbitControls so Double-Tap Box Select locks orbit on pointerdown)
    const dom = this.renderer.domElement;
    this.gestureManager = new TouchGestureManager(dom, DEFAULT_TOUCH_SETTINGS, {
      isGizmoBusy: () =>
        this.isGizmoDragging || this.transformControls.axis !== null,
      isBoxSelectDisabled: () => this.loopCutPreviewMode,
      isShiftHoldDisabled: () =>
        this.loopCutPreviewMode && this.loopCutSlideActive,
      getWorkMode: () => this.workMode,
      hasLongPressTarget: (clientX, clientY, pointerType) =>
        this.workMode === 'object'
          ? this.hitTestObject(clientX, clientY, pointerType) !== null
          : this.hitTestEditComponent(clientX, clientY, pointerType) !== null,
      onSingleTap: (clientX, clientY, pointerType, modifiers, shiftKey) => {
        const effective = this.mergeModifiers(modifiers);
        const shiftActive = effective.shift || shiftKey;
        const additive =
          Boolean(this.settings?.multiSelectTouch) || shiftActive;
        this.performTapSelection(
          clientX,
          clientY,
          pointerType,
          additive,
          false,
        );
      },
      onTwoFingerTap: () => {
        if (!this.loopCutPreviewMode) {
          this.callbacks.onTwoFingerUndo();
        }
      },
      onThreeFingerTap: () => {
        if (!this.loopCutPreviewMode) {
          this.callbacks.onThreeFingerRedo();
        }
      },
      onLongPress: (clientX, clientY, pointerType) => {
        this.handleLongPressContext(clientX, clientY, pointerType);
      },
      onBoxSelectStart: (rect, modifiers, shiftKey) => {
        this.handleBoxSelectMove(rect, modifiers, shiftKey);
      },
      onBoxSelectMove: (rect, modifiers, shiftKey) => {
        this.handleBoxSelectMove(rect, modifiers, shiftKey);
      },
      onBoxSelectEnd: (rect, modifiers, shiftKey) => {
        this.handleBoxSelectEnd(rect, modifiers, shiftKey);
      },
      onBoxSelectCancel: () => {
        this.clearBoxSelectPreview();
      },
      onModifierStateChange: (modifiers) => {
        this.callbacks.onModifierStateChange?.(modifiers);
      },
      onTouchNavigationChange: (
        activePointers,
        modifiers,
        isBoxSelectBlocking,
      ) => {
        this.syncTouchNavigationFlags(
          activePointers,
          modifiers,
          isBoxSelectBlocking,
        );
      },
    });

    // 3. OrbitControls (iPad Touch: 1 finger rotate, 2 fingers pinch/pan)
    this.orbitControls = new OrbitControls(this.activeCamera, this.renderer.domElement);
    this.orbitControls.enableDamping = !this.isSoftwareGl;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.rotateSpeed = 0.75;
    this.orbitControls.zoomSpeed = 0.9;
    this.orbitControls.panSpeed = 0.85;
    this.orbitControls.minDistance = 0.6;
    this.orbitControls.maxDistance = 120;
    this.orbitControls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    this.orbitControls.addEventListener('start', () => {
      this.cameraAnimTargetPos = null;
      this.cameraAnimTargetLook = null;
    });
    this.orbitControls.addEventListener('change', () => {
      this.requestRender();
    });

    dom.addEventListener('webglcontextlost', this.onContextLost);
    dom.addEventListener('wheel', this.onViewportWheel, { passive: false });
    dom.addEventListener('pointerdown', this.onLoopCutSlidePointerDown);
    dom.addEventListener('pointermove', this.onLoopCutSlidePointerMove);
    dom.addEventListener('pointerup', this.onLoopCutSlidePointerUp);
    dom.addEventListener('pointercancel', this.onLoopCutSlidePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.activeCamera);
    }

    this.orbitControls.update();
    this.emitCameraPose();
    this.requestRender();
  }

  private emitCameraPose(): void {
    const q = this.activeCamera.quaternion;
    this.callbacks.onCameraPoseChange?.([q.x, q.y, q.z, q.w]);
  }

  private createAxesGroup(): THREE.Group {
    const group = new THREE.Group();
    group.renderOrder = -2;
    const len = 16;

    const makeAxis = (dir: Vec3, color: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-dir[0] * len, -dir[1] * len, -dir[2] * len),
        new THREE.Vector3(dir[0] * len, dir[1] * len, dir[2] * len),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        depthTest: true,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = -2;
      return line;
    };

    group.add(makeAxis([1, 0, 0], 0xe05252)); // X Red
    group.add(makeAxis([0, 1, 0], 0x52b852)); // Y Green
    group.add(makeAxis([0, 0, 1], 0x48bce8)); // Z Sky Blue (#48BCE8)
    return group;
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private onViewportWheel = (e: WheelEvent) => {
    if (
      !this.isGizmoDragging ||
      this.workMode !== 'edit' ||
      !this.proportionalSettings.enabled
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextRadius = clampProportionalRadius(
      this.proportionalSettings.radius * factor,
    );
    if (Math.abs(nextRadius - this.proportionalSettings.radius) > 1e-5) {
      this.proportionalSettings = {
        ...this.proportionalSettings,
        radius: nextRadius,
      };
      this.refreshProportionalDragWeights(false);
      this.handleGizmoObjectChange();
      this.callbacks.onChangeProportionalRadius?.(nextRadius);
      this.requestRender();
    }
  };

  private onLoopCutSlidePointerDown = (e: PointerEvent) => {
    if (!this.loopCutPreviewMode || !this.loopCutSlideActive) return;
    if (!e.isPrimary) {
      this.loopCutSlidePointerId = null;
      return;
    }
    this.loopCutSlidePointerId = e.pointerId;
    this.loopCutSlideLastX = e.clientX;
    this.orbitControls.enableRotate = false;
  };

  private onLoopCutSlidePointerMove = (e: PointerEvent) => {
    if (!this.loopCutPreviewMode || !this.loopCutSlideActive) {
      this.loopCutSlidePointerId = null;
      return;
    }
    if (this.loopCutSlidePointerId === null || e.pointerId !== this.loopCutSlidePointerId) {
      return;
    }
    const dx = e.clientX - this.loopCutSlideLastX;
    if (Math.abs(dx) < 0.5) return;
    this.loopCutSlideLastX = e.clientX;
    this.callbacks.onLoopCutSlideDelta?.(dx * 0.0055);
  };

  private onLoopCutSlidePointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.loopCutSlidePointerId) {
      this.loopCutSlidePointerId = null;
    }
  };

  private syncTouchNavigationFlags(
    activePointers: ReadonlyMap<number, TrackedPointer>,
    modifiers: TouchModifierState = EMPTY_MODIFIER_STATE,
    isBoxSelectBlocking = false,
  ): void {
    this.isBoxSelectBlocking = isBoxSelectBlocking;
    if (isBoxSelectBlocking || modifiers.shift) {
      // Lock camera navigation while Double-Tap Box Select or touch SHIFT hold is active
      this.orbitControls.enabled = false;
      this.orbitControls.enableRotate = false;
      return;
    }

    if (activePointers.size === 0) {
      this.suppressOrbitForContextPress = false;
      this.loopCutSlidePointerId = null;
      this.orbitControls.enabled = !this.isGizmoDragging;
      this.orbitControls.enableRotate = !(
        this.loopCutPreviewMode && this.loopCutSlideActive
      );
      this.orbitControls.enableZoom = true;
      this.orbitControls.enablePan = true;
      return;
    }

    if (this.suppressOrbitForContextPress) {
      this.orbitControls.enabled = false;
      return;
    }

    if (activePointers.size > 1 && this.loopCutSlidePointerId !== null) {
      this.loopCutSlidePointerId = null;
    }

    const slideBlockingOrbit =
      this.loopCutPreviewMode &&
      this.loopCutSlideActive &&
      activePointers.size === 1;

    const touchCfg = this.settings?.touch ?? DEFAULT_TOUCH_SETTINGS;
    const hasTouch = Array.from(activePointers.values()).some(
      (p) => p.pointerType === 'touch',
    );
    if (!hasTouch) {
      this.orbitControls.enabled = !this.isGizmoDragging;
      this.orbitControls.enableRotate = !slideBlockingOrbit;
      this.orbitControls.enableZoom = true;
      this.orbitControls.enablePan = true;
      return;
    }

    this.orbitControls.enableRotate = !slideBlockingOrbit && touchCfg.oneFingerOrbit;
    this.orbitControls.enableZoom = touchCfg.twoFingerPinchZoom;
    this.orbitControls.enablePan = touchCfg.twoFingerPan;
    this.orbitControls.enabled = !this.isGizmoDragging;
  }

  private handleLongPressContext(
    clientX: number,
    clientY: number,
    pointerType: string,
  ): void {
    if (this.loopCutPreviewMode) return;
    this.suppressOrbitForContextPress = true;
    this.orbitControls.enabled = false;

    if (this.workMode === 'object') {
      const hitObjectId = this.hitTestObject(clientX, clientY, pointerType);
      this.callbacks.onOpenContextMenu({
        clientX,
        clientY,
        hitObjectId,
        hitComponentId: null,
      });
    } else {
      const hitComponentId = this.hitTestEditComponent(
        clientX,
        clientY,
        pointerType,
      );
      this.callbacks.onOpenContextMenu({
        clientX,
        clientY,
        hitObjectId: this.selectedObjectId,
        hitComponentId,
      });
    }
  }

  private hitTestObject(
    clientX: number,
    clientY: number,
    pointerType: string,
  ): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.activeCamera);

    const solidTargets: THREE.Object3D[] = [];
    const wireTargets: THREE.Object3D[] = [];
    const wireframeOnly = this.displayMode === 'wireframe';
    for (const visual of this.visuals.values()) {
      if (!visual.group.visible || visual.locked) continue;
      if (visual.objectType === 'reference_image' && visual.refPlaneMesh) {
        solidTargets.push(visual.refPlaneMesh);
      } else if (!wireframeOnly && visual.hasFaces) {
        solidTargets.push(visual.solidMesh);
      } else {
        wireTargets.push(visual.wireEdges);
      }
    }

    const solidHits = this.raycaster.intersectObjects(solidTargets, false);
    this.raycaster.params.Line.threshold = pointerType === 'touch' ? 0.35 : 0.2;
    const wireHits = this.raycaster.intersectObjects(wireTargets, false);

    let bestHit: { id: string; distance: number } | null = null;
    if (solidHits.length > 0) {
      const id = solidHits[0].object.userData.objectId as string;
      bestHit = { id, distance: solidHits[0].distance };
    }
    if (wireHits.length > 0) {
      const id = wireHits[0].object.userData.objectId as string;
      if (!bestHit || wireHits[0].distance < bestHit.distance) {
        bestHit = { id, distance: wireHits[0].distance };
      }
    }
    return bestHit ? bestHit.id : null;
  }

  private getEditBaseCollider(visual: ObjectVisual): THREE.Mesh | null {
    if (visual.baseEditableMesh.faces.length === 0) return null;
    if (visual.hasActiveModifiers) {
      visual.group.updateMatrixWorld(true);
      visual.baseSolidCollider.matrixWorld.copy(visual.group.matrixWorld);
      return visual.baseSolidCollider;
    }
    return visual.solidMesh;
  }

  private hitTestEditComponent(
    clientX: number,
    clientY: number,
    pointerType: string,
  ): string | null {
    if (!this.selectedObjectId) return null;
    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) return null;

    const baseMesh = visual.baseEditableMesh;
    const baseCollider = this.getEditBaseCollider(visual);

    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const tapPxX = clientX - rect.left;
    const tapPxY = clientY - rect.top;

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.activeCamera);

    if (!this.loopCutPreviewMode && this.editSelectionMode === 'face') {
      if (!baseCollider) return null;
      const hits = this.raycaster.intersectObject(baseCollider, false);
      if (hits.length > 0 && hits[0].faceIndex != null) {
        return visual.baseTriangleToFaceId[hits[0].faceIndex] ?? null;
      }
      return null;
    }

    const xray = this.isXraySelectionActive();
    const camPos = this.activeCamera.position;
    const targetDist = Math.max(1, camPos.distanceTo(this.orbitControls.target));
    const hitRadius = pointerType === 'touch' ? 26 : 15;
    visual.group.updateMatrixWorld(true);

    const isOccluded = (worldPoint: THREE.Vector3): boolean => {
      if (xray || !baseCollider) return false;
      const projected = _v2.copy(worldPoint).project(this.activeCamera);
      this.raycaster.setFromCamera(
        new THREE.Vector2(projected.x, projected.y),
        this.activeCamera,
      );
      const distToPoint = this.raycaster.ray.origin.distanceTo(worldPoint);
      const hits = this.raycaster.intersectObject(baseCollider, false);
      if (hits.length > 0 && hits[0].distance < distToPoint - 0.06) {
        return true;
      }
      return false;
    };

    if (!this.loopCutPreviewMode && this.editSelectionMode === 'vertex') {
      let bestId: string | null = null;
      let bestScore = Infinity;

      for (const v of baseMesh.vertices) {
        _v0
          .set(v.position[0], v.position[1], v.position[2])
          .applyMatrix4(visual.group.matrixWorld);
        const worldPos = _v0.clone();
        _v1.copy(worldPos).project(this.activeCamera);
        if (_v1.z < -1 || _v1.z > 1) continue;

        const sx = ((_v1.x + 1) / 2) * rect.width;
        const sy = ((-_v1.y + 1) / 2) * rect.height;
        const pxDist = Math.hypot(sx - tapPxX, sy - tapPxY);
        if (pxDist > hitRadius) continue;
        if (isOccluded(worldPos)) continue;

        const camDist = worldPos.distanceTo(camPos);
        const score = pxDist + (camDist / targetDist) * 2.0;
        if (score < bestScore) {
          bestScore = score;
          bestId = v.id;
        }
      }
      return bestId;
    }

    if (this.loopCutPreviewMode || this.editSelectionMode === 'edge') {
      let bestId: string | null = null;
      let bestScore = Infinity;

      for (const edge of baseMesh.edges) {
        const va = baseMesh.getVertex(edge.v0);
        const vb = baseMesh.getVertex(edge.v1);
        if (!va || !vb) continue;

        const wa = new THREE.Vector3(...va.position).applyMatrix4(
          visual.group.matrixWorld,
        );
        const wb = new THREE.Vector3(...vb.position).applyMatrix4(
          visual.group.matrixWorld,
        );

        const pa = wa.clone().project(this.activeCamera);
        const pb = wb.clone().project(this.activeCamera);
        if (pa.z > 1 && pb.z > 1) continue;

        const ax = ((pa.x + 1) / 2) * rect.width;
        const ay = ((-pa.y + 1) / 2) * rect.height;
        const bx = ((pb.x + 1) / 2) * rect.width;
        const by = ((-pb.y + 1) / 2) * rect.height;

        const { dist, t } = distToSegment2D(tapPxX, tapPxY, ax, ay, bx, by);
        if (dist > hitRadius) continue;

        const sampleWorld = wa.clone().lerp(wb, t);
        if (isOccluded(sampleWorld)) continue;

        const camDist = sampleWorld.distanceTo(camPos);
        const score = dist + (camDist / targetDist) * 2.0;
        if (score < bestScore) {
          bestScore = score;
          bestId = edge.id;
        }
      }
      return bestId;
    }

    return null;
  }

  private mergeModifiers(modifiers: TouchModifierState): TouchModifierState {
    return {
      shift: modifiers.shift || this.virtualModifiers.shift,
      ctrl: modifiers.ctrl || this.virtualModifiers.ctrl,
      alt: modifiers.alt || this.virtualModifiers.alt,
    };
  }

  private isBoxSelectAdditive(
    modifiers: TouchModifierState,
    shiftKey = false,
  ): boolean {
    const effective = this.mergeModifiers(modifiers);
    return (
      Boolean(this.settings?.multiSelectTouch) ||
      effective.shift ||
      shiftKey
    );
  }

  private toCanvasBoxRect(rect: BoxSelectRect): {
    canvasRect: Rect2D;
    overlay: { left: number; top: number; width: number; height: number };
    width: number;
    height: number;
  } {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const minX = Math.max(0, Math.min(bounds.width, rect.minX - bounds.left));
    const maxX = Math.max(0, Math.min(bounds.width, rect.maxX - bounds.left));
    const minY = Math.max(0, Math.min(bounds.height, rect.minY - bounds.top));
    const maxY = Math.max(0, Math.min(bounds.height, rect.maxY - bounds.top));
    return {
      canvasRect: { minX, minY, maxX, maxY },
      overlay: {
        left: minX,
        top: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      },
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    };
  }

  private queryObjectsInBox(rect: BoxSelectRect): string[] {
    const { canvasRect, width, height } = this.toCanvasBoxRect(rect);
    if (canvasRect.maxX - canvasRect.minX < 2 && canvasRect.maxY - canvasRect.minY < 2) {
      return [];
    }
    this.activeCamera.updateMatrixWorld(true);
    const matched: string[] = [];

    const projectVec = (v: THREE.Vector3) => {
      const p = v.clone().project(this.activeCamera);
      return {
        x: ((p.x + 1) / 2) * width,
        y: ((-p.y + 1) / 2) * height,
        inFront: p.z >= -1 && p.z <= 1,
      };
    };

    for (const visual of this.visuals.values()) {
      if (!visual.group.visible || visual.locked) continue;
      visual.group.updateMatrixWorld(true);

      if (visual.objectType === 'reference_image' && visual.refPlaneMesh) {
        const posAttr = visual.refPlaneMesh.geometry.getAttribute('position');
        if (!posAttr) continue;
        const pts: { x: number; y: number; inFront: boolean }[] = [];
        let hit = false;
        for (let i = 0; i < posAttr.count; i++) {
          const wv = new THREE.Vector3(
            posAttr.getX(i),
            posAttr.getY(i),
            posAttr.getZ(i),
          ).applyMatrix4(visual.group.matrixWorld);
          const pr = projectVec(wv);
          pts.push(pr);
          if (pr.inFront && isPointInRect2D(pr, canvasRect)) {
            hit = true;
            break;
          }
        }
        if (!hit && pts.length >= 4) {
          const corners = [0, 1, 2, 3].map((idx) => pts[idx]);
          if (
            triangleIntersectsRect2D(corners[0], corners[1], corners[2], canvasRect) ||
            triangleIntersectsRect2D(corners[1], corners[3], corners[2], canvasRect)
          ) {
            hit = true;
          }
        }
        if (hit) matched.push(visual.id);
        continue;
      }

      const mesh = visual.editableMesh;
      const vertProjMap = new Map<
        string,
        { x: number; y: number; inFront: boolean }
      >();
      let hit = false;

      // 1. Vertex inside box (fast early accept)
      for (const v of mesh.vertices) {
        const wv = new THREE.Vector3(...v.position).applyMatrix4(
          visual.group.matrixWorld,
        );
        const pr = projectVec(wv);
        vertProjMap.set(v.id, pr);
        if (pr.inFront && isPointInRect2D(pr, canvasRect)) {
          hit = true;
          break;
        }
      }

      // 2. Any mesh edge crossing box
      if (!hit) {
        for (const edge of mesh.edges) {
          const pa = vertProjMap.get(edge.v0);
          const pb = vertProjMap.get(edge.v1);
          if (!pa || !pb || (!pa.inFront && !pb.inFront)) continue;
          if (segmentIntersectsRect2D(pa, pb, canvasRect)) {
            hit = true;
            break;
          }
        }
      }

      // 3. Any face triangle intersecting / enclosing box (handles zoom-in inside a face)
      if (!hit && visual.hasFaces) {
        const posAttr = visual.solidMesh.geometry.getAttribute('position');
        if (posAttr) {
          for (let ti = 0; ti + 2 < posAttr.count; ti += 3) {
            const wa = new THREE.Vector3(
              posAttr.getX(ti),
              posAttr.getY(ti),
              posAttr.getZ(ti),
            ).applyMatrix4(visual.group.matrixWorld);
            const wb = new THREE.Vector3(
              posAttr.getX(ti + 1),
              posAttr.getY(ti + 1),
              posAttr.getZ(ti + 1),
            ).applyMatrix4(visual.group.matrixWorld);
            const wc = new THREE.Vector3(
              posAttr.getX(ti + 2),
              posAttr.getY(ti + 2),
              posAttr.getZ(ti + 2),
            ).applyMatrix4(visual.group.matrixWorld);
            const pa = projectVec(wa);
            const pb = projectVec(wb);
            const pc = projectVec(wc);
            if (!pa.inFront && !pb.inFront && !pc.inFront) continue;
            if (triangleIntersectsRect2D(pa, pb, pc, canvasRect)) {
              hit = true;
              break;
            }
          }
        }
      }

      if (hit) matched.push(visual.id);
    }

    return matched;
  }

  private queryEditComponentsInBox(rect: BoxSelectRect): string[] {
    if (!this.selectedObjectId || this.loopCutPreviewMode) return [];
    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) return [];

    const { canvasRect, width, height } = this.toCanvasBoxRect(rect);
    if (canvasRect.maxX - canvasRect.minX < 2 && canvasRect.maxY - canvasRect.minY < 2) {
      return [];
    }

    this.activeCamera.updateMatrixWorld(true);
    visual.group.updateMatrixWorld(true);
    const xray = this.isXraySelectionActive();
    const baseCollider = this.getEditBaseCollider(visual);

    const isOccluded = (worldPoint: THREE.Vector3): boolean => {
      if (xray || !baseCollider) return false;
      const projected = _v2.copy(worldPoint).project(this.activeCamera);
      this.raycaster.setFromCamera(
        new THREE.Vector2(projected.x, projected.y),
        this.activeCamera,
      );
      const distToPoint = this.raycaster.ray.origin.distanceTo(worldPoint);
      const hits = this.raycaster.intersectObject(baseCollider, false);
      return hits.length > 0 && hits[0].distance < distToPoint - 0.06;
    };

    const projectWorld = (wv: THREE.Vector3) => {
      const p = wv.clone().project(this.activeCamera);
      return {
        x: ((p.x + 1) / 2) * width,
        y: ((-p.y + 1) / 2) * height,
        inFront: p.z >= -1 && p.z <= 1,
      };
    };

    const matched: string[] = [];
    const mesh = visual.baseEditableMesh;

    if (this.editSelectionMode === 'vertex') {
      for (const v of mesh.vertices) {
        const wv = new THREE.Vector3(...v.position).applyMatrix4(
          visual.group.matrixWorld,
        );
        const pr = projectWorld(wv);
        if (!pr.inFront) continue;
        if (!isPointInRect2D(pr, canvasRect)) continue;
        if (isOccluded(wv)) continue;
        matched.push(v.id);
      }
      return matched;
    }

    if (this.editSelectionMode === 'edge') {
      for (const edge of mesh.edges) {
        const va = mesh.getVertex(edge.v0);
        const vb = mesh.getVertex(edge.v1);
        if (!va || !vb) continue;
        const wa = new THREE.Vector3(...va.position).applyMatrix4(
          visual.group.matrixWorld,
        );
        const wb = new THREE.Vector3(...vb.position).applyMatrix4(
          visual.group.matrixWorld,
        );
        const pa = projectWorld(wa);
        const pb = projectWorld(wb);
        if (!pa.inFront && !pb.inFront) continue;
        if (!segmentIntersectsRect2D(pa, pb, canvasRect)) continue;

        if (!xray && baseCollider) {
          // Visible if midpoint or either visible endpoint inside rect is not occluded
          const mid = wa.clone().lerp(wb, 0.5);
          const aIn = pa.inFront && isPointInRect2D(pa, canvasRect);
          const bIn = pb.inFront && isPointInRect2D(pb, canvasRect);
          const visible =
            !isOccluded(mid) ||
            (aIn && !isOccluded(wa)) ||
            (bIn && !isOccluded(wb));
          if (!visible) continue;
        }
        matched.push(edge.id);
      }
      return matched;
    }

    if (this.editSelectionMode === 'face' && baseCollider) {
      const posAttr = baseCollider.geometry.getAttribute('position');
      if (!posAttr) return [];

      for (const face of mesh.faces) {
        const range = visual.baseFaceToTriangleRange.get(face.id);
        if (!range) continue;

        let triIntersects = false;
        const startVert = range.start * 3;
        const endVert = (range.start + range.count) * 3;
        let visibleTriSample: THREE.Vector3 | null = null;

        for (let vi = startVert; vi + 2 < endVert; vi += 3) {
          const wa = new THREE.Vector3(
            posAttr.getX(vi),
            posAttr.getY(vi),
            posAttr.getZ(vi),
          ).applyMatrix4(visual.group.matrixWorld);
          const wb = new THREE.Vector3(
            posAttr.getX(vi + 1),
            posAttr.getY(vi + 1),
            posAttr.getZ(vi + 1),
          ).applyMatrix4(visual.group.matrixWorld);
          const wc = new THREE.Vector3(
            posAttr.getX(vi + 2),
            posAttr.getY(vi + 2),
            posAttr.getZ(vi + 2),
          ).applyMatrix4(visual.group.matrixWorld);

          const pa = projectWorld(wa);
          const pb = projectWorld(wb);
          const pc = projectWorld(wc);
          if (!pa.inFront && !pb.inFront && !pc.inFront) continue;
          if (triangleIntersectsRect2D(pa, pb, pc, canvasRect)) {
            triIntersects = true;
            if (!xray) {
              const triCenter = wa.clone().add(wb).add(wc).multiplyScalar(1 / 3);
              if (!isOccluded(triCenter)) {
                visibleTriSample = triCenter;
                break;
              }
            } else {
              break;
            }
          }
        }

        if (!triIntersects) continue;
        if (!xray && !visibleTriSample) {
          const fc = mesh.computeFaceCenter(face);
          const worldCenter = new THREE.Vector3(...fc).applyMatrix4(
            visual.group.matrixWorld,
          );
          if (isOccluded(worldCenter)) continue;
        }
        matched.push(face.id);
      }
      return matched;
    }

    return [];
  }

  private refreshBoxSelectPreviewVisuals(): void {
    if (this.workMode === 'object') {
      for (const visual of this.visuals.values()) {
        const objData = this.currentObjectsData.get(visual.id);
        const isSelected =
          this.selectedObjectIds.has(visual.id) ||
          this.boxSelectPreviewObjectIds.has(visual.id);
        if (visual.objectType === 'reference_image' && objData) {
          this.syncReferenceVisual(visual, objData, isSelected);
        } else {
          this.applyObjectDisplayMode(visual, isSelected, false);
        }
      }
    } else {
      this.syncEditModeOverlays();
    }
    this.requestRender();
  }

  private clearBoxSelectPreview(): void {
    const hadPreview =
      this.boxSelectPreviewObjectIds.size > 0 ||
      this.boxSelectPreviewComponentIds.size > 0;
    this.boxSelectPreviewObjectIds.clear();
    this.boxSelectPreviewComponentIds.clear();
    this.callbacks.onBoxSelectOverlayChange?.(null);
    if (hadPreview) {
      this.refreshBoxSelectPreviewVisuals();
    }
  }

  private handleBoxSelectMove(
    rect: BoxSelectRect,
    modifiers: TouchModifierState,
    shiftKey = false,
  ): void {
    const additive = this.isBoxSelectAdditive(modifiers, shiftKey);
    const { overlay } = this.toCanvasBoxRect(rect);

    if (this.workMode === 'object') {
      const ids = this.queryObjectsInBox(rect);
      this.boxSelectPreviewObjectIds = new Set(ids);
      this.boxSelectPreviewComponentIds.clear();
      this.refreshBoxSelectPreviewVisuals();
      this.callbacks.onBoxSelectOverlayChange?.({
        ...overlay,
        matchCount: ids.length,
        additive,
      });
    } else {
      const ids = this.queryEditComponentsInBox(rect);
      this.boxSelectPreviewComponentIds = new Set(ids);
      this.boxSelectPreviewObjectIds.clear();
      this.refreshBoxSelectPreviewVisuals();
      this.callbacks.onBoxSelectOverlayChange?.({
        ...overlay,
        matchCount: ids.length,
        additive,
      });
    }
  }

  private handleBoxSelectEnd(
    rect: BoxSelectRect,
    modifiers: TouchModifierState,
    shiftKey = false,
  ): void {
    const additive = this.isBoxSelectAdditive(modifiers, shiftKey);
    const ids =
      this.workMode === 'object'
        ? this.queryObjectsInBox(rect)
        : this.queryEditComponentsInBox(rect);

    this.clearBoxSelectPreview();

    if (this.workMode === 'object') {
      this.callbacks.onBoxSelectObjects?.(ids, additive);
    } else {
      this.callbacks.onBoxSelectComponents?.(ids, additive);
    }
  }

  private performTapSelection(
    clientX: number,
    clientY: number,
    pointerType: string,
    additive: boolean,
    addOnly = false,
  ): void {
    if (this.workMode === 'object') {
      const hitId = this.hitTestObject(clientX, clientY, pointerType);
      this.callbacks.onSelectObject(hitId, additive);
      return;
    }

    const hitCompId = this.hitTestEditComponent(clientX, clientY, pointerType);
    if (this.loopCutPreviewMode) {
      if (hitCompId) {
        this.callbacks.onPickLoopCutEdge(hitCompId);
      }
    } else {
      this.callbacks.onSelectComponent(hitCompId, additive, addOnly);
    }
  }

  private handleGizmoDragStart(): void {
    if (!this.selectedObjectId) return;
    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) return;

    if (this.workMode === 'object') {
      const g = visual.group;
      this.objectDragStartTransform = {
        position: [g.position.x, g.position.y, g.position.z],
        rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
        scale: [g.scale.x, g.scale.y, g.scale.z],
      };
    } else {
      this.editDragStartMesh = visual.baseEditableMesh.clone();
      this.editDragStartVertexIds = visual.baseEditableMesh.getVertexIdsFromSelection(
        this.editSelectionMode,
        this.selectedComponentIds,
      );
      this.editDragStartVertexPositions.clear();
      for (const v of this.editDragStartMesh.vertices) {
        this.editDragStartVertexPositions.set(v.id, [...v.position]);
      }
      this.editGizmoAnchor.updateMatrixWorld(true);
      this.editDragStartAnchorPos.copy(this.editGizmoAnchor.position);
      this.editDragStartAnchorInv.copy(this.editGizmoAnchor.matrixWorld).invert();
      this.proportionalDragField = null;
      this.proportionalDragWeights.clear();
      this.proportionalDragRadiusUsed = -1;
      this.proportionalDragFalloffUsed = '';
      this.refreshProportionalDragWeights(true);
    }
  }

  private refreshProportionalDragWeights(forceRebuildField: boolean): void {
    if (
      !this.editDragStartMesh ||
      !this.selectedObjectId ||
      !this.proportionalSettings.enabled ||
      this.editDragStartVertexIds.size === 0
    ) {
      this.proportionalDragField = null;
      this.proportionalDragWeights.clear();
      return;
    }
    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) return;

    if (
      forceRebuildField ||
      !this.proportionalDragField ||
      this.proportionalDragConnectedUsed !== this.proportionalSettings.connectedOnly
    ) {
      this.proportionalDragField = buildProportionalDistanceField(
        this.editDragStartMesh,
        this.editSelectionMode,
        this.selectedComponentIds,
        {
          connectedOnly: this.proportionalSettings.connectedOnly,
          objectScale: [
            visual.group.scale.x,
            visual.group.scale.y,
            visual.group.scale.z,
          ],
        },
      );
      this.proportionalDragConnectedUsed = this.proportionalSettings.connectedOnly;
      this.proportionalDragRadiusUsed = -1;
    }

    if (
      this.proportionalDragRadiusUsed !== this.proportionalSettings.radius ||
      this.proportionalDragFalloffUsed !== this.proportionalSettings.falloff
    ) {
      this.proportionalDragWeights = computeProportionalWeights(
        this.proportionalDragField,
        this.proportionalSettings.radius,
        this.proportionalSettings.falloff,
      );
      this.proportionalDragRadiusUsed = this.proportionalSettings.radius;
      this.proportionalDragFalloffUsed = this.proportionalSettings.falloff;
    }
  }

  private getProportionalPreviewWeights(visual: ObjectVisual): Map<string, number> {
    if (
      this.workMode !== 'edit' ||
      !this.proportionalSettings.enabled ||
      this.selectedComponentIds.size === 0 ||
      this.loopCutPreviewMode
    ) {
      return new Map();
    }
    const sortedIds = Array.from(this.selectedComponentIds).sort().join(',');
    const key = `${visual.id}|${this.editSelectionMode}|${this.proportionalSettings.connectedOnly ? 1 : 0}|${sortedIds}|${visual.group.scale.x.toFixed(4)},${visual.group.scale.y.toFixed(4)},${visual.group.scale.z.toFixed(4)}`;

    if (
      !this.proportionalPreviewField ||
      this.proportionalPreviewKey !== key ||
      this.proportionalPreviewSourceMesh !== visual.baseEditableMesh
    ) {
      this.proportionalPreviewField = buildProportionalDistanceField(
        visual.baseEditableMesh,
        this.editSelectionMode,
        this.selectedComponentIds,
        {
          connectedOnly: this.proportionalSettings.connectedOnly,
          objectScale: [
            visual.group.scale.x,
            visual.group.scale.y,
            visual.group.scale.z,
          ],
        },
      );
      this.proportionalPreviewSourceMesh = visual.baseEditableMesh;
      this.proportionalPreviewKey = key;
      this.proportionalPreviewRadiusUsed = -1;
    }

    if (
      this.proportionalPreviewRadiusUsed !== this.proportionalSettings.radius ||
      this.proportionalPreviewFalloffUsed !== this.proportionalSettings.falloff
    ) {
      this.proportionalPreviewWeights = computeProportionalWeights(
        this.proportionalPreviewField,
        this.proportionalSettings.radius,
        this.proportionalSettings.falloff,
      );
      this.proportionalPreviewRadiusUsed = this.proportionalSettings.radius;
      this.proportionalPreviewFalloffUsed = this.proportionalSettings.falloff;
    }

    return this.proportionalPreviewWeights;
  }

  private handleGizmoObjectChange(): void {
    if (!this.isGizmoDragging || !this.selectedObjectId) return;
    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) return;

    if (this.workMode === 'object') {
      const g = visual.group;
      const liveTransform: ObjectTransform = {
        position: [g.position.x, g.position.y, g.position.z],
        rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
        scale: [g.scale.x, g.scale.y, g.scale.z],
      };
      this.callbacks.onLiveObjectTransform(this.selectedObjectId, liveTransform);

      // Update any scene objects referencing this object as a Mirror Object live
      this.sceneTransformRefs = this.sceneTransformRefs.map((ref) =>
        ref.id === this.selectedObjectId
          ? {
              id: ref.id,
              position: liveTransform.position,
              rotation: liveTransform.rotation,
              scale: liveTransform.scale,
            }
          : ref,
      );
      for (const other of this.visuals.values()) {
        if (!other.modifiers || other.modifiers.length === 0) continue;
        const refsDragged = other.modifiers.some(
          (m) =>
            m.enabled &&
            m.type === 'mirror' &&
            normalizeMirrorParams(m.params).mirrorObjectId ===
              this.selectedObjectId,
        );
        if (!refsDragged) continue;
        const ownerObj = this.currentObjectsData.get(other.id);
        if (!ownerObj) continue;
        const ownerRef: ModifierTransformRef = {
          id: ownerObj.id,
          position:
            ownerObj.id === this.selectedObjectId
              ? liveTransform.position
              : ownerObj.transform.position,
          rotation:
            ownerObj.id === this.selectedObjectId
              ? liveTransform.rotation
              : ownerObj.transform.rotation,
          scale:
            ownerObj.id === this.selectedObjectId
              ? liveTransform.scale
              : ownerObj.transform.scale,
        };
        const evalRes = evaluateObjectModifiers(ownerObj.mesh, other.modifiers, {
          ownerTransform: ownerRef,
          sceneTransformRefs: this.sceneTransformRefs,
        });
        other.hasActiveModifiers = evalRes.hasActiveModifiers;
        other.editableMesh = evalRes.hasActiveModifiers
          ? EditableMesh.fromJSON(evalRes.mesh)
          : other.baseEditableMesh;
        this.rebuildObjectGeometry(other);
      }
    } else if (this.editDragStartMesh) {
      // Recompute baseEditableMesh from dragStartMesh using delta matrix
      const nextMesh = this.editDragStartMesh.clone();
      this.editGizmoAnchor.updateMatrixWorld(true);
      visual.group.updateMatrixWorld(true);

      // deltaLocal = M_obj^-1 * deltaWorld * M_obj
      _mat4B.copy(visual.group.matrixWorld).invert();

      let affectedVertexIds: Set<string>;
      if (this.proportionalSettings.enabled) {
        this.refreshProportionalDragWeights(false);
        const deltaPosWorld = _v0.subVectors(
          this.editGizmoAnchor.position,
          this.editDragStartAnchorPos,
        );
        affectedVertexIds = applyProportionalWorldAnchorTransform(
          nextMesh,
          this.editDragStartMesh,
          this.proportionalDragWeights,
          {
            startAnchorWorld: this.editDragStartAnchorPos,
            deltaPosWorld,
            deltaQuatWorld: this.editGizmoAnchor.quaternion,
            deltaScaleWorld: this.editGizmoAnchor.scale,
            objectMatrixWorld: visual.group.matrixWorld,
            objectMatrixWorldInv: _mat4B,
          },
        );
      } else {
        // deltaWorld = M_anchor_curr * M_anchor_start^-1
        _mat4A.multiplyMatrices(
          this.editGizmoAnchor.matrixWorld,
          this.editDragStartAnchorInv,
        );
        _mat4C.multiplyMatrices(_mat4B, _mat4A);
        _mat4C.multiply(visual.group.matrixWorld);
        applyTransformToVertices(
          nextMesh,
          this.editDragStartVertexIds,
          _mat4C,
          [0, 0, 0],
        );
        affectedVertexIds = this.editDragStartVertexIds;
      }

      const ownerObj = this.currentObjectsData.get(visual.id);
      const ownerRef: ModifierTransformRef | undefined = ownerObj
        ? {
            id: ownerObj.id,
            position: ownerObj.transform.position,
            rotation: ownerObj.transform.rotation,
            scale: ownerObj.transform.scale,
          }
        : undefined;

      if (visual.modifiers.length > 0) {
        clampVerticesForMirrorClipping(
          nextMesh,
          affectedVertexIds,
          this.editDragStartVertexPositions,
          visual.modifiers,
          ownerRef,
          this.sceneTransformRefs,
        );
      }

      visual.baseEditableMesh = nextMesh;
      if (hasActiveViewportModifiers(visual.modifiers)) {
        const evalRes = evaluateObjectModifiers(nextMesh.toJSON(), visual.modifiers, {
          ownerTransform: ownerRef,
          sceneTransformRefs: this.sceneTransformRefs,
        });
        visual.hasActiveModifiers = evalRes.hasActiveModifiers;
        visual.editableMesh = evalRes.hasActiveModifiers
          ? EditableMesh.fromJSON(evalRes.mesh)
          : nextMesh;
      } else {
        visual.hasActiveModifiers = false;
        visual.editableMesh = nextMesh;
      }
      visual.lastMeshData = null;
      this.rebuildObjectGeometry(visual);
      this.syncEditModeOverlays();
    }
  }

  private handleGizmoDragEnd(): void {
    if (!this.selectedObjectId) return;
    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) return;

    if (this.workMode === 'object' && this.objectDragStartTransform) {
      const g = visual.group;
      const after: ObjectTransform = {
        position: [g.position.x, g.position.y, g.position.z],
        rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
        scale: [g.scale.x, g.scale.y, g.scale.z],
      };
      this.callbacks.onCommitObjectTransform(
        this.selectedObjectId,
        this.objectDragStartTransform,
        after,
      );
      this.objectDragStartTransform = null;
    } else if (this.workMode === 'edit' && this.editDragStartMesh) {
      const before = this.editDragStartMesh;
      const after = visual.baseEditableMesh.clone();
      this.editDragStartMesh = null;
      this.editDragStartVertexPositions.clear();
      this.proportionalDragField = null;
      this.proportionalDragWeights.clear();
      this.proportionalPreviewField = null;
      this.callbacks.onCommitMeshEdit(this.selectedObjectId, before, after);
      this.syncGizmoAttachment();
    }
  }

  private buildModifiersSignature(
    objData: SceneObjectData,
    transformRefs: ModifierTransformRef[],
  ): string {
    const mods = objData.modifiers ?? [];
    if (mods.length === 0) return '';
    const refMap = new Map(transformRefs.map((r) => [r.id, r]));
    const refTransforms: ModifierTransformRef[] = [];
    let needsOwner = false;
    for (const m of mods) {
      if (!m.enabled || m.showInViewport === false) continue;
      if (m.type === 'mirror') {
        const p = normalizeMirrorParams(m.params);
        if (p.mirrorObjectId) {
          needsOwner = true;
          const targetRef = refMap.get(p.mirrorObjectId);
          if (targetRef) refTransforms.push(targetRef);
        }
      }
    }
    return JSON.stringify({
      mods,
      owner: needsOwner ? objData.transform : null,
      refs: refTransforms,
    });
  }

  public syncScene(params: {
    objects: SceneObjectData[];
    selectedObjectId: string | null;
    selectedObjectIds?: Set<string>;
    workMode: WorkMode;
    editSelectionMode: EditSelectionMode;
    selectedComponentIds: Set<string>;
    activeTool: TransformTool;
    axisConstraint: AxisConstraint;
    projection: CameraProjection;
    settings: ModelerSettings;
    meshRevision: number;
    suppressGizmo?: boolean;
    virtualModifiers?: TouchModifierState;
    loopCutPreviewMode?: boolean;
    loopCutPreviewSegments?: [Vec3, Vec3][];
    loopCutPreviewRingEdgeIds?: string[];
    loopCutPreviewFaceIds?: string[];
    loopCutSlideActive?: boolean;
  }): void {
    this.virtualModifiers = params.virtualModifiers
      ? { ...params.virtualModifiers }
      : { ...EMPTY_MODIFIER_STATE };
    this.selectedObjectId = params.selectedObjectId;
    const nextSelObjs = new Set<string>(
      params.selectedObjectIds ? Array.from(params.selectedObjectIds) : [],
    );
    if (params.selectedObjectId) nextSelObjs.add(params.selectedObjectId);
    this.selectedObjectIds = nextSelObjs;
    this.currentObjectsData = new Map(params.objects.map((o) => [o.id, o]));
    this.sceneTransformRefs = buildTransformRefsFromObjects(params.objects);

    this.workMode = params.workMode;
    this.editSelectionMode = params.editSelectionMode;
    this.selectedComponentIds = new Set(params.selectedComponentIds);
    this.activeTool = params.activeTool;
    this.axisConstraint = params.axisConstraint;
    this.settings = params.settings;
    const prevProp = this.proportionalSettings;
    const nextProp = normalizeProportionalSettings(
      params.settings.proportionalEditing,
    );
    const propChanged =
      prevProp.enabled !== nextProp.enabled ||
      Math.abs(prevProp.radius - nextProp.radius) > 1e-6 ||
      prevProp.falloff !== nextProp.falloff ||
      prevProp.connectedOnly !== nextProp.connectedOnly;
    this.proportionalSettings = nextProp;
    this.displayMode =
      params.settings.displayMode === 'material'
        ? 'solid'
        : (params.settings.displayMode ?? 'solid');
    this.xrayTransparency = Math.max(
      10,
      Math.min(90, params.settings.xrayTransparency ?? 50),
    );
    this.showFaceOrientation = Boolean(params.settings.showFaceOrientation);
    this.gestureManager.updateConfig(params.settings.touch);
    this.gestureManager.syncWorkMode(params.workMode);
    this.suppressGizmo = Boolean(params.suppressGizmo);
    this.loopCutPreviewMode = Boolean(params.loopCutPreviewMode);
    this.loopCutPreviewSegments = params.loopCutPreviewSegments ?? [];
    this.loopCutPreviewRingEdgeIds = new Set(
      params.loopCutPreviewRingEdgeIds ?? [],
    );
    this.loopCutPreviewFaceIds = new Set(params.loopCutPreviewFaceIds ?? []);
    this.loopCutSlideActive = Boolean(params.loopCutSlideActive);
    if (!this.loopCutPreviewMode || !this.loopCutSlideActive) {
      this.loopCutSlidePointerId = null;
      this.orbitControls.enableRotate = true;
    } else {
      this.orbitControls.enableRotate = false;
    }

    // Grid & Axes visibility
    this.gridHelper.visible = params.settings.showGrid;
    this.axesGroup.visible = params.settings.showAxes;

    // Projection switching
    if (this.projection !== params.projection) {
      this.switchProjection(params.projection);
    }

    // Reconcile objects
    const seen = new Set<string>();
    for (const objData of params.objects) {
      seen.add(objData.id);
      let visual = this.visuals.get(objData.id);
      if (!visual) {
        visual = this.createObjectVisual(objData);
        this.visuals.set(objData.id, visual);
        this.objectsGroup.add(visual.group);
      }

      visual.group.visible = objData.visible;
      visual.locked = objData.locked;

      // Update transform unless currently dragging this object in Object Mode
      if (!(this.isGizmoDragging && this.workMode === 'object' && this.selectedObjectId === objData.id)) {
        visual.group.position.set(...objData.transform.position);
        visual.group.rotation.set(...objData.transform.rotation);
        visual.group.scale.set(...objData.transform.scale);
      }

      const isSelected =
        this.selectedObjectIds.has(objData.id) ||
        this.boxSelectPreviewObjectIds.has(objData.id);

      // Update mesh geometry or reference image properties
      if (objData.objectType === 'reference_image' && objData.referenceImage) {
        this.syncReferenceVisual(visual, objData, isSelected);
      } else {
        if (!(this.isGizmoDragging && this.workMode === 'edit' && this.selectedObjectId === objData.id)) {
          const modSig = this.buildModifiersSignature(objData, this.sceneTransformRefs);
          if (
            visual.lastMeshData !== objData.mesh ||
            visual.group.userData.meshRevision !== params.meshRevision ||
            visual.modifiersSignature !== modSig
          ) {
            visual.modifiers = objData.modifiers ?? [];
            visual.modifiersSignature = modSig;
            visual.baseEditableMesh = EditableMesh.fromJSON(objData.mesh);
            visual.lastMeshData = objData.mesh;

            if (hasActiveViewportModifiers(visual.modifiers)) {
              const ownerRef: ModifierTransformRef = {
                id: objData.id,
                position: objData.transform.position,
                rotation: objData.transform.rotation,
                scale: objData.transform.scale,
              };
              const evalRes = evaluateObjectModifiers(objData.mesh, visual.modifiers, {
                ownerTransform: ownerRef,
                sceneTransformRefs: this.sceneTransformRefs,
              });
              visual.hasActiveModifiers = evalRes.hasActiveModifiers;
              visual.editableMesh = evalRes.hasActiveModifiers
                ? EditableMesh.fromJSON(evalRes.mesh)
                : visual.baseEditableMesh;
            } else {
              visual.hasActiveModifiers = false;
              visual.editableMesh = visual.baseEditableMesh;
            }

            this.rebuildObjectGeometry(visual);
            visual.group.userData.meshRevision = params.meshRevision;
          }
        }

        const inEditOnThis =
          objData.id === params.selectedObjectId && params.workMode === 'edit';
        this.applyObjectDisplayMode(visual, isSelected, inEditOnThis);
      }
    }

    // Remove deleted visuals
    for (const [id, visual] of this.visuals.entries()) {
      if (!seen.has(id)) {
        this.objectsGroup.remove(visual.group);
        this.disposeObjectVisual(visual);
        this.visuals.delete(id);
      }
    }

    if (
      propChanged &&
      this.isGizmoDragging &&
      this.workMode === 'edit' &&
      this.editDragStartMesh
    ) {
      this.refreshProportionalDragWeights(false);
      this.handleGizmoObjectChange();
    } else {
      this.syncEditModeOverlays();
    }
    this.syncGizmoSettings();
    if (!this.isGizmoDragging) {
      this.syncGizmoAttachment();
    }

    this.requestRender();
  }

  private disposeObjectVisual(visual: ObjectVisual): void {
    visual.solidMesh.geometry.dispose();
    visual.solidMesh.material.dispose();
    visual.faceOrientationFrontMesh?.material.dispose();
    visual.faceOrientationBackMesh?.material.dispose();
    visual.wireEdges.geometry.dispose();
    visual.wireEdges.material.dispose();
    visual.baseSolidCollider.geometry.dispose();
    visual.baseSolidCollider.material.dispose();
    if (visual.refPlaneMesh) {
      visual.refPlaneMesh.geometry.dispose();
      visual.refPlaneMesh.material.dispose();
    }
    if (visual.refTexture) {
      visual.refTexture.dispose();
      visual.refTexture = null;
    }
  }

  private syncReferenceVisual(
    visual: ObjectVisual,
    objData: SceneObjectData,
    isSelected: boolean,
  ): void {
    const ref = objData.referenceImage;
    if (!ref || !visual.refPlaneMesh) return;

    const mat = visual.refPlaneMesh.material;
    mat.opacity = Math.max(0.05, Math.min(1, ref.opacity));
    const isFront = ref.depthMode === 'front';
    mat.depthTest = !isFront;
    visual.refPlaneMesh.renderOrder = isFront ? 10 : -1;

    visual.wireEdges.visible = true;
    visual.wireEdges.material.color.setHex(isSelected ? 0xff9900 : 0x525b6c);
    visual.wireEdges.material.depthTest = !isFront;
    visual.wireEdges.renderOrder = isFront ? 11 : 0;

    if (visual.refImageSrc !== ref.imageDataUrl) {
      visual.refImageSrc = ref.imageDataUrl;
      if (visual.refTexture) {
        visual.refTexture.dispose();
        visual.refTexture = null;
      }
      if (ref.imageDataUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(
          ref.imageDataUrl,
          (tex) => {
            if (this.disposed) {
              tex.dispose();
              return;
            }
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            tex.needsUpdate = true;
            visual.refTexture = tex;
            if (visual.refPlaneMesh) {
              visual.refPlaneMesh.material.map = tex;
              visual.refPlaneMesh.material.needsUpdate = true;
            }
            this.requestRender();
          },
          undefined,
          () => {
            this.requestRender();
          },
        );
      }
    }
  }

  private createObjectVisual(objData: SceneObjectData): ObjectVisual {
    const group = new THREE.Group();
    group.userData.objectId = objData.id;

    if (objData.objectType === 'reference_image' && objData.referenceImage) {
      const ref = objData.referenceImage;
      const aspect =
        ref.aspectRatio > 0
          ? ref.aspectRatio
          : ref.naturalWidth / Math.max(1, ref.naturalHeight);
      const baseSize = 4;
      const width = aspect >= 1 ? baseSize : baseSize * aspect;
      const height = aspect >= 1 ? baseSize / Math.max(0.05, aspect) : baseSize;

      const planeGeo = new THREE.PlaneGeometry(width, height);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: ref.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: ref.depthMode !== 'front',
      });
      const refPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
      refPlaneMesh.userData.objectId = objData.id;
      refPlaneMesh.renderOrder = ref.depthMode === 'front' ? 10 : -1;

      const hw = width / 2;
      const hh = height / 2;
      const borderGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, -hh, 0),
        new THREE.Vector3(hw, -hh, 0),
        new THREE.Vector3(hw, -hh, 0),
        new THREE.Vector3(hw, hh, 0),
        new THREE.Vector3(hw, hh, 0),
        new THREE.Vector3(-hw, hh, 0),
        new THREE.Vector3(-hw, hh, 0),
        new THREE.Vector3(-hw, -hh, 0),
      ]);
      const wireMat = new THREE.LineBasicMaterial({ color: 0x525b6c });
      const wireEdges = new THREE.LineSegments(borderGeo, wireMat);
      wireEdges.userData.objectId = objData.id;

      // Unused placeholder solidMesh so ObjectVisual contract stays uniform
      const dummySolid = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial(),
      );
      dummySolid.visible = false;

      const dummyCollider = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );

      group.add(refPlaneMesh, wireEdges);

      const visual: ObjectVisual = {
        id: objData.id,
        objectType: 'reference_image',
        group,
        solidMesh: dummySolid,
        faceOrientationFrontMesh: null,
        faceOrientationBackMesh: null,
        wireEdges,
        baseSolidCollider: dummyCollider,
        refPlaneMesh,
        refTexture: null,
        refImageSrc: null,
        triangleToFaceId: [],
        faceToTriangleRange: new Map(),
        baseTriangleToFaceId: [],
        baseFaceToTriangleRange: new Map(),
        baseEditableMesh: new EditableMesh(),
        editableMesh: new EditableMesh(),
        lastMeshData: null,
        modifiers: [],
        modifiersSignature: '',
        hasActiveModifiers: false,
        hasFaces: false,
        locked: objData.locked,
      };
      this.syncReferenceVisual(
        visual,
        objData,
        objData.id === this.selectedObjectId,
      );
      return visual;
    }

    const solidMat = new THREE.MeshStandardMaterial({
      color: objData.material.color,
      roughness: objData.material.roughness,
      metalness: objData.material.metalness,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const solidGeoInit = new THREE.BufferGeometry();
    const solidMesh = new THREE.Mesh(solidGeoInit, solidMat);
    solidMesh.castShadow = !this.isSoftwareGl;
    solidMesh.receiveShadow = true;
    solidMesh.userData.objectId = objData.id;

    const faceOrientationFrontMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      emissive: 0x0b2559,
      roughness: 0.62,
      metalness: 0.05,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const faceOrientationFrontMesh = new THREE.Mesh(
      solidGeoInit,
      faceOrientationFrontMat,
    );
    faceOrientationFrontMesh.visible = false;
    faceOrientationFrontMesh.userData.objectId = objData.id;

    const faceOrientationBackMat = new THREE.MeshStandardMaterial({
      color: 0xe03131,
      emissive: 0x5c0d0d,
      roughness: 0.62,
      metalness: 0.05,
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const faceOrientationBackMesh = new THREE.Mesh(
      solidGeoInit,
      faceOrientationBackMat,
    );
    faceOrientationBackMesh.visible = false;
    faceOrientationBackMesh.userData.objectId = objData.id;

    const wireMat = new THREE.LineBasicMaterial({
      color: 0xff9900,
    });
    const wireEdges = new THREE.LineSegments(new THREE.BufferGeometry(), wireMat);
    wireEdges.userData.objectId = objData.id;

    const baseSolidCollider = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );

    group.add(
      solidMesh,
      faceOrientationFrontMesh,
      faceOrientationBackMesh,
      wireEdges,
    );

    const baseMesh = EditableMesh.fromJSON(objData.mesh);
    const modifiers = objData.modifiers ?? [];
    let evalMesh = baseMesh;
    let hasActiveModifiers = false;
    if (hasActiveViewportModifiers(modifiers)) {
      const ownerRef: ModifierTransformRef = {
        id: objData.id,
        position: objData.transform.position,
        rotation: objData.transform.rotation,
        scale: objData.transform.scale,
      };
      const evalRes = evaluateObjectModifiers(objData.mesh, modifiers, {
        ownerTransform: ownerRef,
        sceneTransformRefs: this.sceneTransformRefs,
      });
      hasActiveModifiers = evalRes.hasActiveModifiers;
      if (hasActiveModifiers) {
        evalMesh = EditableMesh.fromJSON(evalRes.mesh);
      }
    }

    const visual: ObjectVisual = {
      id: objData.id,
      objectType: objData.objectType,
      group,
      solidMesh,
      faceOrientationFrontMesh,
      faceOrientationBackMesh,
      wireEdges,
      baseSolidCollider,
      refPlaneMesh: null,
      refTexture: null,
      refImageSrc: null,
      triangleToFaceId: [],
      faceToTriangleRange: new Map(),
      baseTriangleToFaceId: [],
      baseFaceToTriangleRange: new Map(),
      baseEditableMesh: baseMesh,
      editableMesh: evalMesh,
      lastMeshData: objData.mesh,
      modifiers,
      modifiersSignature: this.buildModifiersSignature(
        objData,
        this.sceneTransformRefs,
      ),
      hasActiveModifiers,
      hasFaces: evalMesh.faces.length > 0,
      locked: objData.locked,
    };

    this.rebuildObjectGeometry(visual);
    return visual;
  }

  private isXraySelectionActive(): boolean {
    return (
      this.displayMode === 'xray' ||
      this.displayMode === 'wireframe' ||
      Boolean(this.settings?.xrayEditMode)
    );
  }

  private applyObjectDisplayMode(
    visual: ObjectVisual,
    isSelected: boolean,
    inEditOnThis: boolean,
  ): void {
    const isWireframe = this.displayMode === 'wireframe';
    const isXray = this.displayMode === 'xray';
    const xrayOpacity = Math.max(
      0.05,
      Math.min(0.95, 1 - this.xrayTransparency / 100),
    );
    const faceOrientActive =
      this.showFaceOrientation &&
      visual.hasFaces &&
      visual.faceOrientationFrontMesh !== null &&
      visual.faceOrientationBackMesh !== null;

    const solidMat = visual.solidMesh.material;
    visual.solidMesh.visible =
      !faceOrientActive && !isWireframe && visual.hasFaces;
    visual.solidMesh.castShadow =
      !faceOrientActive && !isWireframe && !isXray && !this.isSoftwareGl;
    visual.solidMesh.receiveShadow = !faceOrientActive && !isWireframe && !isXray;
    visual.solidMesh.renderOrder = 0;

    if (solidMat.transparent !== isXray) {
      solidMat.transparent = isXray;
      solidMat.needsUpdate = true;
    }
    solidMat.opacity = isXray ? xrayOpacity : 1;
    solidMat.depthWrite = !isXray;
    solidMat.depthTest = true;
    solidMat.roughness = 0.58;
    solidMat.metalness = 0.06;
    solidMat.polygonOffset = true;
    solidMat.polygonOffsetFactor = 1;
    solidMat.polygonOffsetUnits = 1;
    // Solid & X-Ray always render with neutral studio grey (independent of object material)
    solidMat.color.set(
      inEditOnThis ? '#8b919c' : isSelected ? '#a9b1bc' : '#8c929d',
    );
    solidMat.emissive.setHex(
      !inEditOnThis && isSelected && !isWireframe ? 0x241605 : 0x000000,
    );

    if (visual.faceOrientationFrontMesh && visual.faceOrientationBackMesh) {
      visual.faceOrientationFrontMesh.visible = faceOrientActive;
      visual.faceOrientationBackMesh.visible = faceOrientActive;
      if (faceOrientActive) {
        const useTranslucent = isXray || isWireframe;
        const orientOpacity = isXray
          ? Math.max(0.18, xrayOpacity)
          : isWireframe
            ? 0.36
            : 1;
        const frontMat = visual.faceOrientationFrontMesh.material;
        const backMat = visual.faceOrientationBackMesh.material;
        if (frontMat.transparent !== useTranslucent) {
          frontMat.transparent = useTranslucent;
          frontMat.needsUpdate = true;
        }
        if (backMat.transparent !== useTranslucent) {
          backMat.transparent = useTranslucent;
          backMat.needsUpdate = true;
        }
        frontMat.opacity = orientOpacity;
        backMat.opacity = orientOpacity;
        frontMat.depthTest = true;
        backMat.depthTest = true;
        frontMat.depthWrite = !useTranslucent;
        backMat.depthWrite = !useTranslucent;
        visual.faceOrientationFrontMesh.renderOrder = useTranslucent ? 1 : 0;
        visual.faceOrientationBackMesh.renderOrder = useTranslucent ? 1 : 0;
      }
    }

    const wireMat = visual.wireEdges.material;
    if (inEditOnThis) {
      if (visual.hasActiveModifiers && (isWireframe || isXray)) {
        // Show evaluated modifier wireframe subtly while Edit Mode overlay draws the base control cage
        visual.wireEdges.visible = true;
        wireMat.color.setHex(0x8a95a8);
        if (!wireMat.transparent) {
          wireMat.transparent = true;
          wireMat.needsUpdate = true;
        }
        wireMat.opacity = isWireframe ? 0.48 : 0.34;
        wireMat.depthTest = !isXray;
        wireMat.depthWrite = false;
        visual.wireEdges.renderOrder = 2;
      } else {
        visual.wireEdges.visible = false; // Handled cleanly by editOverlayGroup
      }
      return;
    }

    if (isWireframe) {
      visual.wireEdges.visible = true;
      wireMat.color.setHex(isSelected ? 0xff9900 : 0x9aa3b2);
      const wireTransparent = !isSelected;
      if (wireMat.transparent !== wireTransparent) {
        wireMat.transparent = wireTransparent;
        wireMat.needsUpdate = true;
      }
      wireMat.opacity = isSelected ? 1 : 0.86;
      wireMat.depthTest = true;
      wireMat.depthWrite = false;
      visual.wireEdges.renderOrder = isSelected ? 4 : 2;
    } else if (isXray) {
      visual.wireEdges.visible = true;
      wireMat.color.setHex(
        isSelected ? 0xff9900 : visual.hasFaces ? 0x272d38 : 0xc0c6d0,
      );
      const wireTransparent = !isSelected && visual.hasFaces;
      if (wireMat.transparent !== wireTransparent) {
        wireMat.transparent = wireTransparent;
        wireMat.needsUpdate = true;
      }
      wireMat.opacity = isSelected ? 1 : visual.hasFaces ? 0.55 : 1;
      wireMat.depthTest = !isSelected && visual.hasFaces;
      wireMat.depthWrite = false;
      visual.wireEdges.renderOrder = isSelected ? 4 : 2;
    } else if (faceOrientActive) {
      // Keep face topology edges clearly legible on top of Blue/Red orientation colors
      visual.wireEdges.visible = true;
      wireMat.color.setHex(isSelected ? 0xff9900 : 0x14171f);
      const wireTransparent = !isSelected;
      if (wireMat.transparent !== wireTransparent) {
        wireMat.transparent = wireTransparent;
        wireMat.needsUpdate = true;
      }
      wireMat.opacity = isSelected ? 1 : 0.48;
      wireMat.depthTest = true;
      wireMat.depthWrite = false;
      visual.wireEdges.renderOrder = isSelected ? 4 : 2;
    } else {
      visual.wireEdges.visible = !visual.hasFaces || isSelected;
      wireMat.color.setHex(
        !visual.hasFaces ? (isSelected ? 0xff9900 : 0xc0c6d0) : 0xff9900,
      );
      const wireTransparent = isSelected;
      if (wireMat.transparent !== wireTransparent) {
        wireMat.transparent = wireTransparent;
        wireMat.needsUpdate = true;
      }
      wireMat.opacity = 1;
      wireMat.depthTest = true;
      wireMat.depthWrite = !isSelected;
      visual.wireEdges.renderOrder = isSelected ? 4 : 1;
    }
  }

  private rebuildObjectGeometry(visual: ObjectVisual): void {
    if (visual.objectType === 'reference_image') return;
    const mesh = visual.editableMesh;
    const triData = mesh.buildTriangulatedData();

    visual.hasFaces = triData.triangleToFaceId.length > 0;
    visual.triangleToFaceId = triData.triangleToFaceId;
    visual.faceToTriangleRange = triData.faceToTriangleRange;

    const solidGeo = new THREE.BufferGeometry();
    solidGeo.setAttribute('position', new THREE.BufferAttribute(triData.positions, 3));
    solidGeo.setAttribute('normal', new THREE.BufferAttribute(triData.normals, 3));
    if (triData.uvs) {
      solidGeo.setAttribute('uv', new THREE.BufferAttribute(triData.uvs, 2));
    }
    solidGeo.computeBoundingBox();
    solidGeo.computeBoundingSphere();

    visual.solidMesh.geometry.dispose();
    visual.solidMesh.geometry = solidGeo;
    if (visual.faceOrientationFrontMesh) {
      visual.faceOrientationFrontMesh.geometry = solidGeo;
    }
    if (visual.faceOrientationBackMesh) {
      visual.faceOrientationBackMesh.geometry = solidGeo;
    }
    const faceOrientActive =
      this.showFaceOrientation &&
      visual.hasFaces &&
      visual.faceOrientationFrontMesh !== null &&
      visual.faceOrientationBackMesh !== null;
    visual.solidMesh.visible =
      !faceOrientActive && visual.hasFaces && this.displayMode !== 'wireframe';
    if (visual.faceOrientationFrontMesh && visual.faceOrientationBackMesh) {
      visual.faceOrientationFrontMesh.visible = faceOrientActive;
      visual.faceOrientationBackMesh.visible = faceOrientActive;
    }

    // Topological edges
    const edgePositions = new Float32Array(mesh.edges.length * 6);
    let ptr = 0;
    for (const edge of mesh.edges) {
      const v0 = mesh.getVertex(edge.v0);
      const v1 = mesh.getVertex(edge.v1);
      if (!v0 || !v1) continue;
      edgePositions[ptr++] = v0.position[0];
      edgePositions[ptr++] = v0.position[1];
      edgePositions[ptr++] = v0.position[2];
      edgePositions[ptr++] = v1.position[0];
      edgePositions[ptr++] = v1.position[1];
      edgePositions[ptr++] = v1.position[2];
    }

    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(edgePositions.subarray(0, ptr), 3),
    );
    wireGeo.computeBoundingSphere();
    visual.wireEdges.geometry.dispose();
    visual.wireEdges.geometry = wireGeo;

    if (visual.hasActiveModifiers) {
      const baseTriData = visual.baseEditableMesh.buildTriangulatedData();
      visual.baseTriangleToFaceId = baseTriData.triangleToFaceId;
      visual.baseFaceToTriangleRange = baseTriData.faceToTriangleRange;
      const baseGeo = new THREE.BufferGeometry();
      baseGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(baseTriData.positions, 3),
      );
      baseGeo.computeBoundingBox();
      baseGeo.computeBoundingSphere();
      visual.baseSolidCollider.geometry.dispose();
      visual.baseSolidCollider.geometry = baseGeo;
    } else {
      visual.baseTriangleToFaceId = triData.triangleToFaceId;
      visual.baseFaceToTriangleRange = triData.faceToTriangleRange;
    }

    if (this.editOverlaySourceMesh === visual.baseEditableMesh) {
      this.editOverlaySourceMesh = null;
    }
  }

  private syncEditModeOverlays(): void {
    if (this.workMode !== 'edit' || !this.selectedObjectId) {
      this.editOverlayGroup.visible = false;
      this.editOverlaySourceMesh = null;
      this.proportionalRing.visible = false;
      this.proportionalRingVisible = false;
      return;
    }

    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual) {
      this.editOverlayGroup.visible = false;
      this.editOverlaySourceMesh = null;
      this.proportionalRing.visible = false;
      this.proportionalRingVisible = false;
      return;
    }

    this.editOverlayGroup.visible = true;
    visual.group.updateMatrixWorld(true);
    this.editOverlayGroup.matrixAutoUpdate = false;
    this.editOverlayGroup.matrix.copy(visual.group.matrixWorld);
    this.editOverlayGroup.matrixWorld.copy(visual.group.matrixWorld);

    // Edit Mode always renders interactive vertices/edges/faces from BASE topology only
    const mesh = visual.baseEditableMesh;
    const xray = this.isXraySelectionActive();
    const isWireframe = this.displayMode === 'wireframe';
    const isXrayMode = this.displayMode === 'xray';
    const highContrastLight =
      isWireframe || (isXrayMode && this.xrayTransparency > 35);

    // 1. All Base Cage Edges
    const allEdgesMat = this.editAllEdgesLine.material as THREE.LineBasicMaterial;
    allEdgesMat.depthTest = !xray;
    allEdgesMat.color.setHex(
      visual.hasActiveModifiers
        ? highContrastLight
          ? 0xf59e0b
          : 0x1e2430
        : highContrastLight
          ? 0xc8d0dc
          : 0x111317,
    );
    allEdgesMat.opacity = isWireframe ? 0.88 : isXrayMode ? 0.76 : 0.85;
    if (this.editOverlaySourceMesh !== mesh) {
      this.editAllEdgesLine.geometry.dispose();
      if (!visual.hasActiveModifiers) {
        this.editAllEdgesLine.geometry = visual.wireEdges.geometry.clone();
      } else {
        const baseEdgePositions = new Float32Array(mesh.edges.length * 6);
        let bPtr = 0;
        for (const edge of mesh.edges) {
          const v0 = mesh.getVertex(edge.v0);
          const v1 = mesh.getVertex(edge.v1);
          if (!v0 || !v1) continue;
          baseEdgePositions[bPtr++] = v0.position[0];
          baseEdgePositions[bPtr++] = v0.position[1];
          baseEdgePositions[bPtr++] = v0.position[2];
          baseEdgePositions[bPtr++] = v1.position[0];
          baseEdgePositions[bPtr++] = v1.position[1];
          baseEdgePositions[bPtr++] = v1.position[2];
        }
        const cageGeo = new THREE.BufferGeometry();
        cageGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(baseEdgePositions.subarray(0, bPtr), 3),
        );
        cageGeo.computeBoundingSphere();
        this.editAllEdgesLine.geometry = cageGeo;
      }
      this.editOverlaySourceMesh = mesh;
    }

    // Highlight selected + live box-select preview components in Edit Mode,
    // including coherent topology-derived edges, faces, and corner vertices
    const activeComponentIds = new Set<string>(this.selectedComponentIds);
    for (const id of this.boxSelectPreviewComponentIds) {
      activeComponentIds.add(id);
    }
    const derived = computeDerivedEditSelection(
      mesh,
      this.editSelectionMode,
      activeComponentIds,
    );

    // 2. Selected + Derived Edges (or traversed Loop Cut ring edges during preview)
    const showLoopRingHighlight =
      this.loopCutPreviewMode && this.loopCutPreviewRingEdgeIds.size > 0;
    const displayEdgeIds = this.loopCutPreviewMode
      ? showLoopRingHighlight
        ? this.loopCutPreviewRingEdgeIds
        : new Set<string>()
      : derived.edgeIds;
    const selEdgeCoords: number[] = [];
    const selEdgePairs: { a: Vec3; b: Vec3 }[] = [];
    for (const eid of displayEdgeIds) {
      const edge = mesh.getEdge(eid);
      if (!edge) continue;
      const v0 = mesh.getVertex(edge.v0);
      const v1 = mesh.getVertex(edge.v1);
      if (!v0 || !v1) continue;
      selEdgeCoords.push(...v0.position, ...v1.position);
      selEdgePairs.push({ a: v0.position, b: v1.position });
    }
    const selEdgeGeo = new THREE.BufferGeometry();
    selEdgeGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(selEdgeCoords, 3),
    );
    this.editSelectedEdgesLine.geometry.dispose();
    this.editSelectedEdgesLine.geometry = selEdgeGeo;
    (this.editSelectedEdgesLine.material as THREE.LineBasicMaterial).color.setHex(
      showLoopRingHighlight ? 0x0ea5e9 : 0xff9900,
    );
    this.editSelectedEdgesLine.visible = selEdgeCoords.length > 0;

    // Thick visible edge bars for selected edges (suppressed during Loop Cut preview so cyan cut lines lead visually)
    if (!this.loopCutPreviewMode && selEdgePairs.length > 0) {
      if (this.editSelectedEdgeBars.instanceMatrix.count < selEdgePairs.length) {
        const oldBar = this.editSelectedEdgeBars;
        this.editOverlayGroup.remove(oldBar);
        const nextBar = new THREE.InstancedMesh(
          oldBar.geometry,
          oldBar.material,
          Math.max(16, selEdgePairs.length * 2),
        );
        nextBar.frustumCulled = false;
        nextBar.renderOrder = 5;
        this.editSelectedEdgeBars = nextBar;
        this.editOverlayGroup.add(nextBar);
      }
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      const mid = new THREE.Vector3();
      const scaleVec = new THREE.Vector3();
      selEdgePairs.forEach((pair, idx) => {
        _v0.set(...pair.a);
        _v1.set(...pair.b);
        dir.subVectors(_v1, _v0);
        const len = dir.length();
        mid.addVectors(_v0, _v1).multiplyScalar(0.5);
        if (len > 1e-6) {
          dir.divideScalar(len);
          _quat.setFromUnitVectors(up, dir);
        } else {
          _quat.identity();
        }
        scaleVec.set(0.024, Math.max(len, 0.001), 0.024);
        _mat4A.compose(mid, _quat, scaleVec);
        this.editSelectedEdgeBars.setMatrixAt(idx, _mat4A);
      });
      this.editSelectedEdgeBars.count = selEdgePairs.length;
      this.editSelectedEdgeBars.instanceMatrix.needsUpdate = true;
      this.editSelectedEdgeBars.visible = true;
    } else {
      this.editSelectedEdgeBars.count = 0;
      this.editSelectedEdgeBars.visible = false;
    }

    // 3. Selected + Derived Faces Overlay (or Loop Cut traversed quad faces during preview)
    const showLoopFaceHighlight =
      this.loopCutPreviewMode && this.loopCutPreviewFaceIds.size > 0;
    const displayFaceIds = this.loopCutPreviewMode
      ? showLoopFaceHighlight
        ? this.loopCutPreviewFaceIds
        : new Set<string>()
      : derived.faceIds;
    const selFacePositions: number[] = [];
    if (displayFaceIds.size > 0) {
      const solidPos = (
        visual.hasActiveModifiers ? visual.baseSolidCollider : visual.solidMesh
      ).geometry.getAttribute('position');
      if (solidPos) {
        for (const fid of displayFaceIds) {
          const range = visual.baseFaceToTriangleRange.get(fid);
          if (!range) continue;
          const startVert = range.start * 3;
          const endVert = (range.start + range.count) * 3;
          for (let vi = startVert; vi < endVert; vi++) {
            selFacePositions.push(
              solidPos.getX(vi),
              solidPos.getY(vi),
              solidPos.getZ(vi),
            );
          }
        }
      }
    }
    const selFaceGeo = new THREE.BufferGeometry();
    selFaceGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(selFacePositions, 3),
    );
    this.editSelectedFacesMesh.geometry.dispose();
    this.editSelectedFacesMesh.geometry = selFaceGeo;
    this.editSelectedFacesMesh.visible = selFacePositions.length > 0;
    const selFacesMat = this.editSelectedFacesMesh
      .material as THREE.MeshBasicMaterial;
    selFacesMat.color.setHex(showLoopFaceHighlight ? 0x38bdf8 : 0xff9900);
    selFacesMat.depthTest = !xray;
    selFacesMat.opacity = showLoopFaceHighlight
      ? isWireframe
        ? 0.16
        : 0.22
      : isWireframe
        ? 0.28
        : isXrayMode
          ? 0.36
          : 0.42;

    // 4. Vertices Points (with Proportional Editing falloff weight gradient)
    const showUnselectedVertices =
      !this.loopCutPreviewMode && this.editSelectionMode === 'vertex';
    const propActive =
      this.proportionalSettings.enabled &&
      this.selectedComponentIds.size > 0 &&
      !this.loopCutPreviewMode;
    const activeWeights = propActive
      ? this.isGizmoDragging
        ? this.proportionalDragWeights
        : this.getProportionalPreviewWeights(visual)
      : null;

    const unselVerts: number[] = [];
    const unselColors: number[] = [];
    const selVerts: number[] = [];
    const baseColorR = highContrastLight ? 0.859 : 0.071;
    const baseColorG = highContrastLight ? 0.886 : 0.078;
    const baseColorB = highContrastLight ? 0.925 : 0.094;

    for (const v of mesh.vertices) {
      if (!this.loopCutPreviewMode && derived.vertexIds.has(v.id)) {
        selVerts.push(...v.position);
      } else {
        const w = activeWeights ? (activeWeights.get(v.id) ?? 0) : 0;
        if (showUnselectedVertices || w > 0) {
          unselVerts.push(...v.position);
          if (w > 0) {
            const [r, g, b] = sampleProportionalWeightColor(w);
            unselColors.push(r, g, b);
          } else {
            unselColors.push(baseColorR, baseColorG, baseColorB);
          }
        }
      }
    }

    const unselGeo = new THREE.BufferGeometry();
    unselGeo.setAttribute('position', new THREE.Float32BufferAttribute(unselVerts, 3));
    unselGeo.setAttribute('color', new THREE.Float32BufferAttribute(unselColors, 3));
    this.editUnselectedVerticesPoints.geometry.dispose();
    this.editUnselectedVerticesPoints.geometry = unselGeo;
    const unselVertMat = this.editUnselectedVerticesPoints
      .material as THREE.PointsMaterial;
    unselVertMat.depthTest = !xray;
    unselVertMat.color.setHex(0xffffff);
    this.editUnselectedVerticesPoints.visible = unselVerts.length > 0;

    const selVertGeo = new THREE.BufferGeometry();
    selVertGeo.setAttribute('position', new THREE.Float32BufferAttribute(selVerts, 3));
    this.editSelectedVerticesPoints.geometry.dispose();
    this.editSelectedVerticesPoints.geometry = selVertGeo;
    const selVertMat = this.editSelectedVerticesPoints
      .material as THREE.PointsMaterial;
    selVertMat.size = this.editSelectionMode === 'vertex' ? 14 : 11;
    this.editSelectedVerticesPoints.visible = selVerts.length > 0;

    this.syncProportionalRadiusRing(visual);

    // 5. Loop Cut Preview Ring Bars + Intersection Dots
    if (this.loopCutPreviewMode && this.loopCutPreviewSegments.length > 0) {
      const segs = this.loopCutPreviewSegments;
      if (this.loopCutPreviewBars.instanceMatrix.count < segs.length) {
        const oldLoop = this.loopCutPreviewBars;
        this.editOverlayGroup.remove(oldLoop);
        const nextLoop = new THREE.InstancedMesh(
          oldLoop.geometry,
          oldLoop.material,
          Math.max(32, segs.length * 2),
        );
        nextLoop.frustumCulled = false;
        nextLoop.renderOrder = 8;
        this.loopCutPreviewBars = nextLoop;
        this.editOverlayGroup.add(nextLoop);
      }

      let totalSegLen = 0;
      for (const pair of segs) {
        const dx = pair[1][0] - pair[0][0];
        const dy = pair[1][1] - pair[0][1];
        const dz = pair[1][2] - pair[0][2];
        totalSegLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const avgSegLen = totalSegLen / Math.max(1, segs.length);
      const barThickness = Math.max(0.005, Math.min(0.03, avgSegLen * 0.016));

      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      const mid = new THREE.Vector3();
      const scaleVec = new THREE.Vector3();
      const dotSeen = new Set<string>();
      const dotCoords: number[] = [];

      const pushDot = (p: Vec3) => {
        const key = `${p[0].toFixed(4)}|${p[1].toFixed(4)}|${p[2].toFixed(4)}`;
        if (dotSeen.has(key)) return;
        dotSeen.add(key);
        dotCoords.push(p[0], p[1], p[2]);
      };

      segs.forEach((pair, idx) => {
        _v0.set(...pair[0]);
        _v1.set(...pair[1]);
        dir.subVectors(_v1, _v0);
        const len = dir.length();
        mid.addVectors(_v0, _v1).multiplyScalar(0.5);
        if (len > 1e-6) {
          dir.divideScalar(len);
          _quat.setFromUnitVectors(up, dir);
        } else {
          _quat.identity();
        }
        scaleVec.set(barThickness, Math.max(len, 0.001), barThickness);
        _mat4A.compose(mid, _quat, scaleVec);
        this.loopCutPreviewBars.setMatrixAt(idx, _mat4A);
        pushDot(pair[0]);
        pushDot(pair[1]);
      });
      this.loopCutPreviewBars.count = segs.length;
      this.loopCutPreviewBars.instanceMatrix.needsUpdate = true;
      this.loopCutPreviewBars.visible = true;

      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(dotCoords, 3),
      );
      this.loopCutPreviewPoints.geometry.dispose();
      this.loopCutPreviewPoints.geometry = dotGeo;
      this.loopCutPreviewPoints.visible = dotCoords.length > 0;
    } else {
      this.loopCutPreviewBars.count = 0;
      this.loopCutPreviewBars.visible = false;
      this.loopCutPreviewPoints.visible = false;
    }
  }

  private syncProportionalRadiusRing(visual: ObjectVisual): void {
    if (
      this.workMode !== 'edit' ||
      !this.proportionalSettings.enabled ||
      this.loopCutPreviewMode ||
      this.selectedComponentIds.size === 0
    ) {
      this.proportionalRing.visible = false;
      this.proportionalRingVisible = false;
      return;
    }

    let hasCenter = false;
    if (this.isGizmoDragging && this.editDragStartMesh) {
      _v0.copy(this.editGizmoAnchor.position);
      hasCenter = true;
    } else {
      const vertIds = visual.baseEditableMesh.getVertexIdsFromSelection(
        this.editSelectionMode,
        this.selectedComponentIds,
      );
      const centroidLocal = visual.baseEditableMesh.computeCentroid(vertIds);
      if (centroidLocal) {
        visual.group.updateMatrixWorld(true);
        _v0
          .set(centroidLocal[0], centroidLocal[1], centroidLocal[2])
          .applyMatrix4(visual.group.matrixWorld);
        hasCenter = true;
      }
    }

    if (!hasCenter) {
      this.proportionalRing.visible = false;
      this.proportionalRingVisible = false;
      return;
    }

    this.proportionalRing.position.copy(_v0);
    this.proportionalRing.scale.setScalar(this.proportionalSettings.radius);
    this.proportionalRing.quaternion.copy(this.activeCamera.quaternion);
    this.proportionalRing.visible = true;
    this.proportionalRingVisible = true;
  }

  private syncGizmoSettings(): void {
    const modeMap: Record<TransformTool, 'translate' | 'rotate' | 'scale'> = {
      select: 'translate',
      move: 'translate',
      rotate: 'rotate',
      scale: 'scale',
    };
    this.transformControls.setMode(modeMap[this.activeTool]);
    this.transformControls.setSize(this.settings?.gizmoSize ?? 1.25);

    const c = this.axisConstraint;
    this.transformControls.showX = c === 'free' || c === 'x';
    this.transformControls.showY = c === 'free' || c === 'y';
    this.transformControls.showZ = c === 'free' || c === 'z';
    this.transformControls.showXY = c === 'free';
    this.transformControls.showYZ = c === 'free';
    this.transformControls.showXZ = c === 'free';
    this.transformControls.showE = c === 'free';
    this.transformControls.showXYZE = c === 'free';

    if (this.settings?.snapEnabled) {
      this.transformControls.setTranslationSnap(this.settings.snapTranslateStep);
      this.transformControls.setRotationSnap(
        THREE.MathUtils.degToRad(this.settings.snapRotateDeg),
      );
      this.transformControls.setScaleSnap(this.settings.snapScaleStep);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  private syncGizmoAttachment(): void {
    if (this.suppressGizmo || this.activeTool === 'select' || !this.selectedObjectId) {
      this.transformControls.detach();
      return;
    }

    const visual = this.visuals.get(this.selectedObjectId);
    if (!visual || !visual.group.visible || visual.locked) {
      this.transformControls.detach();
      return;
    }

    if (this.workMode === 'object') {
      this.transformControls.attach(visual.group);
      return;
    }

    // Edit Mode: attach to centroid of selected base vertices
    const vertIds = visual.baseEditableMesh.getVertexIdsFromSelection(
      this.editSelectionMode,
      this.selectedComponentIds,
    );
    if (vertIds.size === 0) {
      this.transformControls.detach();
      return;
    }

    const centroidLocal = visual.baseEditableMesh.computeCentroid(vertIds);
    if (!centroidLocal) {
      this.transformControls.detach();
      return;
    }

    visual.group.updateMatrixWorld(true);
    _v0
      .set(centroidLocal[0], centroidLocal[1], centroidLocal[2])
      .applyMatrix4(visual.group.matrixWorld);

    this.editGizmoAnchor.position.copy(_v0);
    this.editGizmoAnchor.quaternion.identity();
    this.editGizmoAnchor.scale.set(1, 1, 1);
    this.editGizmoAnchor.updateMatrixWorld(true);

    this.transformControls.attach(this.editGizmoAnchor);
  }

  public switchProjection(next: CameraProjection): void {
    if (this.projection === next) return;
    const prevCam = this.activeCamera;
    const target = this.orbitControls.target;
    const distance = prevCam.position.distanceTo(target);

    if (next === 'orthographic') {
      const aspect = Math.max(0.1, this.container.clientWidth / Math.max(1, this.container.clientHeight));
      const frustumHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2));
      this.orthographicCamera.left = (-frustumHeight * aspect) / 2;
      this.orthographicCamera.right = (frustumHeight * aspect) / 2;
      this.orthographicCamera.top = frustumHeight / 2;
      this.orthographicCamera.bottom = -frustumHeight / 2;
      this.orthographicCamera.zoom = 1;
      this.orthographicCamera.position.copy(this.perspectiveCamera.position);
      this.orthographicCamera.quaternion.copy(this.perspectiveCamera.quaternion);
      this.orthographicCamera.updateProjectionMatrix();
      this.activeCamera = this.orthographicCamera;
    } else {
      this.perspectiveCamera.position.copy(this.orthographicCamera.position);
      this.perspectiveCamera.quaternion.copy(this.orthographicCamera.quaternion);
      this.perspectiveCamera.updateProjectionMatrix();
      this.activeCamera = this.perspectiveCamera;
    }

    this.projection = next;
    this.orbitControls.object = this.activeCamera;
    this.transformControls.camera = this.activeCamera;
    this.orbitControls.update();
    this.emitCameraPose();
    this.requestRender();
  }

  public setCameraPreset(preset: CameraPreset): void {
    const target = this.orbitControls.target.clone();
    if (preset === 'focus') {
      if (this.selectedObjectId) {
        const visual = this.visuals.get(this.selectedObjectId);
        if (visual) {
          target.copy(visual.group.position);
        } else {
          target.set(0, 0, 0);
        }
      } else {
        target.set(0, 0, 0);
      }
    }

    const currentDist = Math.max(
      2.5,
      this.activeCamera.position.distanceTo(this.orbitControls.target),
    );
    const offsetTuple = computeCameraPresetOffset(preset, currentDist);
    const offset = new THREE.Vector3(...offsetTuple);

    const desiredPos = target.clone().add(offset);
    if (this.isSoftwareGl) {
      this.activeCamera.position.copy(desiredPos);
      this.orbitControls.target.copy(target);
      this.orbitControls.update();
      this.emitCameraPose();
      this.requestRender();
    } else {
      this.cameraAnimTargetPos = desiredPos;
      this.cameraAnimTargetLook = target;
      this.lastAnimTime = performance.now();
      this.requestRender();
    }
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;

    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const orthoHeight = this.orthographicCamera.top - this.orthographicCamera.bottom;
    this.orthographicCamera.left = (-orthoHeight * aspect) / 2;
    this.orthographicCamera.right = (orthoHeight * aspect) / 2;
    this.orthographicCamera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.requestRender();
  }

  public requestRender(): void {
    if (this.disposed) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;

    this.frameId = requestAnimationFrame(() => {
      if (this.disposed) return;
      this.renderDirty = false;

      // Advance damped camera preset transitions
      let animating = false;
      if (this.cameraAnimTargetPos && this.cameraAnimTargetLook) {
        const now = performance.now();
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastAnimTime) / 1000));
        this.lastAnimTime = now;
        const lambda = 11;

        this.activeCamera.position.x = THREE.MathUtils.damp(
          this.activeCamera.position.x,
          this.cameraAnimTargetPos.x,
          lambda,
          dt,
        );
        this.activeCamera.position.y = THREE.MathUtils.damp(
          this.activeCamera.position.y,
          this.cameraAnimTargetPos.y,
          lambda,
          dt,
        );
        this.activeCamera.position.z = THREE.MathUtils.damp(
          this.activeCamera.position.z,
          this.cameraAnimTargetPos.z,
          lambda,
          dt,
        );

        this.orbitControls.target.x = THREE.MathUtils.damp(
          this.orbitControls.target.x,
          this.cameraAnimTargetLook.x,
          lambda,
          dt,
        );
        this.orbitControls.target.y = THREE.MathUtils.damp(
          this.orbitControls.target.y,
          this.cameraAnimTargetLook.y,
          lambda,
          dt,
        );
        this.orbitControls.target.z = THREE.MathUtils.damp(
          this.orbitControls.target.z,
          this.cameraAnimTargetLook.z,
          lambda,
          dt,
        );

        if (
          this.activeCamera.position.distanceTo(this.cameraAnimTargetPos) < 0.01 &&
          this.orbitControls.target.distanceTo(this.cameraAnimTargetLook) < 0.01
        ) {
          this.activeCamera.position.copy(this.cameraAnimTargetPos);
          this.orbitControls.target.copy(this.cameraAnimTargetLook);
          this.cameraAnimTargetPos = null;
          this.cameraAnimTargetLook = null;
        } else {
          animating = true;
        }
      }

      const controlsMoved = this.orbitControls.update();
      this.emitCameraPose();
      if (this.proportionalRingVisible) {
        this.proportionalRing.quaternion.copy(this.activeCamera.quaternion);
      }
      this.renderer.render(this.scene, this.activeCamera);

      const done = () => {
        this.renderBusy = false;
        if (this.renderDirty || animating || controlsMoved) {
          this.requestRender();
        }
      };

      if (this.isSoftwareGl) {
        this.afterDraw(done);
      } else {
        done();
      }
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();

    const dom = this.renderer.domElement;
    this.gestureManager.dispose();
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    dom.removeEventListener('wheel', this.onViewportWheel);
    dom.removeEventListener('pointerdown', this.onLoopCutSlidePointerDown);
    dom.removeEventListener('pointermove', this.onLoopCutSlidePointerMove);
    dom.removeEventListener('pointerup', this.onLoopCutSlidePointerUp);
    dom.removeEventListener('pointercancel', this.onLoopCutSlidePointerUp);

    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.vertexDotTexture.dispose();
    this.loopCutPreviewPoints.geometry.dispose();
    (this.loopCutPreviewPoints.material as THREE.Material).dispose();
    this.loopCutPreviewBars.geometry.dispose();
    (this.loopCutPreviewBars.material as THREE.Material).dispose();
    this.proportionalRing.geometry.dispose();
    (this.proportionalRing.material as THREE.Material).dispose();

    for (const visual of this.visuals.values()) {
      this.disposeObjectVisual(visual);
    }
    this.visuals.clear();

    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}

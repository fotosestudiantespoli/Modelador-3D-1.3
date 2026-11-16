import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Rotate3d } from 'lucide-react';
import * as THREE from 'three';
import {
  CameraPreset,
  CameraQuaternionTuple,
} from '../engine/ViewportEngine';

export interface AxisGizmoHandle {
  updateOrientation: (quaternion: CameraQuaternionTuple) => void;
}

export interface ProjectedAxisTip {
  id: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
  label: string;
  color: string;
  positive: boolean;
  preset: Exclude<CameraPreset, 'iso' | 'focus'>;
  oppositePreset: Exclude<CameraPreset, 'iso' | 'focus'>;
  /** Projected unit components in camera space: vx right, vy up, vz toward viewer */
  vx: number;
  vy: number;
  vz: number;
  /** Canvas coordinates */
  sx: number;
  sy: number;
  /** Whether the projected stem length warrants drawing an axis line */
  drawLine: boolean;
  /** Circle radius in CSS pixels */
  radius: number;
}

interface AxisSpec {
  id: ProjectedAxisTip['id'];
  dir: [number, number, number];
  label: string;
  color: string;
  positive: boolean;
  preset: Exclude<CameraPreset, 'iso' | 'focus'>;
  oppositePreset: Exclude<CameraPreset, 'iso' | 'focus'>;
}

const AXIS_SPECS: AxisSpec[] = [
  {
    id: 'x+',
    dir: [1, 0, 0],
    label: 'X',
    color: '#e05252',
    positive: true,
    preset: 'right',
    oppositePreset: 'left',
  },
  {
    id: 'x-',
    dir: [-1, 0, 0],
    label: '-X',
    color: '#e05252',
    positive: false,
    preset: 'left',
    oppositePreset: 'right',
  },
  {
    id: 'y+',
    dir: [0, 1, 0],
    label: 'Y',
    color: '#52b852',
    positive: true,
    preset: 'back',
    oppositePreset: 'front',
  },
  {
    id: 'y-',
    dir: [0, -1, 0],
    label: '-Y',
    color: '#52b852',
    positive: false,
    preset: 'front',
    oppositePreset: 'back',
  },
  {
    id: 'z+',
    dir: [0, 0, 1],
    label: 'Z',
    color: '#48BCE8',
    positive: true,
    preset: 'top',
    oppositePreset: 'bottom',
  },
  {
    id: 'z-',
    dir: [0, 0, -1],
    label: '-Z',
    color: '#48BCE8',
    positive: false,
    preset: 'bottom',
    oppositePreset: 'top',
  },
];

export const GIZMO_CANVAS_SIZE = 96;
const GIZMO_CENTER = GIZMO_CANVAS_SIZE / 2;
const GIZMO_ARM_RADIUS = 30;
const DEPTH_LINE_EPS = 0.08;

const _invQuat = new THREE.Quaternion();
const _vec = new THREE.Vector3();

/**
 * Computes camera-projected 2D axis tips sorted back-to-front by camera depth (vz).
 * Axes aligned along view depth (projected 2D length <= 0.08) omit their stem line
 * and render strictly as circles/dots, matching Blender's 3D Viewport gizmo.
 */
export function projectAxisTips(
  cameraQuaternion: CameraQuaternionTuple,
  size = GIZMO_CANVAS_SIZE,
  armRadius = GIZMO_ARM_RADIUS,
): ProjectedAxisTip[] {
  const center = size / 2;
  _invQuat
    .set(
      cameraQuaternion[0],
      cameraQuaternion[1],
      cameraQuaternion[2],
      cameraQuaternion[3],
    )
    .invert();

  const tips: ProjectedAxisTip[] = AXIS_SPECS.map((spec) => {
    _vec.set(spec.dir[0], spec.dir[1], spec.dir[2]).applyQuaternion(_invQuat);
    const vx = _vec.x;
    const vy = _vec.y;
    const vz = _vec.z;
    const projLen = Math.hypot(vx, vy);

    return {
      id: spec.id,
      label: spec.label,
      color: spec.color,
      positive: spec.positive,
      preset: spec.preset,
      oppositePreset: spec.oppositePreset,
      vx,
      vy,
      vz,
      sx: center + vx * armRadius,
      sy: center - vy * armRadius,
      drawLine: projLen > DEPTH_LINE_EPS,
      radius: spec.positive ? 10 : 6.5,
    };
  });

  // Back-to-front painter's order so foreground axis handles draw over occluded ones
  tips.sort((a, b) => a.vz - b.vz);
  return tips;
}

interface AxisGizmoWidgetProps {
  onSelectPreset: (preset: Exclude<CameraPreset, 'focus'>) => void;
}

export const AxisGizmoWidget = React.forwardRef<
  AxisGizmoHandle,
  AxisGizmoWidgetProps
>(({ onSelectPreset }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quatRef = useRef<CameraQuaternionTuple>([0, 0, 0, 1]);
  const tipsRef = useRef<ProjectedAxisTip[]>([]);
  const hoveredIdRef = useRef<ProjectedAxisTip['id'] | null>(null);
  const bgHoverRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetPx = GIZMO_CANVAS_SIZE * dpr;
    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, GIZMO_CANVAS_SIZE, GIZMO_CANVAS_SIZE);

    // Subtle Blender-style circular backing on hover or interaction
    ctx.beginPath();
    ctx.arc(GIZMO_CENTER, GIZMO_CENTER, GIZMO_CANVAS_SIZE * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = bgHoverRef.current
      ? 'rgba(32, 36, 44, 0.72)'
      : 'rgba(24, 26, 31, 0.36)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = bgHoverRef.current
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(255, 255, 255, 0.05)';
    ctx.stroke();

    const tips = projectAxisTips(quatRef.current);
    tipsRef.current = tips;

    // 1. Draw positive axis stems when projected length > depth threshold
    for (const tip of tips) {
      if (!tip.positive || !tip.drawLine) continue;
      ctx.beginPath();
      ctx.moveTo(GIZMO_CENTER, GIZMO_CENTER);
      ctx.lineTo(tip.sx, tip.sy);
      ctx.strokeStyle = tip.color;
      ctx.globalAlpha = tip.vz < -0.15 ? 0.65 : 0.92;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 2. Draw all 6 axis circles sorted back-to-front
    for (const tip of tips) {
      const isHovered = hoveredIdRef.current === tip.id;
      const r = isHovered ? tip.radius + 1.2 : tip.radius;

      ctx.save();
      if (tip.positive) {
        ctx.globalAlpha = tip.vz < -0.25 ? 0.78 : 1;
        ctx.beginPath();
        ctx.arc(tip.sx, tip.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = tip.color;
        ctx.fill();

        if (isHovered) {
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }

        ctx.fillStyle = '#0f1115';
        ctx.font = '700 10.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tip.label, tip.sx, tip.sy + 0.5);
      } else {
        ctx.globalAlpha = tip.vz < -0.25 ? 0.52 : 0.88;
        ctx.beginPath();
        ctx.arc(tip.sx, tip.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(24, 27, 34, 0.78)';
        ctx.fill();
        ctx.lineWidth = isHovered ? 2 : 1.5;
        ctx.strokeStyle = isHovered ? '#ffffff' : tip.color;
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      updateOrientation(quaternion: CameraQuaternionTuple) {
        quatRef.current = quaternion;
        draw();
      },
    }),
    [draw],
  );

  useEffect(() => {
    draw();
  }, [draw]);

  const hitTestTip = (clientX: number, clientY: number): ProjectedAxisTip | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Search front-to-back (reverse painter order)
    const tips = tipsRef.current;
    for (let i = tips.length - 1; i >= 0; i--) {
      const tip = tips[i];
      const hitRadius = Math.max(tip.radius + 6, 15);
      if (Math.hypot(x - tip.sx, y - tip.sy) <= hitRadius) {
        return tip;
      }
    }
    return null;
  };

  return (
    <div
      className="select-none pointer-events-auto flex flex-col items-center gap-1"
      aria-label="Gizmo de orientación Z-up"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: `${GIZMO_CANVAS_SIZE}px`,
          height: `${GIZMO_CANVAS_SIZE}px`,
          touchAction: 'none',
        }}
        className="block cursor-pointer"
        onPointerEnter={() => {
          bgHoverRef.current = true;
          draw();
        }}
        onPointerMove={(e) => {
          const hit = hitTestTip(e.clientX, e.clientY);
          const nextId = hit ? hit.id : null;
          if (hoveredIdRef.current !== nextId) {
            hoveredIdRef.current = nextId;
            draw();
          }
        }}
        onPointerLeave={() => {
          bgHoverRef.current = false;
          hoveredIdRef.current = null;
          draw();
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const hit = hitTestTip(e.clientX, e.clientY);
          if (!hit) return;
          // If already aligned strictly along this axis tip toward viewer, flip to opposite view (Blender behavior)
          const targetPreset =
            hit.vz > 0.995 ? hit.oppositePreset : hit.preset;
          onSelectPreset(targetPreset);
        }}
      />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelectPreset('iso');
        }}
        title="Volver a vista 3D libre (Perspectiva)"
        aria-label="Volver a vista 3D libre"
        className="h-8 px-2.5 rounded-md bg-[#181a1f]/90 hover:bg-[#242832] active:bg-[#2e3340] border border-[#323642] text-[11px] font-semibold text-[#d1d5db] hover:text-[#ff9900] flex items-center gap-1 shadow-md transition-colors touch-manipulation"
      >
        <Rotate3d className="w-3.5 h-3.5 text-[#ff9900]" />
        <span>3D</span>
      </button>
    </div>
  );
});

AxisGizmoWidget.displayName = 'AxisGizmoWidget';

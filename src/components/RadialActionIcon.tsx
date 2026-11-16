import React from 'react';
import {
  ArrowBigUpDash,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Box,
  Camera,
  CheckSquare,
  Circle,
  CircleDot,
  Columns,
  Compass,
  Copy,
  CopyPlus,
  Cylinder,
  Eye,
  FlipHorizontal,
  Focus,
  GitMerge,
  Globe,
  Grid,
  Grid3X3,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer,
  Move,
  PaintBucket,
  Plus,
  Pyramid,
  Redo2,
  RefreshCw,
  RotateCw,
  Save,
  Scissors,
  ScissorsLineDashed,
  Settings,
  Square,
  SquareDashed,
  Trash2,
  Triangle,
  Undo2,
  View,
  Waypoints,
} from 'lucide-react';
import { RadialIconKey } from '../core/radial/radialActions';

interface RadialActionIconProps {
  icon: RadialIconKey;
  className?: string;
}

export const RadialActionIcon: React.FC<RadialActionIconProps> = ({
  icon,
  className = 'w-4 h-4',
}) => {
  switch (icon) {
    case 'focus':
      return <Focus className={className} />;
    case 'compass':
      return <Compass className={className} />;
    case 'view_front':
      return <View className={className} />;
    case 'view_top':
      return <ArrowUp className={className} />;
    case 'view_right':
      return <ArrowRight className={className} />;
    case 'camera':
      return <Camera className={className} />;
    case 'check_square':
      return <CheckSquare className={className} />;
    case 'deselect':
      return <SquareDashed className={className} />;
    case 'vertex':
      return <CircleDot className={className} />;
    case 'edge':
      return <Minus className={className} />;
    case 'face':
      return <Square className={className} />;
    case 'multi_select':
      return <CopyPlus className={className} />;
    case 'shift':
      return <ArrowBigUpDash className={className} />;
    case 'pointer':
      return <MousePointer className={className} />;
    case 'move':
      return <Move className={className} />;
    case 'rotate':
      return <RotateCw className={className} />;
    case 'scale':
      return <Maximize2 className={className} />;
    case 'axis_free':
      return <Globe className={className} />;
    case 'axis_x':
      return (
        <span className="inline-flex items-center justify-center w-4 h-4 text-[11px] font-bold text-[#e05252]">
          X
        </span>
      );
    case 'axis_y':
      return (
        <span className="inline-flex items-center justify-center w-4 h-4 text-[11px] font-bold text-[#52b852]">
          Y
        </span>
      );
    case 'axis_z':
      return (
        <span className="inline-flex items-center justify-center w-4 h-4 text-[11px] font-bold text-[#48bce8]">
          Z
        </span>
      );
    case 'proportional':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" opacity="0.7" />
          <path d="M5 17c2.4 0 3.7-9 7-9s4.6 9 7 9" />
          <circle cx="12" cy="8" r="1.7" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'proportional_connected':
      return <Link2 className={className} />;
    case 'plus':
      return <Plus className={className} />;
    case 'plane':
      return <Square className={className} />;
    case 'cube':
      return <Box className={className} />;
    case 'circle':
      return <Circle className={className} />;
    case 'sphere':
      return <Globe className={className} />;
    case 'cylinder':
      return <Cylinder className={className} />;
    case 'pyramid':
      return <Pyramid className={className} />;
    case 'suzanne':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <circle cx="4.5" cy="11" r="2.5" />
          <circle cx="19.5" cy="11" r="2.5" />
          <path d="M7 10.5C7 7 9.2 4.5 12 4.5s5 2.5 5 6c0 2-.7 3.5-1.5 4.8-.6 1-1.3 3.7-3.5 3.7s-2.9-2.7-3.5-3.7C7.7 14 7 12.5 7 10.5Z" />
          <circle cx="10.2" cy="10.2" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="13.8" cy="10.2" r="0.8" fill="currentColor" stroke="none" />
          <path d="M10.4 15.2h3.2" />
        </svg>
      );
    case 'fill':
      return <PaintBucket className={className} />;
    case 'extrude':
      return <FlipHorizontal className={className} />;
    case 'inset':
      return <Square className={className} />;
    case 'subdivide':
      return <Grid className={className} />;
    case 'bevel':
      return <Columns className={className} />;
    case 'loop_cut':
      return <Scissors className={className} />;
    case 'merge':
      return <GitMerge className={className} />;
    case 'merge_dist':
      return <Minimize2 className={className} />;
    case 'connect_path':
      return <Waypoints className={className} />;
    case 'recalculate_normals':
      return <RefreshCw className={className} />;
    case 'flip_normals':
      return <ArrowUpDown className={className} />;
    case 'duplicate':
      return <Copy className={className} />;
    case 'trash':
      return <Trash2 className={className} />;
    case 'dissolve':
      return <ScissorsLineDashed className={className} />;
    case 'undo':
      return <Undo2 className={className} />;
    case 'redo':
      return <Redo2 className={className} />;
    case 'work_object':
      return <Box className={className} />;
    case 'work_edit':
      return <Triangle className={className} />;
    case 'xray':
      return <Eye className={className} />;
    case 'face_orientation':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-sm overflow-hidden border border-white/25 ${className}`}
          aria-hidden="true"
        >
          <span className="w-1/2 h-full bg-[#2563eb]" />
          <span className="w-1/2 h-full bg-[#e03131]" />
        </span>
      );
    case 'grid':
      return <Grid3X3 className={className} />;
    case 'save':
      return <Save className={className} />;
    case 'settings':
      return <Settings className={className} />;
  }
};

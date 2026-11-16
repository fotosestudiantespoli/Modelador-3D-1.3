import React, { useState } from 'react';
import {
  Box,
  Circle,
  Cylinder,
  Globe,
  Minus,
  Plus,
  Pyramid,
  Square,
  X,
} from 'lucide-react';
import { PrimitiveOptions, PrimitiveType } from '../core/mesh/primitives';

interface PrimitiveMenuProps {
  onAddPrimitive: (type: PrimitiveType, options?: PrimitiveOptions) => void;
  onClose: () => void;
}

export const PrimitiveMenu: React.FC<PrimitiveMenuProps> = ({
  onAddPrimitive,
  onClose,
}) => {
  const [sphereSegments, setSphereSegments] = useState(16);
  const [sphereRings, setSphereRings] = useState(12);
  const [cylinderSegments, setCylinderSegments] = useState(16);
  const [circleVertices, setCircleVertices] = useState(32);

  const handleAdd = (type: PrimitiveType) => {
    if (type === 'uv_sphere') {
      onAddPrimitive(type, { segments: sphereSegments, rings: sphereRings });
    } else if (type === 'cylinder') {
      onAddPrimitive(type, { segments: cylinderSegments });
    } else if (type === 'circle') {
      onAddPrimitive(type, { segments: circleVertices });
    } else {
      onAddPrimitive(type);
    }
    onClose();
  };

  return (
    <div className="w-72 bg-[#202329] border border-[#353a45] rounded-lg shadow-2xl overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[#2d313a] flex items-center justify-between">
        <span className="text-xs font-semibold text-[#eceef2]">
          Agregar Primitiva
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded flex items-center justify-center text-[#9ca3af] hover:text-white hover:bg-[#2c3039]"
          aria-label="Cerrar menú"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-2 space-y-1.5 max-h-[75vh] overflow-y-auto cad-scroll">
        {/* Plano */}
        <button
          type="button"
          onClick={() => handleAdd('plane')}
          className="w-full min-h-[48px] px-3 py-2 rounded-md bg-[#262a31] hover:bg-[#2f343d] active:bg-[#383e48] border border-transparent hover:border-[#ff9900]/40 flex items-center gap-3 text-left transition-colors"
        >
          <Square className="w-5 h-5 text-[#ff9900] shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#f3f4f6]">Plano</div>
            <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
              4 vért. · 4 aristas · 1 cara
            </div>
          </div>
        </button>

        {/* Cubo */}
        <button
          type="button"
          onClick={() => handleAdd('cube')}
          className="w-full min-h-[48px] px-3 py-2 rounded-md bg-[#262a31] hover:bg-[#2f343d] active:bg-[#383e48] border border-transparent hover:border-[#ff9900]/40 flex items-center gap-3 text-left transition-colors"
        >
          <Box className="w-5 h-5 text-[#ff9900] shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#f3f4f6]">Cubo</div>
            <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
              8 vért. · 12 aristas · 6 caras
            </div>
          </div>
        </button>

        {/* Círculo */}
        <div className="rounded-md bg-[#262a31] border border-[#2f343d] p-2">
          <button
            type="button"
            onClick={() => handleAdd('circle')}
            className="w-full min-h-[40px] px-1 py-1 flex items-center gap-3 text-left hover:text-white"
          >
            <Circle className="w-5 h-5 text-[#ff9900] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#f3f4f6]">Círculo</div>
              <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
                {circleVertices} vért. · {circleVertices} aristas · sin relleno
              </div>
            </div>
          </button>
          <div className="mt-1.5 pt-1.5 border-t border-[#323640] flex items-center justify-between px-1">
            <span className="text-[11px] text-[#9ca3af]">Vértices</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCircleVertices((v) => Math.max(6, v - 4))}
                className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                aria-label="Menos vértices"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-8 text-center text-xs font-mono-tabular text-[#eceef2]">
                {circleVertices}
              </span>
              <button
                type="button"
                onClick={() => setCircleVertices((v) => Math.min(64, v + 4))}
                className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                aria-label="Más vértices"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Esfera UV */}
        <div className="rounded-md bg-[#262a31] border border-[#2f343d] p-2">
          <button
            type="button"
            onClick={() => handleAdd('uv_sphere')}
            className="w-full min-h-[40px] px-1 py-1 flex items-center gap-3 text-left"
          >
            <Globe className="w-5 h-5 text-[#ff9900] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#f3f4f6]">
                Esfera UV
              </div>
              <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
                {sphereSegments} seg. · {sphereRings} anillos
              </div>
            </div>
          </button>
          <div className="mt-1.5 pt-1.5 border-t border-[#323640] space-y-1.5 px-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#9ca3af]">Segmentos</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSphereSegments((v) => Math.max(4, v - 2))}
                  className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                  aria-label="Menos segmentos"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-8 text-center text-xs font-mono-tabular text-[#eceef2]">
                  {sphereSegments}
                </span>
                <button
                  type="button"
                  onClick={() => setSphereSegments((v) => Math.min(48, v + 2))}
                  className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                  aria-label="Más segmentos"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#9ca3af]">Anillos</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSphereRings((v) => Math.max(4, v - 2))}
                  className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                  aria-label="Menos anillos"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-8 text-center text-xs font-mono-tabular text-[#eceef2]">
                  {sphereRings}
                </span>
                <button
                  type="button"
                  onClick={() => setSphereRings((v) => Math.min(36, v + 2))}
                  className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                  aria-label="Más anillos"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Cilindro */}
        <div className="rounded-md bg-[#262a31] border border-[#2f343d] p-2">
          <button
            type="button"
            onClick={() => handleAdd('cylinder')}
            className="w-full min-h-[40px] px-1 py-1 flex items-center gap-3 text-left"
          >
            <Cylinder className="w-5 h-5 text-[#ff9900] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#f3f4f6]">
                Cilindro
              </div>
              <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
                {cylinderSegments} segmentos
              </div>
            </div>
          </button>
          <div className="mt-1.5 pt-1.5 border-t border-[#323640] flex items-center justify-between px-1">
            <span className="text-[11px] text-[#9ca3af]">Segmentos</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCylinderSegments((v) => Math.max(3, v - 2))}
                className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                aria-label="Menos segmentos"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-8 text-center text-xs font-mono-tabular text-[#eceef2]">
                {cylinderSegments}
              </span>
              <button
                type="button"
                onClick={() => setCylinderSegments((v) => Math.min(48, v + 2))}
                className="w-7 h-7 rounded bg-[#1a1c21] hover:bg-[#323640] flex items-center justify-center text-[#d1d5db]"
                aria-label="Más segmentos"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Pirámide */}
        <button
          type="button"
          onClick={() => handleAdd('pyramid')}
          className="w-full min-h-[48px] px-3 py-2 rounded-md bg-[#262a31] hover:bg-[#2f343d] active:bg-[#383e48] border border-transparent hover:border-[#ff9900]/40 flex items-center gap-3 text-left transition-colors"
        >
          <Pyramid className="w-5 h-5 text-[#ff9900] shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#f3f4f6]">
              Pirámide
            </div>
            <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
              Base cuadrada · 4 caras triangulares
            </div>
          </div>
        </button>

        {/* Suzanne */}
        <button
          type="button"
          onClick={() => handleAdd('suzanne')}
          className="w-full min-h-[48px] px-3 py-2 rounded-md bg-[#262a31] hover:bg-[#2f343d] active:bg-[#383e48] border border-transparent hover:border-[#ff9900]/40 flex items-center gap-3 text-left transition-colors"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-[#ff9900] shrink-0"
          >
            <circle cx="4.5" cy="11" r="2.5" />
            <circle cx="19.5" cy="11" r="2.5" />
            <path d="M7 10.5C7 7 9.2 4.5 12 4.5s5 2.5 5 6c0 2-.7 3.5-1.5 4.8-.6 1-1.3 3.7-3.5 3.7s-2.9-2.7-3.5-3.7C7.7 14 7 12.5 7 10.5Z" />
            <circle cx="10.2" cy="10.2" r="0.8" fill="currentColor" stroke="none" />
            <circle cx="13.8" cy="10.2" r="0.8" fill="currentColor" stroke="none" />
            <path d="M10.4 15.2h3.2" />
          </svg>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#f3f4f6]">
              Suzanne
            </div>
            <div className="text-[11px] text-[#9ca3af] font-mono-tabular">
              Cabeza de mono poligonal · simétrica
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function isPointInRect2D(p: Point2D, rect: Rect2D): boolean {
  return (
    p.x >= rect.minX &&
    p.x <= rect.maxX &&
    p.y >= rect.minY &&
    p.y <= rect.maxY
  );
}

/**
 * Liang-Barsky 2D segment-vs-AABB intersection.
 */
export function segmentIntersectsRect2D(
  a: Point2D,
  b: Point2D,
  rect: Rect2D,
): boolean {
  if (isPointInRect2D(a, rect) || isPointInRect2D(b, rect)) {
    return true;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    clip(-dx, a.x - rect.minX) &&
    clip(dx, rect.maxX - a.x) &&
    clip(-dy, a.y - rect.minY) &&
    clip(dy, rect.maxY - a.y)
  ) {
    return t0 <= t1;
  }

  return false;
}

function pointInTriangle2D(
  p: Point2D,
  a: Point2D,
  b: Point2D,
  c: Point2D,
): boolean {
  const cross = (o: Point2D, u: Point2D, v: Point2D) =>
    (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);

  const d1 = cross(p, a, b);
  const d2 = cross(p, b, c);
  const d3 = cross(p, c, a);

  const hasNeg = d1 < -1e-7 || d2 < -1e-7 || d3 < -1e-7;
  const hasPos = d1 > 1e-7 || d2 > 1e-7 || d3 > 1e-7;
  return !(hasNeg && hasPos);
}

/**
 * Exact 2D triangle-vs-AABB intersection:
 * - Fast bounding-box rejection
 * - Any triangle vertex inside rect
 * - Any triangle edge crossing rect
 * - Any rect corner inside triangle (covers small rect completely inside a large face)
 */
export function triangleIntersectsRect2D(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  rect: Rect2D,
): boolean {
  const triMinX = Math.min(a.x, b.x, c.x);
  const triMaxX = Math.max(a.x, b.x, c.x);
  if (triMaxX < rect.minX || triMinX > rect.maxX) return false;

  const triMinY = Math.min(a.y, b.y, c.y);
  const triMaxY = Math.max(a.y, b.y, c.y);
  if (triMaxY < rect.minY || triMinY > rect.maxY) return false;

  if (
    isPointInRect2D(a, rect) ||
    isPointInRect2D(b, rect) ||
    isPointInRect2D(c, rect)
  ) {
    return true;
  }

  if (
    segmentIntersectsRect2D(a, b, rect) ||
    segmentIntersectsRect2D(b, c, rect) ||
    segmentIntersectsRect2D(c, a, rect)
  ) {
    return true;
  }

  return (
    pointInTriangle2D({ x: rect.minX, y: rect.minY }, a, b, c) ||
    pointInTriangle2D({ x: rect.maxX, y: rect.minY }, a, b, c) ||
    pointInTriangle2D({ x: rect.maxX, y: rect.maxY }, a, b, c) ||
    pointInTriangle2D({ x: rect.minX, y: rect.maxY }, a, b, c)
  );
}

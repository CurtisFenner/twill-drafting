
export type Position = {
	/**
	 * millimeters
	 */
	x: number,
	/**
	 * millimeters
	 */
	y: number,
};

export const EPSILON = 1.0e-3;

export class Segment {
	constructor(
		public readonly from: Position,
		public readonly to: Position,
	) { }

	nearestToSegment(
		q: Position
	): { t: number, tb: number, position: Position } {
		const onLine = this.nearestToLine(q);
		const limitedT = Math.max(0, Math.min(onLine.t, onLine.tb));
		if (onLine.t === limitedT) {
			return onLine;
		}
		return {
			t: limitedT,
			tb: onLine.tb,
			position: this.pointAlong(limitedT),
		};
	}

	nearestToLine(
		q: Position,
	): { t: number, tb: number, position: Position } {
		const v = this.asVector();
		if (v.length === 0) {
			return { t: 0, tb: 0, position: this.from };
		}

		const qx = q.x - this.from.x;
		const qy = q.y - this.from.y;

		const dot = qx * v.direction.x + qy * v.direction.y;
		return {
			t: dot,
			tb: v.length,
			position: {
				x: this.from.x + dot * v.direction.x,
				y: this.from.y + dot * v.direction.y,
			},
		};
	}

	asVector() {
		const dx = this.to.x - this.from.x;
		const dy = this.to.y - this.from.y;
		const dm = Math.sqrt(dx ** 2 + dy ** 2);
		if (dm === 0) {
			return {
				direction: { x: 0, y: 0 },
				length: 0,
			};
		} else {
			return {
				direction: { x: dx / dm, y: dy / dm },
				length: dm,
			};
		}
	}

	pointAlong(t: number): Position {
		const v = this.asVector();
		return {
			x: this.from.x + t * v.direction.x,
			y: this.from.y + t * v.direction.y,
		};
	}
}

/**
 * Returns the distance (in radians) between two circular arc angles (also in radians).
 * For example, `0` and `Math.PI*2` have distance `0`.
 * Supports both positive and negative values.
 * Throws if provided infinite or `NaN` values.
 */
export function circularArcDistance(angle1: number, angle2: number): number {
	if (typeof angle1 !== 'number' || typeof angle2 !== 'number' || !isFinite(angle1) || !isFinite(angle2)) {
		throw new Error(`cannot compute circularArcDistance(${angle1}, ${angle2})`);
	}
	angle1 %= Math.PI * 2;
	angle2 %= Math.PI * 2;
	if (angle1 < 0) {
		angle1 += Math.PI * 2;
	}
	if (angle2 < 0) {
		angle2 += Math.PI * 2;
	}
	const distanceDirect = Math.abs(angle1 - angle2);
	const distancePlus = Math.abs(angle1 + Math.PI * 2 - angle2);
	const distanceMinus = Math.abs(angle1 - Math.PI * 2 - angle2);
	return Math.min(distanceDirect, distancePlus, distanceMinus);
}

/**
 * For positive `m`, returns a value in the range `[0, m)`.
 */
export function mod(x: number, m: number): number {
	x %= m;
	if (x < 0) {
		x += m;
	}
	return x;
}

/**
 * Performs a lerp between `angle1` and `angle2`, following a (less than 360 degree)
 * **clockwise** / **positive** circular arc from `angle1` to `angle2`.
 *
 * If `angle1` and `angle2` are approximately collinear, just returns `angle1` instead.
 *
 * Propagates `NaN` values.
 *
 * @param angle1 An arc angle, in radians.
 * @param angle2 An arc angle, in radians.
 * @param t A parameter in the range [0, 1].
 *
 * @returns An angle in the range [0, Math.PI * 2]
 */
export function circularArcLerp(angle1: number, angle2: number, t: number): number {
	angle1 = mod(angle1, Math.PI * 2)
	angle2 = mod(angle2, Math.PI * 2);

	if (circularArcDistance(angle1, angle2) < EPSILON) {
		return angle1;
	}

	if (angle2 < angle1) {
		angle2 += Math.PI * 2;
	}

	return (angle1 + t * (angle2 - angle1)) % (Math.PI * 2);
}

/**
 * Returns the inverse of the `circularArcLerp` function for a provided `angleTarget`.
 * @returns A parameter, as close to being in [0, 1] as possible.
 */
export function circularArcInverseLerp(angle1: number, angle2: number, angleTarget: number): number {
	angle1 = mod(angle1, Math.PI * 2);
	angle2 = mod(angle2, Math.PI * 2);
	angleTarget = mod(angleTarget, Math.PI * 2);

	if (circularArcDistance(angle1, angle2) < EPSILON) {
		// This case is degenerate.
		return 0;
	}

	if (angle2 < angle1) {
		angle2 += Math.PI * 2;
	}

	if (angleTarget < angle1) {
		angleTarget += Math.PI * 2;
	}

	const tBase = (angleTarget - angle1) / (angle2 - angle1);
	if (tBase >= 0 && tBase <= 1) {
		return tBase;
	}

	// [0 (a1)---(a2) . . . . . . . . . . . . . . . (aT) 2pi]
	// In the above example, `aT` is actually closer to the (a1) angle than the (a2) angle.
	// So it is better to subtract out 2*PI.
	const tBaseDistance = tBase < 0 ? Math.abs(tBase) : tBase - 1;

	const tLower = (angleTarget - Math.PI * 2 - angle1) / (angle2 - angle1);
	const tLowerDistance = tLower < 0 ? Math.abs(tLower) : tLower > 1 ? tLower - 1 : 0;


	if (tLowerDistance < tBaseDistance) {
		return tLower;
	}

	return tBase;
}

export class Arc {
	constructor(
		public readonly center: Position,
		public readonly end1: Position,
		public readonly end2: Position,
	) { }

	nearestToArc(
		q: Position
	): { t: number, position: Position } {
		const a1 = Math.atan2(this.end1.y - this.center.y, this.end1.x - this.center.x);
		const a2 = Math.atan2(this.end2.y - this.center.y, this.end2.x - this.center.x);

		if (circularArcDistance(a1, a2) < EPSILON) {
			// The (center, end1, end2) are collinear, or end1 & end2 are nearly coincident.
			// This is a degenerate case; just return something arbitrary.
			return { t: 0, position: this.end1 };
		}

		const aQ = Math.atan2(q.y - this.center.y, q.x - this.center.x);
		// Clamp to the arc's valid angles.
		let t = circularArcInverseLerp(a1, a2, aQ);
		t = Math.max(0, Math.min(1, t));

		return {
			t,
			position: this.pointAlong(t),
		}
	}

	/**
	 * Returns the point along the arc segment using the provided parameter.
	 * Note that if the `end1` and `end2` are not equidistant to the center,
	 * the arc has the radius of `center - end1`.
	 * @param t the parameter in [0, 1]
	 */
	pointAlong(t: number): Position {
		const r1 = pointDistance(this.center, this.end1);

		const a1 = Math.atan2(this.end1.y - this.center.y, this.end1.x - this.center.x);
		let a2 = Math.atan2(this.end2.y - this.center.y, this.end2.x - this.center.x);

		if (circularArcDistance(a1, a2) < EPSILON || r1 < EPSILON) {
			// There is some degeneracy in this case, so just return the first point.
			return this.end1;
		}

		const a = circularArcLerp(a1, a2, t);

		return {
			x: Math.cos(a) * r1 + this.center.x,
			y: Math.sin(a) * r1 + this.center.y,
		};
	}

}

export function pointDistance(a: Position, b: Position): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt(dx ** 2 + dy ** 2);
}

export function pointSubtract(left: Position, right: Position): Position {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
	};
}

export function pointUnit(p: Position): Position {
	return linearSum([1 / pointMagnitude(p), p]);
}

export function pointDot(a: Position, b: Position): number {
	return a.x * b.x + a.y * b.y;
}

export function pointMagnitude(a: Position): number {
	return Math.sqrt(a.x ** 2 + a.y ** 2);
}

export function lineIntersection(
	a: { from: Position, to: Position },
	b: { from: Position, to: Position },
): null | Position {
	const da = pointUnit(pointSubtract(a.to, a.from));
	const db = pointUnit(pointSubtract(b.to, b.from));

	const na = { x: da.y, y: -da.x };

	const numerator = pointDot(pointSubtract(b.from, a.from), na);
	const denominator = pointDot(db, na);
	if (denominator === 0) {
		return null;
	}

	const t = numerator / denominator;
	return linearSum([1, b.from], [-t, db]);
}

export function linearSum(...vs: [number, Position][]): Position {
	const out = { x: 0, y: 0 };
	for (const [c, v] of vs) {
		out.x += c * v.x;
		out.y += c * v.y;
	}
	return out;
}

export type Circle = {
	radius: number,
	center: Position,
};

export type Line = {
	from: Position,
	to: Position,
};

export function circleCircleIntersection(a: Circle, b: Circle, epsilon: number = EPSILON): {
	tag: "points",
	points: Position[],
} | { tag: "circle", circle: Circle } {
	if (a.radius < 0) {
		return circleCircleIntersection({ radius: -a.radius, center: a.center }, b, epsilon);
	} else if (b.radius < 0) {
		return circleCircleIntersection(a, { radius: -b.radius, center: b.center }, epsilon);
	}

	const separation = pointSubtract(b.center, a.center);
	const separationLength = pointMagnitude(separation);

	if (separationLength <= epsilon) {
		if (Math.abs(a.radius - b.radius) <= epsilon) {
			return { tag: "circle", circle: a };
		} else {
			// Same center but different radii
			return { tag: "points", points: [] };
		}
	}

	if (Math.abs(separationLength - (a.radius + b.radius)) <= epsilon) {
		// The circles barely touch
		return {
			tag: "points",
			points: [
				linearSum(
					[1, a.center],
					[a.radius / (a.radius + b.radius), separation],
				)
			]
		};
	} else if (Math.abs(separationLength - Math.abs(a.radius - b.radius)) <= epsilon) {
		if (a.radius > b.radius) {
			return {
				tag: "points",
				points: [
					linearSum(
						[1, a.center],
						[a.radius / (a.radius + b.radius), separation],
					)
				],
			};
		} else {
			return {
				tag: "points",
				points: [
					linearSum(
						[1, b.center],
						[-b.radius / (a.radius + b.radius), separation],
					)
				],
			};
		}
	}

	// Derived from the Law of Cosines
	const aAngle = Math.acos((a.radius ** 2 + separationLength ** 2 - b.radius ** 2) / (2 * a.radius * separationLength));
	if (!isFinite(aAngle)) {
		return { tag: "points", points: [] };
	}

	const horizontal = {
		x: separation.x / separationLength,
		y: separation.y / separationLength,
	};
	const vertical = {
		x: -horizontal.y,
		y: horizontal.x,
	};

	return {
		tag: "points",
		points: [
			linearSum([1, a.center], [a.radius * Math.cos(aAngle), horizontal], [a.radius * Math.sin(aAngle), vertical]),
			linearSum([1, a.center], [a.radius * Math.cos(aAngle), horizontal], [-a.radius * Math.sin(aAngle), vertical]),
		],
	};
}

export function projectToLine(
	line: { from: Position, to: Position },
	query: Position,
): Position {
	const direction = pointUnit(pointSubtract(line.to, line.from));
	const relative = pointSubtract(query, line.from);
	const amount = pointDot(direction, relative);

	return linearSum([1, line.from], [amount, direction]);
}

export function circleLineIntersection(
	circle: Circle,
	line: { from: Position, to: Position },
	epsilon: number = EPSILON,
): Position[] {
	const nearest = new Segment(line.from, line.to).nearestToLine(circle.center).position;
	const orthogonalOffset = pointSubtract(nearest, circle.center);
	const orthgonalDistance = pointMagnitude(orthogonalOffset);
	const lineDirection = pointUnit(pointSubtract(line.to, line.from));
	if (orthgonalDistance <= epsilon) {
		return [
			linearSum(
				[1, circle.center],
				[circle.radius, lineDirection],
			),
			linearSum(
				[1, circle.center],
				[-circle.radius, lineDirection],
			),
		];
	}

	const radical = circle.radius ** 2 - orthgonalDistance ** 2;
	if (radical < -epsilon) {
		return [];
	} else if (radical < epsilon) {
		return [nearest];
	}

	const dx = Math.sqrt(radical);
	return [
		linearSum(
			[1, nearest],
			[dx, lineDirection],
		),
		linearSum(
			[1, nearest],
			[-dx, lineDirection],
		),
	];
}

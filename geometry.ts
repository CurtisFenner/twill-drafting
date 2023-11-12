
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

	if (separationLength <= EPSILON && Math.abs(a.radius - b.radius) <= EPSILON) {
		return { tag: "circle", circle: a };
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

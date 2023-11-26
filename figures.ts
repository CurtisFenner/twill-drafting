import * as geometry from "./geometry.js";

export function parseLengthMm(msg: string | undefined | null): number | null {
	if (!msg) {
		return null;
	}
	const n = parseFloat(msg.trim());
	if (!isFinite(n) || n < 0) {
		return null;
	}
	return n;
}

export interface Figure {
	/**
	 * If any of these are deleted, delete this object.
	 */
	dependsOn(): Figure[];

	bounds(): geometry.Position[];
}

export abstract class AbstractDimensionFigure implements Figure {
	constructor(public relativePlacement: geometry.Position) { }
	bounds(): geometry.Position[] {
		return [this.labelWorldPosition()];
	}

	abstract dependsOn(): Figure[];

	abstract labelWorldPosition(): geometry.Position;
	abstract edit(): boolean;
}

export class PointFigure implements Figure {
	constructor(public position: geometry.Position) { }

	bounds(): geometry.Position[] {
		return [this.position];
	}

	dependsOn(): Figure[] {
		return [];
	}
};


export class SegmentFigure implements Figure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
	) { }

	bounds(): [geometry.Position, geometry.Position] {
		return [this.from.position, this.to.position];
	}

	dependsOn(): Figure[] {
		return [this.from, this.to];
	}

	nearestToLine(query: geometry.Position): geometry.Position {
		return geometry.projectToLine({
			from: this.from.position,
			to: this.to.position
		}, query);
	}

	midpoint(): geometry.Position {
		return geometry.linearSum(
			[0.5, this.from.position],
			[0.5, this.to.position],
		);
	}
}

/**
 * An `ArcFigure` is a partial circular arc with the provided `center` between the
 * points `end1` and `end2`.
 *
 * The two points `end1` and `end2` should be equidistant to `center` for best
 * behavior, but if not, the arc uses only the distance between `center` and `end1`
 * as the arc radius.
 *
 * An `ArcFigure` cannot represent a full, 360 degree circle.
 */
export class ArcFigure implements Figure {
	constructor(
		public center: PointFigure,
		public end1: PointFigure,
		public end2: PointFigure,
	) { }

	dependsOn(): Figure[] {
		return [this.center, this.end1, this.end2];
	}
	bounds(): geometry.Position[] {
		const boundsPoints: geometry.Position[] = [
			this.center.position,
			this.end1.position,
			this.end2.position,
		];
		return boundsPoints;
	}

	/**
	 * Returns a point on the (clockwise) arc from `end1` to `end2`.
	 *
	 * Note that if `end1` and `end2` are not equidistant to the `center`, then the radius
	 * is chosen using the distance to `end1`.
	 *
	 * If `end1` and `end2` are approximately the same angle from the center,
	 * then linear interpolation between these ends is used instead of computing
	 * the arc angle.
	 *
	 * Complete circles should always be made of multiple arcs.
	 *
	 * @param t parameter in range [0, 1].
	 * @returns A point along the arc.
	 */
	pointFromParameter(t: number): geometry.Position {
		const r1 = geometry.pointDistance(this.center.position, this.end1.position);

		const a1 = Math.atan2(this.end1.position.y - this.center.position.y, this.end1.position.x - this.center.position.x);
		let a2 = Math.atan2(this.end2.position.y - this.center.position.y, this.end2.position.x - this.center.position.x);

		if (Math.abs(a1 - a2) < geometry.EPSILON || Math.abs(a1 - a2 - Math.PI * 2) < geometry.EPSILON || r1 < geometry.EPSILON) {
			// There is some degeneracy in this case, so just lerp between the points instead.
			return geometry.linearSum([1 - t, this.end1.position], [t, this.end2.position]);
		}
		if (a2 < a1) {
			a2 += Math.PI * 2;
		}

		const a = a1 * (1 - t) + a2 * t;

		return {
			x: Math.cos(a) * r1 + this.center.position.x,
			y: Math.sin(a) * r1 + this.center.position.y,
		};
	}
}

export class DimensionPointDistanceFigure extends AbstractDimensionFigure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
		public distance: number,
		relativePlacement: geometry.Position,
	) { super(relativePlacement); }

	dependsOn(): Figure[] {
		return [this.from, this.to];
	}

	labelWorldPosition() {
		return geometry.linearSum(
			[0.5, this.from.position],
			[0.5, this.to.position],
			[1, this.relativePlacement],
		)
	}

	edit() {
		const askedLength = parseLengthMm(prompt("Length of segment (mm):", this.distance.toString()));
		if (askedLength !== null && askedLength > 0) {
			this.distance = askedLength;
			return true;
		}
		return false;
	}
}

export class DimensionPointSegmentDistanceFigure extends AbstractDimensionFigure {
	constructor(
		public a: PointFigure,
		public b: SegmentFigure,
		public distance: number,
		relativePlacement: geometry.Position,
	) { super(relativePlacement); }

	dependsOn(): Figure[] {
		return [this.a, this.b];
	}

	labelWorldPosition() {
		return geometry.linearSum(
			[0.5, this.a.position],
			[0.5, this.b.nearestToLine(this.a.position)],
			[1, this.relativePlacement],
		)
	}

	edit() {
		const askedLength = parseLengthMm(prompt("Distance to segment (mm):", this.distance.toString()));
		if (askedLength !== null) {
			this.distance = askedLength;
			return true;
		}
		return false;
	}
}

export class DimensionSegmentAngleFigure extends AbstractDimensionFigure {
	edit(): boolean {
		const askedAngle = parseLengthMm(prompt("Measure of angle (deg):", this.angleDegrees.toFixed(0)));
		if (askedAngle !== null && 0 <= askedAngle && askedAngle < 360) {
			this.angleDegrees = askedAngle;
			return true;
		}
		return false;
	}

	constructor(
		public from: SegmentFigure,
		public to: SegmentFigure,
		public angleDegrees: number,
		relativePlacement: geometry.Position,
	) { super(relativePlacement); }

	dependsOn(): Figure[] {
		return [this.from, this.to];
	}

	labelWorldPosition() {
		return geometry.linearSum(
			[0.5, this.from.midpoint()],
			[0.5, this.to.midpoint()],
			[1, this.relativePlacement],
		);
	}
}

export class ConstraintFixedAngle implements Figure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
		public angleDegrees: number,
	) { }
	bounds(): geometry.Position[] {
		return [this.from.position, this.to.position];
	}

	dependsOn(): Figure[] {
		return [this.from, this.to];
	}
}

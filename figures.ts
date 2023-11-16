import * as geometry from "./geometry.js";
import * as constraints from "./constraints.js";

export function parseLengthMm(msg: string | undefined | null): number | null {
	if (!msg) {
		return null;
	}
	const n = parseFloat(msg.trim());
	if (!isFinite(n) || n <= 0) {
		return null;
	}
	return n;
}

export interface Figure {
	/**
	 * If any of these are deleted, delete this object.
	 */
	dependsOn(): Figure[];
}

export abstract class AbstractDimensionFigure implements Figure {
	constructor(public relativePlacement: geometry.Position) { }

	abstract dependsOn(): Figure[];

	abstract labelWorldPosition(): geometry.Position;
	abstract edit(): boolean;
}

export class PointFigure implements Figure {
	constructor(public position: geometry.Position) { }

	dependsOn(): Figure[] {
		return [];
	}
};


export class SegmentFigure implements Figure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
	) { }

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
		if (askedLength) {
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

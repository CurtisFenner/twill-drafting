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

export class DimensionPointDistanceFigure implements Figure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
		public distance: number,
		public relativePlacement: geometry.Position,
	) { }

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
		}
	}
}

export class DimensionSegmentPointDistanceFigure implements Figure {
	constructor(
		public a: PointFigure,
		public b: SegmentFigure,
		public distance: number,
		public relativePlacement: geometry.Position,
	) { }

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
		if (askedLength) {
			this.distance = askedLength;
		}
	}
}

export class DimensionSegmentAngleFigure implements Figure {
	constructor(
		public from: SegmentFigure,
		public to: SegmentFigure,
		public angleDegrees: number,
		public relativePlacement: geometry.Position,
	) { }

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

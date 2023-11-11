
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


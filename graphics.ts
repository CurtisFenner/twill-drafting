import { Position, Segment, pointDistance } from "./geometry.js";
import * as geometry from "./geometry.js";
import * as data from "./data.js";

export const COLOR_BACKGROUND = "#FFFFFF";
export const COLOR_REGULAR_INK = "#000000";
export const COLOR_HOVER = "#00AA55";
export const COLOR_DRAFT = "#BBBBBB";
export const COLOR_SELECTED = "#88BBFF";
export const COLOR_ERROR = "#EE4488";

export const OUTLINE_WIDTH = 2;
export const SEGMENT_WIDTH = 3.5;
export const POINT_DIAMETER = 5.5;
export const LABELING_WIDTH = 1;
export const DIMENSION_GAP = 7;

export class View {
	constructor(
		public canvas: HTMLCanvasElement,
		public center: Position,
		public pixelsPerMilli: number,
	) { }

	toScreen(world: Position): Position {
		const dx = world.x - this.center.x;
		const dy = world.y - this.center.y;
		return {
			x: this.canvas.width / 2 + dx * this.pixelsPerMilli,
			y: this.canvas.height / 2 + dy * this.pixelsPerMilli,
		};
	}

	toWorld(screen: Position): Position {
		const dx = screen.x - this.canvas.width / 2;
		const dy = screen.y - this.canvas.height / 2;
		return {
			x: this.center.x + dx / this.pixelsPerMilli,
			y: this.center.y + dy / this.pixelsPerMilli,
		};
	}
}

export function drawSketchedSegment(
	ctx: CanvasRenderingContext2D,
	view: View,
	fromWorld: Position,
	toWorld: Position,
): void {
	// Sketching a new line
	ctx.lineWidth = SEGMENT_WIDTH;
	ctx.lineCap = "round";
	ctx.strokeStyle = COLOR_DRAFT;
	const fromScreen = view.toScreen(fromWorld);
	const toScreen = view.toScreen(toWorld);
	ctx.beginPath();
	ctx.moveTo(fromScreen.x, fromScreen.y);
	ctx.lineTo(toScreen.x, toScreen.y);
	ctx.stroke();
}

export function drawSketchedArc(
	ctx: CanvasRenderingContext2D,
	view: View,
	centerWorld: Position | null,
	end1World: Position | null,
	end2World: Position | null,
): void {
	const RADII_LINE_DASH = [10, 10, 30, 10, 10, 20];
	// Sketching a new arc
	if (centerWorld === null) {
		return;
	}
	ctx.lineWidth = SEGMENT_WIDTH;
	ctx.lineCap = "round";
	ctx.strokeStyle = COLOR_DRAFT;
	const centerScreen = view.toScreen(centerWorld);
	const end1Screen = end1World !== null ? view.toScreen(end1World) : null;
	const end2Screen = end2World !== null ? view.toScreen(end2World) : null;


	if (!end1Screen) {
		// Nothing to draw.
		return;
	}

	const radius = pointDistance(centerScreen, end1Screen);

	ctx.save();
	ctx.setLineDash(RADII_LINE_DASH);
	ctx.beginPath();
	ctx.moveTo(centerScreen.x, centerScreen.y);
	ctx.lineTo(end1Screen.x, end1Screen.y);
	ctx.stroke();
	ctx.restore();

	if (end2Screen) {
		// Preview the output arc also.
		ctx.beginPath();
		ctx.arc(
			centerScreen.x,
			centerScreen.y,
			radius,
			Math.atan2(end1Screen.y - centerScreen.y, end1Screen.x - centerScreen.x),
			Math.atan2(end2Screen.y - centerScreen.y, end2Screen.x - centerScreen.x),
		);
		ctx.stroke();
	} else {
		// Preview an arbitrary small arc, to show the direction.
		ctx.beginPath();
		ctx.arc(
			centerScreen.x,
			centerScreen.y,
			radius,
			Math.atan2(end1Screen.y - centerScreen.y, end1Screen.x - centerScreen.x),
			Math.atan2(end1Screen.y - centerScreen.y, end1Screen.x - centerScreen.x) + Math.PI / 4,
		);
		ctx.stroke();
	}



}

export function drawLengthDimension(
	ctx: CanvasRenderingContext2D,
	view: View,
	fromWorld: Position,
	toWorld: Position,
	labelWorld: Position,
	labelText: string,
	ink: string,
	options: { bonusThickness: number },
): void {
	ctx.strokeStyle = ink;
	ctx.lineWidth = LABELING_WIDTH + options.bonusThickness;
	ctx.beginPath();
	const fromScreen = view.toScreen(fromWorld);
	const toScreen = view.toScreen(toWorld);
	const labelScreen = view.toScreen(labelWorld);

	const screenAlong = geometry.pointUnit(geometry.pointSubtract(toScreen, fromScreen));
	const screenPerpendicular = geometry.pointUnit({
		x: toScreen.y - fromScreen.y,
		y: fromScreen.x - toScreen.x,
	});

	const offset = geometry.pointDot(screenPerpendicular, geometry.pointSubtract(labelScreen, fromScreen));
	const labelAlong = geometry.pointDot(screenAlong, geometry.pointSubtract(labelScreen, fromScreen));

	const fromStart = geometry.linearSum([1, fromScreen], [DIMENSION_GAP * Math.sign(offset), screenPerpendicular]);
	const fromEnd = geometry.linearSum([1, fromScreen], [offset + DIMENSION_GAP * Math.sign(offset), screenPerpendicular]);
	const fromLabelLine = geometry.linearSum(
		[1, fromScreen], [offset, screenPerpendicular], [Math.min(0, labelAlong), screenAlong]
	);
	const toLabelLine = geometry.linearSum(
		[1, fromScreen], [offset, screenPerpendicular], [Math.max(geometry.pointDistance(fromScreen, toScreen), labelAlong), screenAlong]
	);
	const toEnd = geometry.linearSum([1, toScreen], [offset + DIMENSION_GAP * Math.sign(offset), screenPerpendicular]);
	const toStart = geometry.linearSum([1, toScreen], [DIMENSION_GAP * Math.sign(offset), screenPerpendicular]);
	ctx.beginPath();
	ctx.moveTo(fromStart.x, fromStart.y);
	ctx.lineTo(fromEnd.x, fromEnd.y);
	ctx.moveTo(toStart.x, toStart.y);
	ctx.lineTo(toEnd.x, toEnd.y);
	ctx.moveTo(fromLabelLine.x, fromLabelLine.y);
	ctx.lineTo(toLabelLine.x, toLabelLine.y);
	ctx.stroke();

	ctx.fillStyle = COLOR_BACKGROUND;
	const fontSize = 20 + options.bonusThickness;
	ctx.font = fontSize + "px 'Josefin Slab'";
	const textMetrics = ctx.measureText(labelText);
	ctx.fillRect(labelScreen.x - textMetrics.width / 2 - 4, labelScreen.y - fontSize / 2 - 4, textMetrics.width + 9, fontSize + 9);

	ctx.fillStyle = ink;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(labelText, labelScreen.x, labelScreen.y);
}

export function drawAngleDimension(
	ctx: CanvasRenderingContext2D,
	view: View,
	fromWorld: { from: Position, to: Position },
	toWorld: { from: Position, to: Position },
	labelWorld: Position,
	labelText: string,
	ink: string,
	kind: "acute" | "obtuse",
	options: { bonusThickness: number },
) {
	// Find the center of the arc (i.e., where the lines intersect)
	const centerWorld = geometry.lineIntersection(fromWorld, toWorld);
	let fromArrow: Position;
	let toArrow: Position;

	ctx.strokeStyle = ink;
	ctx.lineWidth = LABELING_WIDTH + options.bonusThickness;
	ctx.beginPath();

	if (centerWorld === null) {
		// The lines are parallel
		fromArrow = new Segment(fromWorld.from, fromWorld.to)
			.nearestToLine(labelWorld)
			.position;
		toArrow = new Segment(toWorld.from, toWorld.to)
			.nearestToLine(labelWorld)
			.position;

		const fromArrowScreen = view.toScreen(fromArrow);
		const toArrowScreen = view.toScreen(toArrow);
		ctx.moveTo(fromArrowScreen.x, fromArrowScreen.y);
		ctx.lineTo(toArrowScreen.x, toArrowScreen.y);
	} else {
		const circle: geometry.Circle = {
			center: centerWorld,
			radius: pointDistance(centerWorld, labelWorld),
		};

		const centerScreen = view.toScreen(centerWorld);
		const radiusScreen = view.pixelsPerMilli * circle.radius;

		const fromHits = geometry.circleLineIntersection(circle, fromWorld) as Position[];
		const toHits = geometry.circleLineIntersection(circle, toWorld) as Position[];

		// The hits divide the circle into 4 regions.
		const angleDivisions = [...fromHits, ...toHits].map(point => {
			const relative = geometry.pointSubtract(point, centerWorld);
			return Math.atan2(relative.y, relative.x);
		}).sort((a, b) => a - b);

		const acutes = [];
		const obtuses = [];
		for (let i = 0; i < angleDivisions.length; i++) {
			const ta = angleDivisions[i];
			let tb = angleDivisions[(i + 1) % angleDivisions.length];
			if (tb < ta) {
				tb += Math.PI * 2;
			}
			if (tb - ta <= Math.PI / 2) {
				// This is an acute arc
				acutes.push([ta, tb]);
			} else {
				// This is an obtuse arc
				obtuses.push([ta, tb]);
			}
		}

		let startAngle;
		let endAngle;

		const arcs = (kind === "acute" ? acutes : obtuses)
			.map(([t0, t1]) => {
				const v0 = { x: Math.cos(t0), y: Math.sin(t0) };
				const v1 = { x: Math.cos(t1), y: Math.sin(t1) };
				return {
					t0, t1,
					mid: geometry.pointUnit(geometry.linearSum([1, v0], [1, v1])),
				};
			});

		const arc = data.sortedBy(arcs, arc => {
			return -geometry.pointDot(arc.mid, geometry.pointSubtract(labelWorld, centerWorld));
		})[0];
		if (arc) {
			startAngle = arc.t0;
			endAngle = arc.t1;
			ctx.ellipse(centerScreen.x, centerScreen.y, radiusScreen, radiusScreen, 0, startAngle, endAngle, false);
		}
	}
	ctx.stroke();

	const labelScreen = view.toScreen(labelWorld);
	ctx.fillStyle = COLOR_BACKGROUND;
	const fontSize = 20 + options.bonusThickness;
	ctx.font = fontSize + "px 'Josefin Slab'";
	const textMetrics = ctx.measureText(labelText);
	ctx.fillRect(
		labelScreen.x - textMetrics.width / 2 - 4,
		labelScreen.y - fontSize / 2 - 4,
		textMetrics.width + 9,
		fontSize + 9
	);

	ctx.fillStyle = ink;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(labelText, labelScreen.x, labelScreen.y);
}

export function drawPoint(
	ctx: CanvasRenderingContext2D,
	view: View,
	world: Position,
	ink: string,
): void {
	const screen = view.toScreen(world);
	ctx.fillStyle = COLOR_BACKGROUND;
	ctx.beginPath();
	ctx.ellipse(screen.x, screen.y, POINT_DIAMETER / 2 + OUTLINE_WIDTH, POINT_DIAMETER / 2 + OUTLINE_WIDTH, 0, 0, 2 * Math.PI);
	ctx.fill();
	ctx.fillStyle = ink;
	ctx.beginPath();
	ctx.ellipse(screen.x, screen.y, POINT_DIAMETER / 2, POINT_DIAMETER / 2, 0, 0, 2 * Math.PI);
	ctx.fill();
}

export function drawSegment(
	ctx: CanvasRenderingContext2D,
	view: View,
	fromWorld: Position,
	toWorld: Position,
	ink: string,
): void {
	const fromScreen = view.toScreen(fromWorld);
	const toScreen = view.toScreen(toWorld);
	ctx.strokeStyle = ink;
	ctx.lineWidth = SEGMENT_WIDTH + 2 * OUTLINE_WIDTH;
	ctx.lineCap = "round";
	ctx.strokeStyle = COLOR_BACKGROUND;
	ctx.beginPath();
	ctx.moveTo(fromScreen.x, fromScreen.y);
	ctx.lineTo(toScreen.x, toScreen.y);
	ctx.stroke();
	ctx.lineWidth = SEGMENT_WIDTH;
	ctx.strokeStyle = ink;
	ctx.stroke();
}

export function drawArc(
	ctx: CanvasRenderingContext2D,
	view: View,
	centerWorld: Position,
	end1World: Position,
	end2World: Position,
	ink: string,
): void {
	const centerScreen = view.toScreen(centerWorld);
	const end1Screen = view.toScreen(end1World);
	const end2Screen = view.toScreen(end2World);

	let a1 = Math.atan2(end1Screen.y - centerScreen.y, end1Screen.x - centerScreen.x);
	let a2 = Math.atan2(end2Screen.y - centerScreen.y, end2Screen.x - centerScreen.x);
	if (a2 < a1) {
		a2 += Math.PI * 2;
	}

	ctx.strokeStyle = ink;
	ctx.lineWidth = SEGMENT_WIDTH + 2 * OUTLINE_WIDTH;
	ctx.lineCap = "round";
	ctx.strokeStyle = COLOR_BACKGROUND;
	ctx.beginPath();
	ctx.arc(
		centerScreen.x,
		centerScreen.y,
		pointDistance(centerScreen, end1Screen),
		a1,
		a2,
	);
	ctx.stroke();
	ctx.lineWidth = SEGMENT_WIDTH;
	ctx.strokeStyle = ink;
	ctx.stroke();
}

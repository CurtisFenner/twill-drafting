import { Position, Segment, pointDistance } from "./geometry.js";
import * as geometry from "./geometry.js";
import * as constraints from "./constraints.js";
import * as figures from "./figures.js";

function createFullscreenCanvas(parent: HTMLElement, rerender: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void) {
	const canvas = document.createElement("canvas");
	document.body.appendChild(canvas);
	const ctxOrNull = canvas.getContext("2d");
	if (!(ctxOrNull instanceof CanvasRenderingContext2D)) {
		throw new Error("could not create 2d canvas context");
	}
	const ctx = ctxOrNull;

	function resizeCanvas() {
		canvas.width = document.body.clientWidth;
		canvas.height = document.body.clientHeight;
	}

	resizeCanvas();
	window.addEventListener("resize", resizeCanvas);

	let canceled = false;
	function frame() {
		if (canceled) {
			return;
		}

		rerender(ctx, canvas);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);

	return {
		canvas,
		cancel: () => { canceled = true; },
	};
}

function sortedBy<T>(array: T[], f: (element: T) => number): T[] {
	return [...array].sort((a, b) => f(a) - f(b));
}

class View {
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

const about = createFullscreenCanvas(document.body, rerender);
let view: View = new View(about.canvas, { x: 0, y: 0 }, 1);

const boardFigures: figures.Figure[] = [
	new figures.PointFigure({ x: 0, y: 0 }),
	new figures.PointFigure({ x: 100, y: 0 }),
	new figures.PointFigure({ x: 0, y: 50 }),
	new figures.PointFigure({ x: 200, y: 250 }),
];

boardFigures.push(new figures.SegmentFigure(boardFigures[0] as figures.PointFigure, boardFigures[1] as figures.PointFigure));
boardFigures.push(new figures.SegmentFigure(boardFigures[2] as figures.PointFigure, boardFigures[3] as figures.PointFigure));
boardFigures.push(new figures.DimensionSegmentAngleFigure(boardFigures[4] as figures.SegmentFigure, boardFigures[5] as figures.SegmentFigure, 45, { x: 150, y: 0 }));

let lastMouseCursor: Position = { x: 0, y: 0 };

function screenDistanceToFigure(figure: figures.Figure, screenQuery: Position): number {
	const POINT_RADIUS = 5;
	const LINE_RADIUS = 3;
	if (figure instanceof figures.PointFigure) {
		const onScreen = view.toScreen(figure.position);
		return pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	} else if (figure instanceof figures.SegmentFigure) {
		const screenSegment = new Segment(
			view.toScreen(figure.from.position),
			view.toScreen(figure.to.position)
		);
		const m = screenSegment.nearestToSegment(screenQuery);
		const out = pointDistance(m.position, screenQuery) - LINE_RADIUS;
		return out;
	} else if (figure instanceof figures.DimensionPointDistanceFigure
		|| figure instanceof figures.DimensionSegmentAngleFigure
		|| figure instanceof figures.DimensionSegmentPointDistanceFigure) {
		// TODO: Include full label shape
		const onScreen = view.toScreen(figure.labelWorldPosition());
		return pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	}

	throw new Error("unhandled figure: " + String(figure) + " / " + Object.getPrototypeOf(figure)?.constructor?.name);
}

const COLOR_BACKGROUND = "#FFFFFF";
const COLOR_REGULAR_INK = "#000000";
const COLOR_HOVER = "#00AA55";
const COLOR_DRAFT = "#BBBBBB";
const COLOR_SELECTED = "#88BBFF";
const COLOR_ERROR = "#EE4488";

const OUTLINE_WIDTH = 2;
const SEGMENT_WIDTH = 3.5;
const POINT_DIAMETER = 5.5;
const LABELING_WIDTH = 1;
const DIMENSION_GAP = 7;

function figureOrdering(f: figures.Figure) {
	if (f instanceof figures.PointFigure) {
		return 3000;
	} else if (f instanceof figures.SegmentFigure) {
		return 2000;
	} else {
		return 9000;
	}
}

function getMouseHovering(screenCursor: Position): figures.Figure[] {
	return boardFigures
		.map(figure => ({ figure, distance: screenDistanceToFigure(figure, screenCursor) }))
		.filter(x => x.distance <= POINT_DIAMETER + OUTLINE_WIDTH + 1)
		.sort((a, b) => a.distance - b.distance)
		.map(x => x.figure);
}

function drawLengthDimension(
	ctx: CanvasRenderingContext2D,
	fromWorld: Position,
	toWorld: Position,
	labelWorld: Position,
	labelText: string,
	ink: string,
): void {
	ctx.strokeStyle = ink;
	ctx.lineWidth = LABELING_WIDTH;
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
	const fontSize = 20;
	ctx.font = fontSize + "px 'Josefin Slab'";
	const textMetrics = ctx.measureText(labelText);
	ctx.fillRect(labelScreen.x - textMetrics.width / 2 - 4, labelScreen.y - fontSize / 2 - 4, textMetrics.width + 9, fontSize + 9);

	ctx.fillStyle = ink;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(labelText, labelScreen.x, labelScreen.y);
}

function drawAngleDimension(
	ctx: CanvasRenderingContext2D,
	fromWorld: { from: Position, to: Position },
	toWorld: { from: Position, to: Position },
	labelWorld: Position,
	labelText: string,
	ink: string,
	kind: "acute" | "obtuse",
) {
	// Find the center of the arc (i.e., where the lines intersect)
	const centerWorld = geometry.lineIntersection(fromWorld, toWorld);
	let fromArrow: Position;
	let toArrow: Position;

	ctx.strokeStyle = ink;
	ctx.lineWidth = LABELING_WIDTH;
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

		const arc = sortedBy(arcs, arc => {
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
	const fontSize = 20;
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

function isDimensionInvalid(figure: figures.Figure): boolean {
	if (figure instanceof figures.DimensionPointDistanceFigure) {
		const measurement = pointDistance(figure.from.position, figure.to.position);
		const expected = figure.distance;
		return Math.abs(measurement - expected) >= geometry.EPSILON;
	} else if (figure instanceof figures.DimensionSegmentAngleFigure) {
		const v1 = geometry.pointSubtract(figure.from.to.position, figure.from.from.position);
		const v2 = geometry.pointSubtract(figure.to.to.position, figure.to.from.position);
		const dot = geometry.pointDot(geometry.pointUnit(v1), geometry.pointUnit(v2));
		const expectation = Math.cos(figure.angleDegrees * Math.PI / 180);
		return Math.abs(Math.abs(dot) - Math.abs(expectation)) >= geometry.EPSILON;
	} else {
		return false;
	}
}

function rerender(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	recalculateConstraints();

	const hovering = getMouseHovering(lastMouseCursor);

	const isChoosingPoint = cursorMode.tag === "lines";

	if (cursorMode.tag === "lines" && cursorMode.from !== null) {
		// Sketching a new line
		const destination = choosePoint(lastMouseCursor);
		ctx.lineWidth = SEGMENT_WIDTH;
		ctx.lineCap = "round";
		ctx.strokeStyle = COLOR_DRAFT;
		const fromScreen = view.toScreen(cursorMode.from.position);
		const toScreen = view.toScreen(destination.world);
		ctx.beginPath();
		ctx.moveTo(fromScreen.x, fromScreen.y);
		ctx.lineTo(toScreen.x, toScreen.y);
		ctx.stroke();
	}

	const sketchingConstraint = getConstraining();
	if (sketchingConstraint !== null) {
		if (sketchingConstraint.tag === "point-distance") {
			drawLengthDimension(
				ctx,
				sketchingConstraint.from.position,
				sketchingConstraint.to.position,
				view.toWorld(lastMouseCursor),
				"?",
				COLOR_DRAFT
			);
		} else if (sketchingConstraint.tag === "segment-angle") {
			drawAngleDimension(
				ctx,
				{ from: sketchingConstraint.from.from.position, to: sketchingConstraint.from.to.position },
				{ from: sketchingConstraint.to.from.position, to: sketchingConstraint.to.to.position },
				view.toWorld(lastMouseCursor),
				"?°",
				COLOR_DRAFT,
				"acute"
			);
		} else {
			const _: never = sketchingConstraint;
			throw new Error("unhandled sketchingConstraint.tag: " + sketchingConstraint["tag"]);
		}
	}

	function compareWithHover(a: figures.Figure, b: figures.Figure): number {
		const simple = figureOrdering(a) - figureOrdering(b);
		if (simple !== 0) {
			return simple;
		}
		const forA = hovering.indexOf(a);
		const forB = hovering.indexOf(b);
		if (forA === forB) {
			return 0;
		} else if (forA === -1) {
			return -1;
		} else if (forB === -1) {
			return +1;
		}
		return forA - forB;
	}

	for (const figure of boardFigures.slice().sort(compareWithHover)) {
		let ink = COLOR_REGULAR_INK;

		if (isDimensionInvalid(figure)) {
			ink = COLOR_ERROR;
		}

		if (figure === hovering[0]) {
			ink = COLOR_HOVER;
		}

		if (isChoosingPoint
			&& hovering[0] instanceof figures.SegmentFigure
			&& figure === hovering[1]
			&& figure instanceof figures.SegmentFigure) {
			// The intersection of these two lines will be chosen.
			ink = COLOR_HOVER;
		}

		if (cursorMode.tag === "move" && cursorMode.selected === figure) {
			ink = COLOR_SELECTED;
		}

		if (figure instanceof figures.PointFigure) {
			const screen = view.toScreen(figure.position);
			ctx.fillStyle = COLOR_BACKGROUND;
			ctx.beginPath();
			ctx.ellipse(screen.x, screen.y, POINT_DIAMETER / 2 + OUTLINE_WIDTH, POINT_DIAMETER / 2 + OUTLINE_WIDTH, 0, 0, 2 * Math.PI);
			ctx.fill();
			ctx.fillStyle = ink;
			ctx.beginPath();
			ctx.ellipse(screen.x, screen.y, POINT_DIAMETER / 2, POINT_DIAMETER / 2, 0, 0, 2 * Math.PI);
			ctx.fill();
		} else if (figure instanceof figures.SegmentFigure) {
			const fromScreen = view.toScreen(figure.from.position);
			const toScreen = view.toScreen(figure.to.position);
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
		} else if (figure instanceof figures.DimensionPointDistanceFigure) {
			drawLengthDimension(
				ctx,
				figure.from.position,
				figure.to.position,
				figure.labelWorldPosition(),
				figure.distance.toString(),
				ink,
			);
		} else if (figure instanceof figures.DimensionSegmentAngleFigure) {
			drawAngleDimension(
				ctx,
				{ from: figure.from.from.position, to: figure.from.to.position },
				{ from: figure.to.from.position, to: figure.to.to.position },
				figure.labelWorldPosition(),
				figure.angleDegrees.toString() + "°",
				ink,
				figure.angleDegrees >= 90 ? "obtuse" : "acute",
			);
		} else {
			console.error("rerender: unhandled figure", figure);
		}
	}
}

function cursorPosition(e: MouseEvent): Position {
	if (!(e.currentTarget instanceof HTMLCanvasElement)) {
		throw new Error("unreachable");
	}
	const rect = e.currentTarget.getBoundingClientRect();
	return {
		x: e.clientX - rect.left,
		y: e.clientY - rect.top,
	};
}

type CursorMode = MoveMode | LineMode | DimensionMode;

const MOUSE_DRAG_MINIMUM_SCREEN_DISTANCE = 3;

type MoveMode = {
	tag: "move",
	doubleClick: boolean,
	selected: figures.Figure | null,

	/**
	 *
	 * Don't consider the mouse to be dragging until it has moved at least
	 * DRAG_MINIMUM_DISTANCE away from this.
	 */
	screenFence: Position | null,

	dragging: null | {
		tag: "point",
		figure: figures.PointFigure,
		originalPointWorld: Position,
		originalCursorWorld: Position,
	} | {
		tag: "dimension",
		figure: figures.DimensionPointDistanceFigure | figures.DimensionSegmentAngleFigure,
		originalLabelOffset: Position,
		originalCursorWorld: Position,
	},
};

type LineMode = {
	tag: "lines",
	from: null | figures.PointFigure,
};

type DimensionMode = {
	tag: "dimension",
	constraining: figures.Figure[],
};

let cursorMode: CursorMode = {
	tag: "lines",
	from: null,
};

function choosePoint(screenCursor: Position): { world: Position, figure: figures.PointFigure | null, incident: figures.Figure[] } {
	const hovering = getMouseHovering(screenCursor);
	const world = view.toWorld(screenCursor);
	if (hovering[0] instanceof figures.PointFigure) {
		return {
			world: hovering[0].position,
			figure: hovering[0],
			incident: [],
		};
	} else if (hovering[0] instanceof figures.SegmentFigure && hovering[1] instanceof figures.SegmentFigure) {
		// On the intersection of the two segments
	} else if (hovering[0] instanceof figures.SegmentFigure) {
		// On the segment
		return {
			world: hovering[0].nearestToLine(world),
			figure: null,
			incident: [hovering[0]],
		};
	}

	return {
		world,
		figure: null,
		incident: [],
	};
}

function chooseOrCreatePoint(screenCursor: Position): figures.PointFigure {
	const choice = choosePoint(screenCursor);
	if (!choice.figure) {
		const out = new figures.PointFigure(choice.world);
		boardFigures.push(out);
		return out;
	}
	return choice.figure;
}

function createSegment(from: figures.PointFigure, to: figures.PointFigure): figures.SegmentFigure {
	const existing = boardFigures.find(figure => {
		if (figure instanceof figures.SegmentFigure) {
			return (figure.from === from && figure.to === to) || (figure.from === to && figure.to === from);
		}
		return false;
	}) as figures.SegmentFigure | undefined;
	if (!existing) {
		const out = new figures.SegmentFigure(from, to);
		boardFigures.push(out);
		return out;
	}
	return existing;
}

about.canvas.addEventListener("mousemove", e => {
	lastMouseCursor = cursorPosition(e);

	moveDragged(lastMouseCursor);
});

function placeDimensionBetweenPoints(
	from: figures.PointFigure,
	to: figures.PointFigure,
	atWorld: Position,
) {
	if (cursorMode.tag !== "dimension") {
		throw new Error("placeDimensionBetweenPoints: invalid cursorMode");
	}

	const currentLength = pointDistance(from.position, to.position);
	const askedLength = figures.parseLengthMm(prompt("Length of segment (mm):", currentLength.toFixed(1)));
	if (askedLength === null) {
		// Do nothing.
		return;
	}

	const relativePlacement = geometry.pointSubtract(
		atWorld,
		geometry.linearSum([0.5, from.position], [0.5, to.position]),
	);
	const dimension = new figures.DimensionPointDistanceFigure(from, to, askedLength, relativePlacement);
	boardFigures.push(dimension);
	cursorMode.constraining = [];
}

function placeAngleDimensionBetweenSegments(
	a: figures.SegmentFigure,
	b: figures.SegmentFigure,
	atWorld: Position,
) {
	if (cursorMode.tag !== "dimension") {
		throw new Error("placeDimensionBetweenPoints: invalid cursorMode");
	}

	const va = geometry.pointSubtract(a.to.position, a.from.position);
	const vb = geometry.pointSubtract(b.to.position, b.from.position);
	const dot = Math.abs(geometry.pointDot(geometry.pointUnit(va), geometry.pointUnit(vb)));
	const angle = Math.acos(dot) * 180 / Math.PI;

	const askedLength = figures.parseLengthMm(prompt("Measure of angle (deg):", angle.toFixed(0)));
	if (askedLength === null || askedLength < 0 || askedLength >= 360) {
		// Do nothing.
		return;
	}

	const relativePlacement = geometry.pointSubtract(
		atWorld,
		geometry.linearSum([0.5, a.midpoint()], [0.5, b.midpoint()]),
	);
	const dimension = new figures.DimensionSegmentAngleFigure(a, b, askedLength, relativePlacement);
	boardFigures.push(dimension);
	cursorMode.constraining = [];
}

function getConstraining(): null
	| { tag: "point-distance", from: figures.PointFigure, to: figures.PointFigure }
	| { tag: "segment-angle", from: figures.SegmentFigure, to: figures.SegmentFigure } {
	if (cursorMode.tag !== "dimension") {
		return null;
	}

	if (cursorMode.constraining.length === 1) {
		const [a] = cursorMode.constraining;
		if (a instanceof figures.SegmentFigure) {
			return { tag: "point-distance", from: a.from, to: a.to };
		}
	} else if (cursorMode.constraining.length === 2) {
		const [a, b] = cursorMode.constraining;
		if (a instanceof figures.PointFigure && b instanceof figures.PointFigure) {
			return { tag: "point-distance", from: a, to: b };
		} else if (a instanceof figures.SegmentFigure && b instanceof figures.SegmentFigure) {
			// TODO: When exactly parallel, change to distance constraint
			return { tag: "segment-angle", from: a, to: b };
		}
	}

	return null;
}

function dimensioningClick(cursorScreen: Position): void {
	const hovering = getMouseHovering(cursorScreen)
		.filter(figure =>
			figure instanceof figures.PointFigure || figure instanceof figures.SegmentFigure
		)[0] as undefined | figures.PointFigure | figures.SegmentFigure;

	if (cursorMode.tag !== "dimension") {
		throw new Error("dimensioningClick: wrong cursorMode.tag");
	}

	if (cursorMode.constraining.length === 0) {
		if (hovering) {
			// Begin measuring dimensions from hovering
			cursorMode.constraining.push(hovering);
		} else {
			// Do nothing
		}
		return;
	}

	if (hovering === undefined) {
		// Attempt to create a dimension, if it exists.
		const constraining = getConstraining();
		if (constraining !== null) {
			if (constraining.tag === "point-distance") {
				placeDimensionBetweenPoints(constraining.from, constraining.to, view.toWorld(cursorScreen));
			} else if (constraining.tag === "segment-angle") {
				placeAngleDimensionBetweenSegments(constraining.from, constraining.to, view.toWorld(cursorScreen));
			} else {
				const _: never = constraining;
				throw new Error("dimensioningClick: unhandled constraining.tag: " + constraining["tag"]);
			}
		}
		cursorMode.constraining = [];
		return;
	}

	const existing = cursorMode.constraining.indexOf(hovering);
	if (existing >= 0) {
		cursorMode.constraining.splice(existing, 1);
		return;
	}

	if (cursorMode.constraining.length === 1) {
		const [first] = cursorMode.constraining;
		if (hovering instanceof figures.PointFigure) {
			if (first instanceof figures.PointFigure || first instanceof figures.SegmentFigure) {
				cursorMode.constraining.push(hovering);
				return;
			}
		} else if (hovering instanceof figures.SegmentFigure) {
			if (first instanceof figures.PointFigure || first instanceof figures.SegmentFigure) {
				cursorMode.constraining.push(hovering);
				return;
			}
		} else {
			cursorMode.constraining = [];
			return;
		}
	} else if (cursorMode.constraining.length === 2) {
		cursorMode.constraining = [];
		return;
	}
}

function moveDragged(cursorScreen: Position) {
	if (cursorMode.tag === "move" && cursorMode.dragging !== null) {
		if (cursorMode.screenFence !== null) {
			const screenMotion = geometry.pointDistance(cursorScreen, cursorMode.screenFence);
			if (screenMotion < MOUSE_DRAG_MINIMUM_SCREEN_DISTANCE) {
				return;
			} else {
				// A drag has started, cancel the fence
				cursorMode.screenFence = null;
			}
		}

		const mouseMotion = geometry.pointSubtract(view.toWorld(cursorScreen), cursorMode.dragging.originalCursorWorld);
		if (cursorMode.dragging.tag === "point") {
			cursorMode.dragging.figure.position = geometry.linearSum(
				[1, cursorMode.dragging.originalPointWorld],
				[1, mouseMotion],
			);
		} else if (cursorMode.dragging.tag === "dimension") {
			cursorMode.dragging.figure.relativePlacement = geometry.linearSum(
				[1, cursorMode.dragging.originalLabelOffset],
				[1, mouseMotion],
			);
		}
	}
}

function inPlaceFilter<T>(array: T[], predicate: (element: T) => boolean): void {
	let write = 0;
	for (let i = 0; i < array.length; i++) {
		if (predicate(array[i])) {
			array[write] = array[i];
			write += 1;
		}
	}
	array.length = write;
}

function deleteFigure(figure: figures.Figure) {
	const dependers = new Map<figures.Figure, figures.Figure[]>();
	for (const figure of boardFigures) {
		for (const dependency of figure.dependsOn()) {
			const array = dependers.get(dependency) || [];
			array.push(figure);
			dependers.set(dependency, array);
		}
	}

	const queue = new Set([figure]);
	for (const element of queue) {
		for (const depender of dependers.get(element) || []) {
			queue.add(depender);
		}
	}

	inPlaceFilter(boardFigures, f => !queue.has(f));
}

about.canvas.addEventListener("mouseup", e => {
	const cursorScreen = cursorPosition(e);
	if (cursorMode.tag === "move") {
		moveDragged(cursorScreen);

		if (cursorMode.doubleClick) {
			if (cursorMode.screenFence !== null) {
				if (cursorMode.dragging !== null) {
					if (cursorMode.dragging.figure instanceof figures.DimensionPointDistanceFigure) {
						cursorMode.dragging.figure.edit();
					}
				}
			}
		}

		cursorMode.dragging = null;
	}
});

about.canvas.addEventListener("mousedown", e => {
	const cursorScreen = cursorPosition(e);

	if (cursorMode.tag === "move") {
		if (e.button === 2) {
			// Cancel selection
			cursorMode.selected = null;
		} else if (e.button === 0) {
			const hovering: figures.Figure | undefined = getMouseHovering(cursorScreen)[0];

			cursorMode.doubleClick = cursorMode.selected === hovering && hovering !== undefined;
			cursorMode.screenFence = cursorScreen;

			cursorMode.selected = hovering || null;

			if (hovering instanceof figures.PointFigure) {
				cursorMode.dragging = {
					tag: "point",
					figure: hovering,
					originalCursorWorld: view.toWorld(cursorScreen),
					originalPointWorld: hovering.position,
				};
			} else if (hovering instanceof figures.DimensionPointDistanceFigure
				|| hovering instanceof figures.DimensionSegmentAngleFigure) {
				cursorMode.dragging = {
					tag: "dimension",
					figure: hovering,
					originalCursorWorld: view.toWorld(cursorScreen),
					originalLabelOffset: hovering.relativePlacement,
				};
			}
		}
		return false;
	} else if (cursorMode.tag === "lines") {
		if (e.button === 2) {
			// Cancel draw
			e.preventDefault();
			cursorMode.from = null;
		} else if (e.button === 0) {
			if (cursorMode.from === null) {
				// Create a new point at the cursor
				const newPoint = chooseOrCreatePoint(cursorScreen);
				cursorMode.from = newPoint;
			} else {
				// Create a new point & a segment connecting it to the
				// `from` point.
				const newPoint = chooseOrCreatePoint(cursorScreen);
				createSegment(cursorMode.from, newPoint);
				cursorMode.from = newPoint;
			}
		}
		return false;
	} else if (cursorMode.tag === "dimension") {
		if (e.button === 2) {
			// Cancel dimension
			e.preventDefault();
			cursorMode.constraining = [];
		} else if (e.button === 0) {
			dimensioningClick(cursorScreen);
		}
		return false;
	}

	const _: never = cursorMode;
	console.error("unhandled cursor mode", cursorMode["tag"]);
});

about.canvas.addEventListener("contextmenu", e => e.preventDefault());

document.addEventListener("keydown", e => {
	if (e.key === 'Delete' || e.key === 'Backspace') {
		if (cursorMode.tag === "move" && cursorMode.selected !== null) {
			deleteFigure(cursorMode.selected);
		}
	}
});

function modeChange() {
	if (modeMoveRadio.checked) {
		cursorMode = {
			tag: "move",
			doubleClick: false,
			screenFence: null,
			selected: null,
			dragging: null,
		};
	} else if (modeLinesRadio.checked) {
		cursorMode = {
			tag: "lines",
			from: null,
		};
	} else if (modeDimensionRadio.checked) {
		cursorMode = {
			tag: "dimension",
			constraining: [],
		};
	}
}

const modeMoveRadio = document.getElementById("mode-move") as HTMLInputElement;
const modeLinesRadio = document.getElementById("mode-lines") as HTMLInputElement;
const modeDimensionRadio = document.getElementById("mode-dimension") as HTMLInputElement;

modeMoveRadio.addEventListener("input", modeChange);
modeLinesRadio.addEventListener("input", modeChange);
modeDimensionRadio.addEventListener("input", modeChange);

modeChange();

function recalculateConstraints() {
	const pointName = new Map<figures.PointFigure, string>();
	const variables = new Map<string, Position>();
	const pointByName = new Map<string, figures.PointFigure>();
	const cs: constraints.Constraint[] = [];

	function getVariableName(pointFigure: figures.PointFigure) {
		if (pointName.has(pointFigure)) {
			return pointName.get(pointFigure)!;
		}
		const name = "p" + pointName.size;
		pointName.set(pointFigure, name);
		variables.set(name, pointFigure.position);
		pointByName.set(name, pointFigure);
		return name;
	}

	// Prioritize the dragged element, so that there are no "locked" elements
	// caused by arbitrary choices.
	if (cursorMode.tag === "move" && cursorMode.dragging !== null) {
		if (cursorMode.dragging.figure instanceof figures.PointFigure) {
			getVariableName(cursorMode.dragging.figure);
		}
	}

	for (const figure of boardFigures) {
		if (figure instanceof figures.DimensionPointDistanceFigure) {
			cs.push({
				tag: "distance",
				a: getVariableName(figure.from),
				b: getVariableName(figure.to),
				distance: figure.distance,
			});
		} else if (figure instanceof figures.DimensionSegmentAngleFigure) {
			cs.push({
				tag: "angle",
				a: {
					p0: getVariableName(figure.from.from),
					p1: getVariableName(figure.from.to),
				},
				b: {
					p0: getVariableName(figure.to.from),
					p1: getVariableName(figure.to.to),
				},
				angleRadians: figure.angleDegrees * Math.PI / 180,
			});
		} else if (figure instanceof figures.DimensionSegmentPointDistanceFigure) {
			cs.push({
				tag: "segment-distance",
				a: getVariableName(figure.a),
				b: {
					p0: getVariableName(figure.b.from),
					p1: getVariableName(figure.b.to),
				},
				distance: figure.distance,
			});
		}
	}

	const solution = constraints.solve(variables, cs);
	for (const [variableName, newPosition] of solution.solution) {
		const point = pointByName.get(variableName)!;
		point.position = newPosition;
	}
}

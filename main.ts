import { Position, Segment, pointDistance } from "./geometry.js";
import * as geometry from "./geometry.js";
import * as constraints from "./constraints.js";

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

class PointFigure {
	constructor(public position: Position) { }
};


class SegmentFigure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
	) { }

	nearest(query: Position): Position {
		return geometry.projectToLine({
			from: this.from.position,
			to: this.to.position
		}, query);
	}
}

class PointDistanceFigure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
		public distance: number,
		public relativePlacement: Position,
	) { }

	labelWorldPosition() {
		return geometry.linearSum(
			[0.5, this.from.position],
			[0.5, this.to.position],
			[1, this.relativePlacement],
		)
	}
}

type Figure = PointFigure | SegmentFigure | PointDistanceFigure;

const figures: Figure[] = [
	new PointFigure({ x: 0, y: 0 }),
	new PointFigure({ x: 100, y: 0 }),
	new PointFigure({ x: 0, y: 200 }),
];

figures.push(new SegmentFigure(figures[1] as PointFigure, figures[2] as PointFigure));

figures.push(new PointDistanceFigure(figures[1] as PointFigure, figures[2] as PointFigure, 100, { x: -160, y: 120 }));

let lastMouseCursor: Position = { x: 0, y: 0 };

function screenDistanceToFigure(figure: Figure, screenQuery: Position): number {
	const POINT_RADIUS = 5;
	const LINE_RADIUS = 3;
	if (figure instanceof PointFigure) {
		const onScreen = view.toScreen(figure.position);
		return pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	} else if (figure instanceof SegmentFigure) {
		const screenSegment = new Segment(
			view.toScreen(figure.from.position),
			view.toScreen(figure.to.position)
		);
		const m = screenSegment.nearestToSegment(screenQuery);
		const out = pointDistance(m.position, screenQuery) - LINE_RADIUS;
		return out;
	} else if (figure instanceof PointDistanceFigure) {
		// TODO: Include full label shape
		const onScreen = view.toScreen(figure.labelWorldPosition());
		return pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	}
	const _: never = figure;
	throw new Error("unhandled figure tag: " + String(figure));
}

const BACKGROUND_COLOR = "#FFFFFF";
const REGULAR_INK_COLOR = "#000000";
const HOVER_COLOR = "#00AA55";
const SKETCH_COLOR = "#BBBBBB";

const OUTLINE_WIDTH = 2;
const SEGMENT_WIDTH = 3.5;
const POINT_DIAMETER = 5.5;
const LABELING_WIDTH = 1;
const DIMENSION_GAP = 7;

function figureOrdering(f: Figure) {
	if (f instanceof PointFigure) {
		return 3000;
	} else if (f instanceof SegmentFigure) {
		return 2000;
	} else {
		return 9000;
	}
}

function getMouseHovering(screenCursor: Position): Figure[] {
	return figures
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

	ctx.fillStyle = BACKGROUND_COLOR;
	const fontSize = 20;
	ctx.font = fontSize + "px 'Josefin Slab'";
	const textMetrics = ctx.measureText(labelText);
	ctx.fillRect(labelScreen.x - textMetrics.width / 2 - 4, labelScreen.y - fontSize / 2 - 4, textMetrics.width + 9, fontSize + 9);

	ctx.fillStyle = ink;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(labelText, labelScreen.x, labelScreen.y);
}

function rerender(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const hovering = getMouseHovering(lastMouseCursor);

	const isChoosingPoint = cursorMode.tag === "lines";

	if (cursorMode.tag === "lines" && cursorMode.from !== null) {
		// Sketching a new line
		const destination = choosePoint(lastMouseCursor);
		ctx.lineWidth = SEGMENT_WIDTH;
		ctx.lineCap = "round";
		ctx.strokeStyle = SKETCH_COLOR;
		const fromScreen = view.toScreen(cursorMode.from.position);
		const toScreen = view.toScreen(destination.world);
		ctx.beginPath();
		ctx.moveTo(fromScreen.x, fromScreen.y);
		ctx.lineTo(toScreen.x, toScreen.y);
		ctx.stroke();
	}

	const sketchingConstraint = getConstraining();
	if (sketchingConstraint !== null && sketchingConstraint.tag === "point-distance") {
		drawLengthDimension(
			ctx,
			sketchingConstraint.from.position,
			sketchingConstraint.to.position,
			view.toWorld(lastMouseCursor),
			"?",
			SKETCH_COLOR
		);
	}

	function compareWithHover(a: Figure, b: Figure): number {
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

	for (const figure of figures.slice().sort(compareWithHover)) {
		let ink = figure === hovering[0]
			? HOVER_COLOR
			: REGULAR_INK_COLOR;

		if (isChoosingPoint
			&& hovering[0] instanceof SegmentFigure
			&& figure === hovering[1]
			&& figure instanceof SegmentFigure) {
			// The intersection of these two lines will be chosen.
			ink = HOVER_COLOR;
		}

		if (figure instanceof PointFigure) {
			const screen = view.toScreen(figure.position);
			ctx.fillStyle = BACKGROUND_COLOR;
			ctx.beginPath();
			ctx.ellipse(screen.x, screen.y, POINT_DIAMETER / 2 + OUTLINE_WIDTH, POINT_DIAMETER / 2 + OUTLINE_WIDTH, 0, 0, 2 * Math.PI);
			ctx.fill();
			ctx.fillStyle = ink;
			ctx.beginPath();
			ctx.ellipse(screen.x, screen.y, POINT_DIAMETER / 2, POINT_DIAMETER / 2, 0, 0, 2 * Math.PI);
			ctx.fill();
		} else if (figure instanceof SegmentFigure) {
			const fromScreen = view.toScreen(figure.from.position);
			const toScreen = view.toScreen(figure.to.position);
			ctx.strokeStyle = ink;
			ctx.lineWidth = SEGMENT_WIDTH + 2 * OUTLINE_WIDTH;
			ctx.lineCap = "round";
			ctx.strokeStyle = BACKGROUND_COLOR;
			ctx.beginPath();
			ctx.moveTo(fromScreen.x, fromScreen.y);
			ctx.lineTo(toScreen.x, toScreen.y);
			ctx.stroke();
			ctx.lineWidth = SEGMENT_WIDTH;
			ctx.strokeStyle = ink;
			ctx.stroke();
		} else if (figure instanceof PointDistanceFigure) {
			drawLengthDimension(
				ctx,
				figure.from.position,
				figure.to.position,
				figure.labelWorldPosition(),
				figure.distance.toString(),
				ink,
			);
		} else {
			const _: never = figure;
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

type CursorMode = LineMode | DimensionMode;

type LineMode = {
	tag: "lines",
	from: null | PointFigure,
};

type DimensionMode = {
	tag: "dimension",
	constraining: Figure[],
};

let cursorMode: CursorMode = {
	tag: "lines",
	from: null,
};

function choosePoint(screenCursor: Position): { world: Position, figure: PointFigure | null, incident: Figure[] } {
	const hovering = getMouseHovering(screenCursor);
	const world = view.toWorld(screenCursor);
	if (hovering[0] instanceof PointFigure) {
		return {
			world: hovering[0].position,
			figure: hovering[0],
			incident: [],
		};
	} else if (hovering[0] instanceof SegmentFigure && hovering[1] instanceof SegmentFigure) {
		// On the intersection of the two segments
	} else if (hovering[0] instanceof SegmentFigure) {
		// On the segment
		return {
			world: hovering[0].nearest(world),
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

function chooseOrCreatePoint(screenCursor: Position): PointFigure {
	const choice = choosePoint(screenCursor);
	if (!choice.figure) {
		const out = new PointFigure(choice.world);
		figures.push(out);
		return out;
	}
	return choice.figure;
}

function createSegment(from: PointFigure, to: PointFigure): SegmentFigure {
	const existing = figures.find(figure => {
		if (figure instanceof SegmentFigure) {
			return (figure.from === from && figure.to === to) || (figure.from === to && figure.to === from);
		}
		return false;
	}) as SegmentFigure | undefined;
	if (!existing) {
		const out = new SegmentFigure(from, to);
		figures.push(out);
		return out;
	}
	return existing;
}

about.canvas.addEventListener("mousemove", e => {
	lastMouseCursor = cursorPosition(e);
});

function parseLengthMm(msg: string | undefined | null): number | null {
	if (!msg) {
		return null;
	}
	const n = parseFloat(msg.trim());
	if (!isFinite(n) || n <= 0) {
		return null;
	}
	return n;
}

function placeDimensionBetweenPoints(
	from: PointFigure,
	to: PointFigure,
	atWorld: Position,
) {
	if (cursorMode.tag !== "dimension") {
		throw new Error("placeDimensionBetweenPoints: invalid cursorMode");
	}

	const currentLength = pointDistance(from.position, to.position);
	const askedLength = parseLengthMm(prompt("Length of segment (mm):", currentLength.toFixed(1)));
	if (askedLength === null) {
		// Do nothing.
		return;
	}

	const relativePlacement = geometry.pointSubtract(
		atWorld,
		geometry.linearSum([0.5, from.position], [0.5, to.position]),
	);
	const dimension = new PointDistanceFigure(from, to, askedLength, relativePlacement);
	figures.push(dimension);
	cursorMode.constraining = [];
}

function getConstraining(): null | { tag: "point-distance", from: PointFigure, to: PointFigure } {
	if (cursorMode.tag !== "dimension") {
		return null;
	}

	if (cursorMode.constraining.length === 1) {
		const [a] = cursorMode.constraining;
		if (a instanceof SegmentFigure) {
			return { tag: "point-distance", from: a.from, to: a.to };
		}
	} else if (cursorMode.constraining.length === 2) {
		const [a, b] = cursorMode.constraining;
		if (a instanceof PointFigure && b instanceof PointFigure) {
			return { tag: "point-distance", from: a, to: b };
		}
	}

	return null;
}

function dimensioningClick(cursorScreen: Position): void {
	const hovering = getMouseHovering(cursorScreen)
		.filter(figure =>
			figure instanceof PointFigure || figure instanceof SegmentFigure
		)[0] as undefined | PointFigure | SegmentFigure;

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
		if (hovering instanceof PointFigure) {
			if (first instanceof PointFigure || first instanceof SegmentFigure) {
				cursorMode.constraining.push(hovering);
				return;
			}
		} else if (hovering instanceof SegmentFigure) {
			if (first instanceof PointFigure || first instanceof SegmentFigure) {
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

about.canvas.addEventListener("mousedown", e => {
	const cursorScreen = cursorPosition(e);

	if (cursorMode.tag === "lines") {
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

const modeLinesRadio = document.getElementById("mode-lines") as HTMLInputElement;
const modeDimensionRadio = document.getElementById("mode-dimension") as HTMLInputElement;

function modeChange() {
	if (modeLinesRadio.checked) {
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

modeLinesRadio.addEventListener("input", modeChange);
modeDimensionRadio.addEventListener("input", modeChange);

const out = constraints.solve(
	new Map([
		["a", { x: 100, y: 100 }],
		["b", { x: 200, y: 300 }],
		["c", { x: 400, y: 900 }],
	]),
	[
		{
			tag: "fixed",
			a: "a",
			position: { x: 50, y: 50 },
		},
		{
			tag: "distance",
			a: "a",
			b: "b",
			distance: 50,
		},
		{
			tag: "distance",
			a: "a",
			b: "c",
			distance: 50,
		},
		{
			tag: "distance",
			a: "b",
			b: "c",
			distance: 50,
		},
	]
)
console.log(out);

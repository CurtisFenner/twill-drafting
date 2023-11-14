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

interface Figure {
	/**
	 * If any of these are deleted, delete this object.
	 */
	dependsOn(): Figure[];
}

class PointFigure implements Figure {
	constructor(public position: Position) { }

	dependsOn(): Figure[] {
		return [];
	}
};


class SegmentFigure implements Figure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
	) { }

	dependsOn(): Figure[] {
		return [this.from, this.to];
	}

	nearest(query: Position): Position {
		return geometry.projectToLine({
			from: this.from.position,
			to: this.to.position
		}, query);
	}
}

class DimensionPointDistanceFigure implements Figure {
	constructor(
		public from: PointFigure,
		public to: PointFigure,
		public distance: number,
		public relativePlacement: Position,
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

const figures: Figure[] = [
	new PointFigure({ x: 0, y: 0 }),
	new PointFigure({ x: 100, y: 0 }),
	new PointFigure({ x: 0, y: 200 }),
];

figures.push(new SegmentFigure(figures[1] as PointFigure, figures[2] as PointFigure));

figures.push(new DimensionPointDistanceFigure(figures[1] as PointFigure, figures[2] as PointFigure, 100, { x: 160, y: -120 }));

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
	} else if (figure instanceof DimensionPointDistanceFigure) {
		// TODO: Include full label shape
		const onScreen = view.toScreen(figure.labelWorldPosition());
		return pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	}

	throw new Error("unhandled figure: " + String(figure));
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

function isDimensionInvalid(figure: Figure): boolean {
	if (figure instanceof DimensionPointDistanceFigure) {
		const measurement = pointDistance(figure.from.position, figure.to.position);
		const expected = figure.distance;
		return Math.abs(measurement - expected) >= geometry.EPSILON;
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
	if (sketchingConstraint !== null && sketchingConstraint.tag === "point-distance") {
		drawLengthDimension(
			ctx,
			sketchingConstraint.from.position,
			sketchingConstraint.to.position,
			view.toWorld(lastMouseCursor),
			"?",
			COLOR_DRAFT
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
		let ink = COLOR_REGULAR_INK;

		if (isDimensionInvalid(figure)) {
			ink = COLOR_ERROR;
		}

		if (figure === hovering[0]) {
			ink = COLOR_HOVER;
		}

		if (isChoosingPoint
			&& hovering[0] instanceof SegmentFigure
			&& figure === hovering[1]
			&& figure instanceof SegmentFigure) {
			// The intersection of these two lines will be chosen.
			ink = COLOR_HOVER;
		}

		if (cursorMode.tag === "move" && cursorMode.selected === figure) {
			ink = COLOR_SELECTED;
		}

		if (figure instanceof PointFigure) {
			const screen = view.toScreen(figure.position);
			ctx.fillStyle = COLOR_BACKGROUND;
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
			ctx.strokeStyle = COLOR_BACKGROUND;
			ctx.beginPath();
			ctx.moveTo(fromScreen.x, fromScreen.y);
			ctx.lineTo(toScreen.x, toScreen.y);
			ctx.stroke();
			ctx.lineWidth = SEGMENT_WIDTH;
			ctx.strokeStyle = ink;
			ctx.stroke();
		} else if (figure instanceof DimensionPointDistanceFigure) {
			drawLengthDimension(
				ctx,
				figure.from.position,
				figure.to.position,
				figure.labelWorldPosition(),
				figure.distance.toString(),
				ink,
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
	selected: Figure | null,

	/**
	 *
	 * Don't consider the mouse to be dragging until it has moved at least
	 * DRAG_MINIMUM_DISTANCE away from this.
	 */
	screenFence: Position | null,

	dragging: null | {
		tag: "point",
		figure: PointFigure,
		originalPointWorld: Position,
		originalCursorWorld: Position,
	} | {
		tag: "dimension-points",
		figure: DimensionPointDistanceFigure,
		originalLabelOffset: Position,
		originalCursorWorld: Position,
	},
};

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

	moveDragged(lastMouseCursor);
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
	const dimension = new DimensionPointDistanceFigure(from, to, askedLength, relativePlacement);
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
		} else if (cursorMode.dragging.tag === "dimension-points") {
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

function deleteFigure(figure: Figure) {
	const dependers = new Map<Figure, Figure[]>();
	for (const figure of figures) {
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

	inPlaceFilter(figures, f => !queue.has(f));
}

about.canvas.addEventListener("mouseup", e => {
	const cursorScreen = cursorPosition(e);
	if (cursorMode.tag === "move") {
		moveDragged(cursorScreen);

		if (cursorMode.doubleClick) {
			if (cursorMode.screenFence !== null) {
				if (cursorMode.dragging !== null) {
					if (cursorMode.dragging.figure instanceof DimensionPointDistanceFigure) {
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
			const hovering: Figure | undefined = getMouseHovering(cursorScreen)[0];

			cursorMode.doubleClick = cursorMode.selected === hovering && hovering !== undefined;
			cursorMode.screenFence = cursorScreen;

			cursorMode.selected = hovering || null;

			if (hovering instanceof PointFigure) {
				cursorMode.dragging = {
					tag: "point",
					figure: hovering,
					originalCursorWorld: view.toWorld(cursorScreen),
					originalPointWorld: hovering.position,
				};
			} else if (hovering instanceof DimensionPointDistanceFigure) {
				cursorMode.dragging = {
					tag: "dimension-points",
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
	const pointName = new Map<PointFigure, string>();
	const variables = new Map<string, Position>();
	const pointByName = new Map<string, PointFigure>();
	const cs: constraints.Constraint[] = [];

	function getVariableName(pointFigure: PointFigure) {
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
		if (cursorMode.dragging.figure instanceof PointFigure) {
			getVariableName(cursorMode.dragging.figure);
		}
	}

	for (const figure of figures) {
		if (figure instanceof DimensionPointDistanceFigure) {
			cs.push({
				tag: "distance",
				a: getVariableName(figure.from),
				b: getVariableName(figure.to),
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

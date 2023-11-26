import * as constraints from "./constraints.js";
import * as data from "./data.js";
import * as figures from "./figures.js";
import * as geometry from "./geometry.js";
import * as graphics from "./graphics.js";
import * as saving from "./saving.js";

function createFullscreenCanvas(rerender: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void) {
	const canvas = document.createElement("canvas");
	const ctxOrNull = canvas.getContext("2d");
	if (!(ctxOrNull instanceof CanvasRenderingContext2D)) {
		throw new Error("could not create 2d canvas context");
	}
	const ctx = ctxOrNull;


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

const about = createFullscreenCanvas(rerender);
let view: graphics.View = new graphics.View(about.canvas, { x: 0, y: 0 }, 72 / 25.4);

function recenterView(focus: figures.Figure[], paddingMm: number): geometry.Position {
	const points = focus.flatMap(figure => figure.bounds());
	if (points.length === 0) {
		return { x: 2 * paddingMm, y: 2 * paddingMm };
	}

	const xs = points.map(point => point.x);
	const ys = points.map(point => point.y);
	const xRange = [Math.min(...xs), Math.max(...xs)];
	const yRange = [Math.min(...ys), Math.max(...ys)];
	view.center.x = (xRange[0] + xRange[1]) / 2;
	view.center.y = (yRange[0] + yRange[1]) / 2;
	return {
		x: 2 * paddingMm + xRange[1] - xRange[0],
		y: 2 * paddingMm + yRange[1] - yRange[0],
	};
}

const boardFigures: figures.Figure[] = [];

let lastMouseCursor: geometry.Position = { x: 0, y: 0 };

function screenDistanceToFigure(figure: figures.Figure, screenQuery: geometry.Position): number {
	const POINT_RADIUS = 5;
	const LINE_RADIUS = 3;
	if (figure instanceof figures.PointFigure) {
		const onScreen = view.toScreen(figure.position);
		return geometry.pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	} else if (figure instanceof figures.SegmentFigure) {
		const screenSegment = new geometry.Segment(
			view.toScreen(figure.from.position),
			view.toScreen(figure.to.position)
		);
		const m = screenSegment.nearestToSegment(screenQuery);
		const out = geometry.pointDistance(m.position, screenQuery) - LINE_RADIUS;
		return out;
	} else if (figure instanceof figures.DimensionPointDistanceFigure
		|| figure instanceof figures.DimensionSegmentAngleFigure
		|| figure instanceof figures.DimensionPointSegmentDistanceFigure) {
		// TODO: Include full label shape
		const onScreen = view.toScreen(figure.labelWorldPosition());
		return geometry.pointDistance(onScreen, screenQuery) - POINT_RADIUS * 2;
	} else if (figure instanceof figures.ConstraintFixedAngle) {
		return Infinity;
	}

	throw new Error("unhandled figure: " + String(figure) + " / " + Object.getPrototypeOf(figure)?.constructor?.name);
}

function figureOrdering(f: figures.Figure) {
	if (f instanceof figures.PointFigure) {
		return 3000;
	} else if (f instanceof figures.SegmentFigure) {
		return 2000;
	} else {
		return 9000;
	}
}

function getMouseHovering(screenCursor: geometry.Position): figures.Figure[] {
	return boardFigures
		.map(figure => ({ figure, distance: screenDistanceToFigure(figure, screenCursor) }))
		.filter(x => x.distance <= graphics.POINT_DIAMETER + graphics.OUTLINE_WIDTH + 1)
		.sort((a, b) => a.distance - b.distance)
		.map(x => x.figure);
}

function isDimensionInvalid(figure: figures.Figure): boolean {
	if (figure instanceof figures.DimensionPointDistanceFigure) {
		const measurement = geometry.pointDistance(figure.from.position, figure.to.position);
		const expected = figure.distance;
		return Math.abs(measurement - expected) >= geometry.EPSILON;
	} else if (figure instanceof figures.DimensionSegmentAngleFigure) {
		const v1 = geometry.pointSubtract(figure.from.to.position, figure.from.from.position);
		const v2 = geometry.pointSubtract(figure.to.to.position, figure.to.from.position);
		const dot = geometry.pointDot(geometry.pointUnit(v1), geometry.pointUnit(v2));
		const expectation = Math.cos(figure.angleDegrees * Math.PI / 180);
		return Math.abs(Math.abs(dot) - Math.abs(expectation)) >= geometry.EPSILON;
	} else if (figure instanceof figures.DimensionPointSegmentDistanceFigure) {
		const nearest = figure.b.nearestToLine(figure.a.position);
		const measurement = geometry.pointDistance(nearest, figure.a.position);
		return Math.abs(measurement - figure.distance) >= geometry.EPSILON;
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
		graphics.drawSketchedSegment(ctx, view, cursorMode.from.position, destination.world);
	}

	const sketchingConstraint = convertSelectedFiguresToDimensionType();
	if (sketchingConstraint !== null) {
		if (sketchingConstraint.tag === "point-point-distance") {
			graphics.drawLengthDimension(
				ctx,
				view,
				sketchingConstraint.from.position,
				sketchingConstraint.to.position,
				view.toWorld(lastMouseCursor),
				"?",
				graphics.COLOR_DRAFT,
				{ bonusThickness: 0 },
			);
		} else if (sketchingConstraint.tag === "segment-angle") {
			graphics.drawAngleDimension(
				ctx,
				view,
				{ from: sketchingConstraint.from.from.position, to: sketchingConstraint.from.to.position },
				{ from: sketchingConstraint.to.from.position, to: sketchingConstraint.to.to.position },
				view.toWorld(lastMouseCursor),
				"?°",
				graphics.COLOR_DRAFT,
				"acute",
				{ bonusThickness: 0 },
			);
		} else if (sketchingConstraint.tag === "point-segment-distance") {
			graphics.drawLengthDimension(
				ctx,
				view,
				sketchingConstraint.point.position,
				sketchingConstraint.segment.nearestToLine(sketchingConstraint.point.position),
				view.toWorld(lastMouseCursor),
				"?",
				graphics.COLOR_DRAFT,
				{ bonusThickness: 0 },
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
		let ink = graphics.COLOR_REGULAR_INK;

		let bonusThickness = 0;
		if (isDimensionInvalid(figure)) {
			ink = graphics.COLOR_ERROR;
			bonusThickness += 2;
		}

		if (figure === hovering[0]) {
			ink = graphics.COLOR_HOVER;
		}

		if (isChoosingPoint
			&& hovering[0] instanceof figures.SegmentFigure
			&& figure === hovering[1]
			&& figure instanceof figures.SegmentFigure) {
			// The intersection of these two lines will be chosen.
			ink = graphics.COLOR_HOVER;
		}

		if (cursorMode.tag === "move" && cursorMode.selected === figure) {
			ink = graphics.COLOR_SELECTED;
		}

		if (figure instanceof figures.PointFigure) {
			graphics.drawPoint(ctx, view, figure.position, ink);
		} else if (figure instanceof figures.SegmentFigure) {
			graphics.drawSegment(ctx, view, figure.from.position, figure.to.position, ink);
		} else if (figure instanceof figures.DimensionPointDistanceFigure) {
			graphics.drawLengthDimension(
				ctx,
				view,
				figure.from.position,
				figure.to.position,
				figure.labelWorldPosition(),
				figure.distance.toString(),
				ink,
				{ bonusThickness },
			);
		} else if (figure instanceof figures.DimensionPointSegmentDistanceFigure) {
			if (figure.distance !== 0) {
				graphics.drawLengthDimension(
					ctx,
					view,
					figure.a.position,
					figure.b.nearestToLine(figure.a.position),
					figure.labelWorldPosition(),
					figure.distance.toString(),
					ink,
					{ bonusThickness },
				);
			}
		} else if (figure instanceof figures.DimensionSegmentAngleFigure) {
			graphics.drawAngleDimension(
				ctx,
				view,
				{ from: figure.from.from.position, to: figure.from.to.position },
				{ from: figure.to.from.position, to: figure.to.to.position },
				figure.labelWorldPosition(),
				figure.angleDegrees.toString() + "°",
				ink,
				figure.angleDegrees >= 90 ? "obtuse" : "acute",
				{ bonusThickness },
			);
		} else if (figure instanceof figures.ConstraintFixedAngle) {
			// Do nothing
		} else {
			console.error("rerender: unhandled figure", figure);
		}
	}

	for (let i = 0; i < highlightedIntersection.gamuts.length; i++) {
		const hue = 255 * i / highlightedIntersection.gamuts.length;
		const color = "hsl(" + hue.toFixed(0) + "deg 90% 50%)";
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		drawGamut(ctx, view, highlightedIntersection.gamuts[i]);
	}
	if (highlightedIntersection.point !== null) {
		ctx.strokeStyle = "#222";
		ctx.lineWidth = 2;
		const p = view.toScreen(highlightedIntersection.point);
		ctx.beginPath();
		ctx.rect(p.x - 10, p.y - 10, 21, 21);
		ctx.stroke();
	}
}

function drawGamut(
	ctx: CanvasRenderingContext2D,
	view: graphics.View,
	gamut: constraints.Gamut,
): void {
	if (gamut.tag === "circle") {
		const center = view.toScreen(gamut.circle.center);
		const radius = view.pixelsPerMilli * gamut.circle.radius;
		ctx.beginPath();
		ctx.ellipse(center.x, center.y, radius, radius, 0, 0, Math.PI * 2);
		ctx.stroke();
	} else if (gamut.tag === "line") {
		const a = view.toScreen(gamut.line.from);
		const b = view.toScreen(gamut.line.to);
		const direction = geometry.pointSubtract(b, a);
		if (geometry.pointMagnitude(direction) < 0.001) {
			return;
		}
		const unit = geometry.pointUnit(direction);
		const limit0 = geometry.linearSum([0.5, a], [0.5, b], [10000, unit]);
		const limit1 = geometry.linearSum([0.5, a], [0.5, b], [-10000, unit]);
		ctx.beginPath();
		ctx.moveTo(limit0.x, limit0.y);
		ctx.lineTo(limit1.x, limit1.y);
		ctx.stroke();
	} else if (gamut.tag === "plane" || gamut.tag === "void") {
		// Draw nothing
	} else if (gamut.tag === "point") {
		const center = view.toScreen(gamut.point);
		ctx.beginPath();
		ctx.ellipse(center.x, center.y, 0.01, 0.01, 0, 0, Math.PI * 2);
		ctx.stroke();
	} else if (gamut.tag === "union") {
		for (const e of gamut.union) {
			drawGamut(ctx, view, e);
		}
	} else {
		const _: never = gamut;
		throw new Error("drawGamut: unhandled tag: " + gamut["tag"]);
	}
}

function cursorPosition(e: MouseEvent): geometry.Position {
	if (!(e.currentTarget instanceof HTMLCanvasElement)) {
		throw new Error("unreachable");
	}
	const rect = e.currentTarget.getBoundingClientRect();
	return {
		x: e.clientX - rect.left,
		y: e.clientY - rect.top,
	};
}

type CursorMode = MoveMode | LineMode | DimensionMode | OrthogonalMode;

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
	screenFence: geometry.Position | null,

	dragging: null | {
		tag: "point",
		figure: figures.PointFigure,
		originalPointWorld: geometry.Position,
		originalCursorWorld: geometry.Position,
	} | {
		tag: "dimension",
		figure: figures.AbstractDimensionFigure,
		originalLabelOffset: geometry.Position,
		originalCursorWorld: geometry.Position,
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

type OrthogonalMode = {
	tag: "orthogonal",
};

let cursorMode: CursorMode = {
	tag: "lines",
	from: null,
};

function choosePoint(screenCursor: geometry.Position): { world: geometry.Position, figure: figures.PointFigure | null, incident: figures.Figure[] } {
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
		return {
			world: hovering[0].nearestToLine(world),
			figure: null,
			incident: [hovering[0], hovering[1]],
		};
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

function chooseOrCreatePoint(screenCursor: geometry.Position): figures.PointFigure {
	const choice = choosePoint(screenCursor);
	if (!choice.figure) {
		const out = new figures.PointFigure(choice.world);
		boardFigures.push(out);
		for (const incident of choice.incident) {
			if (incident instanceof figures.SegmentFigure) {
				const incidentConstraint = new figures.DimensionPointSegmentDistanceFigure(out, incident, 0, { x: 0, y: 0 });
				boardFigures.push(incidentConstraint);
			} else {
				console.error("unknown incident", incident);
			}
		}
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

	if (panStart !== null) {
		const motionScreen = geometry.pointSubtract(lastMouseCursor, panStart.cursorScreen);
		view.center = geometry.linearSum(
			[1, panStart.viewCenter],
			[-1 / view.pixelsPerMilli, motionScreen],
		);
	}

	moveDragged(lastMouseCursor);
});

about.canvas.addEventListener("wheel", e => {
	const pixelsScrolled = e.deltaY * (1 + e.deltaMode);
	const zoomChange = Math.exp(-pixelsScrolled / 500);
	const cursorScreen = cursorPosition(e);
	const cursorWorld = view.toWorld(cursorScreen);
	view.pixelsPerMilli *= zoomChange;
	const newCursorWorld = view.toWorld(cursorScreen);
	view.center = geometry.linearSum(
		[1, view.center],
		[-1, geometry.pointSubtract(newCursorWorld, cursorWorld)],
	);
	if (panStart !== null) {
		// TODO! Fixup
	}
});

function placeDimensionBetweenPoints(
	from: figures.PointFigure,
	to: figures.PointFigure,
	atWorld: geometry.Position,
) {
	if (cursorMode.tag !== "dimension") {
		throw new Error("placeDimensionBetweenPoints: invalid cursorMode");
	}

	const currentLength = Math.round(geometry.pointDistance(from.position, to.position));
	const relativePlacement = geometry.pointSubtract(
		atWorld,
		geometry.linearSum([0.5, from.position], [0.5, to.position]),
	);
	const dimension = new figures.DimensionPointDistanceFigure(from, to, currentLength, relativePlacement);
	if (dimension.edit()) {
		boardFigures.push(dimension);
		cursorMode.constraining = [];
	}
}

function placeAngleDimensionBetweenSegments(
	a: figures.SegmentFigure,
	b: figures.SegmentFigure,
	atWorld: geometry.Position,
) {
	if (cursorMode.tag !== "dimension") {
		throw new Error("placeDimensionBetweenPoints: invalid cursorMode");
	}

	const va = geometry.pointSubtract(a.to.position, a.from.position);
	const vb = geometry.pointSubtract(b.to.position, b.from.position);
	const dot = Math.abs(geometry.pointDot(geometry.pointUnit(va), geometry.pointUnit(vb)));
	const angle = Math.round(Math.acos(dot) * 180 / Math.PI);

	const relativePlacement = geometry.pointSubtract(
		atWorld,
		geometry.linearSum([0.5, a.midpoint()], [0.5, b.midpoint()]),
	);
	const dimension = new figures.DimensionSegmentAngleFigure(a, b, angle, relativePlacement);
	if (dimension.edit()) {
		boardFigures.push(dimension);
		cursorMode.constraining = [];
	}
}

function placePointSegmentDistanceDimension(
	point: figures.PointFigure,
	segment: figures.SegmentFigure,
	atWorld: geometry.Position,
) {
	if (cursorMode.tag !== "dimension") {
		throw new Error("placeDimensionBetweenPoints: invalid cursorMode");
	}

	const nearestToLine = segment.nearestToLine(point.position);
	const currentDistance = geometry.pointDistance(point.position, nearestToLine);
	const relativePlacement = geometry.pointSubtract(
		atWorld,
		geometry.linearSum([0.5, nearestToLine], [0.5, point.position]),
	);
	const dimension = new figures.DimensionPointSegmentDistanceFigure(point, segment, Math.round(currentDistance), relativePlacement);
	if (dimension.edit()) {
		boardFigures.push(dimension);
		cursorMode.constraining = [];
	}
}

function convertSelectedFiguresToDimensionType(): null
	| { tag: "point-point-distance", from: figures.PointFigure, to: figures.PointFigure }
	| { tag: "segment-angle", from: figures.SegmentFigure, to: figures.SegmentFigure }
	| { tag: "point-segment-distance", point: figures.PointFigure, segment: figures.SegmentFigure } {
	if (cursorMode.tag !== "dimension") {
		return null;
	}

	if (cursorMode.constraining.length === 1) {
		const [a] = cursorMode.constraining;
		if (a instanceof figures.SegmentFigure) {
			return { tag: "point-point-distance", from: a.from, to: a.to };
		}
	} else if (cursorMode.constraining.length === 2) {
		const [a, b] = cursorMode.constraining;
		if (a instanceof figures.PointFigure && b instanceof figures.PointFigure) {
			return { tag: "point-point-distance", from: a, to: b };
		} else if (a instanceof figures.SegmentFigure && b instanceof figures.SegmentFigure) {
			// TODO: When exactly parallel, change to distance constraint
			return { tag: "segment-angle", from: a, to: b };
		} else if (a instanceof figures.PointFigure && b instanceof figures.SegmentFigure) {
			return {
				tag: "point-segment-distance",
				point: a,
				segment: b,
			};
		} else if (a instanceof figures.SegmentFigure && b instanceof figures.PointFigure) {
			return {
				tag: "point-segment-distance",
				point: b,
				segment: a,
			};
		}
	}

	return null;
}

function dimensioningClick(cursorScreen: geometry.Position): void {
	const hovering: undefined | figures.Figure = getMouseHovering(cursorScreen)[0];

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
		const constraining = convertSelectedFiguresToDimensionType();
		if (constraining !== null) {
			if (constraining.tag === "point-point-distance") {
				placeDimensionBetweenPoints(constraining.from, constraining.to, view.toWorld(cursorScreen));
			} else if (constraining.tag === "segment-angle") {
				placeAngleDimensionBetweenSegments(constraining.from, constraining.to, view.toWorld(cursorScreen));
			} else if (constraining.tag === "point-segment-distance") {
				placePointSegmentDistanceDimension(constraining.point, constraining.segment, view.toWorld(cursorScreen));
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

function moveDragged(cursorScreen: geometry.Position) {
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

	data.inPlaceFilter(boardFigures, f => !queue.has(f));
}

about.canvas.addEventListener("mouseup", e => {
	const cursorScreen = cursorPosition(e);

	if (e.button === 1) {
		panStart = null;
		e.preventDefault();
		return;
	}

	if (cursorMode.tag === "move") {
		moveDragged(cursorScreen);

		if (cursorMode.doubleClick) {
			if (cursorMode.screenFence !== null) {
				if (cursorMode.dragging !== null) {
					if (cursorMode.dragging.figure instanceof figures.AbstractDimensionFigure) {
						cursorMode.dragging.figure.edit();
					}
				}
			}
		}

		cursorMode.dragging = null;
	}
});

let panStart: null | { viewCenter: geometry.Position, cursorScreen: geometry.Position } = null;

about.canvas.addEventListener("mousedown", e => {
	const cursorScreen = cursorPosition(e);

	if (e.button === 1) {
		panStart = {
			viewCenter: view.center,
			cursorScreen
		};
		e.preventDefault();
		return;
	}

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
			} else if (hovering instanceof figures.AbstractDimensionFigure) {
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
	} else if (cursorMode.tag === "orthogonal") {
		if (e.button === 0) {
			const hovering: figures.Figure | undefined = getMouseHovering(cursorScreen)[0];
			if (hovering instanceof figures.SegmentFigure) {
				// Toggle a horizontal/vertical
				const direction = geometry.pointSubtract(hovering.to.position, hovering.from.position);
				if (direction.x === 0 && direction.y === 0) {
					return;
				}

				// Delete any existing fixed angle constraint
				const orthogonalAngle = Math.abs(direction.x) >= Math.abs(direction.y)
					? 0 : 90;
				let deleted = false;
				for (const figure of boardFigures) {
					if (!(figure instanceof figures.ConstraintFixedAngle)) {
						continue;
					}
					const samePoints = (figure.from === hovering.from && figure.to === hovering.to) ||
						(figure.from === hovering.to && figure.to === hovering.from);
					if (samePoints) {
						deleteFigure(figure);
						deleted = true;
					}
				}

				if (!deleted) {
					// Create a new fixed angle constraint
					const constraint = new figures.ConstraintFixedAngle(hovering.from, hovering.to, orthogonalAngle);
					boardFigures.push(constraint);
				}
			}
		}
		return false;
	}

	const _: never = cursorMode;
	console.error("unhandled cursor mode", cursorMode["tag"]);
});

about.canvas.addEventListener("contextmenu", e => e.preventDefault());

document.addEventListener("keydown", e => {
	if (document.activeElement === document.body) {
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (cursorMode.tag === "move" && cursorMode.selected !== null) {
				deleteFigure(cursorMode.selected);
			}
		}
	}
});

function readFileText(file: File): Promise<string> {
	return new Promise(resolve => {
		const reader = new FileReader();
		reader.addEventListener("loadend", function () {
			resolve(this.result as string);
		});
		reader.readAsText(file, "utf-8");
	});
}

document.body.addEventListener("dragenter", e => e.preventDefault());
document.body.addEventListener("dragover", e => e.preventDefault());
document.body.addEventListener("drop", async e => {
	const file = e.dataTransfer?.files[0];
	e.preventDefault();
	if (file) {
		const json = await readFileText(file);
		const loadedFigures = saving.deserializeFigures(json);
		boardFigures.splice(0, boardFigures.length);
		boardFigures.push(...loadedFigures);
		recenterView(boardFigures, 25.4 / 2);
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
	} else if (modeOrthogonalRadio.checked) {
		cursorMode = {
			tag: "orthogonal",
		};
	}
}

const modeMoveRadio = document.getElementById("mode-move") as HTMLInputElement;
const modeLinesRadio = document.getElementById("mode-lines") as HTMLInputElement;
const modeDimensionRadio = document.getElementById("mode-dimension") as HTMLInputElement;
const modeOrthogonalRadio = document.getElementById("mode-orthogonal") as HTMLInputElement;

modeMoveRadio.addEventListener("input", modeChange);
modeLinesRadio.addEventListener("input", modeChange);
modeDimensionRadio.addEventListener("input", modeChange);
modeOrthogonalRadio.addEventListener("input", modeChange);

modeChange();

function recalculateConstraints() {
	const pointName = new Map<figures.PointFigure, string>();
	const variables = new Map<string, geometry.Position>();
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

	variables.set("origin", { x: 0, y: 0 });
	variables.set("x-axis", { x: 1, y: 0 });
	cs.push({
		tag: "fixed",
		a: "origin",
		position: { x: 0, y: 0 },
	});
	cs.push({
		tag: "fixed",
		a: "x-axis",
		position: { x: 1, y: 0 },
	});

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
		} else if (figure instanceof figures.DimensionPointSegmentDistanceFigure) {
			cs.push({
				tag: "segment-distance",
				a: getVariableName(figure.a),
				b: {
					p0: getVariableName(figure.b.from),
					p1: getVariableName(figure.b.to),
				},
				distance: figure.distance,
			});
		} else if (figure instanceof figures.ConstraintFixedAngle) {
			cs.push({
				tag: "angle",
				a: {
					p0: "origin",
					p1: "x-axis",
				},
				b: {
					p0: getVariableName(figure.from),
					p1: getVariableName(figure.to),
				},
				angleRadians: figure.angleDegrees * Math.PI / 180,
			});
		}
	}

	if ((document.getElementById("enforce-constraints") as HTMLInputElement).checked) {
		const serialization = saving.serializeFigures(boardFigures);
		if (serialization !== lastSerialization) {
			const solution = constraints.solve(variables, cs);
			for (const [variableName, newPosition] of solution.solution) {
				if (pointByName.has(variableName)) {
					const point = pointByName.get(variableName)!;
					point.position = newPosition;
				}
			}

			logDiv.innerHTML = "";
			const showGamut = (gamut: constraints.Gamut): string => {
				if (gamut.tag === "union") {
					return "(" + gamut.union.map(showGamut).join(" | ") + ")";
				}
				return gamut.tag;
			};
			const table = document.createElement("table");
			for (const row of solution.log) {
				const tr = document.createElement("tr");
				const th = document.createElement("th");
				const td = document.createElement("td");
				th.textContent = row.localSolution.freedom.toString();
				td.textContent = row.localSolution.constraints.map(showGamut).join(" & ");
				tr.appendChild(th);
				tr.appendChild(td);
				table.appendChild(tr);
				tr.addEventListener("mouseenter", () => {
					highlightedIntersection = {
						point: row.solution,
						gamuts: row.localSolution.constraints,
					};
				});
			}
			table.addEventListener("mouseleave", () => {
				highlightedIntersection = { point: null, gamuts: [] };
			});

			logDiv.appendChild(table);

			lastSerialization = serialization;
		}
	}
}

let highlightedIntersection: { gamuts: constraints.Gamut[], point: geometry.Position | null } = { point: null, gamuts: [] };

let lastSerialization = "";

const logDiv = document.getElementById("log-div") as HTMLDivElement;

const saveButton = document.getElementById("save-button") as HTMLButtonElement;
const saveNameInput = document.getElementById("save-name") as HTMLInputElement;

saveButton.addEventListener("click", () => {
	let filename = saveNameInput.value || "sketch";
	if (!filename.toLowerCase().endsWith(".json")) {
		filename += ".json";
	}

	const text = saving.serializeFigures(boardFigures);
	saving.downloadTextFile(filename, text);
});

function resizeCanvasToBody() {
	about.canvas.width = document.body.clientWidth;
	about.canvas.height = document.body.clientHeight;
}

const viewModeSelect = document.getElementById("view-mode") as HTMLSelectElement;
viewModeSelect.addEventListener("input", () => {
	const rangeMm = recenterView(boardFigures, 25.4 / 2);

	if (viewModeSelect.value.startsWith("print")) {
		const pixelsPerMm = parseInt(viewModeSelect.value.substring(5), 10) / 25.4;
		about.canvas.style.width = Math.round(rangeMm.x) + "mm";
		about.canvas.style.height = Math.round(rangeMm.y) + "mm";
		about.canvas.width = Math.round(pixelsPerMm * rangeMm.x);
		about.canvas.height = Math.round(pixelsPerMm * rangeMm.y);
		view.pixelsPerMilli = pixelsPerMm;
	} else if (viewModeSelect.value === "edit") {
		const pixelsPerMm = 72 / 25.4;
		view.pixelsPerMilli = pixelsPerMm;
		about.canvas.style.width = "auto";
		about.canvas.style.height = "auto";
		resizeCanvasToBody();
	}
});

window.addEventListener("resize", () => {
	if (viewModeSelect.value === "edit") {
		resizeCanvasToBody();
	}
});

resizeCanvasToBody();

document.body.insertBefore(about.canvas, document.body.firstChild);

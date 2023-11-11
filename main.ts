import { Position, Segment, pointDistance } from "./geometry.js";
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
}

type Figure = PointFigure | SegmentFigure;

const figures: Figure[] = [
	new PointFigure({ x: 0, y: 0 }),
	new PointFigure({ x: 100, y: 0 }),
	new PointFigure({ x: 0, y: 200 }),
];

figures.push(new SegmentFigure(figures[1] as PointFigure, figures[2] as PointFigure));

let lastMouseCursor: Position = { x: 0, y: 0 };

function screenDistanceToFigure(figure: Figure, screenQuery: Position): number {
	const POINT_RADIUS = 5;
	const LINE_RADIUS = 3;
	if (figure instanceof PointFigure) {
		const onScreen = view.toScreen(figure.position);
		return pointDistance(onScreen, screenQuery) - POINT_RADIUS;
	} else if (figure instanceof SegmentFigure) {
		const screenSegment = new Segment(
			view.toScreen(figure.from.position),
			view.toScreen(figure.to.position)
		);
		const m = screenSegment.nearestToSegment(screenQuery);
		const out = pointDistance(m.position, screenQuery) - LINE_RADIUS;
		return out;
	}
	const _: never = figure;
	throw new Error("unhandled figure tag: " + String(figure));
}

const BACKGROUND_COLOR = "#FFFFFF";
const REGULAR_INK_COLOR = "#000000";
const HOVER_COLOR = "#00AA55";

const OUTLINE_WIDTH = 2;
const SEGMENT_WIDTH = 3.5;
const POINT_DIAMETER = 5.5;

function figureOrdering(f: Figure) {
	if (f instanceof PointFigure) {
		return 3000;
	} else if (f instanceof SegmentFigure) {
		return 2000;
	} else {
		return 9000;
	}
}

function getMouseHovering(): Figure[] {
	return figures
		.map(figure => ({ figure, distance: screenDistanceToFigure(figure, lastMouseCursor) }))
		.filter(x => x.distance <= POINT_DIAMETER + OUTLINE_WIDTH + 1)
		.sort((a, b) => a.distance - b.distance)
		.map(x => x.figure);
}

function rerender(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const hovering = getMouseHovering();

	for (const figure of figures.slice().sort((a, b) => figureOrdering(a) - figureOrdering(b))) {
		let ink = figure === hovering[0]
			? HOVER_COLOR
			: REGULAR_INK_COLOR;
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
		} else {
			const _: never = figure;
			console.error("rerender: unhandled figure", figure);
		}
	}
}

about.canvas.addEventListener("mousemove", e => {
	if (!(e.currentTarget instanceof HTMLCanvasElement)) {
		throw new Error("unreachable");
	}
	const rect = e.currentTarget.getBoundingClientRect();
	lastMouseCursor = {
		x: e.clientX - rect.left,
		y: e.clientY - rect.top,
	};
});

about.canvas.addEventListener("mousedown", e => {

});

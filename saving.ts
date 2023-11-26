import * as figures from "./figures.js";
import { Position } from "./geometry.js";

type FigureID = string;

type SerializedFigure = {
	class: "PointFigure",
	position: Position,
} | {
	class: "SegmentFigure",
	from: FigureID,
	to: FigureID,
} | {
	class: "ArcFigure",
	center: FigureID,
	end1: FigureID,
	end2: FigureID,
} | {
	class: "DimensionPointDistanceFigure",
	from: FigureID,
	to: FigureID,
	distance: number,
	relativePlacement: Position,
} | {
	class: "DimensionPointSegmentDistanceFigure",
	a: FigureID,
	b: FigureID,
	distance: number,
	relativePlacement: Position,
} | {
	class: "DimensionSegmentAngleFigure",
	from: FigureID,
	to: FigureID,
	angleDegrees: number,
	relativePlacement: Position,
} | {
	class: "ConstraintFixedAngle",
	from: FigureID,
	to: FigureID,
	angleDegrees: number,
};

function serializeFigure(
	figure: figures.Figure,
	figureIDs: (figure: figures.Figure) => FigureID,
): SerializedFigure {
	if (figure instanceof figures.PointFigure) {
		return {
			class: "PointFigure",
			position: figure.position,
		};
	} else if (figure instanceof figures.SegmentFigure) {
		return {
			class: "SegmentFigure",
			from: figureIDs(figure.from),
			to: figureIDs(figure.to),
		};
	} else if (figure instanceof figures.ArcFigure) {
		return {
			class: "ArcFigure",
			center: figureIDs(figure.center),
			end1: figureIDs(figure.end1),
			end2: figureIDs(figure.end2),
		};
	} else if (figure instanceof figures.DimensionPointDistanceFigure) {
		return {
			class: "DimensionPointDistanceFigure",
			from: figureIDs(figure.from),
			to: figureIDs(figure.to),
			distance: figure.distance,
			relativePlacement: figure.relativePlacement,
		};
	} else if (figure instanceof figures.DimensionPointSegmentDistanceFigure) {
		return {
			class: "DimensionPointSegmentDistanceFigure",
			a: figureIDs(figure.a),
			b: figureIDs(figure.b),
			distance: figure.distance,
			relativePlacement: figure.relativePlacement,
		};
	} else if (figure instanceof figures.DimensionSegmentAngleFigure) {
		return {
			class: "DimensionSegmentAngleFigure",
			from: figureIDs(figure.from),
			to: figureIDs(figure.to),
			angleDegrees: figure.angleDegrees,
			relativePlacement: figure.relativePlacement,
		};
	} else if (figure instanceof figures.ConstraintFixedAngle) {
		return {
			class: "ConstraintFixedAngle",
			from: figureIDs(figure.from),
			to: figureIDs(figure.to),
			angleDegrees: figure.angleDegrees,
		};
	}
	console.error("unknown figure:", figure);
	throw new Error("unknown figure in serialization");
}

export function serializeFigures(seq: figures.Figure[]): string {
	const figureIDMap = new Map<figures.Figure, string>();
	const figureIDs = (figure: figures.Figure): string => {
		const existing = figureIDMap.get(figure);
		if (existing !== undefined) {
			return existing;
		}
		const name = "f" + figureIDMap.size;
		figureIDMap.set(figure, name);
		return name;
	};

	const out: Record<string, object> = {};
	for (const figure of seq) {
		const id = figureIDs(figure);
		out[id] = serializeFigure(figure, figureIDs)
	}
	return JSON.stringify({ figures: out });
}

export function deserializeFigure(
	object: SerializedFigure,
	figureWithID: (id: string) => figures.Figure,
): figures.Figure {
	if (object.class === "ConstraintFixedAngle") {
		return new figures.ConstraintFixedAngle(
			figureWithID(object.from) as figures.PointFigure,
			figureWithID(object.to) as figures.PointFigure,
			object.angleDegrees,
		);
	} else if (object.class === "DimensionPointDistanceFigure") {
		return new figures.DimensionPointDistanceFigure(
			figureWithID(object.from) as figures.PointFigure,
			figureWithID(object.to) as figures.PointFigure,
			object.distance,
			object.relativePlacement,
		);
	} else if (object.class === "DimensionPointSegmentDistanceFigure") {
		return new figures.DimensionPointSegmentDistanceFigure(
			figureWithID(object.a) as figures.PointFigure,
			figureWithID(object.b) as figures.SegmentFigure,
			object.distance,
			object.relativePlacement,
		);
	} else if (object.class === "DimensionSegmentAngleFigure") {
		return new figures.DimensionSegmentAngleFigure(
			figureWithID(object.from) as figures.SegmentFigure,
			figureWithID(object.to) as figures.SegmentFigure,
			object.angleDegrees,
			object.relativePlacement,
		);
	} else if (object.class === "PointFigure") {
		return new figures.PointFigure(
			object.position,
		);
	} else if (object.class === "SegmentFigure") {
		return new figures.SegmentFigure(
			figureWithID(object.from) as figures.PointFigure,
			figureWithID(object.to) as figures.PointFigure,
		);
	} else if (object.class === 'ArcFigure') {
		return new figures.ArcFigure(
			figureWithID(object.center) as figures.PointFigure,
			figureWithID(object.end1) as figures.PointFigure,
			figureWithID(object.end2) as figures.PointFigure,
		)
	}
	const _: never = object;
	console.error("deserializeFigure:", object);
	throw new Error("deserializeFigure: unknown class: " + object["class"]);
}

export function deserializeFigures(data: string): figures.Figure[] {
	const json = JSON.parse(data) as { figures: Record<FigureID, SerializedFigure> };
	const map = new Map<FigureID, figures.Figure>();
	const figureWithID = (figureID: FigureID): figures.Figure => {
		const existing = map.get(figureID);
		if (existing !== undefined) {
			return existing;
		}
		const figure = deserializeFigure(json.figures[figureID], figureWithID);
		map.set(figureID, figure);
		return figure;
	};

	return Object.keys(json.figures).map(figureWithID);
}

export function downloadTextFile(
	filename: string,
	text: string,
): void {
	const blob = new Blob([text]);
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
}

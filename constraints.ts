import * as geometry from "./geometry.js";

type DistanceConstraint = {
	tag: "distance",
	a: string,
	b: string,
	distance: number,
};

type PointSegmentDistanceConstraint = {
	tag: "segment-distance",
	a: string,
	b: { p0: string, p1: string },
	distance: number,
};

type FixedConstraint = {
	tag: "fixed",
	a: string,
	position: geometry.Position,
};

type AngleContraint = {
	tag: "angle",
	a: { p0: string, p1: string },
	b: { p0: string, p1: string },
	angleRadians: number,
};

export type Constraint = DistanceConstraint | FixedConstraint | AngleContraint | PointSegmentDistanceConstraint;

function constraintDependencies(constraint: Constraint): string[] {
	if (constraint.tag === "distance") {
		return [constraint.a, constraint.b];
	} else if (constraint.tag === "fixed") {
		return [constraint.a];
	} else if (constraint.tag === "angle") {
		return [
			constraint.a.p0,
			constraint.a.p1,
			constraint.b.p0,
			constraint.b.p1,
		];
	} else if (constraint.tag === "segment-distance") {
		return [
			constraint.a,
			constraint.b.p0,
			constraint.b.p1,
		];
	}

	const _: never = constraint;
	throw new Error("constraintDependencies: unhandled tag: " + constraint["tag"]);
}

const ONE_DIMENSIONAL_FREEDOM = 1e5;

function simplifyGamut(gamut: Gamut): Gamut {
	if (gamut.tag === "union") {
		const subUnions = gamut.gamuts.filter(x => x.tag === "union") as (Gamut & { tag: "union" })[];
		if (subUnions.length !== 0) {
			const nonUnions = gamut.gamuts.filter(x => x.tag !== "union");
			return simplifyGamut({
				tag: "union",
				gamuts: [...nonUnions, ...subUnions.flatMap(x => x.gamuts)],
			});
		} else if (gamut.gamuts.length === 1) {
			return gamut.gamuts[0];
		}

		const nonEmpty = gamut.gamuts.filter(x => !gamutEmpty(x));
		if (nonEmpty.length === 0) {
			return { tag: "void" };
		}
		return { tag: "union", gamuts: nonEmpty };
	}
	return gamut;
}

function gamutFreedom(gamut: Gamut): number {
	if (gamut.tag === "union") {
		gamut = simplifyGamut(gamut);
	}

	if (gamut.tag === "plane") {
		return ONE_DIMENSIONAL_FREEDOM ** 2;
	} else if (gamut.tag == "circle" || gamut.tag === "line") {
		return ONE_DIMENSIONAL_FREEDOM;
	} else if (gamut.tag === "point") {
		return 1;
	} else if (gamut.tag === "void") {
		return 0;
	} else if (gamut.tag === "union") {
		let sum = 0;
		for (const e of gamut.gamuts) {
			sum += gamutFreedom(e);
		}
		return sum;
	}
	const _: never = gamut;
	throw new Error("gamutFreedom: unhandled tag " + gamut["tag"]);
}

function gamutEmpty(gamut: Gamut): boolean {
	if (gamut.tag === "void") {
		return true;
	} else if (gamut.tag === "union" && gamut.gamuts.every(gamutEmpty)) {
		return true;
	}

	return false;
}

function gamutNearest(gamut: Gamut, query: geometry.Position): geometry.Position | null {
	if (gamut.tag === "plane") {
		return query;
	} else if (gamut.tag === "circle") {
		const delta = geometry.pointSubtract(query, gamut.circle.center);
		const deltaMagnitude = geometry.pointMagnitude(delta);
		if (deltaMagnitude <= geometry.EPSILON) {
			return geometry.linearSum([1, gamut.circle.center], [gamut.circle.radius, { x: 1, y: 0 }]);
		}
		return geometry.linearSum([1, gamut.circle.center], [gamut.circle.radius / deltaMagnitude, delta]);
	} else if (gamut.tag === "point") {
		return gamut.point;
	} else if (gamut.tag === "union") {
		let best = null;
		for (const e of gamut.gamuts) {
			const nearest = gamutNearest(e, query);
			if (nearest === null) continue;
			if (best === null || geometry.pointDistance(nearest, query) < geometry.pointDistance(best, query)) {
				best = nearest;
			}
		}
		return best;
	} else if (gamut.tag === "line") {
		return new geometry.Segment(gamut.line.from, gamut.line.to).nearestToLine(query).position;
	} else if (gamut.tag === "void") {
		return null;
	}
	const _: never = gamut;
	throw new Error("gamutNearest: unhandled tag " + gamut["tag"]);
}

export function solve(
	initialPoints: Map<string, geometry.Position>,
	constraints: Constraint[],
) {
	const solution = new Map<string, geometry.Position>();
	function constraintIsCertainExcept(constraint: Constraint, except: string): boolean {
		const uncertainDependency = constraintDependencies(constraint).find(dependency => {
			return dependency !== except && !solution.has(dependency);
		});
		return uncertainDependency === undefined;
	}

	const arbitrary: string[] = [];

	while (solution.size < initialPoints.size) {
		let best: null | { variable: string, gamut: Gamut } = null;
		for (const [variable, initialPoint] of initialPoints) {
			if (solution.has(variable)) {
				continue;
			}

			const relevant = constraints.filter(constraint => constraintDependencies(constraint).includes(variable));
			const certain = relevant.filter(x => constraintIsCertainExcept(x, variable));
			const localSolution = solveLocal(variable, certain, solution);

			if (gamutEmpty(localSolution)) {
				continue;
			}

			if (best === null || gamutFreedom(best.gamut) > gamutFreedom(localSolution)) {
				best = {
					variable,
					gamut: localSolution,
				};
			}
		}

		if (best === null) {
			// All remaining points are unsolvable.
			for (const [variable, initialPoint] of initialPoints) {
				if (!solution.has(variable)) {
					solution.set(variable, initialPoint);
					arbitrary.push(variable);
				}
			}
			break;
		}

		const initial = initialPoints.get(best.variable)!;
		const nearest = gamutNearest(best.gamut, initial);
		solution.set(best.variable, nearest === null ? initial : nearest);
		if (gamutFreedom(best.gamut) >= ONE_DIMENSIONAL_FREEDOM) {
			arbitrary.push(best.variable);
		}
	}

	return { solution, arbitrary };
}

type Gamut = { tag: "plane" }
	| { tag: "point", point: geometry.Position }
	| { tag: "circle", circle: geometry.Circle }
	| { tag: "line", line: geometry.Line }
	| { tag: "union", gamuts: Gamut[] }
	| { tag: "void" };

function gamutCircleIntersection(gamut: Gamut, circle: geometry.Circle, epsilon = geometry.EPSILON): Gamut {
	if (gamut.tag === "plane") {
		return { tag: "circle", circle };
	} else if (gamut.tag === "circle") {
		const intersection = geometry.circleCircleIntersection(gamut.circle, circle);
		if (intersection.tag === "circle") {
			return intersection;
		}
		return {
			tag: "union",
			gamuts: intersection.points.map(point => ({ tag: "point", point })),
		};
	} else if (gamut.tag === "point") {
		const distance = Math.abs(geometry.pointDistance(gamut.point, circle.center) - circle.radius);
		if (distance >= epsilon) {
			return { tag: "void" };
		} else {
			return gamut;
		}
	} else if (gamut.tag === "line") {
		const intersections = geometry.circleLineIntersection(circle, gamut.line);
		if (intersections.length === 0) {
			return { tag: "void" };
		}
		return {
			tag: "union",
			gamuts: intersections.map(point => ({ tag: "point", point })),
		};
	} else if (gamut.tag === "void") {
		return {
			tag: "void",
		};
	} else if (gamut.tag === "union") {
		const sub = gamut.gamuts.map(e => gamutCircleIntersection(e, circle, epsilon));
		const nonVoid = sub.filter(e => e.tag !== "void");
		if (nonVoid.length === 0) {
			return { tag: "void" };
		}
		return {
			tag: "union",
			gamuts: nonVoid,
		};
	}
	const _: never = gamut;
	throw new Error("gamutCircleIntersection: unhandled tag " + gamut["tag"]);
}

function gamutLinesIntersection(
	gamut: Gamut,
	lines: geometry.Line[],
	epsilon = geometry.EPSILON,
): Gamut {
	if (gamut.tag === "plane") {
		return {
			tag: "union",
			gamuts: lines.map(line => ({ tag: "line", line }))
		};
	} else if (gamut.tag === "circle") {
		const out: Gamut[] = [];
		for (const line of lines) {
			const points = geometry.circleLineIntersection(gamut.circle, line);
			out.push(...points.map(point => ({ tag: "point" as const, point })));
		}
		return { tag: "union", gamuts: out };
	} else if (gamut.tag === "line") {
		const out: Gamut[] = [];
		for (const line of lines) {
			const pointOrNull = geometry.lineIntersection(line, gamut.line);
			if (pointOrNull !== null) {
				out.push({ tag: "point", point: pointOrNull });
			} else {
				// The lines are parallel. They may not intersect,
				// or they may be identical.
				const nearest = new geometry.Segment(line.from, line.to).nearestToLine(gamut.line.from).position;
				const separation = geometry.pointDistance(gamut.line.from, nearest);
				if (separation <= geometry.EPSILON) {
					return gamut;
				}
				return { tag: "void" };
			}
		}

		return simplifyGamut({ tag: "union", gamuts: out });
	} else if (gamut.tag === "point") {
		for (const line of lines) {
			const nearest = new geometry.Segment(line.from, line.to).nearestToLine(gamut.point);
			if (geometry.pointDistance(nearest.position, gamut.point) <= geometry.EPSILON) {
				return gamut;
			}
		}
		return { tag: "void" };
	} else if (gamut.tag === "union") {
		const sub = gamut.gamuts.map(e => gamutLinesIntersection(e, lines, epsilon));
		return simplifyGamut({
			tag: "union",
			gamuts: sub,
		});
	} else if (gamut.tag === "void") {
		return { tag: "void" };
	}
	const _: never = gamut;
	throw new Error("gamutLinesIntersection: unhandled tag " + gamut["tag"]);
}

function solveLocal(
	variable: string,
	constraints: Constraint[],
	solution: Map<string, geometry.Position>,
): Gamut {
	const fixed = constraints.find(x => x.tag === "fixed" && x.a === variable) as FixedConstraint | undefined;
	if (fixed !== undefined) {
		return { tag: "point", point: fixed.position };
	}

	// Find the intersection of the feasible areas of other constraints.
	let gamut: Gamut = { tag: "plane" };
	for (const c of constraints) {
		if (c.tag === "distance") {
			if (variable === c.a) {
				const limit = {
					center: solution.get(c.b)!,
					radius: c.distance,
				};
				gamut = gamutCircleIntersection(gamut, limit);
			} else if (variable === c.b) {
				const limit = {
					center: solution.get(c.a)!,
					radius: c.distance,
				};
				gamut = gamutCircleIntersection(gamut, limit);
			}
		} else if (c.tag === "angle") {
			// It lies on one of two lines that form a given angle with the other line.
			const [myLine, otherLine] = (variable === c.a.p0 || variable === c.a.p1)
				? [c.a, c.b]
				: [c.b, c.a];
			const otherPoint = myLine.p0 === variable
				? myLine.p1
				: myLine.p0;

			if (otherLine.p0 === variable || otherLine.p1 === variable) {
				// variable point must lie on a circle defined by the
				// Inscribed Angle Theorem
				const angleFirst = solution.get(myLine.p0) || solution.get(myLine.p1);
				if (angleFirst === undefined) throw new Error("angleFirst");
				const angleSecond = solution.get(otherLine.p0) || solution.get(otherLine.p1);
				if (angleSecond === undefined) throw new Error("angleSecond");

				const isoscelesBase = geometry.pointDistance(angleFirst, angleSecond);
				const isoscelesHeight = (isoscelesBase / 2) / Math.tan(c.angleRadians);
				const direction = geometry.pointUnit(geometry.pointSubtract(angleSecond, angleFirst));
				if (!isFinite(direction.x)) return gamut;

				const perpendicular = { x: -direction.y, y: direction.x };
				const centerPositive = geometry.linearSum(
					[0.5, angleFirst],
					[0.5, angleSecond],
					[isoscelesHeight, perpendicular],
				);
				const centerNegative = geometry.linearSum(
					[0.5, angleFirst],
					[0.5, angleSecond],
					[-isoscelesHeight, perpendicular],
				);
				const radius = geometry.pointDistance(centerPositive, angleFirst);
				gamut = {
					tag: "union",
					gamuts: [
						gamutCircleIntersection(gamut, { center: centerNegative, radius }),
						gamutCircleIntersection(gamut, { center: centerPositive, radius }),
					],
				};
			} else {
				// Construct two rotated copies of otherLine, through otherPoint
				const p1Solution = solution.get(otherLine.p1);
				const p0Solution = solution.get(otherLine.p0);
				if (p0Solution === undefined || p1Solution === undefined) {
					console.error(solution);
					console.error("angleConstraint:", c);
					console.error("upon", variable);
					throw new Error("p0Solution or p1Solution is undefined; otherLine: " + JSON.stringify(otherLine));
				}

				const otherLineDirection = geometry.pointSubtract(p1Solution, p0Solution);
				const otherLineRadians = Math.atan2(otherLineDirection.y, otherLineDirection.x);
				const anglePositive = otherLineRadians + c.angleRadians;
				const angleNegative = otherLineRadians - c.angleRadians;
				const directionPositive = { x: Math.cos(anglePositive), y: Math.sin(anglePositive) };
				const directionNegative = { x: Math.cos(angleNegative), y: Math.sin(angleNegative) };

				const otherPointPosition = solution.get(otherPoint)!;
				const lines: geometry.Line[] = [
					{
						from: otherPointPosition,
						to: geometry.linearSum([1, otherPointPosition], [1, directionPositive]),
					},
					{
						from: otherPointPosition,
						to: geometry.linearSum([1, otherPointPosition], [1, directionNegative]),
					},
				];

				gamut = gamutLinesIntersection(gamut, lines);
			}
		} else if (c.tag === "segment-distance") {
			if (c.a === c.b.p0 || c.a === c.b.p1) {
				return gamut;
			} else if (variable === c.a) {
				// variable lies on one of the lines offset from b
				throw new Error("TODO!");
			} else {
				// The b_T lies on one of the lines that makes a theta angle
				// with (b_t, a).
				const a = solution.get(c.a)!;
				const segmentFixed = solution.get(variable === c.b.p0 ? c.b.p1 : c.b.p0)!;
				const theta = Math.asin(c.distance / geometry.pointDistance(a, segmentFixed));
				if (!isFinite(theta)) {
					return gamut;
				}

				const toA = geometry.pointUnit(geometry.pointSubtract(a, segmentFixed));
				if (!isFinite(toA.x)) {
					return gamut;
				}
				const perpendicularA = { x: -toA.y, y: toA.x };

				const lines: geometry.Line[] = [
					{
						from: segmentFixed,
						to: geometry.linearSum(
							[1, segmentFixed],
							[1, toA],
							[Math.tan(theta), perpendicularA],
						),
					},
					{
						from: segmentFixed,
						to: geometry.linearSum(
							[1, segmentFixed],
							[1, toA],
							[-Math.tan(theta), perpendicularA],
						),
					},
				];
				gamut = gamutLinesIntersection(gamut, lines, geometry.EPSILON);
			}
		}
	}

	return gamut;
}

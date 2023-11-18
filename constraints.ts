import { sortedBy } from "./data.js";
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
		const flat = gamut.union
			.flatMap(element => {
				const simplifiedElement = simplifyGamut(element);
				if (simplifiedElement.tag === "union") {
					return simplifiedElement.union;
				}
				return [simplifiedElement];
			})
			.filter(x => x.tag !== "void");

		if (flat.length === 0) {
			return { tag: "void" };
		} else if (flat.length === 1) {
			return flat[0];
		}

		return { tag: "union", union: flat };
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
		for (const e of gamut.union) {
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
	} else if (gamut.tag === "union" && gamut.union.every(gamutEmpty)) {
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
		for (const e of gamut.union) {
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

	const log = [];
	while (solution.size < initialPoints.size) {
		const remaining = [];
		for (const [variable, initialPoint] of initialPoints) {
			if (solution.has(variable)) {
				continue;
			}

			const relevant = constraints.filter(constraint => constraintDependencies(constraint).includes(variable));
			const certain = relevant.filter(x => constraintIsCertainExcept(x, variable));
			const localSolution = solveLocal(variable, certain, solution);
			remaining.push({
				variable,
				localSolution,
				initialPoint,
			});
		}

		const byConstrainment = sortedBy(remaining, r => r.localSolution.freedom === 0
			? Infinity
			: r.localSolution.freedom);

		const mostConstrained = byConstrainment[0];
		const nearest = gamutNearest(mostConstrained.localSolution.intersection, mostConstrained.initialPoint)
			|| mostConstrained.initialPoint;
		log.push({ ...mostConstrained, solution: nearest });
		solution.set(mostConstrained.variable, nearest);
	}

	return { solution, log };
}

export type Gamut = { tag: "plane" }
	| { tag: "point", point: geometry.Position }
	| { tag: "circle", circle: geometry.Circle }
	| { tag: "line", line: geometry.Line }
	| { tag: "union", union: Gamut[] }
	| { tag: "void" };

function gamutCircleIntersection(gamut: Gamut, circle: geometry.Circle, epsilon = geometry.EPSILON): Gamut {
	if (gamut.tag === "plane") {
		return { tag: "circle", circle };
	} else if (gamut.tag === "circle") {
		const intersection = geometry.circleCircleIntersection(gamut.circle, circle, epsilon);
		if (intersection.tag === "circle") {
			return intersection;
		}
		return {
			tag: "union",
			union: intersection.points.map(point => ({ tag: "point", point })),
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
			union: intersections.map(point => ({ tag: "point", point })),
		};
	} else if (gamut.tag === "void") {
		return {
			tag: "void",
		};
	} else if (gamut.tag === "union") {
		const sub = gamut.union.map(e => gamutCircleIntersection(e, circle, epsilon));
		return simplifyGamut({ tag: "union", union: sub });
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
			union: lines.map(line => ({ tag: "line", line }))
		};
	} else if (gamut.tag === "circle") {
		const out: Gamut[] = [];
		for (const line of lines) {
			const points = geometry.circleLineIntersection(gamut.circle, line, epsilon);
			out.push(...points.map(point => ({ tag: "point" as const, point })));
		}
		return { tag: "union", union: out };
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

		return simplifyGamut({ tag: "union", union: out });
	} else if (gamut.tag === "point") {
		for (const line of lines) {
			const nearest = new geometry.Segment(line.from, line.to).nearestToLine(gamut.point);
			if (geometry.pointDistance(nearest.position, gamut.point) <= geometry.EPSILON) {
				return gamut;
			}
		}
		return { tag: "void" };
	} else if (gamut.tag === "union") {
		const sub = gamut.union.map(e => gamutLinesIntersection(e, lines, epsilon));
		return simplifyGamut({
			tag: "union",
			union: sub,
		});
	} else if (gamut.tag === "void") {
		return { tag: "void" };
	}
	const _: never = gamut;
	throw new Error("gamutLinesIntersection: unhandled tag " + gamut["tag"]);
}

/**
 * Fixing the positions of its neighbors according to `fixed`,
 * find the locus of points that `variable` may lie on to satisfy the
 * constraint.
 */
function localConstraintToGamut(
	variable: string,
	constraint: Constraint,
	fixed: Map<string, geometry.Position>,
	epsilon: number,
): Gamut {
	if (constraint.tag === "fixed") {
		return {
			tag: "point",
			point: constraint.position,
		};
	} else if (constraint.tag === "distance") {
		const fixedPoint = constraint.a === variable
			? fixed.get(constraint.b)!
			: fixed.get(constraint.a)!;
		return {
			tag: "circle",
			circle: {
				center: fixedPoint,
				radius: constraint.distance,
			},
		};
	} else if (constraint.tag === "angle") {
		const [myLine, otherLine] = (variable === constraint.a.p0 || variable === constraint.a.p1)
			? [constraint.a, constraint.b]
			: [constraint.b, constraint.a];

		if (otherLine.p0 === variable || otherLine.p1 === variable) {
			// variable point must lie on a circle defined by the
			// Inscribed Angle Theorem
			const angleFirst = fixed.get(myLine.p0) || fixed.get(myLine.p1);
			if (angleFirst === undefined) throw new Error("angleFirst");
			const angleSecond = fixed.get(otherLine.p0) || fixed.get(otherLine.p1);
			if (angleSecond === undefined) throw new Error("angleSecond");

			const isoscelesBase = geometry.pointDistance(angleFirst, angleSecond);
			const isoscelesHeight = (isoscelesBase / 2) / Math.tan(constraint.angleRadians);
			const direction = geometry.pointUnit(geometry.pointSubtract(angleSecond, angleFirst));
			if (!isFinite(direction.x)) return { tag: "void" };

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
			return {
				tag: "union",
				union: [
					{
						tag: "circle",
						circle: { center: centerNegative, radius },
					},
					{
						tag: "circle",
						circle: { center: centerPositive, radius },
					},
				],
			};
		} else {
			// Construct two rotated copies of otherLine, through otherPoint
			const p1Solution = fixed.get(otherLine.p1);
			const p0Solution = fixed.get(otherLine.p0);
			if (p0Solution === undefined || p1Solution === undefined) {
				console.error(fixed);
				console.error("angleConstraint:", constraint);
				console.error("upon", variable);
				throw new Error("p0Solution or p1Solution is undefined; otherLine: " + JSON.stringify(otherLine));
			}

			const otherLineDirection = geometry.pointSubtract(p1Solution, p0Solution);
			if (geometry.pointMagnitude(otherLineDirection) < epsilon) {
				// The direction of the other line segment is ambiguous,
				// and so it doesn't constrain variable.
				return { tag: "plane" };
			}

			const otherLineRadians = Math.atan2(otherLineDirection.y, otherLineDirection.x);
			const anglePositive = otherLineRadians + constraint.angleRadians;
			const angleNegative = otherLineRadians - constraint.angleRadians;
			const directionPositive = { x: Math.cos(anglePositive), y: Math.sin(anglePositive) };
			const directionNegative = { x: Math.cos(angleNegative), y: Math.sin(angleNegative) };

			const otherPoint = myLine.p0 === variable
				? myLine.p1
				: myLine.p0;
			const otherPointPosition = fixed.get(otherPoint)!;

			const lines: Gamut[] = [
				{
					tag: "line", line: {
						from: otherPointPosition,
						to: geometry.linearSum([1, otherPointPosition], [1, directionPositive]),
					}
				},
				{
					tag: "line", line: {
						from: otherPointPosition,
						to: geometry.linearSum([1, otherPointPosition], [1, directionNegative]),
					},
				},
			];
			if (Math.abs(constraint.angleRadians) <= epsilon || Math.abs(constraint.angleRadians - Math.PI / 2) <= epsilon) {
				lines.pop();
			}

			return {
				tag: "union",
				union: lines,
			};
		}
	} else if (constraint.tag === "segment-distance") {
		if (constraint.a === constraint.b.p0 || constraint.a === constraint.b.p1) {
			return { tag: "plane" };
		} else if (variable === constraint.a) {
			// variable lies on one of the lines offset from b
			const from = fixed.get(constraint.b.p0)!;
			const to = fixed.get(constraint.b.p1)!;
			const parallel = geometry.pointUnit(geometry.pointSubtract(to, from));
			if (!isFinite(parallel.x)) {
				// The direction is ambiguous.
				// The entire plane (minus a disc of less than distance radius)
				// is reachable.
				return { tag: "plane" };
			}
			const perpendicular = { x: -parallel.y, y: parallel.x };
			return {
				tag: "union",
				union: [
					{
						tag: "line", line: {
							from: geometry.linearSum([1, from], [constraint.distance, perpendicular]),
							to: geometry.linearSum([1, to], [constraint.distance, perpendicular]),
						},
					},
					{
						tag: "line", line:
						{
							from: geometry.linearSum([1, from], [-constraint.distance, perpendicular]),
							to: geometry.linearSum([1, to], [-constraint.distance, perpendicular]),
						},
					},
				],
			};
		} else {
			// The b_T lies on one of the lines that makes a theta angle
			// with (b_t, a).
			const a = fixed.get(constraint.a)!;
			const bOther = fixed.get(variable === constraint.b.p0 ? constraint.b.p1 : constraint.b.p0)!;
			const separationAB = geometry.pointSubtract(a, bOther);
			const separationABDistance = geometry.pointMagnitude(separationAB);
			const perpendicular = {
				x: -separationAB.y,
				y: separationAB.x,
			};
			if (separationABDistance < epsilon) {
				return { tag: "plane" };
			} else if (Math.abs(separationABDistance - constraint.distance) < epsilon) {
				return {
					tag: "line",
					line: {
						from: bOther,
						to: geometry.linearSum([1, bOther], [1, perpendicular]),
					},
				};
			}

			const theta = Math.asin(constraint.distance / separationABDistance);
			if (!isFinite(theta)) {
				return { tag: "void" };
			}

			return {
				tag: "union",
				union: [
					{
						tag: "line", line: {
							from: bOther,
							to: geometry.linearSum(
								[1, bOther],
								[1, separationAB],
								[Math.tan(theta) / separationABDistance, perpendicular],
							),
						},
					},
					{
						tag: "line", line: {
							from: bOther,
							to: geometry.linearSum(
								[1, bOther],
								[1, separationAB],
								[-Math.tan(theta) / separationABDistance, perpendicular],
							),
						},
					},
				]
			};
		}
	}
	const _: never = constraint;
	throw new Error("unhandled constraint tag: " + constraint["tag"]);
}

function gamutGamutIntersection(
	a: Gamut,
	b: Gamut,
	epsilon: number,
): Gamut {
	if (a.tag === "plane") {
		return b;
	} else if (b.tag === "plane") {
		return a;
	} else if (a.tag === "void" || b.tag === "void") {
		return { tag: "void" };
	} else if (b.tag === "union") {
		return simplifyGamut(
			{
				tag: "union",
				union: b.union.map(right => gamutGamutIntersection(a, right, epsilon)),
			}
		);
	}
	if (b.tag === "circle") {
		return gamutCircleIntersection(a, b.circle, epsilon);
	} else if (b.tag === "line") {
		return gamutLinesIntersection(a, [b.line], epsilon);
	} else if (b.tag === "point") {
		const nearest = gamutNearest(a, b.point);
		if (nearest === null || geometry.pointDistance(nearest, b.point) > epsilon) {
			return { tag: "void" };
		}
		return b;
	}

	const _: never = b;
	throw new Error("gamutGamutIntersection: unhandled tag: " + b["tag"]);
}

function solveLocal(
	variable: string,
	constraints: Constraint[],
	solution: Map<string, geometry.Position>,
): { intersection: Gamut, constraints: Gamut[], freedom: number } {
	// Find the intersection of the feasible areas of other constraints.
	let intersection: Gamut = { tag: "plane" };
	const constraintLoci = [];
	for (const constraint of constraints) {
		const constraintLocus = localConstraintToGamut(variable, constraint, solution, geometry.EPSILON);
		intersection = gamutGamutIntersection(intersection, constraintLocus, geometry.EPSILON);
		constraintLoci.push(constraintLocus);
	}

	return {
		intersection,
		constraints: constraintLoci,
		freedom: gamutFreedom(intersection),
	};
}

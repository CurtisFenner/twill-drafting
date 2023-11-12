import * as geometry from "./geometry.js";

type DistanceConstraint = {
	tag: "distance",
	a: string,
	b: string,
	distance: number,
};

type FixedConstraint = {
	tag: "fixed",
	a: string,
	position: geometry.Position,
};

type Constraint = DistanceConstraint | FixedConstraint;

function constraintDependencies(constraint: Constraint): string[] {
	if (constraint.tag === "distance") {
		return [constraint.a, constraint.b];
	} else if (constraint.tag === "fixed") {
		return [constraint.a];
	}
	const _: never = constraint;
	throw new Error("constraintDependencies: unhandled tag: " + constraint["tag"]);
}

const ONE_DIMENSIONAL_FREEDOM = 1e5;

function gamutFreedom(gamut: Gamut): number {
	if (gamut.tag === "plane") {
		return ONE_DIMENSIONAL_FREEDOM ** 2;
	} else if (gamut.tag == "circle") {
		return ONE_DIMENSIONAL_FREEDOM;
	} else if (gamut.tag === "points") {
		return gamut.points.length - 1;
	}
	const _: never = gamut;
	throw new Error("gamutFreedom: unhandled tag " + gamut["tag"]);
}

function gamutEmpty(gamut: Gamut): boolean {
	return gamut.tag === "points" && gamut.points.length === 0;
}

function gamutNearest(gamut: Gamut, query: geometry.Position): geometry.Position {
	if (gamut.tag === "plane") {
		return query;
	} else if (gamut.tag === "circle") {
		const delta = geometry.pointSubtract(query, gamut.circle.center);
		const deltaMagnitude = geometry.pointMagnitude(delta);
		if (deltaMagnitude <= geometry.EPSILON) {
			return geometry.linearSum([1, gamut.circle.center], [gamut.circle.radius, { x: 1, y: 0 }]);
		}
		return geometry.linearSum([1, gamut.circle.center], [gamut.circle.radius / deltaMagnitude, delta]);
	} else if (gamut.tag === "points") {
		if (gamut.points.length === 0) {
			return query;
		}
		let best = 0;
		for (let i = 1; i < gamut.points.length; i++) {
			if (geometry.pointDistance(query, gamut.points[i]) < geometry.pointDistance(query, gamut.points[best])) {
				best = i;
			}
		}
		return gamut.points[best];
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

		solution.set(best.variable, gamutNearest(best.gamut, initialPoints.get(best.variable)!));
		if (gamutFreedom(best.gamut) >= ONE_DIMENSIONAL_FREEDOM) {
			arbitrary.push(best.variable);
		}
	}

	return { solution, arbitrary };
}

type Gamut = { tag: "plane" }
	| { tag: "points", points: geometry.Position[] }
	| { tag: "circle", circle: geometry.Circle };

function gamutCircleIntersection(gamut: Gamut, circle: geometry.Circle, epsilon = geometry.EPSILON): Gamut {
	if (gamut.tag === "plane") {
		return { tag: "circle", circle };
	} else if (gamut.tag === "circle") {
		return geometry.circleCircleIntersection(gamut.circle, circle);
	} else if (gamut.tag === "points") {
		return {
			tag: "points",
			points: gamut.points.filter(p => Math.abs(geometry.pointDistance(p, circle.center) - circle.radius) >= epsilon),
		};
	}
	const _: never = gamut;
	throw new Error("gamutCircleIntersection: unhandled tag " + gamut["tag"]);
}

function solveLocal(
	variable: string,
	constraints: Constraint[],
	solution: Map<string, geometry.Position>,
): Gamut {
	const fixed = constraints.find(x => x.a === variable && x.tag === "fixed") as FixedConstraint | undefined;
	if (fixed !== undefined) {
		return { tag: "points", points: [fixed.position] };
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
		}
	}

	return gamut;
}

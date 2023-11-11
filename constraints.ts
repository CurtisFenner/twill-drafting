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

export function solve(
	initialPoints: Map<string, geometry.Position>,
	constraints: Constraint[],
) {
	// Basic idea:
	// Attempt going "forward" through the points.
	// If a constraint is violated, try backing up and seeing if a previous
	// point had a degree of freedom that can be exploited.
}

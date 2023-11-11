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

interface Equation {
	evaluate(point: Map<string, number>): { gradient: Map<string, number>, error: number };
}

function addInto(
	target: Map<string, number>,
	b: Map<string, number>,
	scale: number
): void {
	for (const [k, v] of b) {
		target.set(k, (target.get(k) || 0) + v * scale);
	}
}

export function gradientDescent(
	initial: Map<string, number>,
	system: Equation[],
	scale: number,
	epsilon: number,
): { solution: Map<string, number>, errors: number[], elapsed: number } {
	let best = new Map(initial);
	let bestError = Infinity;

	const before = performance.now();
	for (let k = 0; k < 20; k++) {
		let values = new Map(best);
		for (let i = 0; i < 20; i++) {
			let largest = 0;
			const totalDelta = new Map<string, number>();
			let totalError = 0;
			for (const equation of system) {
				const delta = equation.evaluate(values);
				addInto(totalDelta, delta.gradient, -scale);
				largest = Math.max(largest, ...[...delta.gradient.values()].map(Math.abs));
				totalError = delta.error;
			}
			if (largest === 0) {
				break;
			}

			if (totalError < bestError) {
				bestError = totalError;
				best = new Map(values);
			}

			if (largest > 10 * epsilon) {
				addInto(values, totalDelta, 10 * epsilon / largest);
			} else {
				addInto(values, totalDelta, 1);
			}
			console.log(k + "\t" + i + "\t", totalError.toFixed(0));
		}
		scale *= 0.95;
	}

	return {
		solution: best,
		errors: system.map(x => x.evaluate(best).error),
		bestError,
		elapsed: performance.now() - before,
	};
}

class SumFormula implements Equation {
	private members: Equation[];

	constructor(...members: Equation[]) {
		this.members = members;
	}

	evaluate(point: Map<string, number>): { gradient: Map<string, number>; error: number; } {
		const gradient = new Map<string, number>();
		let error = 0;
		for (const member of this.members) {
			const e = member.evaluate(point);
			error += e.error;
			addInto(gradient, e.gradient, 1);
		}
		return { gradient, error };
	}

	static subtract(left: Equation, right: Equation): Equation {
		return new SumFormula(left, new ProductFormula(right, new ConstantFormula(-1)));
	}

	static squareDifference(left: Equation, right: Equation): Equation {
		return ProductFormula.square(SumFormula.subtract(left, right));
	}

	toString() {
		return this.members.map(x => x.toString()).join(" + ");
	}
}

class ConstantFormula implements Equation {
	constructor(private constant: number) { }

	evaluate(point: Map<string, number>): { gradient: Map<string, number>; error: number; } {
		return {
			gradient: new Map(),
			error: this.constant,
		};
	}

	toString() {
		return this.constant.toString();
	}
}

class ProductFormula implements Equation {
	constructor(private left: Equation, private right: Equation) { }

	evaluate(point: Map<string, number>): { gradient: Map<string, number>; error: number; } {
		const left = this.left.evaluate(point);
		const right = this.right.evaluate(point);

		const gradient = new Map<string, number>();
		addInto(gradient, left.gradient, right.error);
		addInto(gradient, right.gradient, left.error);

		return {
			gradient,
			error: left.error * right.error,
		};
	}

	static square(a: Equation) {
		return new ProductFormula(a, a);
	}

	toString() {
		let leftString = this.left.toString();
		let rightString = this.right.toString();
		if (leftString.includes("+")) {
			leftString = "(" + leftString + ")";
		}
		if (rightString.includes("+")) {
			rightString = "(" + rightString + ")";
		}
		return leftString + " * " + rightString;
	}
}

class VariableFormula implements Equation {
	constructor(private variable: string) { }

	evaluate(point: Map<string, number>): { gradient: Map<string, number>; error: number; } {
		return {
			gradient: new Map([[this.variable, 1]]),
			error: point.get(this.variable) || 0,
		};
	}

	toString() {
		return this.variable;
	}
}

function squareLength(a0: string, a1: string) {
	const a0x = new VariableFormula(a0 + ".x");
	const a0y = new VariableFormula(a0 + ".y");
	const a1x = new VariableFormula(a1 + ".x");
	const a1y = new VariableFormula(a1 + ".y");

	return new SumFormula(
		SumFormula.squareDifference(a0x, a1x),
		SumFormula.squareDifference(a0y, a1y),
	);
}

export function equalLengths(
	a0: string, a1: string,
	b0: string, b1: string,
): Equation {
	const aLength = squareLength(a0, a1);
	const bLength = squareLength(b0, b1);
	return SumFormula.squareDifference(aLength, bLength);
}

export function givenLength(
	a0: string, a1: string,
	length: number,
): Equation {
	return SumFormula.squareDifference(squareLength(a0, a1), new ConstantFormula(length ** 2));
}

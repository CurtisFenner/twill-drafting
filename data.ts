export function sortedBy<T>(array: T[], f: (element: T) => number): T[] {
	return [...array].sort((a, b) => f(a) - f(b));
}

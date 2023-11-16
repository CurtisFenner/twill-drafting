export function sortedBy<T>(array: T[], f: (element: T) => number): T[] {
	return [...array].sort((a, b) => f(a) - f(b));
}

export function inPlaceFilter<T>(array: T[], predicate: (element: T) => boolean): void {
	let write = 0;
	for (let i = 0; i < array.length; i++) {
		if (predicate(array[i])) {
			array[write] = array[i];
			write += 1;
		}
	}
	array.length = write;
}

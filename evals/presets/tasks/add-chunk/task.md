Add an exported function `chunk<T>(items: T[], size: number): T[][]` to `list.ts`.
It splits `items` into consecutive arrays of at most `size` elements, keeps order, and returns `[]` for an empty input.
It throws a `RangeError` when `size` is not a positive integer. Do not change `last`.

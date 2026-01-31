// math.ts - Math utility functions
// Exported functions will be mangled as @math_add, @math_multiply, etc.

export function add(a: number, b: number): number {
    return a + b;
}

export function multiply(a: number, b: number): number {
    return a * b;
}

export function square(x: number): number {
    return multiply(x, x);
}

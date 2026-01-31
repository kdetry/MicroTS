// main.ts - Main entry point using ES module imports
import { add, multiply, square } from './math';

function main(): number {
    printf("=== Module Import Example ===\\n\\n");

    let sum: number = add(10, 20);
    printf("add(10, 20) = %d\\n", sum);

    let product: number = multiply(6, 7);
    printf("multiply(6, 7) = %d\\n", product);

    let sq: number = square(5);
    printf("square(5) = %d\\n", sq);

    // Combined: (10 + 20) * 2 = 60
    let result: number = multiply(add(10, 20), 2);
    printf("\\nmultiply(add(10, 20), 2) = %d\\n", result);

    return result;
}

// main.ts - Main entry point that uses utilities from utils.ts
// Compile with: npx ts-node src/cmd/main.ts examples/08-multifile/main.ts --run
// (The compiler will concatenate utils.ts automatically if found)

function main(): number {
    printf("=== Multifile Example ===\\n\\n");

    // Test add function
    let sum: number = add(10, 20);
    printf("add(10, 20) = %d\\n", sum);

    // Test multiply function
    let product: number = multiply(6, 7);
    printf("multiply(6, 7) = %d\\n", product);

    // Test factorial function
    let fact5: number = factorial(5);
    printf("factorial(5) = %d\\n", fact5);

    // Combined calculation
    let result: number = add(multiply(3, 4), factorial(3));
    printf("\\nadd(multiply(3, 4), factorial(3)) = %d\\n", result);

    return result;  // Should return 18 (12 + 6)
}

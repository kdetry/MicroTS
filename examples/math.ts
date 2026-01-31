// Simple math test - verify basic arithmetic operations
function main(): number {
    let a: number = 10;
    let b: number = 3;

    // Test arithmetic: (10 + 3) * 2 - 4 / 2 = 13 * 2 - 2 = 26 - 2 = 24
    let sum: number = a + b;        // 13
    let product: number = sum * 2;  // 26
    let quotient: number = 4 / 2;   // 2
    let result: number = product - quotient;  // 24

    return result;
}

// If/else test
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    let x: number = 42;
    let result: number = 0;

    // Test if/else
    if (x > 50) {
        printf("x is greater than 50\\n");
        result = 1;
    } else {
        printf("x is not greater than 50\\n");
        result = 2;
    }

    // Test if without else
    if (x == 42) {
        printf("x is exactly 42!\\n");
        result = result + 10;
    }

    // Nested if
    if (x > 0) {
        if (x < 100) {
            printf("x is between 0 and 100\\n");
        }
    }

    printf("Final result: %d\\n", result);
    return result;  // Should return 12
}

// For loop test - calculates sum of 1 to 10
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    let sum: number = 0;

    // Sum 1 + 2 + ... + 10 = 55
    for (let i: number = 1; i <= 10; i = i + 1) {
        sum = sum + i;
        printf("i=%d, sum=%d\\n", i, sum);
    }

    printf("Final sum: %d\\n", sum);
    return sum;  // Should return 55
}

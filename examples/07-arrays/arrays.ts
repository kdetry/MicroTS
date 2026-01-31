// Array test - NO DECLARES NEEDED (auto-loaded from libc.ts)
function main(): number {
    // Allocate array of 5 integers (5 * 4 bytes = 20 bytes)
    let arr: number[] = malloc(20);

    // Initialize array
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    arr[3] = 40;
    arr[4] = 50;

    // Calculate sum
    let sum: number = 0;
    for (let i: number = 0; i < 5; i = i + 1) {
        sum = sum + arr[i];
        printf("arr[%d] = %d\\n", i, arr[i]);
    }

    printf("Sum: %d\\n", sum);

    // Free the memory
    free(arr);

    return sum;  // Should return 150
}
